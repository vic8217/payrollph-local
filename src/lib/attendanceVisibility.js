import { manilaDateString } from "./dateUtils.js";

export function normalizeAttendanceKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAttendanceCode(value) {
  return normalizeAttendanceKey(value)
    .replace(/-payrollph$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

export function manilaWeekAnchor(value = new Date()) {
  const workDate = manilaDateString(value);
  return workDate ? new Date(`${workDate}T12:00:00+08:00`) : new Date(value);
}

export function isAttendanceInWorkDateRange(log, startDate, endDate) {
  const workDate = String(log?.date || "").slice(0, 10);
  if (!workDate || !startDate || !endDate) return false;
  return workDate >= startDate && workDate <= endDate;
}

export function attendanceBelongsToEmployee(log, employee) {
  const selectedRecordId = String(employee?.id || "");
  const selectedEmployeeId = normalizeAttendanceKey(employee?.employee_id);
  const selectedEmployeeCode = normalizeAttendanceCode(employee?.employee_id);
  const sameRecord = Boolean(selectedRecordId && String(log?.employee_record_id || "") === selectedRecordId);
  const sameEmployeeId =
    normalizeAttendanceKey(log?.employee_id) === selectedEmployeeId ||
    normalizeAttendanceCode(log?.employee_id) === selectedEmployeeCode;
  return sameRecord || sameEmployeeId;
}

export function attendanceBelongsToCompany(log, companyProfileId) {
  const logCompanyId = String(log?.company_profile_id || "");
  return !logCompanyId || logCompanyId === String(companyProfileId || "");
}

export function isVisibleAttendanceLog(log, { companyProfileId, employee, startDate, endDate } = {}) {
  if (!log) return false;
  return attendanceBelongsToCompany(log, companyProfileId)
    && isAttendanceInWorkDateRange(log, startDate, endDate)
    && attendanceBelongsToEmployee(log, employee);
}

export function selectAttendanceLogsForEmployeeWeek(logs, options) {
  return (logs || []).filter((log) => isVisibleAttendanceLog(log, options));
}

export function employeeListStatus(employee) {
  return String(employee?.status || "active").toLowerCase();
}

export function sortEmployeesForAttendancePicker(employees = []) {
  const rank = (employee) => {
    const status = employeeListStatus(employee);
    if (status === "active") return 0;
    if (status === "inactive") return 1;
    return 2;
  };
  return [...employees].sort((left, right) => {
    const byStatus = rank(left) - rank(right);
    if (byStatus !== 0) return byStatus;
    const leftName = [left.first_name, left.middle_name, left.last_name, left.employee_id].filter(Boolean).join(" ");
    const rightName = [right.first_name, right.middle_name, right.last_name, right.employee_id].filter(Boolean).join(" ");
    return leftName.localeCompare(rightName);
  });
}
