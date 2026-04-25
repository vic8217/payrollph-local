import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Night differential: hours between 10pm (22:00) and 6am (06:00) get +10% premium
function computeNightDiffHours(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (end <= start) return 0;

  let ndHours = 0;
  // Iterate minute by minute is expensive; instead compute overlap with ND windows
  // ND window 1: start-of-day 00:00 to 06:00
  // ND window 2: 22:00 to end-of-day 24:00
  const dateStr = start.toISOString().slice(0, 10);

  const windows = [
    [new Date(`${dateStr}T00:00:00`), new Date(`${dateStr}T06:00:00`)],
    [new Date(`${dateStr}T22:00:00`), new Date(`${dateStr}T23:59:59.999`)],
    // Next day's early window if shift crosses midnight
    [new Date(`${new Date(start.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00`),
     new Date(`${new Date(start.getTime() + 86400000).toISOString().slice(0, 10)}T06:00:00`)],
  ];

  for (const [ws, we] of windows) {
    const overlapStart = Math.max(start.getTime(), ws.getTime());
    const overlapEnd = Math.min(end.getTime(), we.getTime());
    if (overlapEnd > overlapStart) {
      ndHours += (overlapEnd - overlapStart) / 3600000;
    }
  }
  return ndHours;
}

// Compute hours worked from time segments, excluding break duration
function computeHoursWorked(timeIn, breakTimeOut, breakTimeIn, timeOut) {
  let hours = 0;
  // 1st half: time_in → break_time_out
  if (timeIn && breakTimeOut) {
    hours += (new Date(breakTimeOut) - new Date(timeIn)) / 3600000;
  }
  // 2nd half: break_time_in → time_out
  if (breakTimeIn && timeOut) {
    hours += (new Date(timeOut) - new Date(breakTimeIn)) / 3600000;
  }
  // No break recorded: time_in → time_out
  if (timeIn && timeOut && !breakTimeOut && !breakTimeIn) {
    hours = (new Date(timeOut) - new Date(timeIn)) / 3600000;
  }
  return Math.max(0, hours);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { employee_id, today, photo_url } = await req.json();

    if (!employee_id || !today) {
      return Response.json({ error: 'Missing employee_id or today' }, { status: 400 });
    }

    const existingLogs = await base44.asServiceRole.entities.AttendanceLog.filter({
      employee_id,
      date: today,
    });

    const lastLog = existingLogs.sort((a, b) => (b.updated_date || b.time_in || '').localeCompare(a.updated_date || a.time_in || ''))[0];
    const now = new Date();

    // Determine which scan step we're on
    const isTimeIn       = !lastLog || !!lastLog.time_out;
    const isBreakOut     = lastLog && lastLog.time_in && !lastLog.break_time_out && !lastLog.time_out;
    const isBreakIn      = lastLog && lastLog.break_time_out && !lastLog.break_time_in && !lastLog.time_out;
    const isTimeOut      = lastLog && lastLog.time_in && lastLog.break_time_in && !lastLog.time_out;
    // Also allow time_out without break (if no break was recorded)
    const isTimeOutNoBrk = lastLog && lastLog.time_in && !lastLog.break_time_out && !lastLog.time_out && !isBreakOut;

    if (isTimeIn) {
      // --- SCAN 1: Time In ---

      // Rule: if scanning between 12:00pm and 12:59pm, snap time_in to 1:00pm and block overtime
      const nowHour = now.getHours();
      const lunchWindow = nowHour === 12; // 12:00–12:59
      let effectiveTimeIn = now;
      let noOvertime = false;
      if (lunchWindow) {
        // Snap to 1:00pm same day
        effectiveTimeIn = new Date(now);
        effectiveTimeIn.setHours(13, 0, 0, 0);
        noOvertime = true;
      }

      let lateMinutes = 0;
      try {
        const allSettings = await base44.asServiceRole.entities.Settings.list();
        const defaultShift = allSettings.find(s => s.is_default) || allSettings[0];
        if (defaultShift?.shift_start_time) {
          const [startH, startM] = defaultShift.shift_start_time.split(':').map(Number);
          const shiftStart = new Date(effectiveTimeIn);
          shiftStart.setHours(startH, startM, 0, 0);
          if (effectiveTimeIn > shiftStart) {
            lateMinutes = Math.round((effectiveTimeIn - shiftStart) / 60000);
          }
        }
      } catch (_) {}

      const newLog = await base44.asServiceRole.entities.AttendanceLog.create({
        employee_id,
        date: today,
        time_in: effectiveTimeIn.toISOString(),
        late_minutes: lateMinutes,
        day_type: 'regular',
        status: 'pending',
        is_absent: false,
        ...(photo_url ? { photo_url } : {}),
      });
      return Response.json({
        action: 'time_in',
        logId: newLog.id,
        late_minutes: lateMinutes,
        lunch_window_alert: lunchWindow,
        snapped_to_1pm: lunchWindow,
        no_overtime: noOvertime,
      });

    } else if (isBreakOut) {
      // --- SCAN 2: Break Out ---
      await base44.asServiceRole.entities.AttendanceLog.update(lastLog.id, {
        break_time_out: now.toISOString(),
        ...(photo_url ? { photo_url } : {}),
      });
      return Response.json({ action: 'break_out', logId: lastLog.id });

    } else if (isBreakIn) {
      // --- SCAN 3: Break In ---
      await base44.asServiceRole.entities.AttendanceLog.update(lastLog.id, {
        break_time_in: now.toISOString(),
        ...(photo_url ? { photo_url } : {}),
      });
      return Response.json({ action: 'break_in', logId: lastLog.id });

    } else if (isTimeOut || isTimeOutNoBrk) {
      // --- SCAN 4: Time Out ---
      const hoursWorked = computeHoursWorked(
        lastLog.time_in,
        lastLog.break_time_out || null,
        lastLog.break_time_in || null,
        now.toISOString()
      );
      // If time_in was snapped to 1:00pm (lunch window rule), no overtime is credited
      const timeInDate = new Date(lastLog.time_in);
      const wasLunchSnapped = timeInDate.getHours() === 13 && timeInDate.getMinutes() === 0 && timeInDate.getSeconds() === 0;
      const overtimeHours = wasLunchSnapped ? 0 : parseFloat(Math.max(0, hoursWorked - 8).toFixed(2));

      // Night differential: total ND hours across both halves
      let ndHours = 0;
      if (lastLog.break_time_out) {
        ndHours += computeNightDiffHours(lastLog.time_in, lastLog.break_time_out);
      }
      if (lastLog.break_time_in) {
        ndHours += computeNightDiffHours(lastLog.break_time_in, now.toISOString());
      }
      if (!lastLog.break_time_out) {
        ndHours += computeNightDiffHours(lastLog.time_in, now.toISOString());
      }

      const updates = {
        time_out: now.toISOString(),
        hours_worked: parseFloat(hoursWorked.toFixed(2)),
        overtime_hours: overtimeHours,
        night_diff_hours: parseFloat(ndHours.toFixed(2)),
        ...(photo_url ? { photo_url } : {}),
      };

      await base44.asServiceRole.entities.AttendanceLog.update(lastLog.id, updates);
      return Response.json({ action: 'time_out', logId: lastLog.id, hours_worked: updates.hours_worked, overtime_hours: overtimeHours, night_diff_hours: updates.night_diff_hours });

    } else {
      return Response.json({ error: 'No valid scan action could be determined.' }, { status: 400 });
    }

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});