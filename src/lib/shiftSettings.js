import { manilaDateString } from './dateUtils.js';

export const SHIFT_VERSION_BASE_DATE = '0001-01-01';

const VERSION_FIELDS = [
  'setting_name',
  'shift_start_time',
  'shift_end_time',
  'overtime_start_time',
  'grace_period_minutes',
  'time_in_allowance_minutes',
  'paid_break_time',
  'paid_breaktime_approval_document_url',
  'paid_breaktime_approval_document_name',
  'paid_breaktime_approval_uploaded_at',
  'is_default',
  'is_active',
];

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
  const versions = Array.isArray(shift.effective_versions)
    ? [...shift.effective_versions]
      .filter(version => version?.effective_date && version.effective_date <= date)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    : [];
  if (versions.length === 0) return { ...shift, is_active: shift.is_active !== false };
  return { ...shift, ...versions.at(-1) };
}

export function pendingShiftVersion(shift, date = manilaDateString()) {
  if (!Array.isArray(shift?.effective_versions)) return null;
  return [...shift.effective_versions]
    .filter(version => version?.effective_date > date)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))[0] || null;
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
