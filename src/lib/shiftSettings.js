import { manilaDateString } from './dateUtils.js';

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
  'is_default',
  'is_active',
];

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

export function scheduleDateTimes(date, shift) {
  if (!date || !shift?.shift_start_time || !shift?.shift_end_time) return null;
  const start = new Date(`${date}T${shift.shift_start_time}:00+08:00`);
  const end = new Date(`${date}T${shift.shift_end_time}:00+08:00`);
  if (![start, end].every(value => Number.isFinite(value.getTime()))) return null;
  const isOvernight = shift.shift_end_time <= shift.shift_start_time;
  if (isOvernight) end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  return {
    start,
    end,
    earliestTimeIn: new Date(start.getTime() - 60 * 60 * 1000),
    isOvernight,
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
