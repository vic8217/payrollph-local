import test from 'node:test';
import assert from 'node:assert/strict';
import { agencyFeeForAttendanceDays, agencyFeeForPeriod, agencyFeeSummary, countAgencyAttendanceDays, moneyToCents, payrollAllocation } from '../src/lib/agencyPayroll.js';

test('agency fees use integer cents and reject invalid or negative values', () => {
  assert.equal(moneyToCents('1500.25'), 150025);
  assert.equal(moneyToCents('-1'), null);
  assert.equal(moneyToCents('abc'), null);
  assert.equal(agencyFeeSummary(Array.from({ length: 10 }, () => ({ is_agency_employee: true })), '1500').totalAgencyFee, 15000);
});

test('monthly agency fees are charged only in the cutoff containing month end', () => {
  assert.equal(agencyFeeForPeriod('1500', 'MONTHLY', '2026-08-31'), 1500);
  assert.equal(agencyFeeForPeriod('1500', 'MONTHLY', '2026-08-24'), 0);
  assert.equal(agencyFeeForPeriod('1500', 'PER_PAYROLL', '2026-08-24'), 1500);
});

test('agency fees charge the full daily amount for both full and half days', () => {
  assert.equal(agencyFeeForAttendanceDays('150', 1), 150);
  assert.equal(agencyFeeForAttendanceDays('16.50', 5), 82.5);
  assert.equal(countAgencyAttendanceDays([
    { date: '2026-08-18', status: 'approved', time_in: '2026-08-18T00:00:00Z', day_type: 'half_day' },
    { date: '2026-08-19', status: 'approved', time_in: '2026-08-19T00:00:00Z', day_type: 'regular' },
  ]), 2);
  assert.equal(agencyFeeForAttendanceDays('150', 0), 0);
});

test('allocation reconciles ATM, non-ATM, and unassigned net payroll', () => {
  const result = payrollAllocation([
    { payroll_method_at_payroll: 'ATM', net_pay: 10000 },
    { payroll_method_at_payroll: 'ATM', net_pay: 15000 },
    { payroll_method_at_payroll: 'NON_ATM', net_pay: 12000 },
    { net_pay: 500 },
  ]);
  assert.equal(result.groups.ATM.netPayroll, 25000);
  assert.equal(result.groups.NON_ATM.netPayroll, 12000);
  assert.equal(result.groups.UNASSIGNED.netPayroll, 500);
  assert.equal(result.totalNetPayroll, 37500);
});

test('agency fees remain separate from employee net payroll', () => {
  const result = payrollAllocation([{ payroll_method_at_payroll: 'ATM', net_pay: 10000, agency_fee_amount: 1500 }]);
  assert.equal(result.totalNetPayroll, 10000);
  assert.equal(result.agencyFees, 1500);
  assert.equal(result.totalEmployerFundingRequirement, 11500);
});
