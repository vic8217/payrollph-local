// Philippine Payroll Computation Utilities

/**
 * @typedef {object} PayrollLog
 * @property {string=} date
 * @property {string | Date | null=} time_in
 * @property {string | Date | null=} time_out
 * @property {string | Date | null=} break_time_out
 * @property {string | Date | null=} break_time_in
 * @property {number=} hours_worked
 * @property {number=} overtime_hours
 * @property {number=} night_diff_hours
 * @property {number=} late_minutes
 * @property {number=} undertime_minutes
 * @property {string=} day_type
 * @property {string=} status
 * @property {boolean=} is_absent
 */

/**
 * @typedef {object} EmployeePayrollInfo
 * @property {number=} agency_fee_percentage
 * @property {number=} daily_rate
 * @property {number=} monthly_rate
 * @property {string=} employment_type
 */

/**
 * @typedef {object} HolidayRecord
 * @property {string} date
 * @property {string} type
 */

/**
 * @typedef {object} NoWorkDayRecord
 * @property {string} date
 */

/**
 * @typedef {object} HoursComputationOptions
 * @property {string=} shiftStartTime
 * @property {number=} timeInAllowanceMinutes
 * @property {number=} lateGraceMinutes
 * @property {number=} breakInGraceMinutes
 * @property {number=} breakDurationMinutes
 * @property {boolean=} paidBreakTime
 * @property {string=} overtimeStartTime
 * @property {boolean=} applyStatutoryDeductions
 * @property {(log: PayrollLog, employee?: EmployeePayrollInfo) => HoursComputationOptions=} resolveLogOptions
 */

// SSS Contribution Table effective January 2025 and used for 2026.
// Regular employee share: 5% of MSC. Employer share: 10% of MSC.
// MSC is bracketed every ₱500 from ₱5,000 to ₱35,000.
/** @param {number} monthlyRate */
export function computeSSS(monthlyRate) {
	const salary = Number(monthlyRate) || 0;
	const msc = Math.min(35000, Math.max(5000, Math.round(salary / 500) * 500));
	const ec = msc >= 15000 ? 30 : 10;

	return {
		employee: parseFloat((msc * 0.05).toFixed(2)),
		employer: parseFloat((msc * 0.1).toFixed(2)),
		ec,
		total: parseFloat((msc * 0.15 + ec).toFixed(2)),
		monthly_salary_credit: msc,
	};
}

// PhilHealth Contribution (2025/2026: 5%, split 50/50, salary credit ₱10,000-₱100,000)
/** @param {number} monthlyRate */
export function computePhilHealth(monthlyRate) {
	const rate = 0.05;
	const minSalaryCredit = 10000;
	const maxSalaryCredit = 100000;
	const salary = Number(monthlyRate) || 0;
	const salaryCredit = Math.min(
		Math.max(salary, minSalaryCredit),
		maxSalaryCredit,
	);
	const total = salaryCredit * rate;
	return {
		employee: parseFloat((total / 2).toFixed(2)),
		employer: parseFloat((total / 2).toFixed(2)),
		total: parseFloat(total.toFixed(2)),
		salary_credit: salaryCredit,
	};
}

// Pag-IBIG Contribution (effective Feb 2024: 2% employer, employee 1% up to ₱1,500 else 2%, MFS cap ₱10,000)
/** @param {number} monthlyRate */
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

/** @param {EmployeePayrollInfo} employee */
export function employeeStatutoryBasePay(employee = {}) {
	const monthlyRate = Number(employee.monthly_rate) || 0;
	if (monthlyRate > 0) return monthlyRate;

	const dailyRate = Number(employee.daily_rate) || 0;
	return dailyRate > 0 ? dailyRate * 26 : 0;
}

// Withholding Tax (based on TRAIN Law, weekly taxable income)
/** @param {number} weeklyTaxableIncome */
export function computeWithholdingTax(weeklyTaxableIncome) {
	// Convert to monthly equivalent for bracket computation
	const monthly = weeklyTaxableIncome * 4.33;
	if (monthly <= 20833) return 0;
	if (monthly <= 33333) return ((monthly - 20833) * 0.2) / 4.33;
	if (monthly <= 66667) return (2500 + (monthly - 33333) * 0.25) / 4.33;
	if (monthly <= 166667) return (10833.33 + (monthly - 66667) * 0.3) / 4.33;
	if (monthly <= 666667) return (40833.33 + (monthly - 166667) * 0.32) / 4.33;
	return (200833.33 + (monthly - 666667) * 0.35) / 4.33;
}

