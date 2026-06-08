import { appApi } from '@/lib/appApi';

export const normalizePayslipEmployeeId = (value) =>
  String(value || '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase();

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

export async function fetchEmployeePayrollRecords(employee, companyProfileId) {
  if (!employee?.employee_id) return [];

  const employeeId = normalizePayslipEmployeeId(employee.employee_id);
  const records = companyProfileId
    ? await appApi.entities.PayrollRecord.filter({ company_profile_id: companyProfileId }, '-created_date', 1000)
    : await appApi.entities.PayrollRecord.list('-created_date', 1000);

  return records.filter((record) =>
    normalizePayslipEmployeeId(record.employee_id) === employeeId
  );
}

export function isReleasedPayslip(record) {
  return normalizeStatus(record?.status) === 'released';
}
