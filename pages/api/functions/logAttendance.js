// @ts-nocheck
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { computeCreditedHoursWorked, computeOvertimeHours } from "@/lib/payrollUtils";

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const DEFAULT_BREAK_DURATION_MINUTES = 60;
const DUPLICATE_SCAN_WINDOW_MS = 2 * 60 * 1000;
const MIN_STEP_INTERVAL_MS = 5 * 60 * 1000;
// Mirrors the Attendance UI's "Time In(2) missing" rule: once this much time has
// passed since the scheduled break-out without a break-in, the break-in window
// is considered lapsed and the next scan is treated as the final Time Out.
const BREAK_TIME_IN_MISSING_AFTER_MS = 120 * 60 * 1000;
const attendanceLocationFields = {
  time_in: "time_in_location",
  break_time_out: "break_time_out_location",
  break_time_in: "break_time_in_location",
  time_out: "time_out_location",
};

function truncate(value, maxLength = 160) {
  if (value == null) return undefined;
  return String(value).slice(0, maxLength);
}

function cleanNumber(value, decimals = 7) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Number(number.toFixed(decimals));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function sanitizeLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== "object") return null;

  const latitude = cleanNumber(rawLocation.latitude);
  const longitude = cleanNumber(rawLocation.longitude);
  const hasCoordinates = latitude !== undefined &&
    longitude !== undefined &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;

  const capturedAt = rawLocation.captured_at && !Number.isNaN(new Date(rawLocation.captured_at).getTime())
    ? new Date(rawLocation.captured_at).toISOString()
    : new Date().toISOString();

  if (hasCoordinates) {
    return compactObject({
      status: "captured",
      latitude,
      longitude,
      accuracy: cleanNumber(rawLocation.accuracy, 2),
      altitude: cleanNumber(rawLocation.altitude, 2),
      altitude_accuracy: cleanNumber(rawLocation.altitude_accuracy, 2),
      heading: cleanNumber(rawLocation.heading, 2),
      speed: cleanNumber(rawLocation.speed, 2),
      captured_at: capturedAt,
      source: "browser_geolocation",
    });
  }

  const status = truncate(rawLocation.status || "unavailable", 32);
  return compactObject({
    status,
    error: truncate(rawLocation.error),
    captured_at: capturedAt,
    source: "browser_geolocation",
  });
}

function locationUpdateFor(action, rawLocation) {
  const field = attendanceLocationFields[action];
  const location = sanitizeLocation(rawLocation);
  return field && location ? { [field]: location, location_action: action } : {};
}

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

function getBreakDurationMinutes(employee) {
  const minutes = Number(employee?.break_duration_minutes);
  return [30, 60].includes(minutes) ? minutes : DEFAULT_BREAK_DURATION_MINUTES;
}

function addBreakDuration(time, durationMinutes = DEFAULT_BREAK_DURATION_MINUTES) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const total = hours * 60 + minutes + durationMinutes;
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
  const breakIn = addBreakDuration(employee.break_time, getBreakDurationMinutes(employee));
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
  const location = req.body?.location;

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
      ...locationUpdateFor("time_in", location),
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
      ...locationUpdateFor("break_time_out", location),
    });
    return res.status(200).json({ action: "break_time_out", log });
  }

  // If the break-in window has lapsed (scheduled break-out was long ago and the
  // employee never punched their return), don't back-fill Time In(2). Treat this
  // scan as the final Time Out and leave Time In(2) missing — this prevents an
  // end-of-day scan (e.g. 7:19 PM) from being mislabeled as the break return.
  const breakInWindowLapsed = Boolean(
    autoBreak?.break_time_out &&
    minutesSince(autoBreak.break_time_out, nowDate) >= BREAK_TIME_IN_MISSING_AFTER_MS
  );

  if (!currentLog.break_time_in && !breakInWindowLapsed) {
    const breakOutTime = currentLog.break_time_out;
    const isScheduledBreakOut = autoBreak?.break_time_out &&
      new Date(breakOutTime).getTime() === new Date(autoBreak.break_time_out).getTime();

    if (!isScheduledBreakOut && minutesSince(breakOutTime, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_out", "Break Out was just recorded. Please wait before recording Break In.");
    }

    if (isScheduledBreakOut && new Date(now).getTime() < new Date(scheduledBreakIn(employee, date)).getTime()) {
      const durationLabel = getBreakDurationMinutes(employee) === 30 ? "30-minute" : "1-hour";
      return rejectRapidScan(res, currentLog, "break_time_out", `Break In is not available until the scheduled ${durationLabel} break is over.`);
    }

    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: now,
      ...locationUpdateFor("break_time_in", location),
    });
    return res.status(200).json({ action: "break_time_in", log });
  }

  if (!currentLog.time_out) {
    if (minutesSince(currentLog.break_time_in || currentLog.time_in, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_in", "Last scan was just recorded. Please wait before recording Time Out.");
    }

    const [defaultShift] = await listRecords("Settings", {
      filter: { company_profile_id: employee.company_profile_id, is_default: true },
      limit: 1,
    });
    const completedLog = { ...currentLog, time_out: now };
    const hoursWorked = computeCreditedHoursWorked(completedLog, {
      shiftStartTime: defaultShift?.shift_start_time || "08:00",
      timeInAllowanceMinutes: defaultShift?.time_in_allowance_minutes || 0,
      breakInGraceMinutes: defaultShift?.grace_period_minutes || 0,
      breakDurationMinutes: getBreakDurationMinutes(employee),
    });
    const overtimeHours = computeOvertimeHours(completedLog, hoursWorked, {
      shiftStartTime: defaultShift?.shift_start_time || "08:00",
      overtimeStartTime: defaultShift?.overtime_start_time || "17:30",
      breakInGraceMinutes: defaultShift?.grace_period_minutes || 0,
      breakDurationMinutes: getBreakDurationMinutes(employee),
    });
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      time_out: now,
      ...locationUpdateFor("time_out", location),
      hours_worked: Number(hoursWorked.toFixed(2)),
      overtime_hours: Number(overtimeHours.toFixed(2)),
    });
    return res.status(200).json({ action: "time_out", log });
  }

  return res.status(409).json({ error: "Attendance for today is already complete" });
}
