// @ts-nocheck
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { effectiveShiftSetting, resolveEmployeeWorkSchedule, shiftFromAttendanceSnapshot } from "@/lib/shiftSettings";
import {
  computeCreditedHoursWorked,
  computeLateMinutes,
  computeNightDifferentialHours,
  computeOvertimeHours,
} from "@/lib/payrollUtils";
import {
  approvedOvertimeRequestForLog,
  capOvertimeByApprovedRequest,
  overtimeStatusForComputedHours,
} from "@/lib/overtimeRequests";

function todayInManila() {
  return manilaDateString();
}

const DEFAULT_BREAK_DURATION_MINUTES = 60;
const DUPLICATE_SCAN_WINDOW_MS = 2 * 60 * 1000;
const MIN_STEP_INTERVAL_MS = 5 * 60 * 1000;
const OVERNIGHT_LOG_GRACE_MS = 6 * 60 * 60 * 1000;
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

const punchLabels = {
  time_in: "Time In (1)",
  break_time_out: "Time Out (1)",
  break_time_in: "Time In (2)",
  time_out: "Time Out (2)",
};

async function recordSuccessfulPunch({ log, action, employee, occurredAt, location }) {
  const label = punchLabels[action] || "Attendance punch";
  return createRecord("PasscodeAuditLog", {
    company_profile_id: employee.company_profile_id,
    source_entity: "AttendanceLog",
    source_record_id: log.id,
    action: "attendance_punch_recorded",
    punch_action: action,
    occurred_at: occurredAt,
    authorized_by: "Employee Portal",
    reason: "Successful employee attendance scan",
    summary: `${label} successfully recorded at ${occurredAt}`,
    employee_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: log.employee_name,
    record_date: log.date,
    recorded_time: occurredAt,
    location: sanitizeLocation(location),
  });
}

async function successfulPunchResponse(res, { log, action, employee, occurredAt, location }) {
  const receipt = await recordSuccessfulPunch({ log, action, employee, occurredAt, location });
  return res.status(200).json({ action, log, receipt });
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

function scheduledBreak(employee, date, shiftOptions = {}) {
  const breakTime = shiftOptions.breakStartTime || employee.break_time;
  if (!breakTime) return null;

  const [breakHour] = breakTime.split(":").map(Number);
  const breakDate = shiftOptions.isOvernightShift && breakHour < 12
    ? addDays(date, 1)
    : date;

  return {
    break_time_out: new Date(`${breakDate}T${breakTime}:00+08:00`).toISOString(),
  };
}

function scheduledBreakAfterTimeIn(employee, date, timeInValue, shiftOptions = {}) {
  const autoBreak = scheduledBreak(employee, date, shiftOptions);
  const timeIn = timeInValue ? new Date(timeInValue) : null;
  const breakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !Number.isFinite(timeIn.getTime()) || !Number.isFinite(breakOut.getTime())) {
    return null;
  }

  return breakOut.getTime() > timeIn.getTime() ? autoBreak : null;
}

function legacyShiftTimes(value) {
  if (value === "night_shift") {
    return {
      shift_start_time: "20:00",
      shift_end_time: "05:00",
      overtime_start_time: "05:30",
    };
  }
  return {
    shift_start_time: "08:00",
    shift_end_time: "17:00",
    overtime_start_time: "17:30",
  };
}

function resolveEmployeeShiftOptions(employee, shiftSettings, date, log = null) {
  const effectiveShifts = shiftSettings
    .map(setting => effectiveShiftSetting(setting, date))
    .filter(setting => setting?.is_active !== false);
  const defaultShift = effectiveShifts.find(setting => setting.is_default) || effectiveShifts[0] || {};
  const shiftValue = log?.work_schedule || resolveEmployeeWorkSchedule(employee, date, defaultShift.id || "day_shift");
  const rawShift = shiftSettings.find(setting => String(setting.id) === String(shiftValue));
  const matchedShift = shiftFromAttendanceSnapshot(log, effectiveShiftSetting(rawShift, date));
  const shift = matchedShift || (shiftValue ? {} : defaultShift);
  const fallbackShift = legacyShiftTimes(shiftValue);
  const shiftStartTime = shift.shift_start_time || fallbackShift.shift_start_time;
  const shiftEndTime = shift.shift_end_time || fallbackShift.shift_end_time;

  return {
    shiftStartTime,
    shiftEndTime,
    overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
    timeInAllowanceMinutes: Number(shift.time_in_allowance_minutes) || 0,
    breakInGraceMinutes: Number(shift.grace_period_minutes) || 0,
    lateGraceMinutes: Number(shift.grace_period_minutes) || 0,
    paidBreakTime: Boolean(shift.paid_break_time),
    breakStartTime: shift.break_start_time || employee.break_time,
    breakEndTime: shift.break_end_time || null,
    breakDurationMinutes: Number(shift.break_duration_minutes || employee.break_duration_minutes) || DEFAULT_BREAK_DURATION_MINUTES,
    isOvernightShift: shiftEndTime <= shiftStartTime,
  };
}

