import { effectiveShiftSetting, resolveEmployeeWorkSchedule } from './shiftSettings.js';

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
      const breakStart = assignedShift?.break_start_time || employee?.break_time;
      const breakEnd = assignedShift?.break_end_time;
      const duration = Number(assignedShift?.break_duration_minutes || employee?.break_duration_minutes) || 0;
      return !String(breakStart || '').trim() || (!String(breakEnd || '').trim() && duration <= 0);
    })()
  );
}
