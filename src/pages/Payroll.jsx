// @ts-nocheck
import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, CheckCircle2, FileText, Printer, Search, Calculator, Trash2, Download, PauseCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { computeWeeklyPayroll } from '@/lib/payrollUtils';
import { getPayrollPeriodForDate, getPayrollPeriodName, normalizePayrollStartDay } from '@/lib/payrollPeriod';
import { createCashAdvanceDeductionLedger } from '@/lib/cashAdvanceLedger';
import { manilaDateString } from '@/lib/dateUtils';
import { effectiveShiftSetting, resolveEmployeeWorkSchedule, shiftFromAttendanceSnapshot } from '@/lib/shiftSettings';
import PayslipView from '@/components/payroll/PayslipView';
import GrossBreakdownDialog from '@/components/payroll/GrossBreakdownDialog';

/**
 * @typedef {Record<string, any> & {
 *   id: string | number,
 *   start_date: string,
 *   end_date: string,
 *   period_name: string,
 *   status: string,
 *   employee_count?: number,
 *   total_gross?: number,
 *   total_deductions?: number,
 *   total_net?: number,
 * }} PayrollEntity
 *
 * @typedef {Record<string, any> & {
 *   id: string | number,
 *   employee_id: string | number,
 *   first_name?: string,
 *   last_name?: string,
 *   employee_name?: string,
 *   department?: string,
 *   status?: string,
 *   agency_fee_percentage?: number,
 *   daily_rate?: number,
 *   monthly_rate?: number,
 *   employment_type?: string,
 *   incentive_settings?: IncentiveSettings,
 * }} EmployeeEntity
 *
 * @typedef {Record<string, any> & {
 *   id?: string | number,
 *   date: string,
 *   employee_id?: string | number,
 *   status?: string,
 *   day_type?: string,
 *   time_in?: string | Date | null,
 *   time_out?: string | Date | null,
 *   is_absent?: boolean,
 *   late_minutes?: number,
 *   hours_worked?: number,
 * }} AttendanceLogEntity
 *
 * @typedef {Record<string, any> & {
 *   id: string | number,
 *   employee_id: string | number,
 *   request_date?: string,
 *   approved_date?: string,
 *   created_date?: string,
 *   advance_type?: string,
 *   status?: string,
 *   deduction_payroll_periods?: number,
 *   deduction_amount_per_payroll?: number,
 *   deduction_periods_remaining?: number,
 *   remaining_balance?: number,
 *   payroll_period_id?: string | number,
 *   reason?: string,
 * }} CashAdvanceEntity
 *
 * @typedef {Record<string, any> & {
 *   cash_advance_id?: string | number,
 *   amount: number,
 *   balance_before?: number,
 *   balance_after?: number,
 *   transaction_date?: string,
 *   description?: string,
 *   deduction_number?: number,
 *   deduction_total?: number,
 * }} CashAdvanceLedgerEntity
 *
 * @typedef {{
 *   ca: CashAdvanceEntity,
 *   amount: number,
 *   remainingBalance: number,
 *   posted?: CashAdvanceLedgerEntity,
 *   deductionNumber: number,
 * }} CashAdvanceDeduction
 *
 * @typedef {{ date: string, type: string, [key: string]: any }} HolidayEntity
 * @typedef {{ date: string, [key: string]: any }} NoWorkDayEntity
 * @typedef {Record<string, any> & { is_default?: boolean }} ShiftSettingEntity
 * @typedef {{ enabled?: boolean, amount?: string | number }} AttendanceIncentiveSettings
 * @typedef {{ id?: string | number, program_name?: string, reason?: string, amount?: string | number }} SpecialIncentiveProgram
 * @typedef {{ attendance?: AttendanceIncentiveSettings, special_programs?: SpecialIncentiveProgram[], [key: string]: any }} IncentiveSettings
 */

const PayrollCard = /** @type {any} */ (Card);
const PayrollDialogContent = /** @type {any} */ (DialogContent);
const PayrollDialogHeader = /** @type {any} */ (DialogHeader);
const PayrollDialogTitle = /** @type {any} */ (DialogTitle);

/** @type {Record<string, string>} */
const statusColors = {
  draft: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  released: 'bg-emerald-100 text-emerald-700',
};

/** @type {Record<string, string>} */
const generationStatusColors = {
  complete: 'bg-emerald-100 text-emerald-700',
  incomplete: 'bg-amber-100 text-amber-700',
  missing: 'bg-gray-100 text-gray-600',
};

const ATTENDANCE_PHOTO_RETENTION_DAYS = 21;

/**
 * @param {CashAdvanceEntity} ca
 * @param {string} periodEndDate
 */
function isCashAdvanceDeductibleForPeriod(ca, periodEndDate) {
  const approvalDate = ca.approved_date || (ca.advance_type === 'beginning_balance' ? ca.request_date : null);
  if (!approvalDate) return true;
  return String(approvalDate).slice(0, 10) <= periodEndDate;
}

/** @param {number | string | null | undefined} value */
function money(value) {
  return parseFloat((Number(value) || 0).toFixed(2));
}

/** @param {unknown} value */
function normalizedId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function addRetentionDays(date, days = ATTENDANCE_PHOTO_RETENTION_DAYS) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function attendancePhotoCleanupDate(period) {
  if (!period?.start_date) return null;
  const start = new Date(`${period.start_date}T00:00:00+08:00`);
  if (!Number.isFinite(start.getTime())) return null;
  return addRetentionDays(start);
}

function canDeleteAttendancePhotosForPeriod(period, currentPeriod) {
  const cleanupDate = attendancePhotoCleanupDate(period);
  const currentStart = currentPeriod?.start_date
    ? new Date(`${currentPeriod.start_date}T00:00:00+08:00`)
    : null;
  return Boolean(
    cleanupDate &&
    currentStart &&
    Number.isFinite(currentStart.getTime()) &&
    currentStart.getTime() >= cleanupDate.getTime()
  );
}

function attendancePhotoCleanupDateLabel(period) {
  const cleanupDate = attendancePhotoCleanupDate(period);
  return cleanupDate ? format(cleanupDate, 'MMM d, yyyy') : 'after retention ends';
}

function legacyShiftTimes(value) {
  if (value === 'night_shift') return { shift_start_time: '20:00', overtime_start_time: '05:30' };
  return { shift_start_time: '08:00', overtime_start_time: '17:30' };
}

function resolveShiftOptionsForLog(log, employee, shiftSettings, defaultShift) {
  const shiftValue = log?.work_schedule || resolveEmployeeWorkSchedule(employee, log?.date, defaultShift?.id || 'day_shift');
  const rawShift = shiftSettings.find(setting => String(setting.id) === String(shiftValue));
  const matchedShift = shiftFromAttendanceSnapshot(log, effectiveShiftSetting(rawShift, log?.date));
  const hasExplicitShift = Boolean(shiftValue);
  const shift = matchedShift || (hasExplicitShift ? {} : defaultShift || {});
  const fallbackShift = legacyShiftTimes(shiftValue);

  return {
    shiftStartTime: shift.shift_start_time || fallbackShift.shift_start_time,
    overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
    timeInAllowanceMinutes: Number(shift.time_in_allowance_minutes) || 0,
    lateGraceMinutes: Number(shift.grace_period_minutes) || 0,
    breakInGraceMinutes: Number(shift.grace_period_minutes) || 0,
    paidBreakTime: Boolean(shift.paid_break_time),
  };
}

/**
 * @param {string} startDate
 * @param {string} endDate
 */
function dateRange(startDate, endDate) {
  /** @type {string[]} */
  const dates = [];
  const current = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);
  while (current <= end) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Default weekly rest day (0 = Sunday). Rest days are never counted as expected
// work days, so working on a rest day never helps nor breaks the attendance
// incentive — it only earns rest-day premium pay separately.
const DEFAULT_REST_DAY = 0;

