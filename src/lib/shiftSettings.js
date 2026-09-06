import { formatManilaTime, manilaDateString } from './dateUtils.js';

export const SHIFT_VERSION_BASE_DATE = '0001-01-01';

const VERSION_FIELDS = [
  'setting_name',
  'shift_start_time',
  'shift_end_time',
  'overtime_start_time',
  'break_start_time',
  'break_end_time',
  'break_duration_minutes',
  'grace_period_minutes',
  'time_in_allowance_minutes',
  'paid_break_time',
  'paid_breaktime_approval_document_url',
  'paid_breaktime_approval_document_name',
  'paid_breaktime_approval_uploaded_at',
  'has_break',
  'attendance_punch_mode',
  'is_default',
  'is_active',
];

export const ATTENDANCE_PUNCH_MODE = Object.freeze({
  AUTOMATIC_SHIFT: 'automatic_shift',
  FULL_PUNCH: 'full_punch',
});

export function resolveAttendancePunchMode(shift = {}, log = null) {
  const raw = log?.shift_attendance_punch_mode ?? shift?.attendance_punch_mode;
  return String(raw || '').toLowerCase() === ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT
    ? ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT
    : ATTENDANCE_PUNCH_MODE.FULL_PUNCH;
}

function effectiveDateString(value) {
  return String(value || '').slice(0, 10);
}

export function shiftVersionSnapshot(shift, overrides = {}) {
  const snapshot = {};
  VERSION_FIELDS.forEach((field) => {
    if (field in overrides) snapshot[field] = overrides[field];
    else if (field in (shift || {})) snapshot[field] = shift[field];
  });
  if (!('is_active' in snapshot)) snapshot.is_active = true;
  return snapshot;
}

export function effectiveShiftSetting(shift, date = manilaDateString()) {
  if (!shift) return null;
  const targetDate = effectiveDateString(date);
  const versions = Array.isArray(shift.effective_versions)
    ? [...shift.effective_versions]
      .filter(version => {
        const effectiveDate = effectiveDateString(version?.effective_date);
        return effectiveDate && effectiveDate <= targetDate;
      })
      .sort((a, b) => effectiveDateString(a.effective_date).localeCompare(effectiveDateString(b.effective_date)))
    : [];
  if (versions.length === 0) return { ...shift, is_active: shift.is_active !== false };
  return { ...shift, ...versions.at(-1) };
}

export function pendingShiftVersion(shift, date = manilaDateString()) {
  if (!Array.isArray(shift?.effective_versions)) return null;
  const targetDate = effectiveDateString(date);
  return [...shift.effective_versions]
    .filter(version => {
      const effectiveDate = effectiveDateString(version?.effective_date);
      return effectiveDate && effectiveDate > targetDate;
    })
    .sort((a, b) => effectiveDateString(a.effective_date).localeCompare(effectiveDateString(b.effective_date)))[0] || null;
}

export function nextBusinessDate(date = manilaDateString()) {
  const next = new Date(`${date}T12:00:00Z`);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (next.getUTCDay() === 0);
  return next.toISOString().slice(0, 10);
}

export function shiftFromAttendanceSnapshot(log, fallbackShift) {
  if (!log?.shift_start_time || !log?.shift_end_time) return fallbackShift;
  return {
    ...fallbackShift,
    value: log.work_schedule || fallbackShift?.value,
    shift_start_time: log.shift_start_time,
    shift_end_time: log.shift_end_time,
    overtime_start_time: log.shift_overtime_start_time,
    break_start_time: log.shift_break_start_time,
    break_end_time: log.shift_break_end_time,
    break_duration_minutes: log.shift_break_duration_minutes,
    grace_period_minutes: log.shift_grace_period_minutes,
    time_in_allowance_minutes: log.shift_time_in_allowance_minutes,
    paid_break_time: log.shift_paid_break_time,
    has_break: log.shift_has_break,
    attendance_punch_mode: log.shift_attendance_punch_mode || fallbackShift?.attendance_punch_mode,
  };
}