function getBreakDurationMinutes(employee, shiftOptions = {}) {
  const minutes = Number(shiftOptions.breakDurationMinutes || employee?.break_duration_minutes);
  return minutes > 0 ? minutes : DEFAULT_BREAK_DURATION_MINUTES;
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

function scheduledBreakIn(employee, date, shiftOptions = {}) {
  const breakTime = shiftOptions.breakStartTime || employee.break_time;
  if (!breakTime) return null;

  const [breakHour] = breakTime.split(":").map(Number);
  const breakDate = shiftOptions.isOvernightShift && breakHour < 12
    ? addDays(date, 1)
    : date;
  const breakIn = shiftOptions.breakEndTime
    ? { time: shiftOptions.breakEndTime, crossesMidnight: shiftOptions.breakEndTime <= breakTime }
    : addBreakDuration(breakTime, getBreakDurationMinutes(employee, shiftOptions));
  const breakInDate = breakIn.crossesMidnight ? addDays(breakDate, 1) : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
}

function classifyFirstPunchDuringBreak(employee, date, nowDate, shiftOptions = {}) {
  const breakOutValue = scheduledBreak(employee, date, shiftOptions)?.break_time_out;
  const breakInValue = scheduledBreakIn(employee, date, shiftOptions);
  if (!breakOutValue || !breakInValue) return null;

  const breakOut = new Date(breakOutValue);
  const breakIn = new Date(breakInValue);
  const windowEnd = new Date(breakOut.getTime() + BREAK_TIME_IN_MISSING_AFTER_MS);
  if (![breakOut, breakIn, windowEnd].every(value => Number.isFinite(value.getTime()))) return null;

  if (nowDate.getTime() >= breakOut.getTime() && nowDate.getTime() < breakIn.getTime()) {
    return "break_time_in";
  }
  if (nowDate.getTime() >= breakIn.getTime() && nowDate.getTime() < windowEnd.getTime()) {
    return "break_time_in";
  }
  return null;
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

function attendanceLogManilaDate(log) {
  const firstPunch = [log?.time_in, log?.break_time_out, log?.break_time_in, log?.time_out]
    .filter(Boolean)
    .map((value) => new Date(value))
    .find((value) => Number.isFinite(value.getTime()));

  return firstPunch ? manilaDateString(firstPunch) : null;
}

function scheduledShiftEnd(logDate, shiftOptions) {
  if (!logDate || !shiftOptions?.shiftStartTime || !shiftOptions?.shiftEndTime) return null;

  const start = new Date(`${logDate}T${shiftOptions.shiftStartTime}:00+08:00`);
  const end = new Date(`${logDate}T${shiftOptions.shiftEndTime}:00+08:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

function scheduledShiftStart(logDate, shiftOptions) {
  if (!logDate || !shiftOptions?.shiftStartTime) return null;
  const start = new Date(`${logDate}T${shiftOptions.shiftStartTime}:00+08:00`);
  return Number.isFinite(start.getTime()) ? start : null;
}

function isActiveOvernightLog(log, employee, shiftSettings, date, nowDate) {
  if (!log || log.time_out || log.date !== addDays(date, -1)) return false;

  const shiftOptions = resolveEmployeeShiftOptions(
    { ...employee, work_schedule: log.work_schedule || employee.work_schedule },
    shiftSettings,
    log.date,
    log,
  );
  if (!shiftOptions.isOvernightShift) return false;

  const shiftEnd = scheduledShiftEnd(log.date, shiftOptions);
  return Boolean(
    shiftEnd &&
    nowDate.getTime() <= shiftEnd.getTime() + OVERNIGHT_LOG_GRACE_MS
  );
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
  const employeeRecordId = String(req.body?.employee_record_id || "").trim();
  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  const date = todayInManila();
  const location = req.body?.location;

  if (!employeeId) {
    return res.status(400).json({ error: "employee_id is required" });
  }

  const matchingEmployees = await listRecords("Employee", {
    filter: { employee_id: employeeId },
    limit: 2000,
  });
  const employee = employeeRecordId
    ? matchingEmployees.find((item) => String(item.id || "") === employeeRecordId) || matchingEmployees[0]
    : companyProfileId
      ? matchingEmployees.find((item) => String(item.company_profile_id || "") === companyProfileId) || matchingEmployees[0]
      : matchingEmployees[0];

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const employeeLogs = await listRecords("AttendanceLog", {
    filter: {
      employee_id: employeeId,
      company_profile_id: employee.company_profile_id,
    },
    sort: "-created_date",
    limit: 20,
  });
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const employeeName = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" ");
  const shiftSettings = await listRecords("Settings", {
    filter: { company_profile_id: employee.company_profile_id },
  });
  const overtimeRequests = await listRecords("OvertimeRequest", {
    filter: { company_profile_id: employee.company_profile_id },
    limit: 1000,
  });
  const todayLog = employeeLogs.find((log) =>
    log.date === date || attendanceLogManilaDate(log) === date
  );
  const overnightLog = employeeLogs.find((log) =>
    isActiveOvernightLog(log, employee, shiftSettings, date, nowDate)
  );
  const lastLog = todayLog || overnightLog;
  let attendanceDate = lastLog?.date || date;

  // A first scan after midnight can still belong to the prior day's overnight
  // shift. Resolve that shift before creating a new log so a 1:00 AM scan on
  // Aug 1 for a Jul 31 6:00 PM–6:00 AM shift is classified against Jul 31 and
  // its midnight break instead of becoming Aug 1 Time In(1).
  if (!lastLog) {
    const previousDate = addDays(date, -1);
    const previousWorkSchedule = resolveEmployeeWorkSchedule(employee, previousDate);
    const previousShiftOptions = resolveEmployeeShiftOptions(
      { ...employee, work_schedule: previousWorkSchedule },
      shiftSettings,
      previousDate,
    );
    const previousShiftStart = scheduledShiftStart(previousDate, previousShiftOptions);
    const previousShiftEnd = scheduledShiftEnd(previousDate, previousShiftOptions);
    const belongsToPreviousOvernightShift = Boolean(
      previousShiftOptions.isOvernightShift &&
      previousShiftStart &&
      previousShiftEnd &&
      nowDate.getTime() >= previousShiftStart.getTime() &&
      nowDate.getTime() <= previousShiftEnd.getTime() + OVERNIGHT_LOG_GRACE_MS
    );
    if (belongsToPreviousOvernightShift) attendanceDate = previousDate;
  }

  const effectiveWorkSchedule = resolveEmployeeWorkSchedule(employee, attendanceDate);
  const currentShiftOptions = resolveEmployeeShiftOptions(
    { ...employee, work_schedule: lastLog?.work_schedule || effectiveWorkSchedule },
    shiftSettings,
    attendanceDate,
    lastLog,
  );

  if (!lastLog) {
    const shiftStart = scheduledShiftStart(attendanceDate, currentShiftOptions);
    const isEarlyTimeIn = Boolean(
      shiftStart &&
      nowDate.getTime() < shiftStart.getTime()
    );
    const effectiveTimeIn = isEarlyTimeIn ? shiftStart.toISOString() : now;

    const firstBreakPunch = isEarlyTimeIn
      ? null
      : classifyFirstPunchDuringBreak(employee, attendanceDate, nowDate, currentShiftOptions);
    if (firstBreakPunch) {
      const scheduledBreakOut = scheduledBreak(employee, attendanceDate, currentShiftOptions);
      const scheduledBreakReturn = scheduledBreakIn(employee, attendanceDate, currentShiftOptions);
      const isEarlyBreakReturn = scheduledBreakReturn && nowDate.getTime() < new Date(scheduledBreakReturn).getTime();
      const log = await createRecord("AttendanceLog", {
        company_profile_id: employee.company_profile_id,
        employee_record_id: employee.id,
        employee_id: employee.employee_id,
        employee_name: employeeName,
        date: attendanceDate,
        time_in: null,
        break_time_out: scheduledBreakOut?.break_time_out,
        break_time_in: isEarlyBreakReturn ? scheduledBreakReturn : now,
        ...(isEarlyBreakReturn ? { break_time_in_actual_punch_at: now } : {}),
        work_schedule: effectiveWorkSchedule,
        shift_start_time: currentShiftOptions.shiftStartTime,
        shift_end_time: currentShiftOptions.shiftEndTime,
        shift_overtime_start_time: currentShiftOptions.overtimeStartTime,
        shift_grace_period_minutes: currentShiftOptions.lateGraceMinutes,
        shift_time_in_allowance_minutes: currentShiftOptions.timeInAllowanceMinutes,
        shift_paid_break_time: currentShiftOptions.paidBreakTime,
        shift_break_start_time: currentShiftOptions.breakStartTime,
        shift_break_end_time: currentShiftOptions.breakEndTime,
        shift_break_duration_minutes: currentShiftOptions.breakDurationMinutes,
        ...locationUpdateFor("break_time_in", location),
        status: "pending",
        day_type: "regular",
        first_punch_classification: firstBreakPunch,
        time_in_missing_reason: "No successful Time In (1) was recorded before the scheduled break.",
      });
      return successfulPunchResponse(res, { log, action: "break_time_in", employee, occurredAt: now, location });
    }

    const autoBreak = scheduledBreakAfterTimeIn(
      employee,
      attendanceDate,
      effectiveTimeIn,
      currentShiftOptions,
    );
    const log = await createRecord("AttendanceLog", {
      company_profile_id: employee.company_profile_id,
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      date: attendanceDate,
      time_in: effectiveTimeIn,
      ...(isEarlyTimeIn ? {
        time_in_actual_punch_at: now,
        time_in_classification: "early_scan_clamped_to_shift_start",
      } : {}),
      work_schedule: effectiveWorkSchedule,
      shift_start_time: currentShiftOptions.shiftStartTime,
      shift_end_time: currentShiftOptions.shiftEndTime,
      shift_overtime_start_time: currentShiftOptions.overtimeStartTime,
      shift_grace_period_minutes: currentShiftOptions.lateGraceMinutes,
      shift_time_in_allowance_minutes: currentShiftOptions.timeInAllowanceMinutes,
      shift_paid_break_time: currentShiftOptions.paidBreakTime,
      shift_break_start_time: currentShiftOptions.breakStartTime,
      shift_break_end_time: currentShiftOptions.breakEndTime,
      shift_break_duration_minutes: currentShiftOptions.breakDurationMinutes,
      ...(autoBreak || {}),
      ...locationUpdateFor("time_in", location),
      status: "pending",
      day_type: "regular",
    });
    return successfulPunchResponse(res, { log, action: "time_in", employee, occurredAt: now, location });
  }

  let currentLog = lastLog;
  const autoBreak = scheduledBreakAfterTimeIn(
    employee,
    currentLog.date,
    currentLog.time_in,
    currentShiftOptions,
  );
  const lastPunch = lastManualPunch(currentLog);
  if (lastPunch && minutesSince(lastPunch, nowDate) < DUPLICATE_SCAN_WINDOW_MS) {
    return rejectRapidScan(res, currentLog, "duplicate_scan");
  }

  if (autoBreak && !currentLog.break_time_out) {
    currentLog = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: autoBreak.break_time_out,
    });
  }

  const currentShiftEnd = scheduledShiftEnd(currentLog.date, currentShiftOptions);
  const isEndOfShiftScanWithoutBreakPunches = Boolean(
    !currentLog.break_time_out &&
    !currentLog.break_time_in &&
    currentShiftEnd &&
    nowDate.getTime() >= currentShiftEnd.getTime()
  );

  if (!currentLog.break_time_out && !isEndOfShiftScanWithoutBreakPunches) {
    if (minutesSince(currentLog.time_in, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "time_in", "Time In was just recorded. Please wait before recording Break Out.");
    }

    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: now,
      ...locationUpdateFor("break_time_out", location),
    });
    return successfulPunchResponse(res, { log, action: "break_time_out", employee, occurredAt: now, location });
  }

  // If the break-in window has lapsed (scheduled break-out was long ago and the
  // employee never punched their return), don't back-fill Time In(2). Treat this
  // scan as the final Time Out and leave Time In(2) missing — this prevents an
  // end-of-day scan (e.g. 7:19 PM) from being mislabeled as the break return.
  const breakInWindowLapsed = Boolean(
    isEndOfShiftScanWithoutBreakPunches ||
    (
      autoBreak?.break_time_out &&
      minutesSince(autoBreak.break_time_out, nowDate) >= BREAK_TIME_IN_MISSING_AFTER_MS
    )
  );

  if (!currentLog.break_time_in && !breakInWindowLapsed) {
    const breakOutTime = currentLog.break_time_out;
    const isScheduledBreakOut = autoBreak?.break_time_out &&
      new Date(breakOutTime).getTime() === new Date(autoBreak.break_time_out).getTime();

    if (!isScheduledBreakOut && minutesSince(breakOutTime, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_out", "Break Out was just recorded. Please wait before recording Break In.");
    }

    const scheduledBreakReturn = scheduledBreakIn(employee, currentLog.date, currentShiftOptions);
    const isEarlyScheduledBreakReturn = Boolean(
      isScheduledBreakOut &&
      scheduledBreakReturn &&
      new Date(now).getTime() < new Date(scheduledBreakReturn).getTime()
    );

    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: isEarlyScheduledBreakReturn ? scheduledBreakReturn : now,
      ...(isEarlyScheduledBreakReturn ? { break_time_in_actual_punch_at: now } : {}),
      ...locationUpdateFor("break_time_in", location),
    });
    return successfulPunchResponse(res, { log, action: "break_time_in", employee, occurredAt: now, location });
  }

  if (!currentLog.time_out) {
    if (minutesSince(currentLog.break_time_in || currentLog.time_in, nowDate) < MIN_STEP_INTERVAL_MS) {
      return rejectRapidScan(res, currentLog, "break_time_in", "Last scan was just recorded. Please wait before recording Time Out.");
    }

    const shiftOptions = resolveEmployeeShiftOptions(
      { ...employee, work_schedule: currentLog.work_schedule || resolveEmployeeWorkSchedule(employee, currentLog.date) },
      shiftSettings,
      currentLog.date,
      currentLog,
    );
    const completedLog = { ...currentLog, time_out: now };
    const hoursWorked = computeCreditedHoursWorked(completedLog, {
      ...shiftOptions,
      breakDurationMinutes: getBreakDurationMinutes(employee, shiftOptions),
      paidBreakTime: shiftOptions.paidBreakTime,
    });
    const overtimeHours = computeOvertimeHours(completedLog, hoursWorked, {
      ...shiftOptions,
      breakDurationMinutes: getBreakDurationMinutes(employee, shiftOptions),
      paidBreakTime: shiftOptions.paidBreakTime,
    });
    const approvedOtRequest = approvedOvertimeRequestForLog(completedLog, overtimeRequests, employee);
    const cappedOvertimeHours = capOvertimeByApprovedRequest(overtimeHours, approvedOtRequest);
    const nightDiffHours = computeNightDifferentialHours(completedLog, {
      shiftStartTime: shiftOptions.shiftStartTime,
      breakDurationMinutes: getBreakDurationMinutes(employee, shiftOptions),
      paidBreakTime: shiftOptions.paidBreakTime,
    });
    const lateMinutes = computeLateMinutes(completedLog, shiftOptions);
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      time_out: now,
      ...locationUpdateFor("time_out", location),
      hours_worked: Number(hoursWorked.toFixed(2)),
      ot_actual_hours: Number(overtimeHours.toFixed(2)),
      overtime_hours: cappedOvertimeHours,
      ot_requested_hours: approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0,
      ot_status: overtimeStatusForComputedHours(overtimeHours, cappedOvertimeHours, approvedOtRequest),
      overtime_request_id: approvedOtRequest?.id || null,
      night_diff_hours: Number(nightDiffHours.toFixed(2)),
      late_minutes: lateMinutes,
    });
    return successfulPunchResponse(res, { log, action: "time_out", employee, occurredAt: now, location });
  }

  return res.status(409).json({ error: "Attendance for today is already complete" });
}
