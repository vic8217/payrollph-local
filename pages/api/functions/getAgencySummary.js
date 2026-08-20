// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listRecords } from '@/server/entityStore';
import { agencyFeeForAttendanceDays, agencyFeeSummary, isAgencyEmployee, normalizePayrollMethod } from '@/lib/agencyPayroll';

function attendanceDaysForEmployee(logs, employee) {
  const employeeId = String(employee.employee_id || '').trim().toLowerCase();
  const employeeRecordId = String(employee.id || employee.employee_record_id || '').trim().toLowerCase();
  const unitsByDate = new Map();
  logs.forEach(log => {
    const matches =
      (employeeRecordId && String(log.employee_record_id || '').trim().toLowerCase() === employeeRecordId) ||
      (employeeId && String(log.employee_id || '').trim().toLowerCase() === employeeId);
    if (!matches || log.status !== 'approved' || !log.time_in || !log.time_out || log.is_absent) return;
    unitsByDate.set(log.date, 1);
  });
  return [...unitsByDate.values()].reduce((sum, units) => sum + units, 0);
}

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
  const [employees, periods] = await Promise.all([
    listRecords('Employee', { filter: { company_profile_id: companyId }, limit: 5000 }),
    listRecords('PayrollPeriod', { filter: { company_profile_id: companyId }, sort: '-start_date', limit: 100 }),
  ]);
  const period = periods.find(item => String(item.id) === periodId) || periods[0] || null;
  const attendanceLogs = period?.start_date && period?.end_date
    ? await listRecords('AttendanceLog', {
      filter: { company_profile_id: companyId, date: { $gte: period.start_date, $lte: period.end_date } },
      limit: 10000,
    })
    : [];
  const dailyFee = Number(company.agency_fee_per_employee || 0);
  // Agency fees are earned from recorded approved attendance. Do not remove a
  // worker from the fee population merely because current status or employment
  // dates changed after the attendance was recorded.
  const periodAgencyEmployees = employees.filter(employee => isAgencyEmployee(employee.is_agency_employee))
      .map(employee => {
        const attendanceDays = attendanceDaysForEmployee(attendanceLogs, employee);
        return {
          ...employee,
          agency_fee_attendance_days: attendanceDays,
          agency_fee_amount: agencyFeeForAttendanceDays(dailyFee, attendanceDays),
        };
      });
  const expectedEligible = periodAgencyEmployees.filter(employee => employee.agency_fee_attendance_days > 0);
  // The Agency total is the Attendance total for this payroll period; payroll
  // snapshots must not alter or hide attendance-earned agency fees.
  const eligible = expectedEligible;
  const summary = agencyFeeSummary(eligible, String(dailyFee));
  const attendanceDays = summary.employees.reduce((total, employee) => total + Number(employee.agency_fee_attendance_days || 0), 0);
  return res.status(200).json({
    enabled: company.uses_employee_agency === true,
    frequency: 'PER_DAY',
    period,
    ...summary,
    attendanceDays,
    employees: summary.employees.map(employee => ({ ...employee, payrollMethod: normalizePayrollMethod(employee.payroll_disbursement_method) })),
  });
}