export function sortedShiftAssignments(employee) {
  return (Array.isArray(employee?.shift_assignments) ? employee.shift_assignments : [])
    .filter(assignment => assignment?.effective_date && assignment?.work_schedule)
    .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)));
}

export function resolveEmployeeWorkSchedule(employee, date = manilaDateString(), fallbackValue = null) {
  const assignments = sortedShiftAssignments(employee)
    .filter(assignment => assignment.effective_date <= date);
  return assignments.at(-1)?.work_schedule || employee?.work_schedule || fallbackValue;
}

export function legacyShiftSetting(value) {
  if (value === 'night_shift') {
    return {
      id: value,
      setting_name: 'Night Shift',
      shift_start_time: '20:00',
      shift_end_time: '05:00',
      overtime_start_time: '05:30',
    };
  }
  if (value === 'day_shift') {
    return {
      id: value,
      setting_name: 'Day Shift',
      shift_start_time: '08:00',
      shift_end_time: '17:00',
      overtime_start_time: '17:30',
    };
  }
  return null;
}

/** Resolve an employee's assignment and the date-effective version of its shift. */
export function resolveEffectiveEmployeeShift(employee, shifts = [], date = manilaDateString()) {
  const effectiveShifts = shifts
    .map(shift => effectiveShiftSetting(shift, date))
    .filter(shift => shift?.is_active !== false);
  const defaultShift = effectiveShifts.find(shift => shift.is_default) || effectiveShifts[0] || null;
  const scheduleId = resolveEmployeeWorkSchedule(employee, date, defaultShift?.id || null);
  const configured = shifts.find(shift => String(shift.id) === String(scheduleId));
  const shift = effectiveShiftSetting(configured, date) || legacyShiftSetting(scheduleId);
  return shift ? { ...shift, id: scheduleId || shift.id, scheduleId } : null;
}

export function isValidClockTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function normalizeClockTime(value) {
  if (!isValidClockTime(value)) return null;
  const [hours, minutes] = String(value).trim().split(':');
  return `${String(Number(hours)).padStart(2, '0')}:${minutes}`;
}

export function isOvernightClockRange(startTime, endTime) {
  const start = normalizeClockTime(startTime);
  const end = normalizeClockTime(endTime);
  return Boolean(start && end && end <= start);
}

export function addManilaDate(date, days) {
  const next = new Date(`${date}T00:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + days);
  return manilaDateString(next);
}

function addClockMinutes(clockTime, durationMinutes) {
  const [hours, minutes] = normalizeClockTime(clockTime).split(':').map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  const normalized = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`,
    crossesMidnight: total >= 24 * 60,
  };
}

function clockDiffMinutes(startTime, endTime) {
  const start = normalizeClockTime(startTime);
  const end = normalizeClockTime(endTime);
  if (!start || !end || start === end) return null;
  const [startHours, startMinutes] = start.split(':').map(Number);
  const [endHours, endMinutes] = end.split(':').map(Number);
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  return endTotal > startTotal ? endTotal - startTotal : (24 * 60 - startTotal) + endTotal;
}

function isExplicitlyDisabled(value) {
  return value === false || value === 0 || String(value || '').toLowerCase() === 'false';
}

function isExplicitlyEnabled(value) {
  return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
}

/**
 * A break is valid only when HR configured a real window.
 * A single truthy time string — including placeholder 00:00 with no end — is not enough.
 * 00:00–01:00 remains valid because both ends are configured.
 *
 * Precedence:
 * 1. Explicit shift has_break=false / break_enabled=false → no break.
 * 2. HR shift window or start+duration → shift break, never employee.break_time.
 * 3. Explicit has_break=true with an incomplete window → no break, no employee fallback.
 * 4. Legacy employee break_time + duration only when the shift has no modern break policy.
 */
