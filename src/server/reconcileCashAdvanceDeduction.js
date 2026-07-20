// @ts-nocheck
import { deleteRecord, listRecords, updateRecord } from '@/server/entityStore';
import { capCashAdvanceDeductions, money } from '@/lib/cashAdvanceDeduction';

export async function reconcileCashAdvanceDeduction(record, mandatoryTotal) {
  const details = Array.isArray(record.cash_advance_deduction_details) ? record.cash_advance_deduction_details : [];
  const oldCashAdvanceTotal = money(record.cash_advance_deduction);
  const deductionsBeforeCashAdvance = money(
    (Number(record.total_deductions) || 0) - oldCashAdvanceTotal -
    (Number(record.sss_contribution) || 0) - (Number(record.philhealth_contribution) || 0) -
    (Number(record.pagibig_contribution) || 0)
  );
  const availableNetPay = money(
    (Number(record.gross_pay) || 0) + (Number(record.cash_advance_received) || 0) -
    deductionsBeforeCashAdvance - mandatoryTotal
  );
  const capped = capCashAdvanceDeductions(details, availableNetPay);

  for (let index = 0; index < details.length; index += 1) {
    const previous = details[index];
    const next = capped[index];
    const restored = money((Number(previous.amount) || 0) - next.amount);
    if (!(restored > 0) || !previous.cash_advance_id) continue;
    const [advance] = await listRecords('CashAdvance', { filter: { id: previous.cash_advance_id, company_profile_id: record.company_profile_id }, limit: 1 });
    const ledgerRows = await listRecords('CashAdvanceLedger', {
      filter: { company_profile_id: record.company_profile_id, payroll_period_id: record.payroll_period_id, cash_advance_id: previous.cash_advance_id, transaction_type: 'deduction' },
      limit: 100,
    });
    const balanceBefore = money(previous.balance_before);
    const balanceAfter = money(balanceBefore - next.amount);
    for (const ledger of ledgerRows) {
      if (next.amount > 0) await updateRecord('CashAdvanceLedger', ledger.id, { amount: next.amount, balance_before: balanceBefore, balance_after: balanceAfter });
      else await deleteRecord('CashAdvanceLedger', ledger.id);
    }
    if (advance) {
      const total = Number(previous.deduction_total) || Number(advance.deduction_payroll_periods) || 1;
      const deductionNo = Number(previous.deduction_number) || 1;
      await updateRecord('CashAdvance', advance.id, {
        remaining_balance: balanceAfter,
        deduction_periods_remaining: Math.max(1, total - deductionNo + (next.amount > 0 ? 0 : 1)),
        status: balanceAfter > 0 ? 'approved' : 'deducted',
        payroll_period_id: balanceAfter > 0 && String(advance.payroll_period_id || '') === String(record.payroll_period_id) ? null : advance.payroll_period_id,
      });
    }
  }

  const nextDetails = capped.filter(detail => detail.amount > 0).map(detail => ({ ...detail, balance_after: money((Number(detail.balance_before) || 0) - detail.amount) }));
  return {
    cashAdvanceTotal: money(nextDetails.reduce((sum, detail) => sum + detail.amount, 0)),
    details: nextDetails,
    deductionsBeforeCashAdvance,
  };
}
