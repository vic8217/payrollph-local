// Canonical stored values: super_admin, admin, hr_staff, attendance_staff.
// `user` is a legacy HR-level role and remains supported for existing accounts.
export const ROLE_PERMISSIONS = {
  super_admin: ["*"],
  admin: ["employees", "attendance", "biometric_mapping", "schedule", "leave", "holidays", "no_work_days", "payroll", "special_rates", "special_payroll", "thirteenth_month", "separation_pay", "statutory_rates", "deductions", "cash_advance", "users", "passcode_audit", "payslip_receipts", "company_profile", "shift_settings", "employee_portal"],
  hr_staff: ["employees", "attendance", "biometric_mapping", "schedule", "leave", "holidays", "no_work_days", "payslip_receipts"],
  user: ["employees", "attendance", "biometric_mapping", "schedule", "leave", "holidays", "no_work_days", "payslip_receipts"],
  attendance_staff: ["attendance", "schedule", "leave", "holidays", "no_work_days"],
};

export function hasPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

export const ROUTE_PERMISSIONS = {
  "/": "overview", "/management-reports": "overview", "/employees": "employees",
  "/attendance": "attendance", "/attendance/time-in-reviews": "attendance", "/biometric-mapping": "biometric_mapping", "/work-schedule": "schedule",
  "/personal-leave": "leave", "/holidays": "holidays", "/no-work-days": "no_work_days",
  "/payroll": "payroll", "/special-rates": "special_rates", "/special-rate-payroll": "special_payroll",
  "/thirteenth-month-pay": "thirteenth_month", "/separation-pay": "separation_pay", "/statutory-rates": "statutory_rates",
  "/mandatory-deductions": "deductions", "/cash-advance": "cash_advance", "/user-management": "users",
  "/users-log": "security_logs", "/passcode-audit": "passcode_audit", "/payslip-acknowledgements": "payslip_receipts",
  "/company-profile": "company_profile", "/archived-companies": "companies_archive", "/settings": "shift_settings",
  "/employee-portal": "employee_portal", "/employee-portal-qr": "employee_portal", "/passcode-manager": "payroll",
};

export function permissionForPath(pathname) { return ROUTE_PERMISSIONS[pathname]; }

export const ENTITY_PERMISSIONS = {
  AttendanceLog: "attendance", Settings: "schedule", PersonalLeave: "leave", Holiday: "holidays", NoWorkDay: "no_work_days",
};