export function resolveConfiguredBreak(shift = {}, employee = {}) {
  shift = shift || {};
  employee = employee || {};
  if (isExplicitlyDisabled(shift.has_break) || isExplicitlyDisabled(shift.break_enabled)) {
    return { valid: false, reason: 'disabled' };
  }

  const start = normalizeClockTime(shift.break_start_time);
  const end = normalizeClockTime(shift.break_end_time);
  const shiftDuration = Number(shift.break_duration_minutes);
  const employeeDuration = Number(employee.break_duration_minutes);
  const hasShiftDuration = Number.isFinite(shiftDuration) && shiftDuration > 0;
  const hasEmployeeDuration = Number.isFinite(employeeDuration) && employeeDuration > 0;
  const shiftRequiresBreak = isExplicitlyEnabled(shift.has_break);

  if (start && end && start !== end) {
    return {
      valid: true,
      start,
      end,
      durationMinutes: hasShiftDuration ? shiftDuration : clockDiffMinutes(start, end),
      source: 'shift_window',
    };
  }

  if (start && !end && hasShiftDuration) {
    const derived = addClockMinutes(start, shiftDuration);
    return {
      valid: true,
      start,
      end: derived.time,
      durationMinutes: shiftDuration,
      source: 'shift_duration',
      crossesMidnight: derived.crossesMidnight,
    };
  }

  if (shiftRequiresBreak) {
    return { valid: false, reason: 'incomplete' };
  }

  if (isExplicitlyDisabled(employee.break_enabled)) {
    return { valid: false, reason: 'disabled' };
  }

  const employeeStart = normalizeClockTime(employee.break_time);
  if (!start && employeeStart && hasEmployeeDuration) {
    const derived = addClockMinutes(employeeStart, employeeDuration);
    return {
      valid: true,
      start: employeeStart,
      end: derived.time,
      durationMinutes: employeeDuration,
      source: 'employee_duration',
      crossesMidnight: derived.crossesMidnight,
    };
  }

  return { valid: false, reason: 'incomplete' };
}

export function scheduleDateTimes(date, shift) {
  const startTime = normalizeClockTime(shift?.shift_start_time);
  const endTime = normalizeClockTime(shift?.shift_end_time);
  if (!date || !startTime || !endTime) return null;
  const start = new Date(`${date}T${startTime}:00+08:00`);
  const end = new Date(`${date}T${endTime}:00+08:00`);
  if (![start, end].every(value => Number.isFinite(value.getTime()))) return null;
  const isOvernight = isOvernightClockRange(startTime, endTime);
  if (isOvernight) end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  return {
    start,
    end,
    earliestTimeIn: new Date(start.getTime() - 60 * 60 * 1000),
    isOvernight,
    startTime,
    endTime,
  };
}

export function resolveBreakWindow(workDate, shift, scheduleTimes, employee = {}) {
  const configured = resolveConfiguredBreak(shift || {}, employee || {});
  if (!configured.valid || !scheduleTimes?.start) return { ...configured, startAt: null, endAt: null };

  let startAt = new Date(`${workDate}T${configured.start}:00+08:00`);
  if (!Number.isFinite(startAt.getTime())) return { ...configured, valid: false, reason: 'invalid_window' };
  if (startAt.getTime() < scheduleTimes.start.getTime()) {
    startAt = new Date(`${addManilaDate(workDate, 1)}T${configured.start}:00+08:00`);
  }

  let endAt = new Date(`${manilaDateString(startAt)}T${configured.end}:00+08:00`);
  if (!Number.isFinite(endAt.getTime())) return { ...configured, valid: false, reason: 'invalid_window' };
  if (endAt.getTime() <= startAt.getTime()) {
    endAt = new Date(`${addManilaDate(manilaDateString(startAt), 1)}T${configured.end}:00+08:00`);
  }

  return {
    ...configured,
    startAt,
    endAt,
  };
}

function toPunchDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function punchBelongsToOccurrence(punchAt, occurrenceTimes, { includeEndGraceMs = 0 } = {}) {
  const punch = toPunchDate(punchAt);
  if (!punch || !occurrenceTimes?.start || !occurrenceTimes?.end) return false;
  const earliest = occurrenceTimes.earliestTimeIn?.getTime() ?? occurrenceTimes.start.getTime();
  return punch.getTime() >= earliest && punch.getTime() <= occurrenceTimes.end.getTime() + includeEndGraceMs;
}

