import { differenceInCalendarDays, differenceInYears, parse } from 'date-fns';

/**
 * Compute yearly summary: total gross income and days/hours worked
 * Only includes earnings from PayrollRecord (basic, OT, holiday, night diff pay)
 */
export function computeYearlySummary(payrollRecords = []) {
  let totalGross = 0;
  let totalBasicPay = 0;
  let totalOvertimePay = 0;
  let totalHolidayPay = 0;
  let totalNightDiffPay = 0;
  let totalDaysWorked = 0;
  let totalHoursWorked = 0;
  let totalOvertimeHours = 0;
  let totalNightDiffHours = 0;

  for (const record of payrollRecords) {
    totalGross += record.gross_pay || 0;
    totalBasicPay += record.basic_pay || 0;
    totalOvertimePay += record.overtime_pay || 0;
    totalHolidayPay += record.holiday_pay || 0;
    totalNightDiffPay += record.night_diff_pay || 0;
    totalDaysWorked += record.days_worked || 0;
    totalHoursWorked += record.hours_worked ?? ((record.days_worked || 0) * 8);
    totalOvertimeHours += record.overtime_hours || 0;
    totalNightDiffHours += record.night_diff_hours || 0;
  }

  return {
    total_gross: parseFloat(totalGross.toFixed(2)),
    total_basic_pay: parseFloat(totalBasicPay.toFixed(2)),
    total_overtime_pay: parseFloat(totalOvertimePay.toFixed(2)),
    total_holiday_pay: parseFloat(totalHolidayPay.toFixed(2)),
    total_night_diff_pay: parseFloat(totalNightDiffPay.toFixed(2)),
    total_days_worked: totalDaysWorked,
    total_hours_worked: parseFloat(totalHoursWorked.toFixed(2)),
    total_overtime_hours: parseFloat(totalOvertimeHours.toFixed(2)),
    total_night_diff_hours: parseFloat(totalNightDiffHours.toFixed(2)),
  };
}

/**
 * Compute 13th month pay per DOLE regulations
 * Formula: (Total Gross Income for the year) / 12
 * Pro-rated if employee worked less than 12 months
 * 
 * Eligible earnings: basic salary, COLA, honoraria, regular bonuses
 * Excluded: overtime, premium pay, allowances, reimbursements
 */
export function computeThirteenthMonthPay(
  employee,
  payrollRecords = [],
  cashAdvances = []
) {
  const yearly = computeYearlySummary(payrollRecords);
  
  // Use basic pay + holiday pay (these are the eligible earnings per DOLE)
  // Overtime, night diff, and other premiums are excluded
  const eligibleEarnings = yearly.total_basic_pay + yearly.total_holiday_pay;
  
  // Compute number of months worked (at least 1 day = 1 month)
  const monthsWorked = Math.max(1, Math.ceil(yearly.total_days_worked / 26)); // ~26 working days per month
  const monthsInYear = 12;
  
  // 13th month pay = (eligible earnings / months in year) * months worked
  const thirteenthMonthGross = parseFloat(
    ((eligibleEarnings / monthsInYear) * Math.min(monthsWorked, monthsInYear)).toFixed(2)
  );
  
  // Deduct unpaid/pending cash advance balances
  let totalCADeduction = 0;
  for (const ca of cashAdvances) {
    // Only deduct if CA is still active (not yet fully deducted)
    if (ca.status !== 'deducted' && ca.remaining_balance > 0) {
      totalCADeduction += ca.remaining_balance || 0;
    }
  }
  totalCADeduction = parseFloat(totalCADeduction.toFixed(2));
  
  const netPay = parseFloat((thirteenthMonthGross - totalCADeduction).toFixed(2));
  
  return {
    employee_id: employee.employee_id,
    employee_name: `${employee.first_name} ${employee.last_name}`,
    department: employee.department,
    position: employee.position,
    basic_salary_monthly: employee.daily_rate ? employee.daily_rate * 26 : employee.monthly_rate || 0,
    eligible_earnings_yearly: parseFloat(eligibleEarnings.toFixed(2)),
    days_worked_yearly: yearly.total_days_worked,
    hours_worked_yearly: yearly.total_hours_worked,
    months_worked: monthsWorked,
    thirteenth_month_gross: thirteenthMonthGross,
    cash_advance_deduction: totalCADeduction,
    net_pay: netPay,
    payout_date: new Date().toISOString().split('T')[0],
  };
}

/**
 * Compute separation pay per Philippine labor law
 * - Voluntary resignation: 1 month basic salary per year of service
 * - Termination without just cause: 1 month basic salary per year OR pro-rata
 * - Service months are computed from hire_date to separation_date
 */
export function computeSeparationPay(
  employee,
  separationDate,
  terminationType = 'resignation', // 'resignation', 'termination', 'retirement'
  cashAdvances = []
) {
  const hireDate = parse(employee.hire_date, 'yyyy-MM-dd', new Date());
  const sepDate = typeof separationDate === 'string' 
    ? parse(separationDate, 'yyyy-MM-dd', new Date())
    : new Date(separationDate);
  
  // Calculate years and months of service
  let yearsOfService = differenceInYears(sepDate, hireDate);
  const daysDifference = differenceInCalendarDays(sepDate, hireDate) - (yearsOfService * 365);
  const monthsOfService = Math.floor(daysDifference / 30); // approximate months
  
  // Basic salary (monthly rate)
  const basicSalaryMonthly = employee.daily_rate 
    ? employee.daily_rate * 26 
    : employee.monthly_rate || 0;
  
  let separationPayGross = 0;
  
  if (terminationType === 'resignation') {
    // Voluntary resignation: 1 month per year of service
    // Minimum: at least 1 month if service is less than 1 year
    separationPayGross = basicSalaryMonthly * Math.max(1, yearsOfService);
  } else if (terminationType === 'termination') {
    // Termination without just cause: 1 month per year OR pro-rata
    // Use pro-rata calculation: (salary * days of service) / 365
    const totalDaysOfService = differenceInCalendarDays(sepDate, hireDate);
    const proRataPay = (basicSalaryMonthly * totalDaysOfService) / 365;
    
    // Take the higher: full month per year or pro-rata
    separationPayGross = Math.max(basicSalaryMonthly * Math.max(1, yearsOfService), proRataPay);
  } else if (terminationType === 'retirement') {
    // Retirement: varies by company policy, typically 1-2 months per year
    // Default: 1.5 months per year
    separationPayGross = basicSalaryMonthly * 1.5 * yearsOfService;
  }
  
  separationPayGross = parseFloat(separationPayGross.toFixed(2));
  
  // Deduct unpaid cash advances
  let totalCADeduction = 0;
  for (const ca of cashAdvances) {
    if (ca.remaining_balance > 0) {
      totalCADeduction += ca.remaining_balance;
    }
  }
  totalCADeduction = parseFloat(totalCADeduction.toFixed(2));
  
  const netPay = parseFloat((separationPayGross - totalCADeduction).toFixed(2));
  
  return {
    employee_id: employee.employee_id,
    employee_name: `${employee.first_name} ${employee.last_name}`,
    department: employee.department,
    position: employee.position,
    hire_date: employee.hire_date,
    separation_date: typeof separationDate === 'string' ? separationDate : separationDate.toISOString().split('T')[0],
    years_of_service: yearsOfService,
    months_of_service: monthsOfService,
    termination_type: terminationType,
    basic_salary_monthly: basicSalaryMonthly,
    separation_pay_gross: separationPayGross,
    cash_advance_deduction: totalCADeduction,
    net_pay: netPay,
  };
}
