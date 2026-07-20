export const money = value => parseFloat((Number(value) || 0).toFixed(2));

export function capCashAdvanceDeductions(deductions, availableNetPay) {
  let available = Math.max(money(availableNetPay), 0);
  return deductions.map(deduction => {
    const amount = money(Math.min(Math.max(money(deduction.amount), 0), available));
    available = money(available - amount);
    return { ...deduction, amount };
  });
}
