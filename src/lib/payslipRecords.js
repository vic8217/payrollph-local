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
  const matchEmployee = (records) =>
    records.filter((record) => normalizePayslipEmployeeId(record.employee_id) === employeeId);

  if (companyProfileId) {
    const scoped = await appApi.entities.PayrollRecord.filter(
      { company_profile_id: companyProfileId },
      '-created_date',
      1000,
    );
    const matches = matchEmployee(scoped);
    if (matches.length > 0) return matches;
  }

  const allRecords = await appApi.entities.PayrollRecord.list('-created_date', 1000);
  return matchEmployee(allRecords);
}

export async function fetchPayrollPeriodsById(companyProfileId) {
  const periods = companyProfileId
    ? await appApi.entities.PayrollPeriod.filter({ company_profile_id: companyProfileId }, '-created_date', 500)
    : await appApi.entities.PayrollPeriod.list('-created_date', 500);

  const periodsById = Object.fromEntries(periods.map((period) => [String(period.id), period]));

  if (Object.keys(periodsById).length > 0 || !companyProfileId) {
    return periodsById;
  }

  const allPeriods = await appApi.entities.PayrollPeriod.list('-created_date', 500);
  return Object.fromEntries(allPeriods.map((period) => [String(period.id), period]));
}

/** Visible to employees once the record or its parent period is released. */
export function isReleasedPayslip(record, periodsById = {}) {
  return payslipReleaseStatus(record, periodsById) === 'released';
}

export function payslipReleaseStatus(record, periodsById = {}) {
  const recordStatus = normalizeStatus(record?.status);
  if (recordStatus === 'released') return 'released';

  const periodId = record?.payroll_period_id;
  const periodStatus = periodId ? normalizeStatus(periodsById[String(periodId)]?.status) : '';
  if (periodStatus === 'released') return 'released';
  if (recordStatus === 'approved' || periodStatus === 'approved') return 'approved';
  if (recordStatus === 'processing' || periodStatus === 'processing') return 'processing';
  return recordStatus || periodStatus || 'draft';
}
