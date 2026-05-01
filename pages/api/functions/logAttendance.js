// @ts-nocheck
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diffHours(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 36e5);
}

const BREAK_DURATION_MINUTES = 60;
const DUPLICATE_SCAN_WINDOW_MS = 2 * 60 * 1000;
const MIN_STEP_INTERVAL_MS = 5 * 60 * 1000;

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function scheduledBreak(employee, date) {
  if (!employee.break_time) return null;

  const [breakHour] = employee.break_time.split(":").map(Number);
  const breakDate = employee.work_schedule === "night_shift" && breakHour < 12
    ? addDays(date, 1)
    : date;

  return {
    break_time_out: new Date(`${breakDate}T${employee.break_time}:00+08:00`).toISOString(),
  };
}

function addBreakDuration(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const total = hours * 60 + minutes + BREAK_DURATION_MINUTES;
  const normalized = total % (24 * 60);
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`,
    crossesMidnight: total >= 24 * 60,
  };
}

function scheduledBreakIn(employee, date) {
  if (!employee.break_time) return null;

  const [breakHour] = employee.break_time.split(":").map(Number);
  const breakDate = employee.work_schedule === "night_shift" && breakHour < 12
    ? addDays(date, 1)
    : date;
  const breakIn = addBreakDuration(employee.break_time);
  const breakInDate = breakIn.crossesMidnight ? addDays(breakDate, 1) : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
}

function isAutoScheduledBreakIn(employee, date, value) {
  const autoBreakIn = scheduledBreakIn(employee, date);
  return Boolean(value && autoBreakIn && new Date(value).getTime() === new Date(autoBreakIn).getTime());
}

function minutesSince(value, now = new Date()) {
  if (!value) return Infinity;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return now.getTime() - time;
}

function lastManualPunch(log) {
  return [log.time_out, log.break_time_in, log.break_time_out, log.time_in]
    .filter(Boolean)
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time)[0]?.value || null;
}

function rejectRapidScan(res, log, action, message = "Scan already recorded. Please wait before scanning again.") {
  return res.status(200).json({
    action,
    log,
    duplicate: true,
    message,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const employeeId = req.body?.employee_id;
  const date = req.body?.today || todayInManila();

  if (!employeeId) {
    return res.status(400).json({ error: "employee_id is required" });
  }

  const [employee] = await listRecords("Employee", {
    filter: { employee_id: employeeId },
    limit: 1,
  });

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const existingLogs = await listRecords("AttendanceLog", {
    filter: {
      employee_id: employeeId,
      date,
      company_profile_id: employee.company_profile_id,
    },
    sort: "-created_date",
    limit: 1,
  });

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const employeeName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
  const [lastLog] = existingLogs;

  if (!lastLog) {
    const autoBreak = scheduledBreak(employee, date);
    const log = await createRecord("AttendanceLog", {
      company_profile_id: employee.company_profile_id,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      date,
      time_in: now,
      ...(autoBreak || {}),
      status: "pending",
      day_type: "regular",
    });
    return res.status(200).json({ action: "time_in", log });
  }

  let currentLog = lastLog;
  const autoBreak = scheduledBreak(employee, date);
  const lastPunch = lastManualPunch(currentLog);
  if (lastPunch && minutesSince(lastPunch, nowDate) < DUPLICATE_SCAN_WINDOW_MS) {
    return rejectRapidScan(res, currentLog, "duplicate_scan");
  }

  if (autoBreak && !currentLog.break_time_out) {
    currentLog = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: autoBreak.break_time_out,
    });
  }

  if (isAutoScheduledBreakIn(employee, date, currentLog.break_time_in)) {
    currentLog = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: null,
    });
  }

  if (!currentLog.break_time_out) {
    if (minutesSince(currentLog.time_in, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "time_in", "Time In was just recorded. Please wait before recording Break Out.");
    }

    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: now,
    });
    return res.status(200).json({ action: "break_time_out", log });
  }

  if (!currentLog.break_time_in) {
    const breakOutTime = currentLog.break_time_out;
    const isScheduledBreakOut = autoBreak?.break_time_out &&
      new Date(breakOutTime).getTime() === new Date(autoBreak.break_time_out).getTime();

    if (!isScheduledBreakOut && minutesSince(breakOutTime, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_out", "Break Out was just recorded. Please wait before recording Break In.");
    }

    if (isScheduledBreakOut && new Date(now).getTime() < new Date(scheduledBreakIn(employee, date)).getTime()) {
      return rejectRapidScan(res, currentLog, "break_time_out", "Break In is not available until the scheduled 1-hour break is over.");
    }

    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: now,
    });
    return res.status(200).json({ action: "break_time_in", log });
  }

  if (!currentLog.time_out) {
    if (minutesSince(currentLog.break_time_in || currentLog.time_in, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_in", "Last scan was just recorded. Please wait before recording Time Out.");
    }

    const grossHours = diffHours(currentLog.time_in, now);
    const breakHours =
      currentLog.break_time_out && currentLog.break_time_in
        ? diffHours(currentLog.break_time_out, currentLog.break_time_in)
        : 0;
    const hoursWorked = Math.max(0, grossHours - breakHours);
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      time_out: now,
      hours_worked: Number(hoursWorked.toFixed(2)),
      overtime_hours: Number(Math.max(0, hoursWorked - 8).toFixed(2)),
    });
    return res.status(200).json({ action: "time_out", log });
  }

  return res.status(409).json({ error: "Attendance for today is already complete" });
}
