// @ts-nocheck
import { createRecord, listRecords, updateRecord } from "../entityStore.js";
import { manilaDateString } from "../../lib/dateUtils.js";
import {
  attendanceShiftSnapshot,
  describeShiftOccurrence,
  ATTENDANCE_PUNCH_MODE,
  resolveAttendancePunchMode,
  resolveConfiguredBreak,
  resolveEffectiveEmployeeShift,
  resolveEmployeeWorkSchedule,
  resolveShiftOccurrence,
  scheduleDateTimes,
  timeInWindowStatus,
} from "../../lib/shiftSettings.js";
import {
  computeCreditedHoursWorked,
  computeLateMinutes,
  computeNightDifferentialHours,
  computeOvertimeHours,
} from "../../lib/payrollUtils.js";
import {
  approvedOvertimeRequestForLog,
  capOvertimeByApprovedRequest,
  overtimeStatusForComputedHours,
} from "../../lib/overtimeRequests.js";

export const DEFAULT_BREAK_DURATION_MINUTES = 60;
export const DUPLICATE_SCAN_WINDOW_MS = 2 * 60 * 1000;
export const MIN_STEP_INTERVAL_MS = 5 * 60 * 1000;
export const OVERNIGHT_LOG_GRACE_MS = 6 * 60 * 60 * 1000;
export const MAX_EARLY_TIME_IN_MS = 60 * 60 * 1000;
export const EARLY_ATTEMPT_DEBOUNCE_MS = 10 * 1000;
export const BREAK_TIME_IN_MISSING_AFTER_MS = 120 * 60 * 1000;

const attendanceLocationFields = {
  time_in: "time_in_location",
  break_time_out: "break_time_out_location",
  break_time_in: "break_time_in_location",
  time_out: "time_out_location",
};

const punchLabels = {
  time_in: "Time In (1)",
  break_time_out: "Time Out (1)",
  break_time_in: "Time In (2)",
  time_out: "Time Out (2)",
};