function assignedShiftForDate(employee, shiftSettings, date, existingLog = null) {
  const effective = resolveEffectiveEmployeeShift(employee, shiftSettings, date);
  const fromSnapshot = existingLog ? shiftFromAttendanceSnapshot(existingLog, effective) : effective;
  if (!fromSnapshot) return null;
  return {
    ...fromSnapshot,
    id: existingLog?.work_schedule || fromSnapshot.id || fromSnapshot.scheduleId || null,
    setting_name: existingLog?.shift_setting_name || fromSnapshot.setting_name || null,
  };
}

function buildOccurrence({ workDate, shift, times, breakWindow, employee }) {
  const breakConfig = breakWindow || resolveBreakWindow(workDate, shift, times, employee);
  return {
    workDate,
    shift,
    shiftId: shift?.id || shift?.scheduleId || null,
    shiftName: shift?.setting_name || null,
    start: times?.start || null,
    end: times?.end || null,
    earliestTimeIn: times?.earliestTimeIn || null,
    isOvernight: Boolean(times?.isOvernight),
    break: breakConfig,
    hasValidBreak: Boolean(breakConfig?.valid),
    punchMode: resolveAttendancePunchMode(shift),
    employee,
  };
}

/**
 * Resolve the HR-assigned shift occurrence that owns a punch.
 * Overnight punches after midnight belong to the prior work date when that
 * assigned shift is still the active occurrence.
 */
export function resolveShiftOccurrence({
  employee,
  shiftSettings = [],
  punchAt,
  existingLog = null,
  includeEndGraceMs = 0,
} = {}) {
  const punch = toPunchDate(punchAt);
  if (!punch) return null;

  if (existingLog?.date) {
    const shift = assignedShiftForDate(employee, shiftSettings, existingLog.date, existingLog);
    const times = scheduleDateTimes(existingLog.date, shift);
    return buildOccurrence({
      workDate: existingLog.date,
      shift,
      times,
      breakWindow: resolveBreakWindow(existingLog.date, shift, times, employee),
      employee,
    });
  }

  const calendarDate = manilaDateString(punch);
  const previousDate = addManilaDate(calendarDate, -1);
  const previousShift = assignedShiftForDate(employee, shiftSettings, previousDate);
  const previousTimes = scheduleDateTimes(previousDate, previousShift);
  if (
    previousTimes?.isOvernight &&
    punchBelongsToOccurrence(punch, previousTimes, { includeEndGraceMs })
  ) {
    return buildOccurrence({
      workDate: previousDate,
      shift: previousShift,
      times: previousTimes,
      breakWindow: resolveBreakWindow(previousDate, previousShift, previousTimes, employee),
      employee,
    });
  }

  const currentShift = assignedShiftForDate(employee, shiftSettings, calendarDate);
  const currentTimes = scheduleDateTimes(calendarDate, currentShift);
  return buildOccurrence({
    workDate: calendarDate,
    shift: currentShift,
    times: currentTimes,
    breakWindow: resolveBreakWindow(calendarDate, currentShift, currentTimes, employee),
    employee,
  });
}

export function attendanceShiftSnapshot(occurrence) {
  const shift = occurrence?.shift || {};
  const breakConfig = occurrence?.break || {};
  return {
    work_schedule: occurrence?.shiftId || shift.id || shift.scheduleId || null,
    shift_setting_name: occurrence?.shiftName || shift.setting_name || null,
    shift_start_time: shift.shift_start_time || null,
    shift_end_time: shift.shift_end_time || null,
    shift_overtime_start_time: shift.overtime_start_time || null,
    shift_grace_period_minutes: Number(shift.grace_period_minutes) || 0,
    shift_time_in_allowance_minutes: Number(shift.time_in_allowance_minutes) || 0,
    shift_paid_break_time: Boolean(shift.paid_break_time),
    shift_break_start_time: breakConfig.valid ? breakConfig.start : null,
    shift_break_end_time: breakConfig.valid ? breakConfig.end : null,
    shift_break_duration_minutes: breakConfig.valid ? breakConfig.durationMinutes : null,
    shift_is_overnight: Boolean(occurrence?.isOvernight),
    shift_has_break: Boolean(breakConfig.valid),
    shift_attendance_punch_mode: resolveAttendancePunchMode(shift),
    scheduled_time_out: occurrence?.end ? occurrence.end.toISOString() : null,
  };
}