/**
 * @param {string} startDate
 * @param {string} endDate
 * @param {NoWorkDayEntity[]} noWorkDays
 * @param {HolidayEntity[]} holidays
 */
function expectedRegularWorkDates(startDate, endDate, noWorkDays, holidays) {
  const noWorkDaySet = new Set(noWorkDays.map(day => day.date));
  const holidaySet = new Set(holidays.map(holiday => holiday.date));
  return dateRange(startDate, endDate).filter(date => {
    const day = new Date(`${date}T00:00:00+08:00`).getDay();
    return day !== DEFAULT_REST_DAY && !noWorkDaySet.has(date) && !holidaySet.has(date);
  });
}

/**
 * Returns the (yyyy-MM-dd) date that starts the work week containing `dateStr`,
 * honoring the company's declared work-week start day (0 = Sunday … 6 = Saturday).
 * Uses the same +08:00 parsing as the rest of the period helpers so week
 * grouping is consistent with how Sundays/holidays are determined.
 * @param {string} dateStr
 * @param {number} weekStartDay
 */
function weekStartKey(dateStr, weekStartDay) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceWeekStart = (day - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - daysSinceWeekStart);
  return format(d, 'yyyy-MM-dd');
}

/** @param {AttendanceLogEntity | undefined} log */
function isCompleteRegularDay(log) {
  return log?.status === 'approved' &&
    !log.is_absent &&
    (log.day_type || 'regular') === 'regular' &&
    log.time_in &&
    log.time_out &&
    (Number(log.late_minutes) || 0) <= 0 &&
    (Number(log.hours_worked) || 0) >= 8;
}

/** @param {AttendanceLogEntity | undefined} log */
function isPresentDay(log) {
  return log?.status === 'approved' &&
    !log.is_absent &&
    log.time_in &&
    log.time_out &&
    (Number(log.hours_worked) || 0) > 0;
}

/** @param {EmployeeEntity} employee */
function getIncentiveSettings(employee) {
  const settings = employee?.incentive_settings || {};
  return {
    attendance: {
      enabled: Boolean(settings.attendance?.enabled),
      amount: settings.attendance?.amount ?? '',
    },
    special_programs: Array.isArray(settings.special_programs) ? settings.special_programs : [],
  };
}

/**
 * @param {EmployeeEntity} employee
 * @param {AttendanceLogEntity[]} logs
 * @param {string} periodStartDate
 * @param {string} periodEndDate
 * @param {NoWorkDayEntity[]} noWorkDays
 * @param {HolidayEntity[]} holidays
 * @param {number} weekStartDay
 */
function automaticIncentivesForEmployee(employee, logs, periodStartDate, periodEndDate, noWorkDays, holidays, weekStartDay) {
  const settings = getIncentiveSettings(employee);
  /** @type {Array<Record<string, any>>} */
  const details = [];
  const logsByDate = new Map(logs.map(log => [log.date, log]));
  const expectedWorkDates = expectedRegularWorkDates(periodStartDate, periodEndDate, noWorkDays, holidays);
  const presentDayCount = new Set(logs.filter(isPresentDay).map(log => log.date).filter(Boolean)).size;

  // Attendance incentive is a WEEKLY perfect-attendance bonus: the employee must
  // complete every expected work day of a work week (holidays / rest days are
  // excluded from the requirement) with no absence and no late. The configured
  // amount is granted once per fully-completed work week — not per day.
  // Note: only `expectedWorkDates` are evaluated, and Sunday (the default rest
  // day) is never an expected work day — so working on a Sunday neither helps
  // nor breaks this rule.
  if (settings.attendance.enabled && Number(settings.attendance.amount) > 0 && expectedWorkDates.length > 0) {
    const weeklyAmount = money(settings.attendance.amount);

    // Group expected work days into work weeks aligned to the company's declared
    // work-week start day (e.g. Saturday→Friday). Rest days are already excluded.
    /** @type {Map<string, string[]>} */
    const weeks = new Map();
    for (const date of expectedWorkDates) {
      const key = weekStartKey(date, weekStartDay);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(date);
    }

    // A week qualifies only when ALL of its expected work days are complete
    // (approved, present, no absence, no late, full 8 hours).
    const completedWeeks = [...weeks.values()].filter(
      weekDates => weekDates.every(date => isCompleteRegularDay(logsByDate.get(date)))
    ).length;

    if (completedWeeks > 0) {
      details.push({
        type: 'attendance',
        program_name: 'No Absence / No Late',
        reason: 'Weekly attendance incentive for completing the full work week (no absence, no late)',
        unit: 'week',
        unit_amount: weeklyAmount,
        unit_count: completedWeeks,
        // Backward-compatible aliases for older display code.
        daily_amount: weeklyAmount,
        present_days: completedWeeks,
        amount: money(weeklyAmount * completedWeeks),
        source: 'employee_setup',
      });
    }
  }

  settings.special_programs
    .filter(program => Number(program.amount) > 0)
    .forEach(program => {
      const dailyAmount = money(program.amount);
      details.push({
        id: program.id,
        type: 'special',
        program_name: program.program_name,
        reason: program.reason || 'Automatic special incentive per present day',
        unit: 'day',
        unit_amount: dailyAmount,
        unit_count: presentDayCount,
        daily_amount: dailyAmount,
        present_days: presentDayCount,
        amount: money(dailyAmount * presentDayCount),
        source: 'employee_setup',
      });
    });

  return details;
}

