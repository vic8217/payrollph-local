// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, CheckCircle2, FileText, Printer, Search, Calculator, Trash2, Download, PauseCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { computePagIbig, computePhilHealth, computeSSS, computeWeeklyPayroll } from '@/lib/payrollUtils';
import { agencyFeeForAttendanceDays, countAgencyAttendanceDays, normalizePayrollMethod, payrollAllocation } from '@/lib/agencyPayroll';
import { getPayrollPeriodForDate, getPayrollPeriodName, normalizePayrollStartDay } from '@/lib/payrollPeriod';
import { createCashAdvanceDeductionLedger } from '@/lib/cashAdvanceLedger';
import { capCashAdvanceDeductions } from '@/lib/cashAdvanceDeduction';
import { manilaDateString } from '@/lib/dateUtils';
import { effectiveShiftSetting, resolveEmployeeWorkSchedule, shiftFromAttendanceSnapshot } from '@/lib/shiftSettings';
import { approvedOvertimeRequestForLog, capOvertimeByApprovedRequest } from '@/lib/overtimeRequests';
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
function isCashAdvanceDeductibleForPeriod(ca, periodStartDate) {
  const approvalDate = ca.approved_date || (ca.advance_type === 'beginning_balance' ? ca.request_date : null);
  if (!approvalDate) return true;
  // An advance is shown as a payslip addition in the period when it is approved.
  // Its scheduled repayments begin in the following payroll period.
  return String(approvalDate).slice(0, 10) < periodStartDate;
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
  if (value === 'night_shift') return { shift_start_time: '20:00', shift_end_time: '05:00', overtime_start_time: '05:30' };
  return { shift_start_time: '08:00', shift_end_time: '17:00', overtime_start_time: '17:30' };
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
    shiftEndTime: shift.shift_end_time || fallbackShift.shift_end_time,
    overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
    timeInAllowanceMinutes: Number(shift.time_in_allowance_minutes) || 0,
    lateGraceMinutes: Number(shift.grace_period_minutes) || 0,
    breakInGraceMinutes: Number(shift.grace_period_minutes) || 0,
    breakStartTime: shift.break_start_time || employee.break_time || null,
    breakEndTime: shift.break_end_time || null,
    breakDurationMinutes: Number(shift.break_duration_minutes || employee.break_duration_minutes) || 60,
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
  const navigate = useNavigate();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState(/** @type {PayrollEntity | null} */ (null));
  const [selectedRecord, setSelectedRecord] = useState(/** @type {PayrollEntity | null} */ (null));
  const [showUnassignedEmployees, setShowUnassignedEmployees] = useState(false);
  const [reviewRecord, setReviewRecord] = useState(/** @type {PayrollEntity | null} */ (null));
  const [governmentDeductionRecord, setGovernmentDeductionRecord] = useState(/** @type {PayrollEntity | null} */ (null));
  const [governmentDeductionForm, setGovernmentDeductionForm] = useState({ sss: '', philhealth: '', pagibig: '', hrPasscode: '', adminPasscode: '' });
  const [governmentDeductionError, setGovernmentDeductionError] = useState('');
  const [generationReviewOpen, setGenerationReviewOpen] = useState(false);
  const [generationReviewConfirmed, setGenerationReviewConfirmed] = useState(false);
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
  const [pendingOvertimeError, setPendingOvertimeError] = useState(/** @type {Array<{ employeeName: string, date: string, hours: number }> | null} */ (null));
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
  const allocationQuery = useQuery({
    queryKey: ['payrollAllocation', selectedPeriod?.id, activeCompanyId, recordsQuery.dataUpdatedAt],
    queryFn: () => appApi.functions.invoke('getPayrollAllocation', { company_profile_id: activeCompanyId, payroll_period_id: selectedPeriod.id }),
    enabled: !!selectedPeriod?.id && !!activeCompanyId && recordsQuery.isSuccess,
  });

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
      return /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.allPages({
        company_profile_id: activeCompanyId,
        date: { $gte: periodStart, $lte: periodEnd },
      }, '-date', { pageSize: 200 }));
    },
    enabled: !!selectedPeriod && !!activeCompanyId,
  });
  const periodAttendanceLogs = /** @type {AttendanceLogEntity[]} */ (periodAttendanceLogsQuery.data || []);
  const pendingPeriodAttendanceLogs = periodAttendanceLogs.filter(log => log.status === 'pending');

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

  const saveGovernmentDeductions = useMutation({
    mutationFn: () => appApi.functions.invoke('saveGovernmentDeductions', {
      company_profile_id: activeCompanyId,
      payroll_record_id: governmentDeductionRecord?.id,
      payroll_period_id: selectedPeriod?.id,
      sss_contribution: governmentDeductionForm.sss,
      philhealth_contribution: governmentDeductionForm.philhealth,
      pagibig_contribution: governmentDeductionForm.pagibig,
      hr_passcode: governmentDeductionForm.hrPasscode,
      admin_passcode: governmentDeductionForm.adminPasscode,
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['payrollRecords'] });
      qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
      if (result?.period) setSelectedPeriod(previous => ({ ...previous, ...result.period }));
      setGovernmentDeductionRecord(null);
      setGovernmentDeductionError('');
    },
    onError: (error) => setGovernmentDeductionError(error?.message || 'Unable to save government deductions.'),
  });

  const openGovernmentDeductions = (record) => {
    setGovernmentDeductionRecord(record);
    setGovernmentDeductionForm({
      sss: String(Number(record.sss_contribution) || 0),
      philhealth: String(Number(record.philhealth_contribution) || 0),
      pagibig: String(Number(record.pagibig_contribution) || 0),
      hrPasscode: '',
      adminPasscode: '',
    });
    setGovernmentDeductionError('');
  };

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
      const allLogs = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.allPages({
        company_profile_id: activeCompanyId,
        employee_id: employee.employee_id,
        date: { $gte: previewStartDate, $lte: previewEndDate },
      }, '-date', { pageSize: 200 }));
      const rangeLogs = allLogs.filter(log =>
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
          shiftEndTime: defaultShift.shift_end_time || '17:00',
          overtimeStartTime: defaultShift.overtime_start_time || '17:30',
          timeInAllowanceMinutes: Number(defaultShift.time_in_allowance_minutes) || 0,
          lateGraceMinutes: gracePeriodMinutes,
          breakInGraceMinutes: gracePeriodMinutes,
          breakDurationMinutes: [30, 60].includes(Number(employee.break_duration_minutes))
            ? Number(employee.break_duration_minutes)
            : 60,
          paidBreakTime: Boolean(defaultShift.paid_break_time),
          // The preview is read-only, but it should still show the employee's
          // estimated government deductions so its net pay is meaningful.
          applyStatutoryDeductions: true,
          resolveLogOptions: (log) => ({
            ...resolveShiftOptionsForLog(log, employee, shiftSettings, defaultShift),
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

      // Preview cash advances with the same period eligibility, remaining-balance,
      // and available-net-pay rules used by payroll generation. This is read-only:
      // no ledger entry or cash-advance balance is changed here.
      const [currentCashAdvances, cashAdvanceLedger] = await Promise.all([
        entities.CashAdvance.filter({ company_profile_id: activeCompanyId }),
        entities.CashAdvanceLedger.filter({ company_profile_id: activeCompanyId, transaction_type: 'deduction' }, undefined, 5000),
      ]);
      const employeeCashAdvances = currentCashAdvances.filter(cashAdvance =>
        normalizedId(cashAdvance.employee_id) === normalizedId(employee.employee_id)
      );
      const cashAdvanceReleases = employeeCashAdvances.filter(cashAdvance => {
        const approvedDate = String(cashAdvance.approved_date || '').slice(0, 10);
        return cashAdvance.advance_type !== 'beginning_balance' &&
          approvedDate >= previewStartDate && approvedDate <= previewEndDate &&
          Number(cashAdvance.amount_approved || cashAdvance.amount_requested) > 0;
      });
      const cashAdvanceReceived = money(cashAdvanceReleases.reduce(
        (total, cashAdvance) => total + (Number(cashAdvance.amount_approved || cashAdvance.amount_requested) || 0), 0
      ));
      const eligibleCashAdvances = employeeCashAdvances.filter(cashAdvance =>
        cashAdvance.status === 'approved' &&
        (cashAdvance.deduction_periods_remaining == null || cashAdvance.deduction_periods_remaining > 0) &&
        isCashAdvanceDeductibleForPeriod(cashAdvance, previewStartDate)
      );
      const netBeforeCashAdvance = money(computed.net_pay + incentivePay + cashAdvanceReceived);
      const previewCashAdvanceDeductions = capCashAdvanceDeductions(eligibleCashAdvances.map(cashAdvance => {
        const scheduledDeduction = Number(cashAdvance.deduction_amount_per_payroll) || 0;
        const storedRemainingBalance = cashAdvance.remaining_balance != null
          ? Number(cashAdvance.remaining_balance)
          : scheduledDeduction * (Number(cashAdvance.deduction_periods_remaining || cashAdvance.deduction_payroll_periods) || 0);
        const approvedPrincipal = money(cashAdvance.amount_approved || cashAdvance.amount_requested || cashAdvance.beginning_balance);
        const deducted = money(cashAdvanceLedger
          .filter(row => normalizedId(row.cash_advance_id) === normalizedId(cashAdvance.id))
          .reduce((total, row) => total + (Number(row.amount) || 0), 0));
        const remainingBalance = money(Math.max(0, Math.min(storedRemainingBalance, approvedPrincipal - deducted)));
        return { ca: cashAdvance, amount: Math.min(scheduledDeduction, remainingBalance), remainingBalance };
      }), netBeforeCashAdvance);
      const cashAdvanceDeduction = money(previewCashAdvanceDeductions.reduce((total, item) => total + item.amount, 0));
      const cashAdvanceDeductionDetails = previewCashAdvanceDeductions.filter(item => item.amount > 0).map(({ ca, amount, remainingBalance }) => {
        const total = Number(ca.deduction_payroll_periods || ca.deduction_periods_remaining) || 1;
        const remaining = Number(ca.deduction_periods_remaining ?? total);
        const deductionNumber = Math.min(total, Math.max(1, total - remaining + 1));
        return {
          cash_advance_id: ca.id,
          request_date: ca.request_date || ca.approved_date,
          deduction_date: previewEndDate,
          description: ca.reason || ca.advance_type || 'Cash advance',
          amount,
          balance_before: remainingBalance,
          balance_after: money(Math.max(remainingBalance - amount, 0)),
          deduction_number: deductionNumber,
          deduction_total: total,
          deductions_remaining: Math.max(total - deductionNumber, 0),
        };
      });

      setPayPreview({
        ...computed,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        department: employee.department,
        period_name: `${previewStartDate} to ${previewEndDate}`,
        incentive_pay: incentivePay,
        incentive_details: incentiveDetails,
        gross_pay: money(computed.gross_pay + incentivePay),
        cash_advance_received: cashAdvanceReceived,
        cash_advance_deduction: cashAdvanceDeduction,
        cash_advance_deduction_details: cashAdvanceDeductionDetails,
        total_deductions: money(computed.total_deductions + cashAdvanceDeduction),
        net_pay: money(netBeforeCashAdvance - cashAdvanceDeduction),
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
    if (!existingTargetPeriod && previousPeriodReleaseBlock) return;
    setGenerating(true);
    setIncompleteLogsError(null);
    setPendingAttendanceError(null);
    setPendingOvertimeError(null);
    const periodName = getPayrollPeriodName(activePeriodConfig);

    // Employee rates and statuses can be edited from the Employees page while
    // Payroll remains open. Always compute from a fresh server snapshot so a
    // stale React Query cache cannot carry an old daily rate into payroll.
    const currentEmployees = /** @type {EmployeeEntity[]} */ (await entities.Employee.filter({
      company_profile_id: activeCompanyId,
    }, '-created_date'));

    // Pre-check: every worked regular shift must have all required punches.
    // Half-day and absent records do not require the configured break pair.
    const allLogsForCheck = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.allPages({
      company_profile_id: activeCompanyId,
      date: { $gte: startStr, $lte: endStr },
    }, '-date', { pageSize: 200 }));
    const activeEmployeesForCheck = currentEmployees.filter(e => e.status === 'active');
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
        const shiftOptions = resolveShiftOptionsForLog(log, emp, shiftSettings, {});
        const expectsBreakPunches = (log.day_type || 'regular') !== 'half_day' && Boolean(shiftOptions.breakStartTime);
        const missingPunches = [
          !log.time_in ? 'Time In(1)' : null,
          expectsBreakPunches && !log.break_time_out ? 'Time Out(1)' : null,
          expectsBreakPunches && !log.break_time_in ? 'Time In(2)' : null,
          !log.time_out ? 'Time Out(2)' : null,
        ].filter(Boolean);
        if (missingPunches.length > 0) {
          incomplete.push({
            employeeName: `${emp.first_name} ${emp.last_name}`,
            date: `${log.date} — Missing ${missingPunches.join(', ')}`,
          });
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

    // OT decisions affect credited overtime and net pay, so every request in the
    // period must be resolved before payroll is generated or regenerated.
    const overtimeRequestsForCheck = await entities.OvertimeRequest.filter({
      company_profile_id: activeCompanyId,
    }, '-date', 5000);
    const pendingOvertime = overtimeRequestsForCheck
      .filter(request => request.status === 'pending' && request.date >= startStr && request.date <= endStr)
      .map(request => ({
        employeeName: request.employee_name || request.employee_id || 'Unknown employee',
        date: request.date,
        hours: Number(request.requested_hours) || 0,
      }));
    if (pendingOvertime.length > 0) {
      setPendingOvertimeError(pendingOvertime);
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
        mandatory_deductions_reviewed: true,
        mandatory_deductions_applied: false,
        mandatory_deductions_review_status: 'none',
        mandatory_deductions_reviewed_at: new Date().toISOString(),
        mandatory_deductions_reviewed_by: user?.full_name || user?.name || user?.email || 'unknown',
      }));
    }

    const periodCashAdvanceDeductionSuspended = Boolean(period.cash_advance_deduction_suspended);
    // Always use a fresh snapshot. Cash advances can be approved while the payroll
    // page remains open, leaving the query cache stale during regeneration.
    const currentCashAdvances = /** @type {CashAdvanceEntity[]} */ (await entities.CashAdvance.filter({
      company_profile_id: activeCompanyId,
    }));
    const activeEmployees = currentEmployees.filter(e => e.status === 'active' && !e.special_rate_enabled);
    const allLogs = /** @type {AttendanceLogEntity[]} */ (await entities.AttendanceLog.allPages({
      company_profile_id: activeCompanyId,
      date: { $gte: startStr, $lte: endStr },
    }, '-date', { pageSize: 200 }));
    const existingLedger = /** @type {CashAdvanceLedgerEntity[]} */ (await entities.CashAdvanceLedger.filter({
      company_profile_id: activeCompanyId,
      payroll_period_id: period.id,
      transaction_type: 'deduction',
    }));
    // Do not trust remaining_balance alone: older profile edits could restore a stale
    // balance. Posted ledger deductions are the hard ceiling that prevents an
    // advance from ever being deducted beyond its approved principal.
    const allCashAdvanceDeductions = /** @type {CashAdvanceLedgerEntity[]} */ (await entities.CashAdvanceLedger.filter({
      company_profile_id: activeCompanyId,
      transaction_type: 'deduction',
    }, undefined, 5000));
    // Approved CAs that still have remaining deduction periods
    const postedCashAdvanceIds = new Set(existingLedger.map(row => normalizedId(row.cash_advance_id)));
    const approvedCA = currentCashAdvances.filter(cashAdvance =>
      (cashAdvance.status === 'approved' &&
        (cashAdvance.deduction_periods_remaining == null || cashAdvance.deduction_periods_remaining > 0) &&
        isCashAdvanceDeductibleForPeriod(cashAdvance, startStr)) ||
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
      const empLogs = allLogs
        .filter(log =>
          log.employee_id === emp.employee_id &&
          log.date >= startStr && log.date <= endStr &&
          (log.status === 'approved' || log.status === 'pending')
        )
        .map(log => {
          if ((Number(log.overtime_hours) || 0) > 0) return log;
          const approvedRequest = approvedOvertimeRequestForLog(log, overtimeRequestsForCheck, emp);
          if (!approvedRequest) return log;

          // Some approved legacy/request callbacks did not persist credited OT
          // back to AttendanceLog. The approval itself contains the confirmed
          // actual OT, so payroll can safely recover it without guessing from
          // punches and still cap it at the approved amount.
          const confirmedActual = Number(approvedRequest.confirmed_actual_ot_hours) || 0;
          const loggedActual = Number(log.ot_actual_hours) || 0;
          const creditedOvertime = capOvertimeByApprovedRequest(
            confirmedActual > 0 ? confirmedActual : loggedActual,
            approvedRequest,
          );
          if (!(creditedOvertime > 0)) return log;

          return {
            ...log,
            overtime_hours: creditedOvertime,
            ot_actual_hours: confirmedActual > 0 ? confirmedActual : loggedActual,
            ot_requested_hours: Number((approvedRequest.approved_hours ?? approvedRequest.requested_hours) || 0),
            overtime_request_id: approvedRequest.id,
            ot_status: 'approved',
          };
        });
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
      const cashAdvanceReleases = currentCashAdvances.filter(cashAdvance => {
        const approvedDate = String(cashAdvance.approved_date || '').slice(0, 10);
        return normalizedId(cashAdvance.employee_id) === normalizedId(emp.employee_id) &&
          cashAdvance.advance_type !== 'beginning_balance' &&
          approvedDate >= startStr && approvedDate <= endStr &&
          Number(cashAdvance.amount_approved || cashAdvance.amount_requested) > 0;
      });
      const cashAdvanceReceived = money(cashAdvanceReleases.reduce(
        (sum, cashAdvance) => sum + (Number(cashAdvance.amount_approved || cashAdvance.amount_requested) || 0),
        0
      ));
      const cashAdvanceReleaseDetails = cashAdvanceReleases.map(cashAdvance => ({
        cash_advance_id: cashAdvance.id,
        approved_date: cashAdvance.approved_date,
        description: cashAdvance.reason || cashAdvance.advance_type || 'Cash advance',
        amount: money(cashAdvance.amount_approved || cashAdvance.amount_requested),
      }));
      const cashAdvanceDeductionSuspended = Boolean(periodCashAdvanceDeductionSuspended || existingRecord?.cash_advance_deduction_suspended);

      // Find all active CAs for this employee (can have multiple)
      const empCAs = cashAdvanceDeductionSuspended
        ? []
        : approvedCA.filter(cashAdvance => normalizedId(cashAdvance.employee_id) === normalizedId(emp.employee_id));
      // Compute earnings and mandatory deductions before deciding how much of the
      // scheduled advance deduction the employee can actually cover.
      const computed = computeWeeklyPayroll(emp, payrollLogs, periodHolidays, 0, periodNoWorkDays, gracePeriodMinutes, {
        shiftStartTime: defaultShift.shift_start_time || '08:00', overtimeStartTime, timeInAllowanceMinutes,
        lateGraceMinutes: gracePeriodMinutes, breakInGraceMinutes: gracePeriodMinutes,
        breakDurationMinutes: [30, 60].includes(Number(emp.break_duration_minutes)) ? Number(emp.break_duration_minutes) : 60,
        paidBreakTime: Boolean(defaultShift.paid_break_time), applyStatutoryDeductions: false,
        resolveLogOptions: (log) => ({
          ...resolveShiftOptionsForLog(log, emp, shiftSettings, defaultShift),
        }),
      });
      const incentiveDetails = automaticIncentivesForEmployee(emp, payrollLogs, startStr, endStr, periodNoWorkDays, periodHolidays, normalizePayrollStartDay(activeCompany));
      const incentivePay = money(incentiveDetails.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
      const manualGovernmentDeductions = {
        sss_contribution: money(existingRecord?.sss_contribution),
        philhealth_contribution: money(existingRecord?.philhealth_contribution),
        pagibig_contribution: money(existingRecord?.pagibig_contribution),
      };
      const manualGovernmentTotal = money(Object.values(manualGovernmentDeductions).reduce((sum, amount) => sum + amount, 0));
      const netBeforeCashAdvance = money(computed.net_pay + incentivePay + cashAdvanceReceived - manualGovernmentTotal);

      /** @type {CashAdvanceDeduction[]} */
      const caDeductions = capCashAdvanceDeductions(empCAs.map(cashAdvance => {
        const posted = existingLedger.find(row => normalizedId(row.cash_advance_id) === normalizedId(cashAdvance.id));
        const scheduledDeduction = cashAdvance.deduction_amount_per_payroll || 0;
        const storedRemainingBalance = cashAdvance.remaining_balance != null
          ? cashAdvance.remaining_balance
          : scheduledDeduction * (cashAdvance.deduction_periods_remaining || cashAdvance.deduction_payroll_periods || 0);
        const approvedPrincipal = money(cashAdvance.amount_approved || cashAdvance.amount_requested || cashAdvance.beginning_balance);
        const ledgerDeductions = money(allCashAdvanceDeductions
          .filter(row => normalizedId(row.cash_advance_id) === normalizedId(cashAdvance.id))
          .reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
        const ledgerRemainingBalance = money(Math.max(approvedPrincipal - ledgerDeductions, 0));
        const remainingBalance = money(Math.max(0, Math.min(Number(storedRemainingBalance) || 0, ledgerRemainingBalance)));
        const totalPeriods = Number(cashAdvance.deduction_payroll_periods) || Number(cashAdvance.deduction_periods_remaining) || 1;
        const currentRemaining = cashAdvance.deduction_periods_remaining != null ? cashAdvance.deduction_periods_remaining : totalPeriods;
        const deductionNumber = posted?.deduction_number || Math.min(totalPeriods, Math.max(1, totalPeriods - currentRemaining + 1));
        return {
          ca: cashAdvance,
          amount: posted ? Number(posted.amount) || 0 : Math.min(scheduledDeduction, remainingBalance),
          remainingBalance,
          posted,
          deductionNumber,
        };
      }), netBeforeCashAdvance);
      const caDeductionThisPeriod = money(caDeductions.reduce((sum, item) => sum + item.amount, 0));
      const cashAdvanceDeductionDetails = caDeductions
        .filter(({ amount }) => Number(amount) > 0)
        .map(({ ca, amount, remainingBalance, posted, deductionNumber }) => {
          const balanceBefore = posted?.balance_before != null ? Number(posted.balance_before) : Number(remainingBalance) || 0;
          const nextBalance = money(Math.max(balanceBefore - amount, 0));
          const deductionTotal = Number(posted?.deduction_total) || Number(ca.deduction_payroll_periods) || Number(ca.deduction_periods_remaining) || deductionNumber || 1;
          const deductionNo = Number(posted?.deduction_number) || deductionNumber;
          return {
            cash_advance_id: ca.id,
            request_date: ca.request_date || ca.approved_date || ca.created_date?.slice(0, 10),
            deduction_date: posted?.transaction_date || endStr,
            description: posted?.description || ca.reason || ca.advance_type || 'Cash advance',
            amount: Number(amount) || 0,
            balance_before: balanceBefore,
            balance_after: nextBalance,
            deduction_number: deductionNo,
            deduction_total: deductionTotal,
            deductions_remaining: Math.max(deductionTotal - deductionNo, 0),
          };
        });

      const computedWithIncentives = {
        ...computed,
        incentive_pay: incentivePay,
        incentive_details: incentiveDetails,
        gross_pay: money(computed.gross_pay + incentivePay),
        cash_advance_deduction: caDeductionThisPeriod,
        total_deductions: money(computed.total_deductions + caDeductionThisPeriod),
        net_pay: money(netBeforeCashAdvance - caDeductionThisPeriod),
        cash_advance_received: cashAdvanceReceived,
        cash_advance_release_details: cashAdvanceReleaseDetails,
      };
      computedWithIncentives.total_deductions = money(computedWithIncentives.total_deductions + manualGovernmentTotal);
      const sssShares = computeSSS(Number(computedWithIncentives.statutory_base_pay) || Number(emp.monthly_rate) || 0);
      const philhealthShares = computePhilHealth(Number(computedWithIncentives.statutory_base_pay) || Number(emp.monthly_rate) || 0);
      const pagibigShares = computePagIbig(Number(computedWithIncentives.statutory_base_pay) || Number(emp.monthly_rate) || 0);
      const agencyAttendanceDays = countAgencyAttendanceDays(empLogs);
      const agencyFeeAtPayroll = activeCompany?.uses_employee_agency === true && emp.is_agency_employee === true
        ? agencyFeeForAttendanceDays(activeCompany.agency_fee_per_employee || 0, agencyAttendanceDays)
        : 0;

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
        employee_record_id: emp.id,
        payroll_method_at_payroll: existingRecord?.status !== 'draft' ? normalizePayrollMethod(existingRecord.payroll_method_at_payroll) : normalizePayrollMethod(emp.payroll_disbursement_method),
        is_agency_employee_at_payroll: existingRecord?.status !== 'draft' ? existingRecord.is_agency_employee_at_payroll === true : emp.is_agency_employee === true,
        agency_fee_per_employee_at_payroll: existingRecord?.status !== 'draft' ? Number(existingRecord.agency_fee_per_employee_at_payroll || 0) : Number(activeCompany?.agency_fee_per_employee || 0),
        agency_fee_frequency_at_payroll: existingRecord?.status !== 'draft' ? existingRecord.agency_fee_frequency_at_payroll : activeCompany?.agency_fee_frequency || 'PER_PAYROLL',
        agency_fee_amount: existingRecord?.status !== 'draft' ? Number(existingRecord.agency_fee_amount || 0) : agencyFeeAtPayroll,
        agency_fee_attendance_days: existingRecord?.status !== 'draft' ? Number(existingRecord.agency_fee_attendance_days || 0) : agencyAttendanceDays,
        sss_employer_contribution: money((Number(sssShares.employer) || 0) / 4.33),
        philhealth_employer_contribution: money((Number(philhealthShares.employer) || 0) / 4.33),
        pagibig_employer_contribution: money((Number(pagibigShares.employer) || 0) / 4.33),
        status: recordStatus,
        company_profile_id: activeCompanyId,
        incentive_settings: emp.incentive_settings || {},
        mandatory_deduction_set_id: existingRecord?.mandatory_deduction_set_id || null,
        mandatory_deduction_set_name: existingRecord?.mandatory_deduction_set_name || null,
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
        ...manualGovernmentDeductions,
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
      mandatory_deductions_reviewed: true,
      mandatory_deductions_applied: Boolean(period.mandatory_deductions_applied),
      mandatory_deductions_review_status: period.mandatory_deductions_applied ? 'applied' : 'none',
      mandatory_deductions_reviewed_at: new Date().toISOString(),
      mandatory_deductions_reviewed_by: user?.full_name || user?.name || user?.email || 'unknown',
    });

    qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
    qc.invalidateQueries({ queryKey: ['payrollRecords'] });
    qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
    setSelectedPeriod(updatedPeriod);
    setGenerating(false);
  };

  const targetPeriod = periods.find(p => p.start_date === startStr && p.end_date === endStr);
  const currentPeriodConfig = getPayrollPeriodForDate(baseWeek, activeCompany, 0);
  const previousPeriodConfig = getPayrollPeriodForDate(baseWeek, activeCompany, weekOffset - 1);
  const previousPeriod = periods.find(period =>
    period.start_date === previousPeriodConfig.start_date &&
    period.end_date === previousPeriodConfig.end_date
  );
  const hasAnyEarlierPayroll = periods.some(period => period.end_date < startStr);
  const previousPeriodReleaseBlock = !targetPeriod && hasAnyEarlierPayroll && previousPeriod?.status !== 'released';
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
    previousPeriodReleaseBlock;
  const generateTitle = targetPeriod?.status === 'released'
    ? 'Released payroll periods cannot be regenerated'
    : previousPeriodReleaseBlock
      ? `Release the previous payroll period (${previousPeriodConfig.start_date} to ${previousPeriodConfig.end_date}) before generating this period`
    : targetPeriodIsComplete
      ? 'Regenerate this payroll period using the latest attendance and payroll rules'
      : undefined;
  const knownEmployeeIds = new Set(employees
    .filter(employee => !employee.special_rate_enabled)
    .map(employee => String(employee.employee_id || '').toLowerCase()));
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
  const allocation = allocationQuery.data || payrollAllocation(eligibleRecords);
  const unassignedRecords = eligibleRecords.filter(record => normalizePayrollMethod(record.payroll_method_at_payroll) === 'UNASSIGNED');
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
          <Button variant="outline" onClick={() => navigate('/payroll/reconciliation')} className="gap-2">
            <Calculator className="h-4 w-4" /> Payroll Recon
          </Button>
          <Button
            onClick={() => { setGenerationReviewConfirmed(false); setGenerationReviewOpen(true); }}
            disabled={generateDisabled}
            className="gap-2"
            title={generateTitle}
          >
            <Play className="w-4 h-4" /> {generating ? 'Processing...' : `Generate ${targetPeriodLabel}`}
          </Button>
        </div>
      </div>

      {previousPeriodReleaseBlock && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Previous payroll period must be released first</p>
            <p className="mt-0.5 text-xs">
              Release {previousPeriod?.period_name || `${previousPeriodConfig.start_date} to ${previousPeriodConfig.end_date}`} before generating {targetPeriodLabel}.
              {!previousPeriod && ' The previous payroll period has not been generated yet.'}
            </p>
          </div>
        </div>
      )}

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
                  <p className="text-xs text-muted-foreground">Total Deductions</p>
                  <p className="font-semibold text-destructive">
                    -₱{Number(payPreview.total_deductions || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              {payPreview.incomplete_dates.length > 0 && (
                <p className="text-xs text-amber-700">
                  Incomplete attendance excluded: {payPreview.incomplete_dates.join(', ')}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Preview only. Estimated SSS, PhilHealth, Pag-IBIG, and eligible cash-advance deductions are included, but nothing is posted.
              </p>
              <Button size="sm" variant="outline" onClick={() => setReviewRecord(payPreview)} className="gap-1">
                <Search className="w-3 h-3" /> View Breakdown
              </Button>
            </div>
          )}
        </div>
      </PayrollCard>

      {pendingOvertimeError && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-700">⚠️ Cannot Generate Payroll — OT Requests Pending Approval</p>
          <p className="text-xs text-amber-700/80">
            Resolve every OT request in this payroll period, then regenerate payroll so approved OT is included correctly.
          </p>
          <ul className="ml-3 space-y-1 text-xs text-amber-800">
            {pendingOvertimeError.map((item, index) => (
              <li key={`${item.employeeName}-${item.date}-${index}`} className="list-disc">
                {item.employeeName} — {item.date} — {item.hours.toFixed(2)}h requested
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <span className="text-destructive font-semibold text-sm">⚠️ Cannot Generate Payroll — Missing Attendance Punches</span>
          </div>
          <p className="text-xs text-destructive/80">Complete every required Time In and Time Out punch before generating payroll:</p>
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
                  {pendingPeriodAttendanceLogs.length > 0 && (
                    <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                      Approval blocked: {pendingPeriodAttendanceLogs.length} attendance record{pendingPeriodAttendanceLogs.length === 1 ? '' : 's'} still pending for this payroll period. Review and approve or reject them in Attendance, including records for employees who are now inactive.
                    </p>
                  )}
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
                    const hasPendingAny = pendingPeriodAttendanceLogs.length > 0;
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
                <div className="px-4 py-3 border-b bg-card"><p className="text-sm font-semibold">Payroll Allocation Summary</p><p className="text-xs text-muted-foreground">Uses snapshotted classifications for this payroll period</p></div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[['ATM', allocation.groups.ATM], ['Non-ATM', allocation.groups.NON_ATM], ['Unassigned', allocation.groups.UNASSIGNED]].map(([label, group]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-bold">₱{group.netPayroll.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p><p className="text-xs">{group.employeeCount} employees</p></div>)}
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Total Net Payroll</p><p className="text-lg font-bold">₱{allocation.totalNetPayroll.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p></div>
                </div>
                {allocation.groups.UNASSIGNED.employeeCount > 0 && <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3 text-xs font-medium text-amber-800"><span>{allocation.groups.UNASSIGNED.employeeCount} employee(s) need payroll method assignment. Their net pay remains included under Unassigned.</span><Button type="button" size="sm" variant="outline" className="h-7 border-amber-300 bg-white text-amber-900" onClick={() => setShowUnassignedEmployees(true)}>View employees</Button></div>}
                <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
                  <div><p className="mb-2 text-sm font-semibold">Government Contributions</p><table className="w-full text-xs"><thead><tr><th className="text-left">Contribution</th><th className="text-right">Employee</th><th className="text-right">Employer</th></tr></thead><tbody>{[['SSS', allocation.contributions.sssEmployee, allocation.contributions.sssEmployer], ['PhilHealth', allocation.contributions.philhealthEmployee, allocation.contributions.philhealthEmployer], ['Pag-IBIG', allocation.contributions.pagibigEmployee, allocation.contributions.pagibigEmployer]].map(([label, employee, employer]) => <tr key={label}><td className="py-1">{label}</td><td className="text-right">₱{employee.toLocaleString()}</td><td className="text-right">₱{employer.toLocaleString()}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td className="pt-2">Total Remittance</td><td className="pt-2 text-right" colSpan={2}>₱{allocation.totalGovernmentRemittance.toLocaleString()}</td></tr></tfoot></table></div>
                  <div className="space-y-2"><p className="text-sm font-semibold">Employer Obligations</p><div className="flex justify-between text-xs"><span>Employer government share</span><span>₱{allocation.totalEmployerContribution.toLocaleString()}</span></div>{activeCompany?.uses_employee_agency && <div className="flex justify-between text-xs"><span>Agency fees</span><span>₱{allocation.agencyFees.toLocaleString()}</span></div>}<div className="flex justify-between border-t pt-2 font-semibold"><span>Total funding requirement</span><span>₱{allocation.totalEmployerFundingRequirement.toLocaleString()}</span></div><p className="text-[11px] text-muted-foreground">Net payroll, employer government share, and agency fees are shown separately to avoid double-counting employee deductions.</p></div>
                </div>
              </PayrollCard>

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
                                  {selectedPeriod.status !== 'released' && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" onClick={() => openGovernmentDeductions(rec)}>
                                      <ShieldCheck className="w-3 h-3" /> Gov't deductions
                                    </Button>
                                  )}
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

      <Dialog open={showUnassignedEmployees} onOpenChange={setShowUnassignedEmployees}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Unassigned payroll employees</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">These employees are included in this payroll but have no ATM or Non-ATM payroll method assigned.</p>
          <div className="max-h-80 overflow-auto rounded-md border">
            <table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Employee No.</th><th className="px-3 py-2 text-left">Department</th></tr></thead><tbody>
              {unassignedRecords.map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2">{record.employee_name || `${record.first_name || ''} ${record.last_name || ''}`.trim() || 'Unknown'}</td><td className="px-3 py-2">{record.employee_id || '—'}</td><td className="px-3 py-2">{record.department || '—'}</td></tr>)}
            </tbody></table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payslip Dialog */}
      <Dialog open={generationReviewOpen} onOpenChange={open => { setGenerationReviewOpen(open); if (!open) setGenerationReviewConfirmed(false); }}>
        <PayrollDialogContent className="max-w-lg">
          <PayrollDialogHeader><PayrollDialogTitle>Review mandatory deductions</PayrollDialogTitle></PayrollDialogHeader>
          <div className="space-y-4">
            <div className={`rounded-lg border p-4 ${targetPeriod?.mandatory_deductions_applied ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <p className="font-semibold">{targetPeriod?.mandatory_deductions_applied ? 'Mandatory deductions applied' : 'No mandatory deductions applied'}</p>
              <p className="text-sm mt-1">{targetPeriod?.mandatory_deductions_applied
                ? 'This payroll period already has reviewed mandatory deductions. Regeneration will preserve those amounts.'
                : 'This is the default. SSS, PhilHealth, and Pag-IBIG will be ₱0.00 unless an approved deduction set is applied after payroll generation.'}</p>
            </div>
            <button type="button" className="w-full flex items-start gap-3 rounded-lg border p-4 text-left" onClick={() => setGenerationReviewConfirmed(value => !value)}>
              <Checkbox checked={generationReviewConfirmed} className="mt-0.5" />
              <span className="text-sm">I reviewed the mandatory deduction status for <strong>{targetPeriodLabel}</strong> and confirm that payroll may be generated with the status shown above.</span>
            </button>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGenerationReviewOpen(false)}>Cancel</Button>
              <Button disabled={!generationReviewConfirmed} onClick={() => { setGenerationReviewOpen(false); setGenerationReviewConfirmed(false); generatePayroll(); }}>
                <Play className="w-4 h-4 mr-2" />Confirm and generate
              </Button>
            </div>
          </div>
        </PayrollDialogContent>
      </Dialog>

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

      <Dialog open={!!governmentDeductionRecord} onOpenChange={open => !open && setGovernmentDeductionRecord(null)}>
        <PayrollDialogContent className="max-w-lg">
          <PayrollDialogHeader><PayrollDialogTitle>Manual Government Deductions</PayrollDialogTitle></PayrollDialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Responsibility notice</p>
              <p className="mt-1">The Admin Manager and HR Officer are responsible for computing and entering the correct mandatory government deductions. The system does not calculate SSS, PhilHealth, or Pag-IBIG contributions.</p>
            </div>
            <p className="text-sm text-muted-foreground">Employee: <span className="font-medium text-foreground">{governmentDeductionRecord?.employee_name}</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                ['sss', 'SSS'],
                ['philhealth', 'PhilHealth'],
                ['pagibig', 'Pag-IBIG'],
              ].map(([field, label]) => (
                <label key={field} className="space-y-1 text-sm font-medium">
                  <span>{label}</span>
                  <Input type="number" min="0" step="0.01" value={governmentDeductionForm[field]} onChange={event => setGovernmentDeductionForm(previous => ({ ...previous, [field]: event.target.value }))} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-medium"><span>HR Officer passcode</span><Input type="password" value={governmentDeductionForm.hrPasscode} onChange={event => setGovernmentDeductionForm(previous => ({ ...previous, hrPasscode: event.target.value }))} /></label>
              <label className="space-y-1 text-sm font-medium"><span>Admin Manager passcode</span><Input type="password" value={governmentDeductionForm.adminPasscode} onChange={event => setGovernmentDeductionForm(previous => ({ ...previous, adminPasscode: event.target.value }))} /></label>
            </div>
            {governmentDeductionError && <p className="text-sm text-destructive">{governmentDeductionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGovernmentDeductionRecord(null)}>Cancel</Button>
              <Button disabled={saveGovernmentDeductions.isPending || !governmentDeductionForm.hrPasscode.trim() || !governmentDeductionForm.adminPasscode.trim()} onClick={() => saveGovernmentDeductions.mutate()}>
                {saveGovernmentDeductions.isPending ? 'Saving...' : 'Save deductions'}
              </Button>
            </div>
          </div>
        </PayrollDialogContent>
      </Dialog>
    </div>
  );
}
