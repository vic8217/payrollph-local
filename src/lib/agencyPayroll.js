export const PAYROLL_METHODS = ['ATM', 'NON_ATM', 'UNASSIGNED'];

export function normalizePayrollMethod(value) {
  const normalized = String(value || '').toUpperCase().replace('-', '_');
  return PAYROLL_METHODS.includes(normalized) ? normalized : 'UNASSIGNED';
}

export function moneyToCents(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}

export function centsToMoney(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

export function agencyFeeSummary(employees, feeValue) {
  const feeCents = moneyToCents(feeValue);
  if (feeCents == null) throw new Error('Agency fee must be a valid non-negative amount with no more than two decimal places.');
  const qualified = employees.filter(employee => employee.is_agency_employee === true);
  return {
    employeeCount: qualified.length,
    feePerEmployee: centsToMoney(feeCents),
    totalAgencyFee: centsToMoney(qualified.reduce((sum, employee) =>
      sum + Math.round(Number(employee.agency_fee_amount ?? centsToMoney(feeCents)) * 100), 0)),
    employees: qualified,
  };
}

export function agencyFeeForAttendanceDays(feeValue, attendanceDays) {
  const cents = moneyToCents(feeValue);
  if (cents == null) return 0;
  const days = Math.max(0, Math.floor(Number(attendanceDays) || 0));
  return centsToMoney(cents * days);
}

export function countAgencyAttendanceDays(logs = []) {
  return new Set(logs
    .filter(log => log.status === 'approved' && Boolean(log.time_in) && !log.is_absent)
    .map(log => String(log.date || '').trim())
    .filter(Boolean)).size;
}

export function agencyFeeForPeriod(feeValue, frequency, periodEndDate) {
  const cents = moneyToCents(feeValue);
  if (cents == null) return 0;
  if (frequency !== 'MONTHLY') return centsToMoney(cents);
  const end = new Date(`${periodEndDate}T12:00:00Z`);
  if (!Number.isFinite(end.getTime())) return 0;
  const next = new Date(end);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCMonth() !== end.getUTCMonth() ? centsToMoney(cents) : 0;
}

export function payrollAllocation(records = []) {
  const groups = Object.fromEntries(PAYROLL_METHODS.map(method => [method, { method, employeeCount: 0, netPayrollCents: 0 }]));
  const contributions = {
    sssEmployeeCents: 0, sssEmployerCents: 0,
    philhealthEmployeeCents: 0, philhealthEmployerCents: 0,
    pagibigEmployeeCents: 0, pagibigEmployerCents: 0,
  };
  let agencyFeesCents = 0;
  for (const record of records) {
    const method = normalizePayrollMethod(record.payroll_method_at_payroll);
    groups[method].employeeCount += 1;
    groups[method].netPayrollCents += Math.round(Number(record.net_pay || 0) * 100);
    contributions.sssEmployeeCents += Math.round(Number(record.sss_contribution || 0) * 100);
    contributions.sssEmployerCents += Math.round(Number(record.sss_employer_contribution || 0) * 100);
    contributions.philhealthEmployeeCents += Math.round(Number(record.philhealth_contribution || 0) * 100);
    contributions.philhealthEmployerCents += Math.round(Number(record.philhealth_employer_contribution || 0) * 100);
    contributions.pagibigEmployeeCents += Math.round(Number(record.pagibig_contribution || 0) * 100);
    contributions.pagibigEmployerCents += Math.round(Number(record.pagibig_employer_contribution || 0) * 100);
    agencyFeesCents += Math.round(Number(record.agency_fee_amount || 0) * 100);
  }
  const resultGroups = Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, {
    method: key,
    employeeCount: group.employeeCount,
    netPayroll: centsToMoney(group.netPayrollCents),
  }]));
  const employeeContributionCents = contributions.sssEmployeeCents + contributions.philhealthEmployeeCents + contributions.pagibigEmployeeCents;
  const employerContributionCents = contributions.sssEmployerCents + contributions.philhealthEmployerCents + contributions.pagibigEmployerCents;
  const totalNetPayrollCents = Object.values(groups).reduce((sum, group) => sum + group.netPayrollCents, 0);
  return {
    groups: resultGroups,
    totalNetPayroll: centsToMoney(totalNetPayrollCents),
    contributions: Object.fromEntries(Object.entries(contributions).map(([key, cents]) => [key.replace('Cents', ''), centsToMoney(cents)])),
    totalEmployeeContribution: centsToMoney(employeeContributionCents),
    totalEmployerContribution: centsToMoney(employerContributionCents),
    totalGovernmentRemittance: centsToMoney(employeeContributionCents + employerContributionCents),
    agencyFees: centsToMoney(agencyFeesCents),
    totalEmployerFundingRequirement: centsToMoney(totalNetPayrollCents + employerContributionCents + agencyFeesCents),
  };
}