/** @type {Record<string, number>} */
export const DAY_PAY_MULTIPLIERS = {
	regular: 1,
	special_working_holiday: 1,
	rest_day: 1.3,
	special_holiday: 1.3,
	special_holiday_rest_day: 1.5,
	double_special_holiday: 1.5,
	double_special_holiday_rest_day: 1.95,
	regular_holiday: 2.0,
	regular_holiday_rest_day: 2.6,
	double_holiday: 3.0,
	double_holiday_rest_day: 3.9,
};

/** @type {Record<string, number>} */
export const OVERTIME_MULTIPLIERS = {
	regular: 1.25,
	special_working_holiday: 1.25,
	rest_day: 1.69,
	special_holiday: 1.69,
	special_holiday_rest_day: 1.95,
	double_special_holiday: 1.95,
	double_special_holiday_rest_day: 2.535,
	regular_holiday: 2.6,
	regular_holiday_rest_day: 3.38,
	double_holiday: 3.9,
	double_holiday_rest_day: 5.07,
};

const REGULAR_HOLIDAY_TYPES = new Set([
	'regular_holiday',
	'regular_holiday_rest_day',
	'double_holiday',
	'double_holiday_rest_day',
]);

/**
 * @param {PayrollLog} log
 * @param {string[]} holidayTypes
 */
function resolvePayDayType(log, holidayTypes = []) {
	const rawDayType = log.day_type || 'regular';
	// Rest days are employee-specific and must come from the attendance day type.
	// A Sunday can be a normal scheduled work day for an employee.
	const isRestDay = rawDayType === 'rest_day';

	const explicitRegularHoliday = rawDayType === 'regular_holiday' ? 1 : 0;
	const calendarRegularHolidays = holidayTypes.filter(
		(type) => type === 'regular_holiday',
	).length;
	const regularHolidayCount = Math.max(
		explicitRegularHoliday,
		calendarRegularHolidays,
	);

	const explicitSpecialHoliday = rawDayType === 'special_holiday' ? 1 : 0;
	const calendarSpecialHolidays = holidayTypes.filter(
		(type) => type === 'special_holiday',
	).length;
	const specialHolidayCount = Math.max(
		explicitSpecialHoliday,
		calendarSpecialHolidays,
	);
	const hasSpecialWorkingHoliday =
		rawDayType === 'special_working_holiday' ||
		holidayTypes.includes('special_working_holiday');

	if (regularHolidayCount >= 2)
		return isRestDay ? 'double_holiday_rest_day' : 'double_holiday';
	if (regularHolidayCount === 1)
		return isRestDay ? 'regular_holiday_rest_day' : 'regular_holiday';
	if (specialHolidayCount >= 2)
		return isRestDay
			? 'double_special_holiday_rest_day'
			: 'double_special_holiday';
	if (specialHolidayCount === 1)
		return isRestDay ? 'special_holiday_rest_day' : 'special_holiday';
	if (hasSpecialWorkingHoliday)
		return isRestDay ? 'rest_day' : 'special_working_holiday';
	if (isRestDay) return 'rest_day';
	return 'regular';
}

// Overtime pay computation based on DOLE minimum statutory pay rates.
/**
 * @param {number} hourlyRate
 * @param {number} overtimeHours
 * @param {string} dayType
 */
export function computeOvertimePay(hourlyRate, overtimeHours, dayType) {
	const multiplier =
		OVERTIME_MULTIPLIERS[dayType] || OVERTIME_MULTIPLIERS.regular;
	return hourlyRate * overtimeHours * multiplier;
}

// Holiday/rest-day pay multipliers for the first eight hours.
/**
 * @param {string} dayType
 * @param {boolean} worked
 */
export function getHolidayMultiplier(dayType, worked) {
	if (!worked && REGULAR_HOLIDAY_TYPES.has(dayType)) {
		return dayType.startsWith('double_holiday') ? 2.0 : 1.0;
	}
	if (!worked) return 0;
	return DAY_PAY_MULTIPLIERS[dayType] || DAY_PAY_MULTIPLIERS.regular;
}

// Night differential is an additional 10% of the applicable hourly rate for the day.
/**
 * @param {number} hourlyRate
 * @param {number} nightDiffHours
 * @param {string} dayType
 */
