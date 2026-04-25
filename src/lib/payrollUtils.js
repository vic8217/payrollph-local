// Philippine Payroll Computation Utilities

// SSS Contribution Table (2024 rates)
export function computeSSS(monthlyRate) {
  if (monthlyRate < 4250) return { employee: 180, employer: 380 };
  if (monthlyRate < 4750) return { employee: 202.50, employer: 427.50 };
  if (monthlyRate < 5250) return { employee: 225, employer: 475 };
  if (monthlyRate < 5750) return { employee: 247.50, employer: 522.50 };
  if (monthlyRate < 6250) return { employee: 270, employer: 570 };
  if (monthlyRate < 6750) return { employee: 292.50, employer: 617.50 };
  if (monthlyRate < 7250) return { employee: 315, employer: 665 };
  if (monthlyRate < 7750) return { employee: 337.50, employer: 712.50 };
  if (monthlyRate < 8250) return { employee: 360, employer: 760 };
  if (monthlyRate < 8750) return { employee: 382.50, employer: 807.50 };
  if (monthlyRate < 9250) return { employee: 405, employer: 855 };
  if (monthlyRate < 9750) return { employee: 427.50, employer: 902.50 };
  if (monthlyRate < 10250) return { employee: 450, employer: 950 };
  if (monthlyRate < 10750) return { employee: 472.50, employer: 997.50 };
  if (monthlyRate < 11250) return { employee: 495, employer: 1045 };
  if (monthlyRate < 11750) return { employee: 517.50, employer: 1092.50 };
  if (monthlyRate < 12250) return { employee: 540, employer: 1140 };
  if (monthlyRate < 12750) return { employee: 562.50, employer: 1187.50 };
  if (monthlyRate < 13250) return { employee: 585, employer: 1235 };
  if (monthlyRate < 13750) return { employee: 607.50, employer: 1282.50 };
  if (monthlyRate < 14250) return { employee: 630, employer: 1330 };
  if (monthlyRate < 14750) return { employee: 652.50, employer: 1377.50 };
  if (monthlyRate < 15250) return { employee: 675, employer: 1425 };
  if (monthlyRate < 15750) return { employee: 697.50, employer: 1472.50 };
  if (monthlyRate < 16250) return { employee: 720, employer: 1520 };
  if (monthlyRate < 16750) return { employee: 742.50, employer: 1567.50 };
  if (monthlyRate < 17250) return { employee: 765, employer: 1615 };
  if (monthlyRate < 17750) return { employee: 787.50, employer: 1662.50 };
  if (monthlyRate < 18250) return { employee: 810, employer: 1710 };
  if (monthlyRate < 18750) return { employee: 832.50, employer: 1757.50 };
  if (monthlyRate < 19250) return { employee: 855, employer: 1805 };
  if (monthlyRate < 19750) return { employee: 877.50, employer: 1852.50 };
  if (monthlyRate < 20250) return { employee: 900, employer: 1900 };
  // Cap at 20,000
  return { employee: 900, employer: 1900 };
}

// PhilHealth Contribution (2024: 5% of monthly salary, split 50/50, max salary credit 80,000)
export function computePhilHealth(monthlyRate) {
  const rate = 0.05;
  const minSalaryCredit = 10000;
  const maxSalaryCredit = 80000;
  const salaryCredit = Math.min(Math.max(monthlyRate, minSalaryCredit), maxSalaryCredit);
  const total = salaryCredit * rate;
  return { employee: total / 2, employer: total / 2 };
}

