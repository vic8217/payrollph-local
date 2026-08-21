// @ts-nocheck
import { listRecords } from '@/server/entityStore';
import { prisma } from '@/server/prisma';

const FIELDS = ['basic_pay','overtime_hours','overtime_pay','night_diff_pay','cash_advance_received','cash_advance_deduction','late_deduction','total_deductions','gross_pay','net_pay'];
const number = value => Number(value) || 0;
const hasVariance = (record, reconciliation) => FIELDS.some(key => Math.abs(number((reconciliation?.system_values || record)[key]) - number((reconciliation?.manual_values || record)[key])) > .005);

export async function payrollReconciliationReadiness(companyProfileId, payrollPeriodId) {
  const records = await listRecords('PayrollRecord', { filter: { company_profile_id: companyProfileId, payroll_period_id: payrollPeriodId }, limit: 5000 });
  const saved = await listRecords('PayrollReconciliation', { filter: { company_profile_id: companyProfileId, payroll_period_id: payrollPeriodId }, limit: 5000 });
  const latest = new Map(); saved.forEach(item => { if (!latest.has(String(item.employee_id))) latest.set(String(item.employee_id), item); });
  let notes = []; let reviewerNotesAvailable = true;
  try { notes = await prisma.payrollReconciliationReviewerNote.findMany({ where: { companyProfileId: String(companyProfileId), payrollPeriodId: String(payrollPeriodId) }, select: { employeeId: true, status: true } }); } catch (error) { if (error?.code === 'P2021') reviewerNotesAvailable = false; else throw error; }
  const openByEmployee = new Set(notes.filter(note => ['needs_response','reopened','responded'].includes(note.status)).map(note => String(note.employeeId)));
  let reconciledEmployees = 0; let unresolvedEmployees = 0; let pendingEmployees = 0;
  records.forEach(record => { const reconciliation = latest.get(String(record.employee_id)); if (!reconciliation) pendingEmployees += 1; else if (hasVariance(record, reconciliation) && !['accept_system','accept_manual'].includes(reconciliation.resolution_status)) unresolvedEmployees += 1; else if (openByEmployee.has(String(record.employee_id))) unresolvedEmployees += 1; else reconciledEmployees += 1; });
  const group = statuses => { const rows = notes.filter(note => statuses.includes(note.status)); return { noteCount: rows.length, employeeCount: new Set(rows.map(note => String(note.employeeId))).size }; };
  const remarksForResolution = group(['needs_response','reopened']); const remarksForReview = group(['responded']); const resolvedReviewerRemarks = group(['resolved']);
  return { totalEmployees: records.length, reconciledEmployees, unresolvedEmployees, pendingEmployees, remarksForResolution, remarksForReview, resolvedReviewerRemarks, reviewerNotesAvailable, isReadyForFinalization: pendingEmployees === 0 && unresolvedEmployees === 0 && (!reviewerNotesAvailable || (remarksForResolution.noteCount === 0 && remarksForReview.noteCount === 0)) };
}