export function computeNightDiffPay(hourlyRate, nightDiffHours, dayType) {
	const dayMultiplier =
		DAY_PAY_MULTIPLIERS[dayType] || DAY_PAY_MULTIPLIERS.regular;
	return hourlyRate * dayMultiplier * 0.1 * (nightDiffHours || 0);
}

/** @param {string | Date | null | undefined} value */
function toValidDate(value) {
	const date = value ? new Date(value) : null;
	if (!date || !Number.isFinite(date.getTime())) return null;

	const minutePrecisionDate = new Date(date);
	minutePrecisionDate.setSeconds(0, 0);
	return minutePrecisionDate;
}

function punchActualValue(log, action) {
	const location = log?.[`${action}_location`];
	let locationCapturedAt = null;
	if (typeof location === 'string') {
		try { locationCapturedAt = JSON.parse(location)?.captured_at; } catch { /* invalid legacy location */ }
	} else {
		locationCapturedAt = location?.captured_at;
	}
	return log?.[`${action}_photo_captured_at`] ||
		log?.[`${action}_actual_punch_at`] ||
		locationCapturedAt ||
		null;
}

// Early punches remain credited at the scheduled/credited value. A later
// actual punch always wins so default shift times cannot create unworked time.
function creditedOrLateActualPunch(log, action) {
	const credited = toValidDate(log?.[action]);
	// A completed Super Admin + HR/Admin review explicitly authorizes the
	// adjusted Time In for payroll computation. Preserve the original scan in
	// the audit fields, but do not let it override the approved adjustment.
	if (
		action === 'time_in' &&
		log?.time_in_adjusted_at
	) {
		return credited;
	}
	const actual = toValidDate(punchActualValue(log, action));
	return actual && credited && actual.getTime() > credited.getTime() ? actual : credited;
}

/**
 * @param {string | undefined} logDate
 * @param {string | undefined} time
 */
function resolveScheduledTime(logDate, time) {
	if (!logDate || !time) return null;
	const [hours, minutes] = String(time).split(':').map(Number);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
	return new Date(
		`${logDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`,
	);
}