export function describeShiftOccurrence(occurrence) {
  if (!occurrence) return null;
  const breakStart = occurrence.break?.startAt || null;
  const breakEnd = occurrence.break?.endAt || null;
  return {
    id: occurrence.shiftId || null,
    name: occurrence.shiftName || null,
    work_date: occurrence.workDate || null,
    shift_start: occurrence.start ? occurrence.start.toISOString() : null,
    shift_end: occurrence.end ? occurrence.end.toISOString() : null,
    shift_start_manila: occurrence.start ? formatManilaTime(occurrence.start) : null,
    shift_end_manila: occurrence.end ? formatManilaTime(occurrence.end) : null,
    is_overnight: Boolean(occurrence.isOvernight),
    has_valid_break: Boolean(occurrence.hasValidBreak),
    break_start: breakStart ? breakStart.toISOString() : null,
    break_end: breakEnd ? breakEnd.toISOString() : null,
    break_start_manila: breakStart ? formatManilaTime(breakStart) : null,
    break_end_manila: breakEnd ? formatManilaTime(breakEnd) : null,
    punch_mode: occurrence.punchMode || resolveAttendancePunchMode(occurrence.shift),
    scheduled_time_out: occurrence.end ? occurrence.end.toISOString() : null,
    scheduled_time_out_manila: occurrence.end ? formatManilaTime(occurrence.end) : null,
  };
}

export function timeInWindowStatus(attemptedAt, scheduleTimes) {
  const attempted = attemptedAt instanceof Date ? attemptedAt : new Date(attemptedAt);
  if (!scheduleTimes?.start || !scheduleTimes?.earliestTimeIn || !Number.isFinite(attempted.getTime())) {
    return { hasSchedule: false, isEarlyAttempt: false };
  }
  return {
    hasSchedule: true,
    isEarlyAttempt: attempted.getTime() < scheduleTimes.earliestTimeIn.getTime(),
    attemptedAt: attempted,
    scheduledStart: scheduleTimes.start,
    earliestAllowedTimeIn: scheduleTimes.earliestTimeIn,
  };
}

export function nextEmployeeShiftAssignment(employee, date = manilaDateString()) {
  return sortedShiftAssignments(employee)
    .find(assignment => assignment.effective_date > date) || null;
}

export function buildShiftAssignmentUpdate(employee, workSchedule, effectiveDate = manilaDateString(), options = {}) {
  const today = options.today || manilaDateString();
  const fallbackValue = options.fallbackValue || employee?.work_schedule || workSchedule;
  const assignments = sortedShiftAssignments(employee);

  if (employee?.work_schedule && !assignments.some(assignment => assignment.effective_date <= today)) {
    assignments.unshift({
      effective_date: SHIFT_VERSION_BASE_DATE,
      work_schedule: employee.work_schedule,
    });
  }

  const nextAssignments = assignments
    .filter(assignment => assignment.effective_date !== effectiveDate);
  nextAssignments.push({
    effective_date: effectiveDate,
    work_schedule: workSchedule,
    assigned_at: options.assignedAt || new Date().toISOString(),
  });
  nextAssignments.sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)));

  const effectiveToday = resolveEmployeeWorkSchedule(
    { ...employee, shift_assignments: nextAssignments, work_schedule: employee?.work_schedule || fallbackValue },
    today,
    fallbackValue,
  );

  return {
    shift_assignments: nextAssignments,
    work_schedule: effectiveToday,
  };
}
