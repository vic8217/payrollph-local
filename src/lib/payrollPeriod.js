import { addDays, differenceInCalendarDays, format, startOfWeek } from 'date-fns';

export const PAYROLL_WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const DEFAULT_PAYROLL_START_DAY = 6;
export const DEFAULT_PAYROLL_LENGTH_DAYS = 7;

export function normalizePayrollStartDay(company) {
  const value = Number(company?.payroll_period_start_day);
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : DEFAULT_PAYROLL_START_DAY;
}

export function normalizePayrollLengthDays(company) {
  const value = Number(company?.payroll_period_length_days);
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : DEFAULT_PAYROLL_LENGTH_DAYS;
}

export function getPayrollPeriodForDate(date = new Date(), company, offset = 0) {
  const startDay = normalizePayrollStartDay(company);
  const lengthDays = normalizePayrollLengthDays(company);
  const anchorStart = startOfWeek(new Date(2024, 0, 1), { weekStartsOn: startDay });
  const daysSinceAnchor = differenceInCalendarDays(date, anchorStart);
  const periodIndex = Math.floor(daysSinceAnchor / lengthDays) + offset;
  const periodStart = addDays(anchorStart, periodIndex * lengthDays);
  const periodEnd = addDays(periodStart, lengthDays - 1);
  const startDate = format(periodStart, 'yyyy-MM-dd');
  const endDate = format(periodEnd, 'yyyy-MM-dd');

  return {
    start: periodStart,
    end: periodEnd,
    start_date: startDate,
    end_date: endDate,
    period_name: `${format(periodStart, 'MMM d')} - ${format(periodEnd, 'MMM d, yyyy')}`,
    label: `${format(periodStart, 'MMM d')} - ${format(periodEnd, 'MMM d, yyyy')}`,
  };
}

export function getPayrollPeriodName(period) {
  return `Payroll Period: ${period.label || `${period.start_date} - ${period.end_date}`}`;
}

export function getPayrollPeriodSummary(company) {
  const startDay = normalizePayrollStartDay(company);
  const lengthDays = normalizePayrollLengthDays(company);
  const startLabel = PAYROLL_WEEKDAY_OPTIONS.find((day) => day.value === startDay)?.label || 'Saturday';
  return `${startLabel} start, ${lengthDays} day${lengthDays === 1 ? '' : 's'}`;
}