function addDateString(dateString, days) {
	const [year, month, day] = String(dateString || '').split('-').map(Number);
	if (![year, month, day].every(Number.isFinite)) return null;
	const date = new Date(Date.UTC(year, month - 1, day + days));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function manilaClockParts(value) {
	const date = toValidDate(value);
	if (!date) return null;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Asia/Manila',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(date);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	const hour = Number(values.hour);
	const minute = Number(values.minute);
	return [hour, minute].every(Number.isFinite) ? { hour, minute } : null;
}

function normalizePunchWithinWorkInterval(log, value, workStart, workEnd) {
	const punch = toValidDate(value);
	if (!punch || !workStart || !workEnd || workEnd.getTime() <= workStart.getTime()) return punch;
	if (punch.getTime() > workStart.getTime() && punch.getTime() <= workEnd.getTime()) return punch;

	const nextDate = addDateString(log?.date, 1);
	const clock = manilaClockParts(punch);
	if (!nextDate || !clock) return punch;

	const candidateHours = clock.hour === 12 ? [0, 12] : [clock.hour];
	for (const hour of candidateHours) {
		const candidate = resolveScheduledTime(
			nextDate,
			`${String(hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
		);
		if (
			candidate &&
			candidate.getTime() > workStart.getTime() &&
			candidate.getTime() <= workEnd.getTime()
		) {
			return candidate;
		}
	}

	return punch;
}

export function normalizeOvernightBreakPunches(
	/** @type {PayrollLog} */
	log,
	/** @type {HoursComputationOptions} */
	{ shiftStartTime = '08:00' } = {},
) {
	const timeIn = toValidDate(log.time_in);
	const recordedTimeOut = toValidDate(log.time_out);
	let timeOut = recordedTimeOut;
	const lastStart = creditedOrLateActualPunch(log, 'break_time_in') ||
		creditedOrLateActualPunch(log, 'time_in') ||
		timeIn;

	// A manual time-only correction can leave a daytime timeout on tomorrow's
	// date. Attendance shifts cannot span more than 24 hours, so move such a
	// timeout back to the earliest valid occurrence after the last work start.
	while (
		timeOut &&
		lastStart &&
		timeOut.getTime() - lastStart.getTime() > 24 * 36e5
	) {
		const previousDay = addDays(timeOut, -1);
		if (previousDay.getTime() <= lastStart.getTime()) break;
		timeOut = previousDay;
	}
	if (!timeIn || !timeOut || timeOut.getTime() <= timeIn.getTime()) {
		return { log, updates: {} };
	}

	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	const workStart = scheduledStart && timeIn.getTime() < scheduledStart.getTime()
		? scheduledStart
		: timeIn;
	const breakOut = normalizePunchWithinWorkInterval(log, log.break_time_out, workStart, timeOut);
	const breakIn = normalizePunchWithinWorkInterval(log, log.break_time_in, workStart, timeOut);
	const updates = {};
	if (recordedTimeOut && timeOut.getTime() !== recordedTimeOut.getTime()) {
		updates.time_out = timeOut.toISOString();
	}

	if (breakOut && log.break_time_out && breakOut.getTime() !== toValidDate(log.break_time_out)?.getTime()) {
		updates.break_time_out = breakOut.toISOString();
	}
	if (breakIn && log.break_time_in && breakIn.getTime() !== toValidDate(log.break_time_in)?.getTime()) {
		updates.break_time_in = breakIn.toISOString();
	}

	return {
		log: Object.keys(updates).length > 0 ? { ...log, ...updates } : log,
		updates,
	};
}

export function computeCreditedHoursWorked(
	/** @type {PayrollLog} */
	log,
	/** @type {HoursComputationOptions} */
	{
		shiftStartTime = '08:00',
		breakInGraceMinutes = 0,
		breakDurationMinutes = 60,
		paidBreakTime = false,
	} = {},
) {
	const timeIn = creditedOrLateActualPunch(log, 'time_in');
	const normalizedLog = normalizeOvernightBreakPunches(log, { shiftStartTime }).log;
	const timeOut = toValidDate(normalizedLog.time_out);
	if (!timeIn || !timeOut) return Number(log.hours_worked) || 0;

	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	let effectiveTimeIn = timeIn;

	if (scheduledStart) {
		if (timeIn.getTime() < scheduledStart.getTime()) {
			effectiveTimeIn = scheduledStart;
		}
	}

	const breakOut = toValidDate(normalizedLog.break_time_out);
	const recordedBreakIn = creditedOrLateActualPunch(normalizedLog, 'break_time_in');
	let effectiveBreakIn = recordedBreakIn;
	if (paidBreakTime) {
		return parseFloat(
			Math.max(0, (timeOut.getTime() - effectiveTimeIn.getTime()) / 36e5).toFixed(2),
		);
	}

	if (breakOut && recordedBreakIn) {
		const expectedBreakIn = new Date(breakOut);
		expectedBreakIn.setMinutes(
			expectedBreakIn.getMinutes() + (Number(breakDurationMinutes) || 60),
		);
		const breakInMinutesAfterExpected =
			(recordedBreakIn.getTime() - expectedBreakIn.getTime()) / 60000;

		if (
			breakInMinutesAfterExpected <= 0 ||
			breakInMinutesAfterExpected <= Math.max(0, Number(breakInGraceMinutes) || 0)
		) {
			effectiveBreakIn = expectedBreakIn;
		}
	} else if (breakOut) {
		effectiveBreakIn = new Date(breakOut);
		effectiveBreakIn.setMinutes(
			effectiveBreakIn.getMinutes() + (Number(breakDurationMinutes) || 60),
		);
		if (effectiveBreakIn.getTime() > timeOut.getTime()) {
			effectiveBreakIn = timeOut;
		}
	}

	const firstSegmentHours = breakOut
		? Math.max(0, (breakOut.getTime() - effectiveTimeIn.getTime()) / 36e5)
		: 0;
	const secondSegmentHours = effectiveBreakIn
		? Math.max(0, (timeOut.getTime() - effectiveBreakIn.getTime()) / 36e5)
		: 0;

	const hoursWorked =
		breakOut && effectiveBreakIn
			? firstSegmentHours + secondSegmentHours
			: Math.max(0, (timeOut.getTime() - effectiveTimeIn.getTime()) / 36e5);

	return parseFloat(hoursWorked.toFixed(2));
}

/**
 * @param {Date} date
 * @param {number} days
 */
function addDays(date, days) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

/**
 * @param {Date | null} startA
 * @param {Date | null} endA
 * @param {Date | null} startB
 * @param {Date | null} endB
 */
function overlapHours(startA, endA, startB, endB) {
	if (!startA || !endA || !startB || !endB) return 0;
	const start = Math.max(startA.getTime(), startB.getTime());
	const end = Math.min(endA.getTime(), endB.getTime());
	return Math.max(0, (end - start) / 36e5);
}

function resolveBreakInterval(log, breakDurationMinutes = 60, workStart = null, workEnd = null) {
	const breakOut = normalizePunchWithinWorkInterval(log, log.break_time_out, workStart, workEnd);
	if (!breakOut) return { breakOut: null, breakIn: null };

	const timeOut = workEnd || toValidDate(log.time_out);
	let breakIn = normalizePunchWithinWorkInterval(
		log,
		creditedOrLateActualPunch(log, 'break_time_in'),
		workStart,
		workEnd,
	);
	if (!breakIn) {
		breakIn = new Date(breakOut);
		breakIn.setMinutes(
			breakIn.getMinutes() + (Number(breakDurationMinutes) || 60),
		);
	}
	if (timeOut && breakIn.getTime() > timeOut.getTime()) {
		breakIn = timeOut;
	}
	if (breakIn.getTime() <= breakOut.getTime()) {
		return { breakOut: null, breakIn: null };
	}
	return { breakOut, breakIn };
}

export function computeLateMinutes(
	/** @type {PayrollLog} */
	log,
	/** @type {HoursComputationOptions} */
	{
		shiftStartTime = '08:00',
		timeInAllowanceMinutes = 0,
	} = {},
) {
	const timeIn = creditedOrLateActualPunch(log, 'time_in');
	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	if (!timeIn || !scheduledStart) return Number(log.late_minutes) || 0;

	const minutesAfterStart =
		(timeIn.getTime() - scheduledStart.getTime()) / 60000;
	if (minutesAfterStart <= 0) return 0;

	const allowance = Math.max(0, Number(timeInAllowanceMinutes) || 0);
	if (minutesAfterStart <= allowance) return 0;

	return Math.floor(minutesAfterStart);
}

export function computeNightDifferentialHours(
	/** @type {PayrollLog} */
	log,
	/** @type {HoursComputationOptions} */
	{ shiftStartTime, breakDurationMinutes = 60, paidBreakTime = false } = {},
) {
	const normalizedLog = normalizeOvernightBreakPunches(log, { shiftStartTime }).log;
	const timeIn = creditedOrLateActualPunch(normalizedLog, 'time_in');
	const timeOut = toValidDate(normalizedLog.time_out);
	if (!timeIn || !timeOut || timeOut.getTime() <= timeIn.getTime()) {
		return Number(log.night_diff_hours) || 0;
	}

	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	const effectiveTimeIn = scheduledStart && timeIn.getTime() < scheduledStart.getTime()
		? scheduledStart
		: timeIn;
	if (timeOut.getTime() <= effectiveTimeIn.getTime()) return 0;

	const { breakOut, breakIn } = paidBreakTime
		? { breakOut: null, breakIn: null }
		: resolveBreakInterval(normalizedLog, breakDurationMinutes, effectiveTimeIn, timeOut);
	const workIntervals = breakOut && breakIn
		? [[effectiveTimeIn, breakOut], [breakIn, timeOut]]
		: [[effectiveTimeIn, timeOut]];
	const firstNightWindow = resolveScheduledTime(log.date, '22:00');
	if (!firstNightWindow) return 0;

	let totalHours = 0;
	const durationDays = Math.ceil((timeOut.getTime() - effectiveTimeIn.getTime()) / 864e5);
	for (let dayOffset = -1; dayOffset <= durationDays + 1; dayOffset += 1) {
		const nightStart = addDays(firstNightWindow, dayOffset);
		const nightEnd = new Date(nightStart);
		nightEnd.setHours(nightEnd.getHours() + 8);
		for (const [workStart, workEnd] of workIntervals) {
			totalHours += overlapHours(workStart, workEnd, nightStart, nightEnd);
		}
	}

	return parseFloat(totalHours.toFixed(2));
}

export function computeOvertimeHours(
	/** @type {PayrollLog} */
	log,
	/** @type {number} */
	hoursWorked,
	/** @type {HoursComputationOptions} */
	{
		shiftStartTime = '08:00',
		overtimeStartTime,
		breakInGraceMinutes = 0,
		breakDurationMinutes = 60,
		paidBreakTime = false,
	} = {},
) {
	if (!overtimeStartTime) {
		return parseFloat(Math.max(0, (Number(hoursWorked) || 0) - 8).toFixed(2));
	}

	const normalizedLog = normalizeOvernightBreakPunches(log, { shiftStartTime }).log;
	const timeOut = toValidDate(normalizedLog.time_out);
	if (!timeOut) return Number(log.overtime_hours) || 0;

	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	const reviewedTimeIn = creditedOrLateActualPunch(normalizedLog, 'time_in');
	// Ordinary early scans remain credited at the scheduled start. A protected
	// Time In adjustment, however, confirms that the employee actually worked
	// before the shift, so expose that interval as supportable pre-shift OT.
	const preShiftOvertimeHours = normalizedLog.time_in_adjusted_at && scheduledStart && reviewedTimeIn
		? Math.max(0, (scheduledStart.getTime() - reviewedTimeIn.getTime()) / 36e5)
		: 0;
	let overtimeStart = resolveScheduledTime(log.date, overtimeStartTime);
	if (!overtimeStart) {
		return parseFloat(Math.max(0, (Number(hoursWorked) || 0) - 8).toFixed(2));
	}

	if (scheduledStart && overtimeStart.getTime() <= scheduledStart.getTime()) {
		overtimeStart = addDays(overtimeStart, 1);
	}

	const overtimeWindowStart = new Date(
		Math.max(
			overtimeStart.getTime(),
			reviewedTimeIn?.getTime() || overtimeStart.getTime(),
		),
	);
	let overtimeHours = Math.max(
		0,
		(timeOut.getTime() - overtimeWindowStart.getTime()) / 36e5,
	);

	const workStart = reviewedTimeIn || overtimeWindowStart;
	const breakOut = paidBreakTime ? null : normalizePunchWithinWorkInterval(normalizedLog, normalizedLog.break_time_out, workStart, timeOut);
	const recordedBreakInValue = creditedOrLateActualPunch(normalizedLog, 'break_time_in');
	const recordedBreakIn = normalizePunchWithinWorkInterval(normalizedLog, recordedBreakInValue, workStart, timeOut);
	let effectiveBreakIn = recordedBreakIn;
	if (breakOut && recordedBreakIn) {
		const expectedBreakIn = new Date(breakOut);
		expectedBreakIn.setMinutes(
			expectedBreakIn.getMinutes() + (Number(breakDurationMinutes) || 60),
		);
		const breakInMinutesAfterExpected =
			(recordedBreakIn.getTime() - expectedBreakIn.getTime()) / 60000;

		if (
			breakInMinutesAfterExpected <= 0 ||
			breakInMinutesAfterExpected <=
				Math.max(0, Number(breakInGraceMinutes) || 0)
		) {
			effectiveBreakIn = expectedBreakIn;
		}
	} else if (breakOut) {
		effectiveBreakIn = new Date(breakOut);
		effectiveBreakIn.setMinutes(
			effectiveBreakIn.getMinutes() + (Number(breakDurationMinutes) || 60),
		);
		if (effectiveBreakIn.getTime() > timeOut.getTime()) {
			effectiveBreakIn = timeOut;
		}
	}
	overtimeHours -= overlapHours(
		overtimeWindowStart,
		timeOut,
		breakOut,
		effectiveBreakIn,
	);

	return parseFloat(Math.max(0, overtimeHours + preShiftOvertimeHours).toFixed(2));
}

export function computeRequestExemptOvertimeHours(
	/** @type {PayrollLog} */
	log,
	/** @type {HoursComputationOptions & { shiftEndTime?: string }} */
	{
		shiftStartTime = '08:00',
		shiftEndTime,
		overtimeStartTime,
		breakInGraceMinutes = 0,
		breakDurationMinutes = 60,
		paidBreakTime = false,
	} = {},
) {
	if (!shiftEndTime || !overtimeStartTime) return 0;

	const scheduledStart = resolveScheduledTime(log.date, shiftStartTime);
	let scheduledEnd = resolveScheduledTime(log.date, shiftEndTime);
	let overtimeStart = resolveScheduledTime(log.date, overtimeStartTime);
	const timeOut = toValidDate(log.time_out);
	if (!scheduledStart || !scheduledEnd || !overtimeStart || !timeOut) return 0;

	if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
		scheduledEnd = addDays(scheduledEnd, 1);
	}
	if (overtimeStart.getTime() <= scheduledStart.getTime()) {
		overtimeStart = addDays(overtimeStart, 1);
	}

	const shiftDurationHours = (scheduledEnd.getTime() - scheduledStart.getTime()) / 36e5;
	const overtimeOffsetHours = (overtimeStart.getTime() - scheduledStart.getTime()) / 36e5;
	const isExtendedShift =
		shiftDurationHours >= 12 &&
		overtimeOffsetHours >= 8 &&
		overtimeStart.getTime() < scheduledEnd.getTime();
	if (!isExtendedShift) return 0;

	const cappedTimeOut = new Date(Math.min(timeOut.getTime(), scheduledEnd.getTime()));
	if (cappedTimeOut.getTime() <= overtimeStart.getTime()) return 0;

	return computeOvertimeHours(
		{ ...log, time_out: cappedTimeOut },
		0,
		{
			shiftStartTime,
			overtimeStartTime,
			breakInGraceMinutes,
			breakDurationMinutes,
			paidBreakTime,
		},
	);
}

// Compute full weekly payroll for an employee
// cashAdvanceDeduction: the fixed per-payroll deduction amount for this period
// noWorkDays: array of NoWorkDay records { date, reason }
// gracePeriodMinutes: number of minutes not to be considered late (default 0)
// options.timeInAllowanceMinutes: Time In(1) allowance credited toward worked hours when within the configured window.
export function computeWeeklyPayroll(
	/** @type {EmployeePayrollInfo} */
	employee,
	/** @type {PayrollLog[]} */
	attendanceLogs,
	/** @type {HolidayRecord[]} */
	holidays,
	/** @type {number} */
	cashAdvanceDeduction,
	/** @type {NoWorkDayRecord[]} */
	noWorkDays = [],
	/** @type {number} */
	gracePeriodMinutes = 0,
	/** @type {HoursComputationOptions} */
	options = {},
) {
	const agencyFeePercentage = employee.agency_fee_percentage || 0;
	const dailyRate = employee.daily_rate || 0;
	const monthlyRate = employeeStatutoryBasePay(employee);
	const hourlyRate = dailyRate / 8;

	// Statutory deductions use the employee's base pay from the employee profile,
	// not gross pay, overtime, holiday pay, incentives, or other period earnings.
	const statutoryBasePay = monthlyRate;
	const sss = computeSSS(statutoryBasePay);
	const philHealth = computePhilHealth(statutoryBasePay);
	const pagIbig = computePagIbig(statutoryBasePay);

	const applyStatutoryDeductions = options.applyStatutoryDeductions !== false;
	const weeklySSS = applyStatutoryDeductions ? parseFloat((sss.employee / 4.33).toFixed(2)) : 0;
	const weeklyPhilHealth = applyStatutoryDeductions ? parseFloat((philHealth.employee / 4.33).toFixed(2)) : 0;
	const weeklyPagIbig = applyStatutoryDeductions ? parseFloat((pagIbig.employee / 4.33).toFixed(2)) : 0;

	let basicPay = 0;
	let restDayPay = 0;
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

	/** @type {Record<string, string[]>} */
	const holidayMap = {};
	holidays.forEach((h) => {
		if (!holidayMap[h.date]) holidayMap[h.date] = [];
		holidayMap[h.date].push(h.type);
	});

	// No-work days declared by management (no work = no pay, except regular holiday still pays)
	const noWorkDaySet = new Set((noWorkDays || []).map((d) => d.date));
	const resolveLogOptions =
		typeof options.resolveLogOptions === 'function'
			? options.resolveLogOptions
			: null;

	for (const log of attendanceLogs.filter((l) => l.status !== 'pending')) {
		const logOptions = resolveLogOptions
			? { ...options, ...resolveLogOptions(log, employee) }
			: options;
		const logDate = log.date || '';
		const dayType = resolvePayDayType(log, holidayMap[logDate] || []);
		const holidayMultiplier = getHolidayMultiplier(dayType, !!log.time_in);

		if (log.is_absent) {
			if (holidayMultiplier > 0 && REGULAR_HOLIDAY_TYPES.has(dayType)) {
				holidayPay += dailyRate * holidayMultiplier;
			} else if (!noWorkDaySet.has(logDate)) {
				absentDeduction += dailyRate;
			}
			continue;
		}
		if (!log.time_in) {
			if (holidayMultiplier > 0 && REGULAR_HOLIDAY_TYPES.has(dayType)) {
				holidayPay += dailyRate * holidayMultiplier;
				continue;
			}
			if (noWorkDaySet.has(logDate)) continue; // no-work day, skip
			continue;
		}

		// If this is a declared no-work day and the employee did NOT work, skip pay
		// (If they did work, time_in exists and we fall through to normal pay below)

		const worked = !!log.time_in;
		const multiplier = getHolidayMultiplier(dayType, worked);

		const hoursWorked = computeCreditedHoursWorked(log, logOptions);
		totalHoursWorked += hoursWorked;
		const effectivePay = dailyRate * multiplier;
		const isHalfDay = (log.day_type || '') === 'half_day';
		const lateMinutesAfterGrace = isHalfDay ? 0 : computeLateMinutes(log, logOptions);

		// Automatic missing-time minutes already include a late arrival because
		// credited hours start from the actual Time In. Remove separately charged
		// late minutes so the same minutes are not deducted twice.
		const missingMinutesFromHours =
			hoursWorked > 0 && hoursWorked < 8 ? (8 - hoursWorked) * 60 : 0;
		const manualUndertimeMinutes = Number(log.undertime_minutes) || 0;
		const undertimeMins = isHalfDay
			? 0
			: manualUndertimeMinutes > 0
				? manualUndertimeMinutes
				: Math.max(0, missingMinutesFromHours - lateMinutesAfterGrace);

		if (isHalfDay) {
			workedDays += 0.5;
			regularDays += 0.5;
			basicPay += dailyRate * 0.5;
		} else if (dayType === 'regular' || dayType === 'special_working_holiday') {
			workedDays++;
			regularDays++;
			basicPay += effectivePay;
		} else if (dayType === 'rest_day') {
			workedDays++;
			restDayWorked++;
			restDayPay += effectivePay;
		} else if (
			dayType === 'regular_holiday' ||
			dayType === 'regular_holiday_rest_day' ||
			dayType === 'double_holiday' ||
			dayType === 'double_holiday_rest_day'
		) {
			workedDays++;
			regularHolidayWorked++;
			if (dayType.endsWith('_rest_day')) restDayWorked++;
			holidayPay += effectivePay;
		} else if (
			dayType === 'special_holiday' ||
			dayType === 'special_holiday_rest_day' ||
			dayType === 'double_special_holiday' ||
			dayType === 'double_special_holiday_rest_day'
		) {
			workedDays++;
			specialHolidayWorked++;
			if (dayType.endsWith('_rest_day')) restDayWorked++;
			holidayPay += effectivePay;
		}

		// Overtime
		const hasRequestAwareOvertime =
			log.ot_actual_hours != null ||
			log.overtime_request_id != null ||
			log.ot_requested_hours === 0;
		const overtimeHours = hasRequestAwareOvertime || ['approved', 'denied'].includes(log.ot_status)
			? Number(log.overtime_hours) || 0
			: logOptions.overtimeStartTime
				? computeOvertimeHours(log, hoursWorked, logOptions)
				: Number(log.overtime_hours) || 0;
		if (overtimeHours > 0) {
			totalOvertimeHours += overtimeHours;
			overtimePay += computeOvertimePay(hourlyRate, overtimeHours, dayType);
		}

		// Night differential (10% premium per ND hour)
		const nightDiffHours = computeNightDifferentialHours(log, logOptions);
		if (nightDiffHours > 0) {
			totalNightDiffHours += nightDiffHours;
			nightDiffPay += computeNightDiffPay(
				hourlyRate,
				nightDiffHours,
				dayType,
			);
		}

		// Late deduction after the configured HR/admin allowance.
		if (lateMinutesAfterGrace > 0) {
			lateDeduction += (hourlyRate / 60) * lateMinutesAfterGrace;
		}

		// Undertime deduction (use auto-computed from hours_worked if not manually set)
		if (undertimeMins > 0) {
			undertimeDeduction += (hourlyRate / 60) * undertimeMins;
		}
	}

	const grossPay = basicPay + restDayPay + overtimePay + holidayPay + nightDiffPay;
	const withholdingTax = 0;

	// Compute agency fee (percentage of basic pay only for agency employees)
	const agencyFee =
		employee.employment_type === 'agency'
			? parseFloat(((basicPay * agencyFeePercentage) / 100).toFixed(2))
			: 0;

	const totalDeductions =
		weeklySSS +
		weeklyPhilHealth +
		weeklyPagIbig +
		withholdingTax +
		lateDeduction +
		undertimeDeduction +
		absentDeduction +
		agencyFee +
		(cashAdvanceDeduction || 0);

	const netPay = grossPay - totalDeductions;

	return {
		daily_rate: parseFloat(dailyRate.toFixed(2)),
		monthly_rate: parseFloat(monthlyRate.toFixed(2)),
		statutory_base_pay: parseFloat(statutoryBasePay.toFixed(2)),
		basic_pay: parseFloat(basicPay.toFixed(2)),
		rest_day_pay: parseFloat(restDayPay.toFixed(2)),
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
