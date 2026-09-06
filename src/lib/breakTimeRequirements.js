import {
  effectiveShiftSetting,
  resolveConfiguredBreak,
  resolveEmployeeWorkSchedule,
} from './shiftSettings.js';

export const BREAK_ALERT_ROLES = ['super_admin', 'admin'];

export function canReceiveBreakTimeAlerts(user) {
  return BREAK_ALERT_ROLES.includes(user?.role);
}

export function employeesMissingBreakTime(employees = [], shiftSettings = [], date) {
  const effectiveShifts = shiftSettings
    .map(shift => effectiveShiftSetting(shift, date))
    .filter(shift => shift?.is_active !== false);
  const defaultShift = effectiveShifts.find(shift => shift.is_default) || effectiveShifts[0] || null;

  return employees.filter(employee =>
    employee?.status === 'active' && (() => {
      const shiftValue = resolveEmployeeWorkSchedule(employee, date, defaultShift?.id || null);
      const assignedShift = effectiveShifts.find(shift => String(shift.id) === String(shiftValue)) || defaultShift;
      const breakConfig = resolveConfiguredBreak(assignedShift, employee);
      // A shift explicitly configured without a break is complete, not an
      // employee issue. Only surface assignments whose break policy is
      // incomplete.
      return !breakConfig.valid && breakConfig.reason === 'incomplete';
    })()
  );
}
