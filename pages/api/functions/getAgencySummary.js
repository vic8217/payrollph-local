// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listRecords } from '@/server/entityStore';
import { agencyFeeSummary, normalizePayrollMethod } from '@/lib/agencyPayroll';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || !['super_admin', 'admin', 'user'].includes(session.user.role)) return res.status(403).json({ error: 'HR or administrator access is required.' });
  const companyId = String(req.body?.company_profile_id || '');
  const assigned = session.user.company_profile_ids || (session.user.company_profile_id ? [session.user.company_profile_id] : []);
  if (session.user.role !== 'super_admin' && !assigned.includes(companyId)) return res.status(403).json({ error: 'You cannot view agency data for this company.' });
  const [company] = await listRecords('CompanyProfile', { filter: { id: companyId }, limit: 1 });
  if (!company) return res.status(404).json({ error: 'Company not found.' });
  const periodId = String(req.body?.payroll_period_id || '');
  const [employees, periods, records] = await Promise.all([
    listRecords('Employee', { filter: { company_profile_id: companyId }, limit: 5000 }),
    listRecords('PayrollPeriod', { filter: { company_profile_id: companyId }, sort: '-start_date', limit: 100 }),
    periodId ? listRecords('PayrollRecord', { filter: { company_profile_id: companyId, payroll_period_id: periodId }, limit: 5000 }) : [],
  ]);
  const period = periods.find(item => String(item.id) === periodId) || periods[0] || null;
  const finalized = ['approved', 'released'].includes(period?.status) && records.length > 0;
  const eligible = finalized
    ? records.filter(record => record.is_agency_employee_at_payroll === true).map(record => ({
      id: record.employee_record_id || record.employee_id,
      employee_id: record.employee_id,
      first_name: record.employee_name,
      department: record.department,
      is_agency_employee: true,
      payroll_disbursement_method: record.payroll_method_at_payroll,
      agency_fee_amount: record.agency_fee_amount,
    }))
    : employees.filter(employee => employee.status === 'active' && employee.is_agency_employee === true &&
      (!period?.start_date || !employee.date_hired || employee.date_hired <= period.end_date) &&
      (!employee.termination_date || employee.termination_date >= period.start_date));
  const fee = finalized ? Number(eligible[0]?.agency_fee_amount || 0) : Number(company.agency_fee_per_employee || 0);
  const summary = agencyFeeSummary(eligible, String(fee));
  return res.status(200).json({
    enabled: company.uses_employee_agency === true,
    frequency: company.agency_fee_frequency || 'PER_PAYROLL',
    period,
    finalizedSnapshot: finalized,
    ...summary,
    employees: summary.employees.map(employee => ({ ...employee, payrollMethod: normalizePayrollMethod(employee.payroll_disbursement_method) })),
  });
}
