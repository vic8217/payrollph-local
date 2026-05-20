export const BREAK_ALERT_ROLES = ['super_admin', 'admin', 'user'];

export function canReceiveBreakTimeAlerts(user) {
  return BREAK_ALERT_ROLES.includes(user?.role);
}

export function employeesMissingBreakTime(employees = []) {
  return employees.filter(employee =>
    employee?.status === 'active' && !String(employee?.break_time || '').trim()
  );
}
