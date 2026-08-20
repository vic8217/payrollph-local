// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listRecords } from '@/server/entityStore';
import { agencyFeeForAttendanceDays, agencyFeeSummary, normalizePayrollMethod } from '@/lib/agencyPayroll';

function attendanceDaysForEmployee(logs, employee) {
  const employeeId = String(employee.employee_id || '').trim().toLowerCase();
  const employeeRecordId = String(employee.id || employee.employee_record_id || '').trim().toLowerCase();
  const unitsByDate = new Map();
  logs.forEach(log => {
    const matches =
      (employeeRecordId && String(log.employee_record_id || '').trim().toLowerCase() === employeeRecordId) ||
      (employeeId && String(log.employee_id || '').trim().toLowerCase() === employeeId);
    if (!matches || log.status !== 'approved' || !log.time_in || log.is_absent) return;
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
  const [employees, periods, records] = await Promise.all([
    listRecords('Employee', { filter: { company_profile_id: companyId }, limit: 5000 }),
    listRecords('PayrollPeriod', { filter: { company_profile_id: companyId }, sort: '-start_date', limit: 100 }),
    periodId ? listRecords('PayrollRecord', { filter: { company_profile_id: companyId, payroll_period_id: periodId }, limit: 5000 }) : [],
  ]);
  const period = periods.find(item => String(item.id) === periodId) || periods[0] || null;
  const finalized = ['approved', 'released'].includes(period?.status);
  const attendanceLogs = period?.start_date && period?.end_date
    ? await listRecords('AttendanceLog', {
      filter: { company_profile_id: companyId, date: { $gte: period.start_date, $lte: period.end_date } },
      limit: 10000,
    })
    : [];
  const dailyFee = Number(company.agency_fee_per_employee || 0);
  const periodAgencyEmployees = employees.filter(employee => employee.status === 'active' && employee.is_agency_employee === true &&
      (!period?.start_date || !employee.date_hired || employee.date_hired <= period.end_date) &&
      (!(employee.termination_date || employee.resigned_date) || (employee.termination_date || employee.resigned_date) >= period.start_date))
      .map(employee => {
        const attendanceDays = attendanceDaysForEmployee(attendanceLogs, employee);
        return {
          ...employee,
          agency_fee_attendance_days: attendanceDays,
          agency_fee_amount: agencyFeeForAttendanceDays(dailyFee, attendanceDays),
        };
      });
  const expectedEligible = periodAgencyEmployees.filter(employee => employee.agency_fee_attendance_days > 0);
  const eligible = finalized
    ? records.filter(record => record.is_agency_employee_at_payroll === true).map(record => ({
      id: record.employee_record_id || record.employee_id, employee_id: record.employee_id, first_name: record.employee_name,
      department: record.department, is_agency_employee: true, payroll_disbursement_method: record.payroll_method_at_payroll,
      agency_fee_amount: record.agency_fee_amount, agency_fee_attendance_days: record.agency_fee_attendance_days,
    }))
    : expectedEligible;
  const summary = agencyFeeSummary(eligible, String(dailyFee));
  const employeeKey = employee => String(employee.employee_id || '').trim().toLowerCase();
  const includedEmployeeIds = new Set(summary.employees.map(employeeKey));
  // Reconcile against the complete current Agency roster shown on Employees.
  // The period-specific reason explains why a roster member was not charged.
  const agencyCandidates = periodAgencyEmployees;
  const currentAgencyIds = new Set(agencyCandidates.map(employeeKey));
  const currentIncludedEmployees = summary.employees.filter(employee => currentAgencyIds.has(employeeKey(employee)));
  const snapshotOnlyEmployees = summary.employees.filter(employee => !currentAgencyIds.has(employeeKey(employee)));
  const excludedEmployees = agencyCandidates
    .filter(employee => !includedEmployeeIds.has(String(employee.employee_id || '').trim().toLowerCase()))
    .map(employee => {
      const attendanceDays = attendanceDaysForEmployee(attendanceLogs, employee);
      return {
        id: employee.id,
        employee_id: employee.employee_id,
        employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
        department: employee.department,
        attendance_days: attendanceDays,
        reason: attendanceDays > 0
          ? finalized
            ? 'Historical payroll snapshot is not Agency'
            : 'Unresolved eligibility mismatch'
          : employee.date_hired && period?.start_date && employee.date_hired > period.end_date
            ? 'Hired after this payroll period'
            : (employee.termination_date || employee.resigned_date) && period?.end_date && (employee.termination_date || employee.resigned_date) < period.start_date
              ? 'Inactive before this payroll period'
              : 'No approved attendance in this payroll period',
      };
    });
  return res.status(200).json({
    enabled: company.uses_employee_agency === true,
    frequency: 'PER_DAY',
    period,
    finalizedSnapshot: finalized,
    ...summary,
    reconciliation: {
      agencyCandidateCount: agencyCandidates.length,
      currentIncludedCount: currentIncludedEmployees.length,
      snapshotOnlyCount: snapshotOnlyEmployees.length,
      payrollSnapshotCount: records.length,
      payrollSnapshotAgencyCount: records.filter(record => record.is_agency_employee_at_payroll === true).length,
      excludedEmployees,
    },
    employees: summary.employees.map(employee => ({ ...employee, payrollMethod: normalizePayrollMethod(employee.payroll_disbursement_method) })),
  });
}
