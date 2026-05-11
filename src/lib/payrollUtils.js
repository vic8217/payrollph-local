// Philippine Payroll Computation Utilities

// SSS Contribution Table effective January 2025 and used for 2026.
// Regular employee share: 5% of MSC. Employer share: 10% of MSC.
// MSC is bracketed every ₱500 from ₱5,000 to ₱35,000.
export function computeSSS(monthlyRate) {
  const salary = Number(monthlyRate) || 0;
  const msc = Math.min(35000, Math.max(5000, Math.round(salary / 500) * 500));
  const ec = msc >= 15000 ? 30 : 10;

  return {
    employee: parseFloat((msc * 0.05).toFixed(2)),
    employer: parseFloat((msc * 0.10).toFixed(2)),
    ec,
    total: parseFloat((msc * 0.15 + ec).toFixed(2)),
    monthly_salary_credit: msc,
  };
}

// PhilHealth Contribution (2025/2026: 5%, split 50/50, salary credit ₱10,000-₱100,000)
export function computePhilHealth(monthlyRate) {
  const rate = 0.05;
  const minSalaryCredit = 10000;
  const maxSalaryCredit = 100000;
  const salary = Number(monthlyRate) || 0;
  const salaryCredit = Math.min(Math.max(salary, minSalaryCredit), maxSalaryCredit);
  const total = salaryCredit * rate;
  return {
    employee: parseFloat((total / 2).toFixed(2)),
    employer: parseFloat((total / 2).toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    salary_credit: salaryCredit,
  };
}

// Pag-IBIG Contribution (effective Feb 2024: 2% employer, employee 1% up to ₱1,500 else 2%, MFS cap ₱10,000)
export function computePagIbig(monthlyRate) {
  const salary = Number(monthlyRate) || 0;
  const fundSalary = Math.min(Math.max(salary, 0), 10000);
  const employeeRate = fundSalary <= 1500 ? 0.01 : 0.02;
  const employee = fundSalary * employeeRate;
  const employer = fundSalary * 0.02;

  return {
    employee: parseFloat(employee.toFixed(2)),
    employer: parseFloat(employer.toFixed(2)),
    total: parseFloat((employee + employer).toFixed(2)),
    fund_salary: fundSalary,
  };
}

// Withholding Tax (based on TRAIN Law, weekly taxable income)
export function computeWithholdingTax(weeklyTaxableIncome) {
  // Convert to monthly equivalent for bracket computation
  const monthly = weeklyTaxableIncome * 4.33;
  if (monthly <= 20833) return 0;
  if (monthly <= 33333) return ((monthly - 20833) * 0.20) / 4.33;
  if (monthly <= 66667) return (2500 + (monthly - 33333) * 0.25) / 4.33;
  if (monthly <= 166667) return (10833.33 + (monthly - 66667) * 0.30) / 4.33;
  if (monthly <= 666667) return (40833.33 + (monthly - 166667) * 0.32) / 4.33;
  return (200833.33 + (monthly - 666667) * 0.35) / 4.33;
}

export const DAY_PAY_MULTIPLIERS = {
  regular: 1,
  special_working_holiday: 1,
  rest_day: 1.30,
  special_holiday: 1.30,
  special_holiday_rest_day: 1.50,
  double_special_holiday: 1.50,
  double_special_holiday_rest_day: 1.95,
  regular_holiday: 2.00,
  regular_holiday_rest_day: 2.60,
  double_holiday: 3.00,
  double_holiday_rest_day: 3.90,
};

export const OVERTIME_MULTIPLIERS = {
  regular: 1.25,
  special_working_holiday: 1.25,
  rest_day: 1.69,
  special_holiday: 1.69,
  special_holiday_rest_day: 1.95,
  double_special_holiday: 1.95,
  double_special_holiday_rest_day: 2.535,
  regular_holiday: 2.60,
  regular_holiday_rest_day: 3.38,
  double_holiday: 3.90,
  double_holiday_rest_day: 5.07,
};

const REGULAR_HOLIDAY_TYPES = new Set(['regular_holiday', 'regular_holiday_rest_day', 'double_holiday', 'double_holiday_rest_day']);

function resolvePayDayType(log, holidayTypes = []) {
  const logDate = new Date(log.date);
  const isSunday = logDate.getDay() === 0;
  const rawDayType = log.day_type || 'regular';
  // Company default work week: Monday-Saturday work days, Sunday scheduled rest day.
  const isRestDay = isSunday || rawDayType === 'rest_day';

  const explicitRegularHoliday = rawDayType === 'regular_holiday' ? 1 : 0;
  const calendarRegularHolidays = holidayTypes.filter(type => type === 'regular_holiday').length;
  const regularHolidayCount = Math.max(explicitRegularHoliday, calendarRegularHolidays);

  const explicitSpecialHoliday = rawDayType === 'special_holiday' ? 1 : 0;
  const calendarSpecialHolidays = holidayTypes.filter(type => type === 'special_holiday').length;
  const specialHolidayCount = Math.max(explicitSpecialHoliday, calendarSpecialHolidays);
  const hasSpecialWorkingHoliday = rawDayType === 'special_working_holiday' || holidayTypes.includes('special_working_holiday');

  if (regularHolidayCount >= 2) return isRestDay ? 'double_holiday_rest_day' : 'double_holiday';
  if (regularHolidayCount === 1) return isRestDay ? 'regular_holiday_rest_day' : 'regular_holiday';
  if (specialHolidayCount >= 2) return isRestDay ? 'double_special_holiday_rest_day' : 'double_special_holiday';
  if (specialHolidayCount === 1) return isRestDay ? 'special_holiday_rest_day' : 'special_holiday';
  if (hasSpecialWorkingHoliday) return isRestDay ? 'rest_day' : 'special_working_holiday';
  if (isRestDay) return 'rest_day';
  return 'regular';
}

// Overtime pay computation based on DOLE minimum statutory pay rates.
export function computeOvertimePay(hourlyRate, overtimeHours, dayType) {
  const multiplier = OVERTIME_MULTIPLIERS[dayType] || OVERTIME_MULTIPLIERS.regular;
  return hourlyRate * overtimeHours * multiplier;
}

// Holiday/rest-day pay multipliers for the first eight hours.
export function getHolidayMultiplier(dayType, worked) {
  if (!worked && REGULAR_HOLIDAY_TYPES.has(dayType)) {
    return dayType.startsWith('double_holiday') ? 2.0 : 1.0;
  }
  if (!worked) return 0;
  return DAY_PAY_MULTIPLIERS[dayType] || DAY_PAY_MULTIPLIERS.regular;
}

// Night differential is an additional 10% of the applicable hourly rate for the day.
export function computeNightDiffPay(hourlyRate, nightDiffHours, dayType) {
  const dayMultiplier = DAY_PAY_MULTIPLIERS[dayType] || DAY_PAY_MULTIPLIERS.regular;
  return hourlyRate * dayMultiplier * 0.10 * (nightDiffHours || 0);
}

function toValidDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function resolveScheduledTime(logDate, time) {
  if (!logDate || !time) return null;
  const [hours, minutes] = String(time).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return new Date(`${logDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`);
}

export function computeCreditedHoursWorked(log, {
  shiftStartTime = '08:00',
  timeInAllowanceMinutes = 0,
} = {}) {
  const timeIn = toValidDate(log.time_in);
  const timeOut = toValidDate(log.time_out);
  if (!timeIn || !timeOut) return Number(log.hours_worked) || 0;

  const allowance = Math.max(0, Number(timeInAllowanceMinutes) || 0);
  const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
  let effectiveTimeIn = timeIn;

  if (scheduledStart) {
    const minutesAfterStart = (timeIn.getTime() - scheduledStart.getTime()) / 60000;
    if (minutesAfterStart > 0 && minutesAfterStart <= allowance) {
      effectiveTimeIn = scheduledStart;
    }
  }

  const breakOut = toValidDate(log.break_time_out);
  const breakIn = toValidDate(log.break_time_in);
  let hoursWorked = 0;

  if (breakOut && breakIn) {
    hoursWorked += Math.max(0, (breakOut.getTime() - effectiveTimeIn.getTime()) / 36e5);
    hoursWorked += Math.max(0, (timeOut.getTime() - breakIn.getTime()) / 36e5);
  } else {
    hoursWorked = Math.max(0, (timeOut.getTime() - effectiveTimeIn.getTime()) / 36e5);
  }

  return parseFloat(hoursWorked.toFixed(2));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function overlapHours(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return 0;
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, (end - start) / 36e5);
}

export function computeOvertimeHours(log, hoursWorked, {
  shiftStartTime = '08:00',
  overtimeStartTime,
} = {}) {
  if (!overtimeStartTime) {
    return parseFloat(Math.max(0, (Number(hoursWorked) || 0) - 8).toFixed(2));
  }

  const timeOut = toValidDate(log.time_out);
  if (!timeOut) return Number(log.overtime_hours) || 0;

  const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
  let overtimeStart = resolveScheduledTime(log.date, overtimeStartTime);
  if (!overtimeStart) {
    return parseFloat(Math.max(0, (Number(hoursWorked) || 0) - 8).toFixed(2));
  }

  if (scheduledStart && overtimeStart.getTime() <= scheduledStart.getTime()) {
    overtimeStart = addDays(overtimeStart, 1);
  }

  const overtimeWindowStart = new Date(Math.max(overtimeStart.getTime(), toValidDate(log.time_in)?.getTime() || overtimeStart.getTime()));
  let overtimeHours = Math.max(0, (timeOut.getTime() - overtimeWindowStart.getTime()) / 36e5);

  const breakOut = toValidDate(log.break_time_out);
  const breakIn = toValidDate(log.break_time_in);
  overtimeHours -= overlapHours(overtimeWindowStart, timeOut, breakOut, breakIn);

  return parseFloat(Math.max(0, overtimeHours).toFixed(2));
}

// Compute full weekly payroll for an employee
// cashAdvanceDeduction: the fixed per-payroll deduction amount for this period
// noWorkDays: array of NoWorkDay records { date, reason }
// gracePeriodMinutes: number of minutes not to be considered late (default 0)
// options.timeInAllowanceMinutes: Time In(1) allowance credited toward worked hours.
export function computeWeeklyPayroll(employee, attendanceLogs, holidays, cashAdvanceDeduction, noWorkDays = [], gracePeriodMinutes = 0, options = {}) {
  const agencyFeePercentage = employee.agency_fee_percentage || 0;
  const dailyRate = employee.daily_rate || 0;
  const monthlyRate = employee.monthly_rate || dailyRate * 26;
  const hourlyRate = dailyRate / 8;

  // Weekly deductions (monthly / 4.33)
  const sss = computeSSS(monthlyRate);
  const philHealth = computePhilHealth(monthlyRate);
  const pagIbig = computePagIbig(monthlyRate);

  const weeklySSS = parseFloat((sss.employee / 4.33).toFixed(2));
  const weeklyPhilHealth = parseFloat((philHealth.employee / 4.33).toFixed(2));
  const weeklyPagIbig = parseFloat((pagIbig.employee / 4.33).toFixed(2));

  let basicPay = 0;
  let overtimePay = 0;
  let holidayPay = 0;
  let nightDiffPay = 0;
  let lateDeduction = 0;
  let undertimeDeduction = 0;
  let absentDeduction = 0;
  let workedDays = 0;
  let totalHoursWorked = 0;
  let regularDays = 0;
  let restDayWorked = 0;
  let regularHolidayWorked = 0;
  let specialHolidayWorked = 0;
  let totalOvertimeHours = 0;
  let totalNightDiffHours = 0;

  const holidayMap = {};
  holidays.forEach(h => {
    if (!holidayMap[h.date]) holidayMap[h.date] = [];
    holidayMap[h.date].push(h.type);
  });

  // No-work days declared by management (no work = no pay, except regular holiday still pays)
  const noWorkDaySet = new Set((noWorkDays || []).map(d => d.date));

  for (const log of attendanceLogs.filter(l => l.status !== 'pending')) {
    const dayType = resolvePayDayType(log, holidayMap[log.date] || []);
    const holidayMultiplier = getHolidayMultiplier(dayType, !!log.time_in);

    if (log.is_absent) {
      if (holidayMultiplier > 0 && REGULAR_HOLIDAY_TYPES.has(dayType)) {
        holidayPay += dailyRate * holidayMultiplier;
      } else if (!noWorkDaySet.has(log.date)) {
        absentDeduction += dailyRate;
      }
      continue;
    }
    if (!log.time_in) {
      if (holidayMultiplier > 0 && REGULAR_HOLIDAY_TYPES.has(dayType)) {
        holidayPay += dailyRate * holidayMultiplier;
        continue;
      }
      if (noWorkDaySet.has(log.date)) continue; // no-work day, skip
      continue;
    }

    // If this is a declared no-work day and the employee did NOT work, skip pay
    // (If they did work, time_in exists and we fall through to normal pay below)

    const worked = !!log.time_in;
    const multiplier = getHolidayMultiplier(dayType, worked);
    if (worked) workedDays++;

    // Prorate pay based on actual hours worked (max 8h = full day)
    const hoursWorked = computeCreditedHoursWorked(log, options);
    totalHoursWorked += hoursWorked;
    const dayFraction = hoursWorked >= 8 ? 1 : hoursWorked / 8;
    const effectivePay = dailyRate * multiplier * dayFraction;

    // Auto-compute undertime from hours_worked if not manually set
    const undertimeFromHours = hoursWorked > 0 && hoursWorked < 8 ? (8 - hoursWorked) * 60 : 0;
    const undertimeMins = log.undertime_minutes > 0 ? log.undertime_minutes : undertimeFromHours;

    if (dayType === 'regular' || dayType === 'special_working_holiday') {
      regularDays++;
      basicPay += effectivePay;
    } else if (dayType === 'rest_day') {
      restDayWorked++;
      basicPay += effectivePay;
    } else if (dayType === 'regular_holiday' || dayType === 'regular_holiday_rest_day' || dayType === 'double_holiday' || dayType === 'double_holiday_rest_day') {
      regularHolidayWorked++;
      if (dayType.endsWith('_rest_day')) restDayWorked++;
      holidayPay += effectivePay;
    } else if (dayType === 'special_holiday' || dayType === 'special_holiday_rest_day' || dayType === 'double_special_holiday' || dayType === 'double_special_holiday_rest_day') {
      specialHolidayWorked++;
      if (dayType.endsWith('_rest_day')) restDayWorked++;
      holidayPay += effectivePay;
    }

    // Overtime
    const overtimeHours = options.overtimeStartTime
      ? computeOvertimeHours(log, hoursWorked, options)
      : Number(log.overtime_hours) || 0;
    if (overtimeHours > 0) {
      totalOvertimeHours += overtimeHours;
      overtimePay += computeOvertimePay(hourlyRate, overtimeHours, dayType);
    }

    // Night differential (10% premium per ND hour)
    if (log.night_diff_hours > 0) {
      totalNightDiffHours += log.night_diff_hours;
      nightDiffPay += computeNightDiffPay(hourlyRate, log.night_diff_hours, dayType);
    }

    // Late deduction (per minute = hourly rate / 60), minus grace period
    const lateMinutesAfterGrace = Math.max(0, log.late_minutes - gracePeriodMinutes);
    if (lateMinutesAfterGrace > 0) {
      lateDeduction += (hourlyRate / 60) * lateMinutesAfterGrace;
    }

    // Undertime deduction (use auto-computed from hours_worked if not manually set)
    if (undertimeMins > 0) {
      undertimeDeduction += (hourlyRate / 60) * undertimeMins;
    }
  }

  const grossPay = basicPay + overtimePay + holidayPay + nightDiffPay;
  const taxableIncome = grossPay - weeklySSS - weeklyPhilHealth - weeklyPagIbig;
  const withholdingTax = parseFloat(computeWithholdingTax(Math.max(0, taxableIncome)).toFixed(2));

  // Compute agency fee (percentage of basic pay only for agency employees)
  const agencyFee = employee.employment_type === 'agency' ? parseFloat((basicPay * agencyFeePercentage / 100).toFixed(2)) : 0;

  const totalDeductions = weeklySSS + weeklyPhilHealth + weeklyPagIbig + withholdingTax +
    lateDeduction + undertimeDeduction + absentDeduction + agencyFee + (cashAdvanceDeduction || 0);

  const netPay = grossPay - totalDeductions;

  return {
    basic_pay: parseFloat(basicPay.toFixed(2)),
    overtime_pay: parseFloat(overtimePay.toFixed(2)),
    holiday_pay: parseFloat(holidayPay.toFixed(2)),
    night_diff_pay: parseFloat(nightDiffPay.toFixed(2)),
    gross_pay: parseFloat(grossPay.toFixed(2)),
    sss_contribution: weeklySSS,
    philhealth_contribution: weeklyPhilHealth,
    pagibig_contribution: weeklyPagIbig,
    withholding_tax: parseFloat(withholdingTax.toFixed(2)),
    late_deduction: parseFloat(lateDeduction.toFixed(2)),
    undertime_deduction: parseFloat(undertimeDeduction.toFixed(2)),
    absent_deduction: parseFloat(absentDeduction.toFixed(2)),
    agency_fee: agencyFee,
    cash_advance_deduction: cashAdvanceDeduction || 0,
    total_deductions: parseFloat(totalDeductions.toFixed(2)),
    net_pay: parseFloat(netPay.toFixed(2)),
    days_worked: workedDays,
    hours_worked: parseFloat(totalHoursWorked.toFixed(2)),
    regular_days: regularDays,
    rest_day_worked: restDayWorked,
    regular_holiday_worked: regularHolidayWorked,
    special_holiday_worked: specialHolidayWorked,
    overtime_hours: parseFloat(totalOvertimeHours.toFixed(2)),
    night_diff_hours: parseFloat(totalNightDiffHours.toFixed(2)),
  };
}
