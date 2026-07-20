// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { createRecord, listRecords, updateRecord } from '@/server/entityStore';
import { prisma } from '@/server/prisma';
import { manilaDateString } from '@/lib/dateUtils';
import { reconcileCashAdvanceDeduction } from '@/server/reconcileCashAdvanceDeduction';

const money = value => parseFloat((Number(value) || 0).toFixed(2));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id && !session?.user?.email) return res.status(401).json({ error: 'Please sign in again.' });
  const authenticatedUser = await prisma.appUser.findFirst({
    where: session.user.id ? { id: session.user.id } : { email: String(session.user.email || '').toLowerCase() },
    select: { email: true, name: true, role: true },
  });
  if (!['super_admin', 'admin', 'user'].includes(authenticatedUser?.role || session.user.role)) {
    return res.status(403).json({ error: 'You are not allowed to apply mandatory deductions.' });
  }

  const companyId = String(req.body?.company_profile_id || '').trim();
  const setId = String(req.body?.deduction_set_id || '').trim();
  const periodId = String(req.body?.payroll_period_id || '').trim();
  const target = req.body?.target === 'all' ? 'all' : 'employee';
  const employeeRecordId = String(req.body?.employee_record_id || '').trim();
  const hrPasscode = String(req.body?.hr_passcode || '').trim();
  const adminPasscode = String(req.body?.admin_passcode || '').trim();
  if (!companyId || !setId || !periodId || (target === 'employee' && !employeeRecordId)) return res.status(400).json({ error: 'Deduction set, payroll period, and target employee are required.' });
  if (!hrPasscode || !adminPasscode) return res.status(400).json({ error: 'Both HR Officer and Admin Manager passcodes are required.' });

  const [codes] = await listRecords('DailyPasscode', { filter: { company_profile_id: companyId, date: manilaDateString() }, limit: 1 });
  if (!codes) return res.status(400).json({ error: 'No daily passcodes have been generated for today.' });
  if (String(codes.passcode || '') !== hrPasscode) return res.status(403).json({ error: 'Incorrect HR Officer passcode.' });
  if (String(codes.manager_passcode || '') !== adminPasscode) return res.status(403).json({ error: 'Incorrect Admin Manager passcode.' });

  const [[set], [period], employees, periodRecords] = await Promise.all([
    listRecords('MandatoryDeductionSet', { filter: { id: setId, company_profile_id: companyId }, limit: 1 }),
    listRecords('PayrollPeriod', { filter: { id: periodId, company_profile_id: companyId }, limit: 1 }),
    listRecords('Employee', { filter: { company_profile_id: companyId }, limit: 10000 }),
    listRecords('PayrollRecord', { filter: { payroll_period_id: periodId, company_profile_id: companyId }, limit: 10000 }),
  ]);
  if (!set || !period) return res.status(404).json({ error: 'Deduction set or payroll period was not found.' });
  if (period.status === 'released') return res.status(400).json({ error: 'Released payroll deductions cannot be changed.' });
  if (periodRecords.length === 0) return res.status(400).json({ error: 'Generate this payroll period before applying a deduction set.' });

  const employee = target === 'employee' ? employees.find(item => item.id === employeeRecordId) : null;
  if (target === 'employee' && !employee) return res.status(404).json({ error: 'Employee was not found.' });
  const records = target === 'all' ? periodRecords : periodRecords.filter(record => String(record.employee_id) === String(employee.employee_id));
  if (records.length === 0) return res.status(404).json({ error: 'The selected employee does not have a payroll record in this period.' });
  if (records.some(record => record.status === 'released')) return res.status(400).json({ error: 'Released payroll deductions cannot be changed.' });

  const sss = money(set.sss_contribution);
  const philhealth = money(set.philhealth_contribution);
  const pagibig = money(set.pagibig_contribution);
  if ([set.sss_contribution, set.philhealth_contribution, set.pagibig_contribution].some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'The deduction set contains invalid amounts. Edit the set before applying it.' });
  }
  const newGovernmentTotal = money(sss + philhealth + pagibig);
  const appliedAt = new Date().toISOString();
  const appliedBy = authenticatedUser?.name || authenticatedUser?.email || session.user.name || session.user.email || 'unknown';
  const updatedRecords = await Promise.all(records.map(async record => {
    const reconciled = await reconcileCashAdvanceDeduction(record, newGovernmentTotal);
    const totalDeductions = money(reconciled.deductionsBeforeCashAdvance + newGovernmentTotal + reconciled.cashAdvanceTotal);
    return updateRecord('PayrollRecord', record.id, {
      sss_contribution: sss, philhealth_contribution: philhealth, pagibig_contribution: pagibig,
      cash_advance_deduction: reconciled.cashAdvanceTotal,
      cash_advance_deduction_details: reconciled.details,
      total_deductions: totalDeductions,
      net_pay: money((Number(record.gross_pay) || 0) + (Number(record.cash_advance_received) || 0) - totalDeductions),
      government_deductions_manually_entered: true,
      mandatory_deduction_set_id: set.id, mandatory_deduction_set_name: set.name,
      mandatory_deduction_applied_at: appliedAt, mandatory_deduction_applied_by: appliedBy,
    });
  }));
  const updatedById = new Map(updatedRecords.map(record => [record.id, record]));
  const finalRecords = periodRecords.map(record => updatedById.get(record.id) || record);
  const updatedPeriod = await updateRecord('PayrollPeriod', period.id, {
    total_deductions: money(finalRecords.reduce((sum, record) => sum + (Number(record.total_deductions) || 0), 0)),
    total_net: money(finalRecords.reduce((sum, record) => sum + (Number(record.net_pay) || 0), 0)),
    mandatory_deductions_reviewed: true,
    mandatory_deductions_applied: true,
    mandatory_deductions_review_status: 'applied',
    mandatory_deductions_reviewed_at: appliedAt,
    mandatory_deductions_reviewed_by: appliedBy,
  });
  const targetLabel = target === 'all' ? 'all employees' : `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  await createRecord('PasscodeAuditLog', {
    company_profile_id: companyId, source_entity: 'MandatoryDeductionSet', source_record_id: set.id,
    action: 'mandatory_deduction_set_applied', occurred_at: appliedAt, authorized_by: appliedBy,
    summary: `${set.name} applied to ${targetLabel} for ${period.period_name}. HR Officer and Admin Manager passcodes verified.`,
    payroll_period_id: period.id, payroll_period_name: period.period_name,
    employee_id: employee?.employee_id || null, employee_name: target === 'all' ? 'All employees' : targetLabel,
  });
  return res.status(200).json({ updated_count: updatedRecords.length, period: updatedPeriod });
}