const SLOT_PROVENANCE = {
  time_in: {
    source: "time_in_source",
    eventId: "time_in_biometric_event_id",
    serial: "time_in_device_serial",
    logId: "time_in_device_log_id",
    attendStat: "time_in_attend_stat",
    verify: "time_in_verification_method",
  },
  break_time_out: {
    source: "break_time_out_source",
    eventId: "break_time_out_biometric_event_id",
    serial: "break_time_out_device_serial",
    logId: "break_time_out_device_log_id",
    attendStat: "break_time_out_attend_stat",
    verify: "break_time_out_verification_method",
  },
  break_time_in: {
    source: "break_time_in_source",
    eventId: "break_time_in_biometric_event_id",
    serial: "break_time_in_device_serial",
    logId: "break_time_in_device_log_id",
    attendStat: "break_time_in_attend_stat",
    verify: "break_time_in_verification_method",
  },
  time_out: {
    source: "time_out_source",
    eventId: "time_out_biometric_event_id",
    serial: "time_out_device_serial",
    logId: "time_out_device_log_id",
    attendStat: "time_out_attend_stat",
    verify: "time_out_verification_method",
  },
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

function toOccurredAt(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function sanitizeLocation(rawLocation) {
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

function createdLogSourceFields(source) {
  return source === "biometric" ? { record_source: "biometric" } : {};
}

function provenanceUpdateFor(action, source, sourceRef, existingLog = null) {
  if (source !== "biometric" || !sourceRef || !SLOT_PROVENANCE[action]) return {};
  const fields = SLOT_PROVENANCE[action];
  if (existingLog?.[fields.source] || existingLog?.[fields.eventId]) return {};
  return {
    [fields.source]: "biometric",
    [fields.eventId]: sourceRef.biometricTimeLogId || null,
    [fields.serial]: sourceRef.deviceSerial || null,
    [fields.logId]: sourceRef.deviceLogId || null,
    [fields.attendStat]: sourceRef.attendStat || null,
    [fields.verify]: sourceRef.verifyMethodNormalized || sourceRef.verifyMethod || null,
  };
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function scheduledBreak(employee, date, shiftOptions = {}) {
  const configured = resolveConfiguredBreak({
    break_start_time: shiftOptions.breakStartTime,
    break_end_time: shiftOptions.breakEndTime,
    break_duration_minutes: shiftOptions.breakDurationMinutes,
    break_enabled: shiftOptions.breakEnabled,
  }, employee);
  if (!configured.valid) return null;

  const shiftStart = scheduledShiftStart(date, shiftOptions);
  let breakOut = new Date(`${date}T${configured.start}:00+08:00`);
  if (!Number.isFinite(breakOut.getTime())) return null;
  if (shiftStart && breakOut.getTime() < shiftStart.getTime()) {
    breakOut = new Date(`${addDays(date, 1)}T${configured.start}:00+08:00`);
  }

  return {
    break_time_out: breakOut.toISOString(),
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

export function resolveEmployeeShiftOptions(employee, shiftSettings, date, log = null) {
  const occurrence = resolveShiftOccurrence({
    employee,
    shiftSettings,
    punchAt: log?.time_in || `${date}T12:00:00+08:00`,
    existingLog: log ? { ...log, date: log.date || date } : { date },
  });
  const shift = occurrence?.shift || {};
  const breakConfig = occurrence?.break || resolveConfiguredBreak(shift, employee);

  return {
    shiftStartTime: shift.shift_start_time || null,
    shiftEndTime: shift.shift_end_time || null,
    overtimeStartTime: shift.overtime_start_time || null,
    timeInAllowanceMinutes: Number(shift.time_in_allowance_minutes) || 0,
    breakInGraceMinutes: Number(shift.grace_period_minutes) || 0,
    lateGraceMinutes: Number(shift.grace_period_minutes) || 0,
    paidBreakTime: Boolean(shift.paid_break_time),
    breakStartTime: breakConfig.valid ? breakConfig.start : null,
    breakEndTime: breakConfig.valid ? breakConfig.end : null,
    breakDurationMinutes: breakConfig.valid
      ? Number(breakConfig.durationMinutes) || DEFAULT_BREAK_DURATION_MINUTES
      : null,
    breakEnabled: breakConfig.valid,
    isOvernightShift: Boolean(occurrence?.isOvernight),
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

export function scheduledBreakIn(employee, date, shiftOptions = {}) {
  const autoBreak = scheduledBreak(employee, date, shiftOptions);
  const configured = resolveConfiguredBreak({
    break_start_time: shiftOptions.breakStartTime,
    break_end_time: shiftOptions.breakEndTime,
    break_duration_minutes: shiftOptions.breakDurationMinutes,
    break_enabled: shiftOptions.breakEnabled,
  }, employee);
  if (!autoBreak || !configured.valid) return null;

  const breakOut = new Date(autoBreak.break_time_out);
  if (!Number.isFinite(breakOut.getTime())) return null;

  if (configured.end) {
    let breakIn = new Date(`${manilaDateString(breakOut)}T${configured.end}:00+08:00`);
    if (breakIn.getTime() <= breakOut.getTime()) {
      breakIn = new Date(`${addDays(manilaDateString(breakOut), 1)}T${configured.end}:00+08:00`);
    }
    return breakIn.toISOString();
  }

  const derived = addBreakDuration(configured.start, getBreakDurationMinutes(employee, shiftOptions));
  const breakInDate = derived.crossesMidnight ? addDays(manilaDateString(breakOut), 1) : manilaDateString(breakOut);
  return new Date(`${breakInDate}T${derived.time}:00+08:00`).toISOString();
}

export function scheduledShiftEnd(logDate, shiftOptions) {
  if (!logDate || !shiftOptions?.shiftStartTime || !shiftOptions?.shiftEndTime) return null;

  const start = new Date(`${logDate}T${shiftOptions.shiftStartTime}:00+08:00`);
  const end = new Date(`${logDate}T${shiftOptions.shiftEndTime}:00+08:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  return end;
}

export function scheduledShiftStart(logDate, shiftOptions) {
  if (!logDate || !shiftOptions?.shiftStartTime) return null;
  const start = new Date(`${logDate}T${shiftOptions.shiftStartTime}:00+08:00`);
  return Number.isFinite(start.getTime()) ? start : null;
}

export function isDeclaredHalfDay(value) {
  const dayType = typeof value === "string" ? value : value?.day_type;
  return String(dayType || "").toLowerCase() === "half_day";
}

/**
 * Existing PayrollPH first-punch rule (pre-Phase-2 logAttendance):
 * if a scheduled break exists and the first punch is at/after break start
 * and before shift end, the punch is Time In (2), not Time In (1).
 * This is not a half-day classifier. Half-day is only day_type === "half_day".
 */
function classifyFirstPunchDuringBreak(employee, date, punchAt, shiftOptions = {}) {
  const breakOutValue = scheduledBreak(employee, date, shiftOptions)?.break_time_out;
  const breakInValue = scheduledBreakIn(employee, date, shiftOptions);
  const shiftEndValue = scheduledShiftEnd(date, shiftOptions);
  if (!breakOutValue || !breakInValue || !shiftEndValue) return null;

  const breakOut = new Date(breakOutValue);
  const breakIn = new Date(breakInValue);
  const shiftEnd = new Date(shiftEndValue);
  if (![breakOut, breakIn, shiftEnd].every(value => Number.isFinite(value.getTime()))) return null;

  if (punchAt.getTime() >= breakOut.getTime() && punchAt.getTime() < shiftEnd.getTime()) {
    return "break_time_in";
  }
  return null;
}

export function minutesSince(value, punchAt) {
  if (!value) return Infinity;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || !punchAt || !Number.isFinite(punchAt.getTime())) return Infinity;
  return punchAt.getTime() - time;
}

export function lastManualPunch(log) {
  return [log.time_out, log.break_time_in, log.break_time_out, log.time_in]
    .filter(Boolean)
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time)[0]?.value || null;
}

export function attendanceLogManilaDate(log) {
  const firstPunch = [log?.time_in, log?.break_time_out, log?.break_time_in, log?.time_out]
    .filter(Boolean)
    .map((value) => new Date(value))
    .find((value) => Number.isFinite(value.getTime()));

  return firstPunch ? manilaDateString(firstPunch) : null;
}

function isActiveOvernightLog(log, employee, shiftSettings, date, punchAt) {
  if (!log || log.status === "rejected" || log.time_out || log.date !== addDays(date, -1)) return false;

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
    punchAt.getTime() <= shiftEnd.getTime() + OVERNIGHT_LOG_GRACE_MS
  );
}

function isCompletedPriorOvernightLog(log, employee, shiftSettings, date, punchAt) {
  if (!log?.time_out || log.status === "rejected" || log.date !== addDays(date, -1)) return false;

  const shiftOptions = resolveEmployeeShiftOptions(
    { ...employee, work_schedule: log.work_schedule || employee.work_schedule },
    shiftSettings,
    log.date,
    log,
  );
  if (!shiftOptions.isOvernightShift) return false;

  const timeOut = new Date(log.time_out);
  return Number.isFinite(timeOut.getTime()) && punchAt.getTime() >= timeOut.getTime();
}

async function recordSuccessfulPunch({ log, action, employee, occurredAtIso, location, authorizedBy }, store) {
  const label = punchLabels[action] || "Attendance punch";
  return store.createRecord("PasscodeAuditLog", {
    company_profile_id: employee.company_profile_id,
    source_entity: "AttendanceLog",
    source_record_id: log.id,
    action: "attendance_punch_recorded",
    punch_action: action,
    occurred_at: occurredAtIso,
    authorized_by: authorizedBy,
    reason: authorizedBy === "Biometric terminal"
      ? "Successful biometric attendance punch"
      : "Successful employee attendance scan",
    summary: `${label} successfully recorded at ${occurredAtIso}`,
    employee_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: log.employee_name,
    record_date: log.date,
    recorded_time: occurredAtIso,
    location: sanitizeLocation(location),
  });
}

async function recordEarlyTimeInAttempt({
  employee,
  shift,
  workDate,
  scheduledStart,
  earliestAllowed,
  attemptedAt,
  location,
  requestMeta,
  authorizedBy,
}, store) {
  let receipt = null;
  let duplicate = false;
  try {
    const recentAudits = await store.listRecords("PasscodeAuditLog", {
      filter: { company_profile_id: employee.company_profile_id, employee_record_id: employee.id },
      sort: "-occurred_at",
      limit: 10,
    });
    receipt = recentAudits.find(record =>
      record.action === "early_time_in_attempt" &&
      Number.isFinite(new Date(record.attempted_at || record.occurred_at).getTime()) &&
      attemptedAt.getTime() - new Date(record.attempted_at || record.occurred_at).getTime() < EARLY_ATTEMPT_DEBOUNCE_MS
    ) || null;
    duplicate = Boolean(receipt);
    if (!receipt) {
      receipt = await store.createRecord("PasscodeAuditLog", {
        company_profile_id: employee.company_profile_id,
        source_entity: "AttendanceLog",
        source_record_id: null,
        action: "early_time_in_attempt",
        punch_action: "time_in",
        status: "EARLY_ATTEMPT",
        result: "RECORDED_NOT_OFFICIAL",
        classification: "EARLY_TIME_IN_ATTEMPT",
        reason: "BEFORE_ALLOWED_TIME_IN_WINDOW",
        employee_record_id: employee.id,
        employee_id: employee.employee_id,
        employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "),
        shift_id: shift?.id || null,
        schedule_id: shift?.scheduleId || shift?.id || null,
        record_date: workDate,
        work_date: workDate,
        scheduled_start: scheduledStart.toISOString(),
        earliest_allowed_time_in: earliestAllowed.toISOString(),
        attempted_at: attemptedAt.toISOString(),
        occurred_at: attemptedAt.toISOString(),
        location: sanitizeLocation(location),
        source_ip: truncate(requestMeta?.sourceIp, 80),
        user_agent: truncate(requestMeta?.userAgent, 240),
        authorized_by: authorizedBy,
        summary: "Early Time In (1) attempt recorded for audit only; official attendance was not created.",
      });
    }
  } catch {
    return {
      outcome: "failed",
      code: "EARLY_TIME_IN_AUDIT_FAILED",
      error: "Your early attempt could not be recorded. Please try again.",
    };
  }
  return {
    outcome: "early_attempt",
    code: "EARLY_TIME_IN_RECORDED",
    action: "time_in",
    message: "Your early Time In attempt was recorded. You must punch again when official Time In becomes available.",
    attemptedAt: attemptedAt.toISOString(),
    scheduledStart: scheduledStart.toISOString(),
    earliestAllowedTimeIn: earliestAllowed.toISOString(),
    officialTimeInCreated: false,
    duplicateSuppressed: duplicate,
    receiptId: receipt?.id || null,
    receipt,
  };
}

function applied(log, action, receipt, occurrence = null) {
  return { outcome: "applied", action, log, receipt, resolvedShift: describeShiftOccurrence(occurrence) };
}

function duplicateResult(log, action, message = "Scan already recorded. Please wait before scanning again.", occurrence = null) {
  return { outcome: "duplicate", action, log, duplicate: true, message, resolvedShift: describeShiftOccurrence(occurrence) };
}

function withResolvedShift(result, occurrence) {
  return { ...result, resolvedShift: result.resolvedShift || describeShiftOccurrence(occurrence) };
}

export function isClosedAttendanceLog(log) {
  return ["rejected", "voided", "void", "cancelled"].includes(String(log?.status || "").toLowerCase());
}

export function attendanceCompletionFields(currentLog, timeOutIso, employee, shiftSettings, overtimeRequests) {
  const shiftOptions = resolveEmployeeShiftOptions(
    { ...employee, work_schedule: currentLog.work_schedule || resolveEmployeeWorkSchedule(employee, currentLog.date) },
    shiftSettings,
    currentLog.date,
    currentLog,
  );
  const completedLog = { ...currentLog, time_out: timeOutIso };
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
  return {
    hours_worked: Number(hoursWorked.toFixed(2)),
    ot_actual_hours: Number(overtimeHours.toFixed(2)),
    overtime_hours: cappedOvertimeHours,
    ot_requested_hours: approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0,
    ot_status: overtimeStatusForComputedHours(overtimeHours, cappedOvertimeHours, approvedOtRequest),
    overtime_request_id: approvedOtRequest?.id || null,
    night_diff_hours: Number(nightDiffHours.toFixed(2)),
    late_minutes: computeLateMinutes(completedLog, shiftOptions),
  };
}

export function canFinalizeAutomaticTimeOut(log, occurrence, asOf) {
  if (!log || log.time_out || isDeclaredHalfDay(log) || isClosedAttendanceLog(log)) return false;
  if (resolveAttendancePunchMode(occurrence?.shift, log) !== ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT) return false;
  const shiftEnd = (log.scheduled_time_out ? new Date(log.scheduled_time_out) : null) || occurrence?.end;
  if (!shiftEnd || !Number.isFinite(shiftEnd.getTime()) || !asOf || asOf.getTime() < shiftEnd.getTime()) return false;
  if (occurrence?.hasValidBreak || log.shift_has_break) return Boolean(log.break_time_in);
  return Boolean(log.time_in);
}

export function missingAutomaticBreakReturn(log, occurrence, asOf) {
  if (!log || log.time_out || isDeclaredHalfDay(log) || isClosedAttendanceLog(log) || log.break_time_in) return false;
  if (resolveAttendancePunchMode(occurrence?.shift, log) !== ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT) return false;
  if (!(occurrence?.hasValidBreak || log.shift_has_break)) return false;
  const shiftEnd = (log.scheduled_time_out ? new Date(log.scheduled_time_out) : null) || occurrence?.end;
  return Boolean(shiftEnd && Number.isFinite(shiftEnd.getTime()) && asOf && asOf.getTime() >= shiftEnd.getTime());
}

/**
 * Canonical PayrollPH punch engine. Callers must supply occurredAt.
 * This function never substitutes wall-clock now for the punch time.
 */
export async function applyAttendancePunch({
  employee,
  occurredAt,
  source = "employee_portal",
  sourceRef = null,
  location = null,
  authorizedBy = "Employee Portal",
  requestMeta = null,
  shiftSettings: providedShiftSettings = null,
  overtimeRequests: providedOvertimeRequests = null,
  declaredDayType = null,
} = {}, store = { createRecord, listRecords, updateRecord }) {
  const punchAt = toOccurredAt(occurredAt);
  if (!employee) {
    return { outcome: "rejected", code: "EMPLOYEE_REQUIRED", error: "Employee is required." };
  }
  if (!punchAt) {
    return { outcome: "rejected", code: "OCCURRED_AT_REQUIRED", error: "occurredAt is required and must be a valid timestamp." };
  }

  const occurredAtIso = punchAt.toISOString();
  const calendarDate = manilaDateString(punchAt);
  const employeeName = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" ");
  const employeeLogs = await store.listRecords("AttendanceLog", {
    filter: {
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
    },
    sort: "-created_date",
    limit: 20,
  });
  const shiftSettings = providedShiftSettings || await store.listRecords("Settings", {
    filter: { company_profile_id: employee.company_profile_id },
  });
  const overtimeRequests = providedOvertimeRequests || await store.listRecords("OvertimeRequest", {
    filter: { company_profile_id: employee.company_profile_id },
    limit: 1000,
  });

  const provisionalOccurrence = resolveShiftOccurrence({
    employee,
    shiftSettings,
    punchAt,
  });
  const occurrenceDate = provisionalOccurrence?.workDate || calendarDate;
  const todayLog = employeeLogs.find((log) =>
    log.status !== "rejected" &&
    (log.date === occurrenceDate || log.date === calendarDate || attendanceLogManilaDate(log) === occurrenceDate)
  );
  const overnightLog = employeeLogs.find((log) =>
    isActiveOvernightLog(log, employee, shiftSettings, calendarDate, punchAt)
  );
  const completedOvernightLog = employeeLogs.find((log) =>
    isCompletedPriorOvernightLog(log, employee, shiftSettings, calendarDate, punchAt)
  );

  const nextShift = resolveEffectiveEmployeeShift(employee, shiftSettings, calendarDate);
  const nextShiftSchedule = scheduleDateTimes(calendarDate, nextShift);
  const nextTimeInWindowIsClosed = Boolean(
    nextShiftSchedule?.earliestTimeIn &&
    punchAt.getTime() < nextShiftSchedule.earliestTimeIn.getTime()
  );

  if (!todayLog && !overnightLog && completedOvernightLog && nextTimeInWindowIsClosed) {
    const completedOccurrence = resolveShiftOccurrence({
      employee,
      shiftSettings,
      punchAt,
      existingLog: completedOvernightLog,
    });
    return duplicateResult(
      completedOvernightLog,
      "time_out",
      "Time Out (2) was already recorded. This duplicate scan was ignored.",
      completedOccurrence,
    );
  }

  const lastLog = todayLog || overnightLog;
  const occurrence = resolveShiftOccurrence({
    employee,
    shiftSettings,
    punchAt,
    existingLog: lastLog,
    includeEndGraceMs: lastLog ? OVERNIGHT_LOG_GRACE_MS : 0,
  }) || provisionalOccurrence;
  const attendanceDate = lastLog?.date || occurrence?.workDate || calendarDate;
  const currentShiftOptions = resolveEmployeeShiftOptions(
    employee,
    shiftSettings,
    attendanceDate,
    lastLog,
  );
  const shiftSnapshot = attendanceShiftSnapshot(occurrence);
  const usesBreakSlots = Boolean(occurrence?.hasValidBreak);
  const punchMode = resolveAttendancePunchMode(occurrence?.shift, lastLog);
  const isAutomaticShift = punchMode === ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT;
  const isScheduledFinalization = source === "scheduled_finalization";

  const finishApplied = async (log, action) => {
    const receipt = await recordSuccessfulPunch({
      log,
      action,
      employee,
      occurredAtIso,
      location,
      authorizedBy,
    }, store);
    return applied(log, action, receipt, occurrence);
  };

  if (!lastLog) {
    const effectiveShift = occurrence?.shift || resolveEffectiveEmployeeShift(employee, shiftSettings, attendanceDate);
    const scheduleTimes = occurrence?.start ? {
      start: occurrence.start,
      end: occurrence.end,
      earliestTimeIn: occurrence.earliestTimeIn,
      isOvernight: occurrence.isOvernight,
    } : scheduleDateTimes(attendanceDate, effectiveShift);
    const shiftStart = scheduleTimes?.start || scheduledShiftStart(attendanceDate, currentShiftOptions);
    const shiftEnd = occurrence?.end || scheduledShiftEnd(attendanceDate, currentShiftOptions);
    const timeInWindow = timeInWindowStatus(punchAt, scheduleTimes || (shiftStart ? {
      start: shiftStart,
      earliestTimeIn: new Date(shiftStart.getTime() - MAX_EARLY_TIME_IN_MS),
    } : null));
    if (timeInWindow.isEarlyAttempt) {
      return withResolvedShift(await recordEarlyTimeInAttempt({
        employee,
        shift: effectiveShift,
        workDate: attendanceDate,
        scheduledStart: shiftStart,
        earliestAllowed: scheduleTimes?.earliestTimeIn || new Date(shiftStart.getTime() - MAX_EARLY_TIME_IN_MS),
        attemptedAt: punchAt,
        location,
        requestMeta,
        authorizedBy,
      }, store), occurrence);
    }
    if (shiftEnd && punchAt.getTime() >= shiftEnd.getTime()) {
      return withResolvedShift({
        outcome: "rejected",
        code: "TIME_IN_AFTER_SHIFT_END",
        error: `The ${currentShiftOptions.shiftEndTime} shift has already ended. This scan cannot be recorded as Time In (1).`,
      }, occurrence);
    }
    const isEarlyTimeIn = Boolean(
      shiftStart &&
      punchAt.getTime() < shiftStart.getTime()
    );
    const effectiveTimeIn = occurredAtIso;

    const declaredHalfDay = isDeclaredHalfDay(declaredDayType);
    const firstBreakPunch = !usesBreakSlots || isEarlyTimeIn || declaredHalfDay || isAutomaticShift
      ? null
      : classifyFirstPunchDuringBreak(employee, attendanceDate, punchAt, currentShiftOptions);
    if (firstBreakPunch) {
      const scheduledBreakOut = scheduledBreak(employee, attendanceDate, currentShiftOptions);
      const scheduledBreakReturn = scheduledBreakIn(employee, attendanceDate, currentShiftOptions);
      if (scheduledBreakReturn && punchAt.getTime() < new Date(scheduledBreakReturn).getTime() - MAX_EARLY_TIME_IN_MS) {
        return withResolvedShift({
          outcome: "rejected",
          code: "BREAK_TIME_IN_TOO_EARLY",
          error: "Time In (2) is allowed only within 1 hour before the scheduled break return. This scan was not recorded.",
        }, occurrence);
      }
      const isEarlyBreakReturn = scheduledBreakReturn && punchAt.getTime() < new Date(scheduledBreakReturn).getTime();
      const log = await store.createRecord("AttendanceLog", {
        company_profile_id: employee.company_profile_id,
        employee_record_id: employee.id,
        employee_id: employee.employee_id,
        employee_name: employeeName,
        date: attendanceDate,
        time_in: null,
        break_time_out: scheduledBreakOut?.break_time_out,
        break_time_in: isEarlyBreakReturn ? scheduledBreakReturn : occurredAtIso,
        ...(isEarlyBreakReturn ? { break_time_in_actual_punch_at: occurredAtIso } : {}),
        ...shiftSnapshot,
        ...locationUpdateFor("break_time_in", location),
        ...createdLogSourceFields(source),
        ...provenanceUpdateFor("break_time_in", source, sourceRef),
        status: "pending",
        day_type: declaredHalfDay ? "half_day" : "regular",
        first_punch_classification: firstBreakPunch,
        time_in_missing_reason: "No successful Time In (1) was recorded before the scheduled break.",
      });
      return finishApplied(log, "break_time_in");
    }

    const autoBreak = declaredHalfDay || !usesBreakSlots ? null : scheduledBreakAfterTimeIn(
      employee,
      attendanceDate,
      effectiveTimeIn,
      currentShiftOptions,
    );
    const log = await store.createRecord("AttendanceLog", {
      company_profile_id: employee.company_profile_id,
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      date: attendanceDate,
      time_in: effectiveTimeIn,
      time_in_actual_punch_at: occurredAtIso,
      ...(isEarlyTimeIn ? { time_in_classification: "early_scan" } : {}),
      ...shiftSnapshot,
      ...(autoBreak || {}),
      ...locationUpdateFor("time_in", location),
      ...createdLogSourceFields(source),
      ...provenanceUpdateFor("time_in", source, sourceRef),
      status: "pending",
      day_type: declaredHalfDay ? "half_day" : "regular",
    });
    return finishApplied(log, "time_in");
  }

  let currentLog = lastLog;
  const declaredHalfDay = isDeclaredHalfDay(currentLog) || isDeclaredHalfDay(declaredDayType);
  const autoBreak = declaredHalfDay || !usesBreakSlots ? null : scheduledBreakAfterTimeIn(
    employee,
    currentLog.date,
    currentLog.time_in,
    currentShiftOptions,
  );
  const lastPunch = lastManualPunch(currentLog);
  if (!isScheduledFinalization && lastPunch && minutesSince(lastPunch, punchAt) < DUPLICATE_SCAN_WINDOW_MS) {
    return duplicateResult(currentLog, "duplicate_scan", undefined, occurrence);
  }

  if (autoBreak && !currentLog.break_time_out) {
    currentLog = await store.updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: autoBreak.break_time_out,
    });
  }

  const currentShiftEnd = occurrence?.end || scheduledShiftEnd(currentLog.date, currentShiftOptions);
  const automaticReady = isAutomaticShift && !declaredHalfDay;

  if (automaticReady && usesBreakSlots && !currentLog.break_time_in && !isScheduledFinalization) {
    const scheduledBreakReturn = scheduledBreakIn(employee, currentLog.date, currentShiftOptions);
    if (scheduledBreakReturn && punchAt.getTime() < new Date(scheduledBreakReturn).getTime() - MAX_EARLY_TIME_IN_MS) {
      return withResolvedShift({
        outcome: "rejected",
        code: "BREAK_TIME_IN_TOO_EARLY",
        error: "Time In (2) is allowed only within 1 hour before the scheduled break return. This scan was not recorded.",
      }, occurrence);
    }
    const isEarlyScheduledBreakReturn = Boolean(
      scheduledBreakReturn &&
      punchAt.getTime() < new Date(scheduledBreakReturn).getTime()
    );
    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: isEarlyScheduledBreakReturn ? scheduledBreakReturn : occurredAtIso,
      ...(isEarlyScheduledBreakReturn ? { break_time_in_actual_punch_at: occurredAtIso } : {}),
      ...locationUpdateFor("break_time_in", location),
      ...provenanceUpdateFor("break_time_in", source, sourceRef, currentLog),
    });
    return finishApplied(log, "break_time_in");
  }

  if (automaticReady && missingAutomaticBreakReturn(currentLog, occurrence, punchAt)) {
    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      time_in_2_missing: true,
      review_reason: "MISSING_TIME_IN_2",
    });
    return withResolvedShift({
      outcome: "needs_review",
      code: "MISSING_TIME_IN_2",
      action: "missing_time_in_2",
      error: "Time In (2) is missing. Scheduled Time Out (2) was not awarded.",
      log,
    }, occurrence);
  }

  if (automaticReady && canFinalizeAutomaticTimeOut(currentLog, occurrence, punchAt)) {
    const scheduledOut = (occurrence?.end || new Date(currentLog.scheduled_time_out)).toISOString();
    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      time_out: scheduledOut,
      time_out_source: "scheduled",
      time_in_2_missing: false,
      review_reason: null,
      ...attendanceCompletionFields(currentLog, scheduledOut, employee, shiftSettings, overtimeRequests),
    });
    return finishApplied(log, "time_out");
  }

  if (automaticReady && currentLog.break_time_in && !currentLog.time_out) {
    return withResolvedShift({
      outcome: "pending_scheduled",
      code: "SCHEDULED_TIME_OUT_PENDING",
      action: "scheduled_time_out",
      message: "Scheduled Time Out (2) becomes official only after the configured shift end.",
      log: currentLog,
    }, occurrence);
  }

  if (automaticReady && !usesBreakSlots && currentLog.time_in && !currentLog.time_out) {
    return withResolvedShift({
      outcome: "pending_scheduled",
      code: "SCHEDULED_TIME_OUT_PENDING",
      action: "scheduled_time_out",
      message: "Scheduled Time Out (2) becomes official only after the configured shift end.",
      log: currentLog,
    }, occurrence);
  }

  const isEndOfShiftScanWithoutBreakPunches = Boolean(
    !automaticReady &&
    !currentLog.break_time_out &&
    !currentLog.break_time_in &&
    currentShiftEnd &&
    punchAt.getTime() >= currentShiftEnd.getTime()
  );

  if (usesBreakSlots && !declaredHalfDay && !currentLog.break_time_out && !isEndOfShiftScanWithoutBreakPunches) {
    if (minutesSince(currentLog.time_in, punchAt) < MIN_STEP_INTERVAL_MS) {
      return duplicateResult(currentLog, "time_in", "Time In was just recorded. Please wait before recording Break Out.", occurrence);
    }

    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: occurredAtIso,
      ...locationUpdateFor("break_time_out", location),
      ...provenanceUpdateFor("break_time_out", source, sourceRef, currentLog),
    });
    return finishApplied(log, "break_time_out");
  }

  const breakInWindowLapsed = Boolean(
    isEndOfShiftScanWithoutBreakPunches ||
    (
      autoBreak?.break_time_out &&
      minutesSince(autoBreak.break_time_out, punchAt) >= BREAK_TIME_IN_MISSING_AFTER_MS
    )
  );

  if (usesBreakSlots && !declaredHalfDay && !currentLog.break_time_in && !breakInWindowLapsed) {
    const breakOutTime = currentLog.break_time_out;
    const isScheduledBreakOut = autoBreak?.break_time_out &&
      new Date(breakOutTime).getTime() === new Date(autoBreak.break_time_out).getTime();

    if (!isScheduledBreakOut && minutesSince(breakOutTime, punchAt) < MIN_STEP_INTERVAL_MS) {
      return duplicateResult(currentLog, "break_time_out", "Break Out was just recorded. Please wait before recording Break In.", occurrence);
    }

    const scheduledBreakReturn = scheduledBreakIn(employee, currentLog.date, currentShiftOptions);
    if (scheduledBreakReturn && punchAt.getTime() < new Date(scheduledBreakReturn).getTime() - MAX_EARLY_TIME_IN_MS) {
      return withResolvedShift({
        outcome: "rejected",
        code: "BREAK_TIME_IN_TOO_EARLY",
        error: "Time In (2) is allowed only within 1 hour before the scheduled break return. This scan was not recorded.",
      }, occurrence);
    }
    const isEarlyScheduledBreakReturn = Boolean(
      isScheduledBreakOut &&
      scheduledBreakReturn &&
      punchAt.getTime() < new Date(scheduledBreakReturn).getTime()
    );

    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: isEarlyScheduledBreakReturn ? scheduledBreakReturn : occurredAtIso,
      ...(isEarlyScheduledBreakReturn ? { break_time_in_actual_punch_at: occurredAtIso } : {}),
      ...locationUpdateFor("break_time_in", location),
      ...provenanceUpdateFor("break_time_in", source, sourceRef, currentLog),
    });
    return finishApplied(log, "break_time_in");
  }

  if (!currentLog.time_out) {
    if (minutesSince(currentLog.break_time_in || currentLog.time_in, punchAt) < MIN_STEP_INTERVAL_MS) {
      return duplicateResult(currentLog, "break_time_in", "Last scan was just recorded. Please wait before recording Time Out.", occurrence);
    }

    const log = await store.updateRecord("AttendanceLog", currentLog.id, {
      time_out: occurredAtIso,
      ...locationUpdateFor("time_out", location),
      ...provenanceUpdateFor("time_out", source, sourceRef, currentLog),
      ...attendanceCompletionFields(currentLog, occurredAtIso, employee, shiftSettings, overtimeRequests),
    });
    return finishApplied(log, "time_out");
  }

  return withResolvedShift({
    outcome: "rejected",
    code: "ATTENDANCE_COMPLETE",
    error: "Attendance for today is already complete",
    log: currentLog,
  }, occurrence);
}

export async function finalizeAutomaticShiftAttendance(args, store) {
  return applyAttendancePunch({
    ...args,
    source: "scheduled_finalization",
    authorizedBy: args?.authorizedBy || "Automatic shift",
  }, store);
}
