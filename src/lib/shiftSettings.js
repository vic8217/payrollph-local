import { manilaDateString } from './dateUtils.js';

export const SHIFT_VERSION_BASE_DATE = '0001-01-01';

const VERSION_FIELDS = [
  'setting_name',
  'shift_start_time',
  'shift_end_time',
  'overtime_start_time',
  'grace_period_minutes',
  'time_in_allowance_minutes',
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
  };
}
