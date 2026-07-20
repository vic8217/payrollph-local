// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { createRecord, listRecords, updateRecord } from '@/server/entityStore';
import { prisma } from '@/server/prisma';
import { manilaDateString } from '@/lib/dateUtils';

const money = value => Number.isFinite(Number(value)) ? parseFloat(Number(value).toFixed(2)) : NaN;

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
  const role = authenticatedUser?.role || session.user.role;
  if (!['super_admin', 'admin', 'user'].includes(role)) return res.status(403).json({ error: 'You are not allowed to enter government deductions.' });

  const companyProfileId = String(req.body?.company_profile_id || '').trim();
  const payrollRecordId = String(req.body?.payroll_record_id || '').trim();
  const payrollPeriodId = String(req.body?.payroll_period_id || '').trim();
  const hrPasscode = String(req.body?.hr_passcode || '').trim();
  const adminPasscode = String(req.body?.admin_passcode || '').trim();
  const sss = money(req.body?.sss_contribution);
  const philhealth = money(req.body?.philhealth_contribution);
  const pagibig = money(req.body?.pagibig_contribution);
  if (!companyProfileId || !payrollRecordId || !payrollPeriodId) return res.status(400).json({ error: 'Company, payroll period, and employee payroll record are required.' });
  if ([sss, philhealth, pagibig].some(value => !Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Enter valid non-negative deduction amounts.' });
  if (!hrPasscode || !adminPasscode) return res.status(400).json({ error: 'Both HR Officer and Admin Manager passcodes are required.' });

  const [codes] = await listRecords('DailyPasscode', { filter: { company_profile_id: companyProfileId, date: manilaDateString() }, limit: 1 });
  if (!codes) return res.status(400).json({ error: 'No daily passcodes have been generated for today.' });
  if (String(codes.passcode || '') !== hrPasscode) return res.status(403).json({ error: 'Incorrect HR Officer passcode.' });
  if (String(codes.manager_passcode || '') !== adminPasscode) return res.status(403).json({ error: 'Incorrect Admin Manager passcode.' });

  const [record] = await listRecords('PayrollRecord', { filter: { id: payrollRecordId, company_profile_id: companyProfileId, payroll_period_id: payrollPeriodId }, limit: 1 });
  const [period] = await listRecords('PayrollPeriod', { filter: { id: payrollPeriodId, company_profile_id: companyProfileId }, limit: 1 });
  if (!record || !period) return res.status(404).json({ error: 'Payroll record or period was not found.' });
  if (period.status === 'released' || record.status === 'released') return res.status(400).json({ error: 'Released payroll deductions cannot be changed.' });

  const oldGovernmentTotal = money((Number(record.sss_contribution) || 0) + (Number(record.philhealth_contribution) || 0) + (Number(record.pagibig_contribution) || 0));
  const newGovernmentTotal = money(sss + philhealth + pagibig);
  const baseDeductions = money((Number(record.total_deductions) || 0) - oldGovernmentTotal);
  const totalDeductions = money(baseDeductions + newGovernmentTotal);
  const netPay = money(
    (Number(record.gross_pay) || 0) +
    (Number(record.cash_advance_received) || 0) -
    totalDeductions
  );
  const savedAt = new Date().toISOString();
  const savedBy = authenticatedUser?.name || authenticatedUser?.email || session.user.name || session.user.email || 'unknown';
  const updated = await updateRecord('PayrollRecord', record.id, {
    sss_contribution: sss,
    philhealth_contribution: philhealth,
    pagibig_contribution: pagibig,
    total_deductions: totalDeductions,
    net_pay: netPay,
    government_deductions_manually_entered: true,
    government_deductions_saved_at: savedAt,
    government_deductions_saved_by: savedBy,
    passcode_audit_action: 'government_deductions_saved',
    passcode_audit_at: savedAt,
    passcode_audit_by: savedBy,
    passcode_audit_summary: `Manual government deductions saved for ${record.employee_name || record.employee_id}`,
  });

  const periodRecords = await listRecords('PayrollRecord', { filter: { payroll_period_id: payrollPeriodId, company_profile_id: companyProfileId }, limit: 10000 });
  const periodUpdate = await updateRecord('PayrollPeriod', period.id, {
    total_gross: money(periodRecords.reduce((sum, item) => sum + (item.id === updated.id ? Number(updated.gross_pay) : Number(item.gross_pay) || 0), 0)),
    total_deductions: money(periodRecords.reduce((sum, item) => sum + (item.id === updated.id ? totalDeductions : Number(item.total_deductions) || 0), 0)),
    total_net: money(periodRecords.reduce((sum, item) => sum + (item.id === updated.id ? netPay : Number(item.net_pay) || 0), 0)),
    mandatory_deductions_reviewed: true,
    mandatory_deductions_applied: true,
    mandatory_deductions_review_status: 'applied',
    mandatory_deductions_reviewed_at: savedAt,
    mandatory_deductions_reviewed_by: savedBy,
  });
  await createRecord('PasscodeAuditLog', {
    company_profile_id: companyProfileId,
    source_entity: 'PayrollRecord', source_record_id: record.id,
    action: 'government_deductions_saved', occurred_at: savedAt, authorized_by: savedBy,
    summary: `Manual SSS, PhilHealth, and Pag-IBIG deductions saved for ${record.employee_name || record.employee_id}. HR Officer and Admin Manager accepted responsibility for the computation.`,
    employee_id: record.employee_id, employee_name: record.employee_name, record_date: manilaDateString(),
  });
  return res.status(200).json({ record: updated, period: periodUpdate });
}