export default function Payroll() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState(/** @type {PayrollEntity | null} */ (null));
  const [selectedRecord, setSelectedRecord] = useState(/** @type {PayrollEntity | null} */ (null));
  const [reviewRecord, setReviewRecord] = useState(/** @type {PayrollEntity | null} */ (null));
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewEmployeeId, setPreviewEmployeeId] = useState('');
  const [previewStartDate, setPreviewStartDate] = useState(manilaDateString());
  const [previewEndDate, setPreviewEndDate] = useState(manilaDateString());
  const [previewing, setPreviewing] = useState(false);
  const [payPreview, setPayPreview] = useState(null);
  const [payPreviewError, setPayPreviewError] = useState('');
  const [incompleteLogsError, setIncompleteLogsError] = useState(/** @type {Array<{ employeeName: string, date: string }> | null} */ (null));
  const [pendingAttendanceError, setPendingAttendanceError] = useState(/** @type {Array<{ employeeName: string, count: number }> | null} */ (null));
  const qc = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();
  const { user } = useAuth();
  const entities = /** @type {Record<string, any>} */ (appApi.entities);

  const baseWeek = new Date();
  const activePeriodConfig = getPayrollPeriodForDate(baseWeek, activeCompany, weekOffset);
  const weekStart = activePeriodConfig.start;
  const weekEnd = activePeriodConfig.end;
  const startStr = activePeriodConfig.start_date;
  const endStr = activePeriodConfig.end_date;

  const periodsQuery = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-created_date', 20),
    enabled: !!activeCompanyId,
  });
  const periods = /** @type {PayrollEntity[]} */ (periodsQuery.data || []);

  const recordsQuery = useQuery({
    queryKey: ['payrollRecords', selectedPeriod?.id],
    queryFn: () => selectedPeriod
      ? entities.PayrollRecord.filter({ payroll_period_id: selectedPeriod.id, company_profile_id: activeCompanyId })
      : [],
    enabled: !!selectedPeriod && !!activeCompanyId,
  });
  const records = /** @type {PayrollEntity[]} */ (recordsQuery.data || []);

  const employeesQuery = useQuery({ queryKey: ['employees', activeCompanyId], queryFn: () => entities.Employee.filter({ company_profile_id: activeCompanyId }, '-created_date', 200), enabled: !!activeCompanyId });
  const employees = /** @type {EmployeeEntity[]} */ (employeesQuery.data || []);
  const holidaysQuery = useQuery({ queryKey: ['holidays', activeCompanyId], queryFn: () => entities.Holiday.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const holidays = /** @type {HolidayEntity[]} */ (holidaysQuery.data || []);
  const cashAdvancesQuery = useQuery({ queryKey: ['cashAdvances', activeCompanyId], queryFn: () => entities.CashAdvance.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const cashAdvances = /** @type {CashAdvanceEntity[]} */ (cashAdvancesQuery.data || []);
  const noWorkDaysQuery = useQuery({ queryKey: ['noWorkDays', activeCompanyId], queryFn: () => entities.NoWorkDay.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const noWorkDays = /** @type {NoWorkDayEntity[]} */ (noWorkDaysQuery.data || []);
  const shiftSettingsQuery = useQuery({ queryKey: ['settings', activeCompanyId], queryFn: () => entities.Settings.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const shiftSettings = /** @type {ShiftSettingEntity[]} */ (shiftSettingsQuery.data || []);

  const periodAttendanceLogsQuery = useQuery({
    queryKey: ['attendanceLogs', selectedPeriod?.start_date, selectedPeriod?.end_date, activeCompanyId],
    queryFn: async () => {
      const periodForLogs = selectedPeriod;
      if (!periodForLogs?.start_date || !periodForLogs?.end_date) return [];
      const periodStart = periodForLogs.start_date;
      const periodEnd = periodForLogs.end_date;
      const all = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.filter({ company_profile_id: activeCompanyId }, '-date', 1000));
      return all.filter(log => log.date >= periodStart && log.date <= periodEnd);
    },
    enabled: !!selectedPeriod && !!activeCompanyId,
  });
  const periodAttendanceLogs = /** @type {AttendanceLogEntity[]} */ (periodAttendanceLogsQuery.data || []);

  const approvePeriod = useMutation({
    /** @param {{ id: string | number, status: string }} args */
    mutationFn: async ({ id, status }) => {
      const updatedPeriod = /** @type {PayrollEntity} */ (await entities.PayrollPeriod.update(id, { status }));
      const periodRecords = /** @type {PayrollEntity[]} */ (await entities.PayrollRecord.filter({ payroll_period_id: id, company_profile_id: activeCompanyId }));
      await Promise.all(periodRecords.map(record =>
        entities.PayrollRecord.update(record.id, { status })
      ));
      return updatedPeriod;
    },
    /** @param {PayrollEntity} updatedPeriod */
    onSuccess: (updatedPeriod) => {
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
      qc.invalidateQueries({ queryKey: ['payrollRecords'] });
      setSelectedPeriod(previous => previous?.id === updatedPeriod.id ? { ...previous, ...updatedPeriod } : updatedPeriod);
    },
  });

  const deleteAttendancePeriodPhotos = useMutation({
    mutationFn: (/** @type {PayrollEntity} */ period) => appApi.functions.invoke('deleteAttendancePeriodPhotos', {
      company_profile_id: activeCompanyId,
      start_date: period.start_date,
      end_date: period.end_date,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendanceLogs'] });
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
    },
  });

  const backupAttendancePeriodPhotos = useMutation({
    mutationFn: (/** @type {PayrollEntity} */ period) => appApi.functions.invoke('backupAttendancePeriodPhotos', {
      company_profile_id: activeCompanyId,
      start_date: period.start_date,
      end_date: period.end_date,
    }),
    onSuccess: (result) => {
      const csv = typeof result?.csv === 'string' ? result.csv : '';
      const filename = result?.filename || 'attendance-photo-backup.csv';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
    },
  });

  const suspendCashAdvanceDeduction = useMutation({
    /** @param {{ record: PayrollEntity, period: PayrollEntity }} args */
    mutationFn: ({ record, period }) => appApi.functions.invoke('suspendCashAdvanceDeduction', {
      payroll_record_id: record.id,
      payroll_period_id: period.id,
      company_profile_id: activeCompanyId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
      qc.invalidateQueries({ queryKey: ['payrollRecords'] });
      qc.invalidateQueries({ queryKey: ['cashAdvances'] });
      qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
    },
  });

  const suspendCashAdvancePeriodDeduction = useMutation({
    /** @param {{ period?: PayrollEntity | null, periodConfig: any, periodName: string }} args */
    mutationFn: ({ period, periodConfig, periodName }) => appApi.functions.invoke('suspendCashAdvancePeriodDeduction', {
      payroll_period_id: period?.id,
      period_name: period?.period_name || periodName,
      start_date: period?.start_date || periodConfig.start_date,
      end_date: period?.end_date || periodConfig.end_date,
      company_profile_id: activeCompanyId,
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
      qc.invalidateQueries({ queryKey: ['payrollRecords'] });
      qc.invalidateQueries({ queryKey: ['cashAdvances'] });
      qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
      if (result?.period) {
        setSelectedPeriod(result.period);
      }
    },
  });

  const previewEmployeePay = async () => {
    setPayPreviewError('');
    setPayPreview(null);

    if (!previewEmployeeId) {
      setPayPreviewError('Select an employee.');
      return;
    }
    if (!previewStartDate || !previewEndDate || previewStartDate > previewEndDate) {
      setPayPreviewError('Choose a valid date range.');
      return;
    }

    const employee = employees.find(emp => String(emp.employee_id) === String(previewEmployeeId));
    if (!employee) {
      setPayPreviewError('Employee not found.');
      return;
    }

    setPreviewing(true);
    try {
      const allLogs = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.filter({
        company_profile_id: activeCompanyId,
        employee_id: employee.employee_id,
      }, '-date', 1000));
      const rangeLogs = allLogs.filter(log =>
        log.date >= previewStartDate &&
        log.date <= previewEndDate &&
        (log.status === 'approved' || log.status === 'pending')
      );
      const incompleteDates = rangeLogs
        .filter(log => log.time_in && !log.time_out && !log.is_absent)
        .map(log => log.date);
      const usableLogs = rangeLogs
        .filter(log => log.is_absent || !log.time_in || log.time_out)
        .map(log => ({ ...log, status: 'approved' }));
      const previewHolidays = holidays.filter(holiday =>
        holiday.date >= previewStartDate && holiday.date <= previewEndDate
      );
      const previewNoWorkDays = noWorkDays.filter(noWorkDay =>
        noWorkDay.date >= previewStartDate && noWorkDay.date <= previewEndDate
      );
      const loggedDates = new Set(usableLogs.map(log => log.date));
      const regularHolidayLogs = previewHolidays
        .filter(holiday => holiday.type === 'regular_holiday' && !loggedDates.has(holiday.date))
        .map(holiday => ({
          employee_id: employee.employee_id,
          date: holiday.date,
          status: 'approved',
          day_type: 'regular_holiday',
          time_in: null,
          is_absent: false,
        }));
      const payrollLogs = [...usableLogs, ...regularHolidayLogs];
      const effectiveShifts = shiftSettings
        .map(setting => effectiveShiftSetting(setting, previewEndDate))
        .filter(setting => setting?.is_active !== false);
      const defaultShift = effectiveShifts.find(setting => setting.is_default) || effectiveShifts[0] || {};
      const gracePeriodMinutes = Number(defaultShift.grace_period_minutes) || 0;
      const computed = computeWeeklyPayroll(
        employee,
        payrollLogs,
        previewHolidays,
        0,
        previewNoWorkDays,
        gracePeriodMinutes,
        {
          shiftStartTime: defaultShift.shift_start_time || '08:00',
          overtimeStartTime: defaultShift.overtime_start_time || '17:30',
          timeInAllowanceMinutes: Number(defaultShift.time_in_allowance_minutes) || 0,
          lateGraceMinutes: gracePeriodMinutes,
          breakInGraceMinutes: gracePeriodMinutes,
          breakDurationMinutes: [30, 60].includes(Number(employee.break_duration_minutes))
            ? Number(employee.break_duration_minutes)
            : 60,
          paidBreakTime: Boolean(defaultShift.paid_break_time),
          applyStatutoryDeductions: false,
          resolveLogOptions: (log) => ({
            ...resolveShiftOptionsForLog(log, employee, shiftSettings, defaultShift),
            breakDurationMinutes: [30, 60].includes(Number(employee.break_duration_minutes))
              ? Number(employee.break_duration_minutes)
              : 60,
          }),
        },
      );
      const incentiveDetails = automaticIncentivesForEmployee(
        employee,
        payrollLogs,
        previewStartDate,
        previewEndDate,
        previewNoWorkDays,
        previewHolidays,
        normalizePayrollStartDay(activeCompany),
      );
      const incentivePay = money(incentiveDetails.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));

      setPayPreview({
        ...computed,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        department: employee.department,
        period_name: `${previewStartDate} to ${previewEndDate}`,
        incentive_pay: incentivePay,
        incentive_details: incentiveDetails,
        gross_pay: money(computed.gross_pay + incentivePay),
        net_pay: money(computed.net_pay + incentivePay),
        included_logs: usableLogs.length,
        incomplete_dates: incompleteDates,
      });
    } catch (error) {
      setPayPreviewError(error?.message || 'Unable to calculate the pay preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const generatePayroll = async () => {
    if (weekStart > new Date()) return;
    const existingTargetPeriod = periods.find(p => p.start_date === startStr && p.end_date === endStr);
    if (existingTargetPeriod?.status === 'released') return;
    setGenerating(true);
    setIncompleteLogsError(null);
    setPendingAttendanceError(null);
    const periodName = getPayrollPeriodName(activePeriodConfig);

    // Pre-check: block if any employee has time_in but no time_out
    const allLogsForCheck = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.list('-date', 1000));
    const activeEmployeesForCheck = employees.filter(e => e.status === 'active');
    /** @type {Array<{ employeeName: string, date: string }>} */
    const incomplete = [];
    for (const emp of activeEmployeesForCheck) {
      const empLogs = allLogsForCheck.filter(log =>
        log.employee_id === emp.employee_id &&
        log.date >= startStr && log.date <= endStr &&
        (log.status === 'approved' || log.status === 'pending') &&
        !log.is_absent
      );
      for (const log of empLogs) {
        if (log.time_in && !log.time_out) {
          incomplete.push({ employeeName: `${emp.first_name} ${emp.last_name}`, date: log.date });
        }
      }
    }
    if (incomplete.length > 0) {
      setIncompleteLogsError(incomplete);
      setGenerating(false);
      return;
    }

    // Pre-check: block if any employee has pending attendance logs
    /** @type {Array<{ employeeName: string, count: number }>} */
    const pendingIssues = [];
    for (const emp of activeEmployeesForCheck) {
      const pendingLogs = allLogsForCheck.filter(log =>
        log.employee_id === emp.employee_id &&
        log.date >= startStr && log.date <= endStr &&
        log.status === 'pending'
      );
      if (pendingLogs.length > 0) {
        pendingIssues.push({ employeeName: `${emp.first_name} ${emp.last_name}`, count: pendingLogs.length });
      }
    }
    if (pendingIssues.length > 0) {
      setPendingAttendanceError(pendingIssues);
      setGenerating(false);
      return;
    }

    // Check if period already exists
    let period = /** @type {PayrollEntity | undefined} */ (periods.find(periodItem => periodItem.start_date === startStr && periodItem.end_date === endStr));
    if (!period) {
      period = /** @type {PayrollEntity} */ (await entities.PayrollPeriod.create({
        period_name: periodName,
        start_date: startStr,
        end_date: endStr,
        status: 'processing',
        company_profile_id: activeCompanyId,
      }));
    }

    const periodCashAdvanceDeductionSuspended = Boolean(period.cash_advance_deduction_suspended);
    // Always use a fresh snapshot. Cash advances can be approved while the payroll
    // page remains open, leaving the query cache stale during regeneration.
    const currentCashAdvances = /** @type {CashAdvanceEntity[]} */ (await entities.CashAdvance.filter({
      company_profile_id: activeCompanyId,
    }));
    const activeEmployees = employees.filter(e => e.status === 'active');
    const allLogs = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.list('-date', 1000));
    const existingLedger = /** @type {CashAdvanceLedgerEntity[]} */ (await entities.CashAdvanceLedger.filter({
      company_profile_id: activeCompanyId,
      payroll_period_id: period.id,
      transaction_type: 'deduction',
    }));
    // Approved CAs that still have remaining deduction periods
    const postedCashAdvanceIds = new Set(existingLedger.map(row => normalizedId(row.cash_advance_id)));
    const approvedCA = currentCashAdvances.filter(cashAdvance =>
      (cashAdvance.status === 'approved' &&
        (cashAdvance.deduction_periods_remaining == null || cashAdvance.deduction_periods_remaining > 0) &&
        isCashAdvanceDeductibleForPeriod(cashAdvance, endStr)) ||
      postedCashAdvanceIds.has(normalizedId(cashAdvance.id))
    );

    // Block payroll if any approved CA is missing deduction setup
    /** @type {Array<{ employeeName: string, caId: string | number | undefined }>} */
    const missingCASetup = [];
    for (const emp of activeEmployees) {
      const empCA = approvedCA.filter(cashAdvance => normalizedId(cashAdvance.employee_id) === normalizedId(emp.employee_id));
      for (const cashAdvance of empCA) {
        if (!cashAdvance.deduction_payroll_periods || !cashAdvance.deduction_amount_per_payroll) {
          missingCASetup.push({ employeeName: `${emp.first_name} ${emp.last_name}`, caId: cashAdvance.id });
        }
      }
    }
    if (!periodCashAdvanceDeductionSuspended && missingCASetup.length > 0) {
      setGenerating(false);
      setIncompleteLogsError(missingCASetup.map(m => ({ employeeName: m.employeeName, date: 'Cash advance missing deduction period/amount setup' })));
      return;
    }

    let totalGross = 0, totalDed = 0, totalNet = 0;
    const periodHolidays = holidays.filter(holiday => holiday.date >= startStr && holiday.date <= endStr);
    const periodNoWorkDays = noWorkDays.filter(noWorkDay => noWorkDay.date >= startStr && noWorkDay.date <= endStr);
    const regularHolidayDates = periodHolidays
      .filter(holiday => holiday.type === 'regular_holiday')
      .map(holiday => holiday.date);
    const effectiveShifts = shiftSettings
      .map(setting => effectiveShiftSetting(setting, endStr))
      .filter(setting => setting?.is_active !== false);
    const defaultShift = effectiveShifts.find(setting => setting.is_default) || effectiveShifts[0] || {};
    const gracePeriodMinutes = Number(defaultShift.grace_period_minutes) || 0;
    const timeInAllowanceMinutes = Number(defaultShift.time_in_allowance_minutes) || 0;
    const overtimeStartTime = defaultShift.overtime_start_time || '17:30';

    for (const emp of activeEmployees) {
      const empLogs = allLogs.filter(log =>
        log.employee_id === emp.employee_id &&
        log.date >= startStr && log.date <= endStr &&
        (log.status === 'approved' || log.status === 'pending')
      );
      const empLogDates = new Set(empLogs.map(log => log.date));
      const payrollLogs = [
        ...empLogs,
        ...regularHolidayDates
          .filter(date => !empLogDates.has(date))
          .map(date => ({
            employee_id: emp.employee_id,
            date,
            status: 'approved',
            day_type: 'regular_holiday',
            time_in: null,
            is_absent: false,
          })),
      ];
      const existing = await entities.PayrollRecord.filter({ payroll_period_id: period.id, employee_id: emp.employee_id });
      const existingRecord = existing[0];
      const cashAdvanceDeductionSuspended = Boolean(periodCashAdvanceDeductionSuspended || existingRecord?.cash_advance_deduction_suspended);

      // Find all active CAs for this employee (can have multiple)
      const empCAs = cashAdvanceDeductionSuspended
        ? []
        : approvedCA.filter(cashAdvance => normalizedId(cashAdvance.employee_id) === normalizedId(emp.employee_id));
      // Sum up the per-payroll deduction amounts for this period, capped by remaining balance when available.
      /** @type {CashAdvanceDeduction[]} */
      const caDeductions = empCAs.map(cashAdvance => {
        const posted = existingLedger.find(row => normalizedId(row.cash_advance_id) === normalizedId(cashAdvance.id));
        const scheduledDeduction = cashAdvance.deduction_amount_per_payroll || 0;
        const remainingBalance = cashAdvance.remaining_balance != null
          ? cashAdvance.remaining_balance
          : scheduledDeduction * (cashAdvance.deduction_periods_remaining || cashAdvance.deduction_payroll_periods || 0);
        const totalPeriods = Number(cashAdvance.deduction_payroll_periods) || Number(cashAdvance.deduction_periods_remaining) || 1;
        const currentRemaining = cashAdvance.deduction_periods_remaining != null ? cashAdvance.deduction_periods_remaining : totalPeriods;
        const deductionNumber = posted?.deduction_number || Math.min(totalPeriods, Math.max(1, totalPeriods - currentRemaining + 1));
        return {
          ca: cashAdvance,
          amount: posted ? Number(posted.amount) || 0 : Math.min(scheduledDeduction, Math.max(remainingBalance, 0)),
          remainingBalance,
          posted,
          deductionNumber,
        };
      });
      const caDeductionThisPeriod = caDeductions.reduce((sum, item) => sum + item.amount, 0);
      const cashAdvanceDeductionDetails = caDeductions
        .filter(({ amount }) => Number(amount) > 0)
        .map(({ ca, amount, remainingBalance, posted, deductionNumber }) => {
          const nextBalance = posted?.balance_after != null
            ? Number(posted.balance_after)
            : parseFloat(Math.max(remainingBalance - amount, 0).toFixed(2));
          const deductionTotal = Number(posted?.deduction_total) || Number(ca.deduction_payroll_periods) || Number(ca.deduction_periods_remaining) || deductionNumber || 1;
          const deductionNo = Number(posted?.deduction_number) || deductionNumber;
          return {
            cash_advance_id: ca.id,
            request_date: ca.request_date || ca.approved_date || ca.created_date?.slice(0, 10),
            deduction_date: posted?.transaction_date || endStr,
            description: posted?.description || ca.reason || ca.advance_type || 'Cash advance',
            amount: Number(posted?.amount) || Number(amount) || 0,
            balance_before: posted?.balance_before != null ? Number(posted.balance_before) : Number(remainingBalance) || 0,
            balance_after: nextBalance,
            deduction_number: deductionNo,
            deduction_total: deductionTotal,
            deductions_remaining: Math.max(deductionTotal - deductionNo, 0),
          };
        });

      const computed = computeWeeklyPayroll(
        emp,
        payrollLogs,
        periodHolidays,
        caDeductionThisPeriod,
        periodNoWorkDays,
        gracePeriodMinutes,
        {
          shiftStartTime: defaultShift.shift_start_time || '08:00',
          overtimeStartTime,
          timeInAllowanceMinutes,
          lateGraceMinutes: gracePeriodMinutes,
          breakInGraceMinutes: gracePeriodMinutes,
          breakDurationMinutes: [30, 60].includes(Number(emp.break_duration_minutes)) ? Number(emp.break_duration_minutes) : 60,
          paidBreakTime: Boolean(defaultShift.paid_break_time),
          resolveLogOptions: (log) => ({
            ...resolveShiftOptionsForLog(log, emp, shiftSettings, defaultShift),
            breakDurationMinutes: [30, 60].includes(Number(emp.break_duration_minutes)) ? Number(emp.break_duration_minutes) : 60,
          }),
        }
      );
      const incentiveDetails = automaticIncentivesForEmployee(
        emp,
        payrollLogs,
        startStr,
        endStr,
        periodNoWorkDays,
        periodHolidays,
        normalizePayrollStartDay(activeCompany)
      );
      const incentivePay = money(incentiveDetails.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
      const computedWithIncentives = {
        ...computed,
        incentive_pay: incentivePay,
        incentive_details: incentiveDetails,
        gross_pay: money(computed.gross_pay + incentivePay),
        net_pay: money(computed.net_pay + incentivePay),
      };

      // Upsert payroll record
      const recordStatus = period.status === 'released'
        ? 'released'
        : period.status === 'approved'
          ? 'approved'
          : 'draft';
      const recordData = {
        payroll_period_id: period.id,
        period_name: periodName,
        employee_id: emp.employee_id,
        employee_name: `${emp.first_name} ${emp.last_name}`,
        department: emp.department,
        status: recordStatus,
        company_profile_id: activeCompanyId,
        incentive_settings: emp.incentive_settings || {},
        cash_advance_deduction_details: cashAdvanceDeductionDetails,
        cash_advance_deduction_suspended: cashAdvanceDeductionSuspended,
        ...(cashAdvanceDeductionSuspended ? {
          cash_advance_suspended_amount: existingRecord?.cash_advance_suspended_amount || 0,
          cash_advance_suspended_details: existingRecord?.cash_advance_suspended_details || [],
          cash_advance_suspended_at: existingRecord?.cash_advance_suspended_at || period.cash_advance_suspended_at || null,
          cash_advance_suspended_by: existingRecord?.cash_advance_suspended_by || period.cash_advance_suspended_by || null,
        } : {
          cash_advance_suspended_amount: 0,
          cash_advance_suspended_details: [],
          cash_advance_suspended_at: null,
          cash_advance_suspended_by: null,
        }),
        ...computedWithIncentives,
      };

      const payrollRecord = existing.length > 0
        ? await entities.PayrollRecord.update(existing[0].id, recordData)
        : await entities.PayrollRecord.create(recordData);

      // Decrement remaining periods for each CA; mark as 'deducted' when exhausted
      for (const { ca, amount, remainingBalance, posted, deductionNumber } of caDeductions) {
        if (posted || !(amount > 0)) continue;
        const nextBalance = parseFloat(Math.max(remainingBalance - amount, 0).toFixed(2));
        const currentDeductionPeriods = Number(ca.deduction_periods_remaining ?? ca.deduction_payroll_periods) || 0;
        const remaining = nextBalance <= 0
          ? 0
          : Math.max(currentDeductionPeriods - 1, 1);
        const newStatus = nextBalance <= 0 ? 'deducted' : 'approved';
        await createCashAdvanceDeductionLedger({
          advance: ca,
          amount,
          balanceBefore: remainingBalance,
          balanceAfter: nextBalance,
          payrollPeriod: period,
          payrollRecordId: payrollRecord.id,
          deductionNumber,
        });
        await entities.CashAdvance.update(ca.id, {
          remaining_balance: nextBalance,
          deduction_periods_remaining: remaining,
          status: newStatus,
          payroll_period_id: nextBalance <= 0 ? period.id : ca.payroll_period_id,
        });
      }

      totalGross += computedWithIncentives.gross_pay;
      totalDed += computedWithIncentives.total_deductions;
      totalNet += computedWithIncentives.net_pay;
    }

    const updatedPeriod = await entities.PayrollPeriod.update(period.id, {
      total_gross: parseFloat(totalGross.toFixed(2)),
      total_deductions: parseFloat(totalDed.toFixed(2)),
      total_net: parseFloat(totalNet.toFixed(2)),
      employee_count: activeEmployees.length,
    });

    qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
    qc.invalidateQueries({ queryKey: ['payrollRecords'] });
    qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
    setSelectedPeriod(updatedPeriod);
    setGenerating(false);
  };

  const targetPeriod = periods.find(p => p.start_date === startStr && p.end_date === endStr);
  const currentPeriodConfig = getPayrollPeriodForDate(baseWeek, activeCompany, 0);
  const savedPeriodsByRange = new Map(periods.map(period => [`${period.start_date}:${period.end_date}`, period]));
  const summaryPeriods = Array.from({ length: 8 }, (_, index) => {
    const configuredPeriod = getPayrollPeriodForDate(baseWeek, activeCompany, -index);
    const savedPeriod = savedPeriodsByRange.get(`${configuredPeriod.start_date}:${configuredPeriod.end_date}`);
    const generatedEmployeeCount = Number(savedPeriod?.employee_count) || 0;
    const hasTotals = Number(savedPeriod?.total_gross) > 0 || Number(savedPeriod?.total_net) > 0 || Number(savedPeriod?.total_deductions) > 0;
    const isComplete = !!savedPeriod && (generatedEmployeeCount > 0 || hasTotals);

    return {
      id: savedPeriod?.id || `missing-${configuredPeriod.start_date}`,
      offset: -index,
      savedPeriod,
      period_name: savedPeriod?.period_name || getPayrollPeriodName(configuredPeriod),
      start_date: configuredPeriod.start_date,
      end_date: configuredPeriod.end_date,
      employee_count: generatedEmployeeCount,
      total_net: savedPeriod?.total_net || 0,
      cash_advance_deduction_suspended: Boolean(savedPeriod?.cash_advance_deduction_suspended),
      cash_advance_suspended_by: savedPeriod?.cash_advance_suspended_by,
      workflow_status: savedPeriod?.status || 'not generated',
      generation_status: savedPeriod ? (isComplete ? 'complete' : 'incomplete') : 'missing',
      generation_label: savedPeriod ? (isComplete ? 'Complete' : 'Incomplete') : 'Not generated',
    };
  });
  const selectedSummaryPeriod = summaryPeriods.find(period => period.start_date === startStr && period.end_date === endStr);
  const targetPeriodLabel = selectedSummaryPeriod?.period_name?.replace(/^Payroll Period:\s*/, '') || activePeriodConfig.label;
  const targetPeriodIsComplete = selectedSummaryPeriod?.generation_status === 'complete';
  const generateDisabled = generating ||
    targetPeriod?.status === 'released' ||
    (!!targetPeriod && targetPeriodIsComplete && targetPeriod.status !== 'approved');
  const generateTitle = targetPeriod?.status === 'released'
    ? 'Released payroll periods cannot be regenerated'
    : targetPeriod?.status === 'processing' && targetPeriodIsComplete
      ? 'Approve this payroll period before regenerating'
      : undefined;
  const knownEmployeeIds = new Set(employees.map(employee => String(employee.employee_id || '').toLowerCase()));
  const eligibleRecords = employeesQuery.isSuccess
    ? records.filter(record => knownEmployeeIds.has(String(record.employee_id || '').toLowerCase()))
    : records;
  const hiddenOrphanRecordCount = Math.max(records.length - eligibleRecords.length, 0);
  const normalizedEmployeeSearch = employeeSearch.trim().toLowerCase();
  const filteredRecords = normalizedEmployeeSearch
    ? eligibleRecords.filter(record =>
      [
        record.employee_name,
        record.employee_id,
        record.department,
      ].some(value => String(value || '').toLowerCase().includes(normalizedEmployeeSearch))
    )
    : eligibleRecords;
  const payrollRecordTotals = eligibleRecords.reduce((totals, record) => ({
    gross: money(totals.gross + (Number(record.gross_pay) || 0)),
    cashAdvance: money(totals.cashAdvance + (Number(record.cash_advance_deduction) || 0)),
    deductions: money(totals.deductions + (Number(record.total_deductions) || 0)),
    net: money(totals.net + (Number(record.net_pay) || 0)),
  }), { gross: 0, cashAdvance: 0, deductions: 0, net: 0 });
  const filteredRecordTotals = filteredRecords.reduce((totals, record) => ({
    gross: money(totals.gross + (Number(record.gross_pay) || 0)),
    cashAdvance: money(totals.cashAdvance + (Number(record.cash_advance_deduction) || 0)),
    deductions: money(totals.deductions + (Number(record.total_deductions) || 0)),
    net: money(totals.net + (Number(record.net_pay) || 0)),
  }), { gross: 0, cashAdvance: 0, deductions: 0, net: 0 });
  const selectedPeriodGross = eligibleRecords.length ? payrollRecordTotals.gross : (selectedPeriod?.total_gross || 0);
  const selectedPeriodNet = eligibleRecords.length ? payrollRecordTotals.net : (selectedPeriod?.total_net || 0);
  const canSuspendCashAdvanceDeduction = user?.role === 'super_admin' && selectedPeriod && selectedPeriod.status !== 'released';
  const canSuspendCashAdvancePeriodDeduction = user?.role === 'super_admin';

  const handleDeleteAttendancePhotos = () => {
    if (!selectedPeriod) return;
    const confirmed = window.confirm(`Delete attendance photos for ${selectedPeriod.period_name} (${selectedPeriod.start_date} to ${selectedPeriod.end_date}) across all employees? Payroll and attendance records will remain.`);
    if (!confirmed) return;
    deleteAttendancePeriodPhotos.mutate(selectedPeriod);
  };

  const handleBackupAttendancePhotos = (/** @type {PayrollEntity} */ period) => {
    if (!period || period.status !== 'released') return;
    backupAttendancePeriodPhotos.mutate(period);
  };

  const handleSuspendCashAdvancePeriodDeduction = (periodSummary) => {
    if (!canSuspendCashAdvancePeriodDeduction || !periodSummary) return;
    if (periodSummary.savedPeriod?.status === 'released') return;
    if (periodSummary.cash_advance_deduction_suspended) return;

    const confirmed = window.confirm(`Suspend cash advance deductions for all employees in ${periodSummary.period_name}? This applies even if payroll has not been generated yet.`);
    if (!confirmed) return;
    suspendCashAdvancePeriodDeduction.mutate({
      period: periodSummary.savedPeriod,
      periodConfig: periodSummary,
      periodName: periodSummary.period_name,
    });
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={generatePayroll}
            disabled={generateDisabled}
            className="gap-2"
            title={generateTitle}
          >
            <Play className="w-4 h-4" /> {generating ? 'Processing...' : `Generate ${targetPeriodLabel}`}
          </Button>
        </div>
      </div>

      <PayrollCard className="border border-border shadow-sm">
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Employee Pay Preview</p>
              <p className="text-xs text-muted-foreground">
                Estimate one employee’s pay for a single day or selected dates without generating payroll.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_160px_auto]">
            <Select value={previewEmployeeId} onValueChange={value => {
              setPreviewEmployeeId(value);
              setPayPreview(null);
              setPayPreviewError('');
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees
                  .filter(employee => employee.status === 'active')
                  .map(employee => (
                    <SelectItem key={employee.id} value={String(employee.employee_id)}>
                      {employee.first_name} {employee.last_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={previewStartDate}
              onChange={event => {
                const value = event.target.value;
                setPreviewStartDate(value);
                if (previewEndDate < value) setPreviewEndDate(value);
                setPayPreview(null);
              }}
            />
            <Input
              type="date"
              value={previewEndDate}
              min={previewStartDate}
              onChange={event => {
                setPreviewEndDate(event.target.value);
                setPayPreview(null);
              }}
            />
            <Button onClick={previewEmployeePay} disabled={previewing} className="gap-2">
              <Calculator className="w-4 h-4" />
              {previewing ? 'Calculating...' : 'Preview Pay'}
            </Button>
          </div>

          {payPreviewError && (
            <p className="text-sm text-destructive">{payPreviewError}</p>
          )}

          {payPreview && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-semibold text-foreground">{payPreview.employee_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {payPreview.period_name} · {payPreview.included_logs} attendance record{payPreview.included_logs === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Estimated Pay</p>
                  <p className="text-2xl font-bold text-primary">
                    ₱{Number(payPreview.net_pay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <div className="rounded-lg bg-background p-3">
                  <p className="text-xs text-muted-foreground">Hours</p>
                  <p className="font-semibold">{payPreview.hours_worked || 0}h</p>
                </div>
                <div className="rounded-lg bg-background p-3">
                  <p className="text-xs text-muted-foreground">Basic Pay</p>
                  <p className="font-semibold">₱{Number(payPreview.basic_pay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-lg bg-background p-3">
                  <p className="text-xs text-muted-foreground">OT / Premiums</p>
                  <p className="font-semibold">
                    ₱{Number(
                      (payPreview.overtime_pay || 0) +
                      (payPreview.holiday_pay || 0) +
                      (payPreview.night_diff_pay || 0) +
                      (payPreview.incentive_pay || 0)
                    ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-lg bg-background p-3">
                  <p className="text-xs text-muted-foreground">Attendance Deductions</p>
                  <p className="font-semibold text-destructive">
                    -₱{Number(
                      (payPreview.late_deduction || 0) +
                      (payPreview.undertime_deduction || 0) +
                      (payPreview.absent_deduction || 0) +
                      (payPreview.agency_fee || 0)
                    ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              {payPreview.incomplete_dates.length > 0 && (
                <p className="text-xs text-amber-700">
                  Incomplete attendance excluded: {payPreview.incomplete_dates.join(', ')}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Preview only. No payroll record or cash-advance deduction was posted. Statutory deductions are applied during the actual payroll run.
              </p>
              <Button size="sm" variant="outline" onClick={() => setReviewRecord(payPreview)} className="gap-1">
                <Search className="w-3 h-3" /> View Breakdown
              </Button>
            </div>
          )}
        </div>
      </PayrollCard>

      {/* Pending attendance error */}
      {pendingAttendanceError && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-700 font-semibold text-sm">⚠️ Cannot Generate Payroll — Attendance Pending Approval</span>
          </div>
          <p className="text-xs text-amber-700/80">The following employees have attendance logs that are still pending approval. Please approve or reject their attendance before generating payroll:</p>
          <ul className="text-xs text-amber-800 space-y-1 ml-3">
            {pendingAttendanceError.map((item, i) => (
              <li key={i} className="list-disc">{item.employeeName} — {item.count} pending log{item.count > 1 ? 's' : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Incomplete logs error */}
      {incompleteLogsError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-destructive font-semibold text-sm">⚠️ Cannot Generate Payroll — Missing Time-Out</span>
          </div>
          <p className="text-xs text-destructive/80">The following employees have a time-in but no time-out. Please complete their attendance logs before generating payroll:</p>
          <ul className="text-xs text-destructive space-y-1 ml-3">
            {incompleteLogsError.map((item, i) => (
              <li key={i} className="list-disc">{item.employeeName} — {item.date}</li>
            ))}
          </ul>
        </div>
      )}

      {backupAttendancePeriodPhotos.error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {backupAttendancePeriodPhotos.error.message || 'Unable to download attendance photo backup CSV.'}
        </div>
      )}

      {suspendCashAdvancePeriodDeduction.error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {suspendCashAdvancePeriodDeduction.error.message || 'Unable to suspend cash advance deductions for this payroll period.'}
        </div>
      )}

      <PayrollCard className="border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
          <div>
            <p className="font-semibold text-foreground">Payroll Period Summary</p>
            <p className="text-xs text-muted-foreground mt-0.5">Recent periods based on the company payroll schedule</p>
          </div>
          <Badge variant="outline" className="text-xs">
            {summaryPeriods.filter(period => period.savedPeriod).length} generated
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period Covered</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Photo Cleanup</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payroll Generation</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Employees</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {summaryPeriods.map(period => {
                const isSelected = selectedPeriod?.id === period.savedPeriod?.id;
                const isTarget = period.start_date === startStr && period.end_date === endStr;
                const isCurrent = period.start_date === currentPeriodConfig.start_date && period.end_date === currentPeriodConfig.end_date;
                const canSuspendPeriod = canSuspendCashAdvancePeriodDeduction &&
                  period.savedPeriod?.status !== 'released' &&
                  !period.cash_advance_deduction_suspended;

                return (
                  <tr
                    key={period.id}
                    className={`border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/30 ${!period.savedPeriod ? 'bg-muted/10' : ''} ${isCurrent ? 'bg-emerald-50/80 hover:bg-emerald-50' : ''} ${!isCurrent && (isTarget || isSelected) ? 'bg-primary/5' : ''}`}
                    onClick={() => {
                      setWeekOffset(period.offset);
                      setSelectedPeriod(period.savedPeriod || null);
                      setEmployeeSearch('');
                      setIncompleteLogsError(null);
                      setPendingAttendanceError(null);
                    }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{period.period_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {period.start_date} to {period.end_date}
                        {isCurrent ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Current</span> : ''}
                        {!isCurrent && isTarget ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Selected</span> : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {period.savedPeriod ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleBackupAttendancePhotos(period.savedPeriod);
                            }}
                            disabled={period.savedPeriod.status !== 'released' || backupAttendancePeriodPhotos.isPending}
                            title={period.savedPeriod.status === 'released'
                              ? 'Download attendance photo backup CSV'
                              : 'Available after payroll is released to employees'}
                          >
                            <Download className="h-4 w-4" />
                            {backupAttendancePeriodPhotos.isPending ? 'Backing up...' : 'Backup CSV'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-destructive hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              const confirmed = window.confirm(`Delete attendance photos for ${period.period_name} (${period.start_date} to ${period.end_date}) across all employees? Payroll and attendance records will remain.`);
                              if (!confirmed) return;
                              deleteAttendancePeriodPhotos.mutate(period.savedPeriod);
                            }}
                            disabled={
                              deleteAttendancePeriodPhotos.isPending ||
                              !period.savedPeriod.attendance_photos_backup_completed_at ||
                              !canDeleteAttendancePhotosForPeriod(period, currentPeriodConfig)
                            }
                            title={!period.savedPeriod.attendance_photos_backup_completed_at
                              ? 'Download the backup CSV before deleting photos'
                              : canDeleteAttendancePhotosForPeriod(period, currentPeriodConfig)
                                ? 'Delete attendance photos for this payroll period'
                                : `Available when the current payroll period reaches ${attendancePhotoCleanupDateLabel(period)}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            {deleteAttendancePeriodPhotos.isPending ? 'Deleting...' : 'Delete Photos'}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs ${generationStatusColors[period.generation_status]}`}>
                        {period.generation_label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs capitalize ${statusColors[period.workflow_status] || 'bg-gray-100 text-gray-600'}`}>
                        {period.workflow_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">{period.employee_count || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {period.savedPeriod ? `₱${Number(period.total_net || 0).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {period.cash_advance_deduction_suspended ? (
                          <Badge variant="outline" className="bg-blue-100 text-blue-700 text-xs">
                            CA suspended
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            disabled={!canSuspendPeriod || suspendCashAdvancePeriodDeduction.isPending}
                            title={period.savedPeriod?.status === 'released'
                              ? 'Released payroll periods can no longer be changed'
                              : 'Suspend cash advance deductions for all employees in this payroll period'}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSuspendCashAdvancePeriodDeduction(period);
                            }}
                          >
                            <PauseCircle className="h-4 w-4" />
                            {suspendCashAdvancePeriodDeduction.isPending ? 'Suspending...' : 'Suspend CA'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PayrollCard>

      {/* Selected period card */}
      {targetPeriod && (
        <div
          className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedPeriod?.id === targetPeriod.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}
          onClick={() => {
            setSelectedPeriod(targetPeriod);
            setEmployeeSearch('');
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">{targetPeriod.period_name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {targetPeriod.employee_count || 0} employees · Net ₱{(targetPeriod.total_net || 0).toLocaleString()}
              </p>
            </div>
            <Badge variant="outline" className={`text-xs capitalize ${statusColors[targetPeriod.status]}`}>{targetPeriod.status}</Badge>
          </div>
        </div>
      )}

      {/* Payroll Records */}
      <div>
          {selectedPeriod ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{selectedPeriod.period_name}</p>
                    <Badge variant="outline" className={`text-xs capitalize ${statusColors[selectedPeriod.status] || 'bg-gray-100 text-gray-600'}`}>
                      {selectedPeriod.status === 'released' ? 'Released to employees' : `${selectedPeriod.status || 'draft'} - not released`}
                    </Badge>
                    {selectedPeriod.cash_advance_deduction_suspended && (
                      <Badge variant="outline" className="bg-blue-100 text-blue-700 text-xs">
                        CA deductions suspended for all employees
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-destructive hover:text-destructive"
                      onClick={handleDeleteAttendancePhotos}
                      disabled={
                        deleteAttendancePeriodPhotos.isPending ||
                        !selectedPeriod.attendance_photos_backup_completed_at ||
                        !canDeleteAttendancePhotosForPeriod(selectedPeriod, currentPeriodConfig)
                      }
                      title={!selectedPeriod.attendance_photos_backup_completed_at
                        ? 'Download the backup CSV before deleting photos'
                        : canDeleteAttendancePhotosForPeriod(selectedPeriod, currentPeriodConfig)
                          ? 'Delete attendance photos for this payroll period'
                          : `Available when the current payroll period reaches ${attendancePhotoCleanupDateLabel(selectedPeriod)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleteAttendancePeriodPhotos.isPending ? 'Deleting photos...' : 'Delete Attendance Photos'}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {eligibleRecords.length} employees · Gross ₱{selectedPeriodGross.toLocaleString()} · Net ₱{selectedPeriodNet.toLocaleString()}
                  </p>
                  {hiddenOrphanRecordCount > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      {hiddenOrphanRecordCount} saved payroll record{hiddenOrphanRecordCount === 1 ? '' : 's'} hidden because the employee is no longer in this company employee list.
                    </p>
                  )}
                  {deleteAttendancePeriodPhotos.error && (
                    <p className="mt-1 text-xs text-destructive">
                      {deleteAttendancePeriodPhotos.error.message || 'Unable to delete attendance photos.'}
                    </p>
                  )}
                  {suspendCashAdvanceDeduction.error && (
                    <p className="mt-1 text-xs text-destructive">
                      {suspendCashAdvanceDeduction.error.message || 'Unable to suspend cash advance deduction.'}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {selectedPeriod.status === 'processing' && (() => {
                    const hasPendingAny = periodAttendanceLogs.some(l => l.status === 'pending');
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approvePeriod.mutate({ id: selectedPeriod.id, status: 'approved' })}
                        className="gap-1"
                        disabled={hasPendingAny}
                        title={hasPendingAny ? 'Some employees still have pending attendance logs' : undefined}
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </Button>
                    );
                  })()}
                  {selectedPeriod.status === 'approved' && (
                    <Button size="sm" onClick={() => approvePeriod.mutate({ id: selectedPeriod.id, status: 'released' })} className="gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Release
                    </Button>
                  )}
                </div>
              </div>

              <PayrollCard className="border border-border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-foreground">Employee Payroll Records</p>
                    <p className="text-xs text-muted-foreground">
                      Showing {filteredRecords.length} of {eligibleRecords.length} employee{eligibleRecords.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={employeeSearch}
                      onChange={(/** @type {React.ChangeEvent<HTMLInputElement>} */ event) => setEmployeeSearch(event.target.value)}
                      placeholder="Search employee"
                      className="h-9 pl-9"
                    />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gross</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cash Advance</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Deductions</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleRecords.length === 0 ? (
                       <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No payroll records. Click "Generate Payroll" to compute.</td></tr>
                      ) : filteredRecords.length === 0 ? (
                       <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No employees match your search.</td></tr>
                      ) : filteredRecords.map(rec => {
                       const hasPending = periodAttendanceLogs.some(l => l.employee_id === rec.employee_id && l.status === 'pending');
                       const isCashAdvanceSuspended = Boolean(rec.cash_advance_deduction_suspended);
                       const canSuspendThisRecord = Boolean(
                         canSuspendCashAdvanceDeduction &&
                         !hasPending &&
                         !isCashAdvanceSuspended &&
                         (Number(rec.cash_advance_deduction) || 0) > 0
                       );
                       return (
                       <tr key={rec.id} className={`border-b border-border last:border-0 hover:bg-muted/20 ${hasPending ? 'bg-amber-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <p className="font-medium text-foreground">{rec.employee_name}</p>
                           <p className="text-xs text-muted-foreground">{rec.department}</p>
                           {(Number(rec.incentive_pay) || 0) > 0 && (
                             <p className="text-xs text-emerald-700 mt-1">
                               Auto incentives: ₱{Number(rec.incentive_pay || 0).toLocaleString()}
                             </p>
                           )}
                           {hasPending && (
                             <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 mt-1">
                               ⚠️ Attendance needs approval
                             </span>
                           )}
                           {isCashAdvanceSuspended && (
                             <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-100 rounded px-1.5 py-0.5 mt-1">
                               CA deduction suspended
                             </span>
                           )}
                         </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground">₱{(rec.gross_pay || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            {(rec.cash_advance_deduction || 0) > 0
                              ? <span className="text-destructive font-medium">-₱{(rec.cash_advance_deduction).toLocaleString()}</span>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right text-destructive">₱{(rec.total_deductions || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-bold text-foreground">₱{(rec.net_pay || 0).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs capitalize ${statusColors[rec.status]}`}>{rec.status}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {!hasPending && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" onClick={() => setReviewRecord(rec)}>
                                    <Search className="w-3 h-3" /> Review
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedRecord(rec)}>
                                    <Printer className="w-4 h-4" />
                                  </Button>
                                  {canSuspendThisRecord && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1 px-2"
                                      disabled={suspendCashAdvanceDeduction.isPending}
                                      onClick={() => {
                                        const confirmed = window.confirm(`Suspend the cash advance deduction for ${rec.employee_name} in ${selectedPeriod.period_name}? This will restore the cash advance balance and update this payroll period totals.`);
                                        if (!confirmed) return;
                                        suspendCashAdvanceDeduction.mutate({ record: rec, period: selectedPeriod });
                                      }}
                                    >
                                      <PauseCircle className="w-3 h-3" /> Suspend CA
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                        })}
                        {filteredRecords.length > 0 && (
                          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                            <td className="px-4 py-3 text-right text-foreground">Total</td>
                            <td className="px-4 py-3 text-right text-foreground">₱{filteredRecordTotals.gross.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              {filteredRecordTotals.cashAdvance > 0
                                ? <span className="text-destructive">-₱{filteredRecordTotals.cashAdvance.toLocaleString()}</span>
                                : <span className="text-muted-foreground text-xs">—</span>
                              }
                            </td>
                            <td className="px-4 py-3 text-right text-destructive">₱{filteredRecordTotals.deductions.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-bold text-foreground">₱{filteredRecordTotals.net.toLocaleString()}</td>
                            <td className="px-4 py-3"></td>
                            <td className="px-4 py-3"></td>
                          </tr>
                        )}
                        </tbody>
                  </table>
                </div>
              </PayrollCard>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Generate payroll for this period or select a previous period</p>
            </div>
          )}
      </div>

      {/* Payslip Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <PayrollDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <PayrollDialogHeader><PayrollDialogTitle>Payslip</PayrollDialogTitle></PayrollDialogHeader>
          {selectedRecord && <PayslipView record={selectedRecord} />}
        </PayrollDialogContent>
      </Dialog>

      {/* Gross Breakdown Review Dialog */}
      <GrossBreakdownDialog
        record={reviewRecord}
        open={!!reviewRecord}
        onClose={() => setReviewRecord(null)}
      />
    </div>
  );
}