// Pag-IBIG Contribution (2% employee if > 1500, max 100)
export function computePagIbig(monthlyRate) {
  if (monthlyRate <= 1500) return { employee: monthlyRate * 0.01, employer: monthlyRate * 0.02 };
  return { employee: Math.min(100, monthlyRate * 0.02), employer: Math.min(100, monthlyRate * 0.02) };
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

// Overtime pay computation
export function computeOvertimePay(hourlyRate, overtimeHours, dayType, isRestDay) {
  let multiplier = 1.25; // Regular OT
  if (isRestDay) multiplier = 1.30;
  if (dayType === 'regular_holiday') multiplier = 2.60;
  if (dayType === 'special_holiday') multiplier = 1.69;
  return hourlyRate * overtimeHours * multiplier;
}

// Holiday pay multipliers
export function getHolidayMultiplier(dayType, worked) {
  if (dayType === 'regular_holiday') return worked ? 2.0 : 1.0; // 200% if worked, 100% if not
  if (dayType === 'special_holiday') return worked ? 1.30 : 0; // 130% if worked, no pay if not
  if (dayType === 'rest_day') return worked ? 1.30 : 0;
  return worked ? 1.0 : 0;
}

// Night differential pay (10% of hourly rate per ND hour — Philippine Labor Code)
export function computeNightDiffPay(hourlyRate, nightDiffHours) {
  return hourlyRate * 0.10 * (nightDiffHours || 0);
}

// Compute full weekly payroll for an employee
// cashAdvanceDeduction: the fixed per-payroll deduction amount for this period
// noWorkDays: array of NoWorkDay records { date, reason }
// gracePeriodMinutes: number of minutes not to be considered late (default 0)
export function computeWeeklyPayroll(employee, attendanceLogs, holidays, cashAdvanceDeduction, noWorkDays = [], gracePeriodMinutes = 0) {
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
  let regularDays = 0;
  let restDayWorked = 0;
  let regularHolidayWorked = 0;
  let specialHolidayWorked = 0;
  let totalOvertimeHours = 0;
  let totalNightDiffHours = 0;

  const holidayDates = new Set(holidays.map(h => h.date));
  const holidayMap = {};
  holidays.forEach(h => { holidayMap[h.date] = h.type; });

  // No-work days declared by management (no work = no pay, except regular holiday still pays)
  const noWorkDaySet = new Set((noWorkDays || []).map(d => d.date));

  for (const log of attendanceLogs.filter(l => l.status !== 'pending')) {
    // Saturday (day 6) is a regular working day — treat as regular if marked as rest_day
    const logDate = new Date(log.date);
    const isSaturday = logDate.getDay() === 6;

    if (log.is_absent) {
      // If absent on a no-work day: no deduction (they didn't need to come)
      // If absent on a regular holiday: still gets paid (handled below via holiday pay)
      if (!noWorkDaySet.has(log.date)) {
        absentDeduction += dailyRate;
      }
      continue;
    }
    if (!log.time_in) {
      // No time_in (not scanned), treat same as absent logic above
      if (noWorkDaySet.has(log.date)) continue; // no-work day, skip
      continue;
    }

    // If this is a declared no-work day and the employee did NOT work, skip pay
    // (If they did work, time_in exists and we fall through to normal pay below)

    // Saturday treated as ordinary workday (regular), not rest_day
    const dayType = (isSaturday && log.day_type === 'rest_day') ? 'regular' : (log.day_type || 'regular');
    const worked = !!log.time_in;
    const multiplier = getHolidayMultiplier(dayType, worked);

    // Prorate pay based on actual hours worked (max 8h = full day)
    const hoursWorked = log.hours_worked || 0;
    const dayFraction = hoursWorked >= 8 ? 1 : hoursWorked / 8;
    const effectivePay = dailyRate * multiplier * dayFraction;

    // Auto-compute undertime from hours_worked if not manually set
    const undertimeFromHours = hoursWorked > 0 && hoursWorked < 8 ? (8 - hoursWorked) * 60 : 0;
    const undertimeMins = log.undertime_minutes > 0 ? log.undertime_minutes : undertimeFromHours;

    if (dayType === 'regular') {
      regularDays++;
      basicPay += effectivePay;
    } else if (dayType === 'rest_day') {
      restDayWorked++;
      basicPay += effectivePay;
    } else if (dayType === 'regular_holiday') {
      regularHolidayWorked++;
      holidayPay += effectivePay;
    } else if (dayType === 'special_holiday') {
      specialHolidayWorked++;
      holidayPay += effectivePay;
    }

    // Overtime
    if (log.overtime_hours > 0) {
      totalOvertimeHours += log.overtime_hours;
      overtimePay += computeOvertimePay(hourlyRate, log.overtime_hours, dayType, dayType === 'rest_day');
    }

    // Night differential (10% premium per ND hour)
    if (log.night_diff_hours > 0) {
      totalNightDiffHours += log.night_diff_hours;
      nightDiffPay += computeNightDiffPay(hourlyRate, log.night_diff_hours);
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
    days_worked: regularDays + restDayWorked + regularHolidayWorked + specialHolidayWorked,
    regular_days: regularDays,
    rest_day_worked: restDayWorked,
    regular_holiday_worked: regularHolidayWorked,
    special_holiday_worked: specialHolidayWorked,
    overtime_hours: parseFloat(totalOvertimeHours.toFixed(2)),
    night_diff_hours: parseFloat(totalNightDiffHours.toFixed(2)),
  };
}