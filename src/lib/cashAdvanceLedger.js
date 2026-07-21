import { appApi } from '@/lib/appApi';

const money = (value) => parseFloat((Number(value) || 0).toFixed(2));

const advanceAmount = (advance) => money(advance.amount_approved || advance.amount_requested || advance.beginning_balance || 0);

async function existingLedger(filter) {
  const rows = await appApi.entities.CashAdvanceLedger.filter(filter);
  return rows[0] || null;
}

export async function ensureCashAdvanceBeginningLedger(advance) {
  if (!advance?.id) return null;

  const existing = await existingLedger({
    cash_advance_id: advance.id,
    transaction_type: 'beginning',
  });

  const amount = money(advance.beginning_balance || advanceAmount(advance));
  const payload = {
    cash_advance_id: advance.id,
    employee_id: advance.employee_id,
    employee_name: advance.employee_name,
    company_profile_id: advance.company_profile_id,
    transaction_date: advance.request_date || new Date().toISOString().slice(0, 10),
    transaction_type: 'beginning',
    description: advance.reason || 'Beginning cash advance balance',
    amount,
    balance_before: 0,
    balance_after: amount,
    deduction_number: null,
    deduction_total: Number(advance.deduction_payroll_periods) || 0,
  };

  if (existing) return appApi.entities.CashAdvanceLedger.update(existing.id, payload);
  return appApi.entities.CashAdvanceLedger.create(payload);
}

export async function ensureCashAdvanceAdditionLedger(advance) {
  if (!advance?.id || advance.advance_type === 'beginning_balance') return null;

  const existing = await existingLedger({
    cash_advance_id: advance.id,
    transaction_type: 'addition',
  });

  const amount = advanceAmount(advance);
  const payload = {
    cash_advance_id: advance.id,
    employee_id: advance.employee_id,
    employee_name: advance.employee_name,
    company_profile_id: advance.company_profile_id,
    transaction_date: advance.approved_date || new Date().toISOString().slice(0, 10),
    transaction_type: 'addition',
    description: advance.reason || 'Cash advance availed',
    amount,
    balance_before: 0,
    balance_after: amount,
    deduction_number: null,
    deduction_total: Number(advance.deduction_payroll_periods) || 0,
  };

  if (existing) return appApi.entities.CashAdvanceLedger.update(existing.id, payload);
  return appApi.entities.CashAdvanceLedger.create(payload);
}

export async function createCashAdvanceDeductionLedger({
  advance,
  amount,
  balanceBefore,
  balanceAfter,
  payrollPeriod,
  payrollRecordId,
  deductionNumber,
}) {
  if (!advance?.id || !payrollPeriod?.id || !(Number(amount) > 0)) return null;

  const existing = await existingLedger({
    cash_advance_id: advance.id,
    payroll_period_id: payrollPeriod.id,
    transaction_type: 'deduction',
  });
  if (existing) return existing;

  const total = Number(advance.deduction_payroll_periods) || Number(advance.deduction_periods_remaining) || deductionNumber || 1;
  const advanceDate = advance.request_date || advance.approved_date || 'no date';
  const advanceLabel = advance.advance_type === 'beginning_balance'
    ? 'Beginning balance'
    : (advance.reason || 'Cash advance');
  return appApi.entities.CashAdvanceLedger.create({
    cash_advance_id: advance.id,
    employee_id: advance.employee_id,
    employee_name: advance.employee_name,
    company_profile_id: advance.company_profile_id,
    payroll_period_id: payrollPeriod.id,
    payroll_record_id: payrollRecordId,
    period_name: payrollPeriod.period_name,
    transaction_date: payrollPeriod.end_date || new Date().toISOString().slice(0, 10),
    transaction_type: 'deduction',
    description: `${advanceLabel} (${advanceDate}) — payment ${deductionNumber} of ${total}`,
    amount: money(amount),
    balance_before: money(balanceBefore),
    balance_after: money(balanceAfter),
    deduction_number: deductionNumber,
    deduction_total: total,
  });
}

export async function ensureCashAdvanceDeductionBackfill(advance) {
  if (!advance?.id || advance.remaining_balance == null) return [];

  const approved = advanceAmount(advance);
  const remaining = money(advance.remaining_balance);
  const totalAlreadyDeducted = money(approved - remaining);
  if (!(totalAlreadyDeducted > 0)) return [];

  const rows = await appApi.entities.CashAdvanceLedger.filter({
    cash_advance_id: advance.id,
    transaction_type: 'deduction',
  });
  const postedDeductions = money(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const missingDeduction = money(totalAlreadyDeducted - postedDeductions);
  if (!(missingDeduction > 0)) return rows;

  const total = Number(advance.deduction_payroll_periods) || Number(advance.deduction_periods_remaining) || 1;
  const existingCount = rows.length;
  const perPayroll = Number(advance.deduction_amount_per_payroll) || missingDeduction;
  const created = [];
  let balanceBefore = money(approved - postedDeductions);
  let remainingMissing = missingDeduction;
  let sequence = existingCount + 1;

  while (remainingMissing > 0) {
    const amount = money(Math.min(perPayroll, remainingMissing));
    const balanceAfter = money(balanceBefore - amount);
    created.push(await appApi.entities.CashAdvanceLedger.create({
      cash_advance_id: advance.id,
      employee_id: advance.employee_id,
      employee_name: advance.employee_name,
      company_profile_id: advance.company_profile_id,
      transaction_date: advance.updated_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      transaction_type: 'deduction',
      description: `Cash advance deduction ${sequence} of ${total}`,
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      deduction_number: sequence,
      deduction_total: total,
      source: 'balance_backfill',
    }));
    balanceBefore = balanceAfter;
    remainingMissing = money(remainingMissing - amount);
    sequence += 1;
  }

  return created;
}
