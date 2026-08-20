// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import {
  computeCreditedHoursWorked,
  computeLateMinutes,
  computeNightDifferentialHours,
  computeOvertimeHours,
  normalizeOvernightBreakPunches,
} from '@/lib/payrollUtils';
import {
  approvedOvertimeRequestForLog,
  capOvertimeByApprovedRequest,
  employeeRequestMatchesLog,
  overtimeStatusForComputedHours,
} from '@/lib/overtimeRequests';
import {
  formatManilaDateTime,
  formatManilaTime,
  manilaDateString,
} from '@/lib/dateUtils';
import { effectiveShiftSetting, resolveEmployeeWorkSchedule, shiftFromAttendanceSnapshot, sortedShiftAssignments } from '@/lib/shiftSettings';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, ArrowLeft, User, Pencil, Camera, KeyRound, Download, Eye, MapPin, Clock, TriangleAlert, QrCode, ScanFace, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const statusColors = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
};

const overtimeStatusColors = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-600',
};

const employeeFullName = (employee) =>
  [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');
const normalizeAttendanceKey = (value) => String(value || '').trim().toLowerCase();
const normalizeAttendanceCode = (value) =>
  normalizeAttendanceKey(value)
    .replace(/-payrollph$/i, '')
    .replace(/[^a-z0-9]/g, '');
const normalizeDailyPasscode = (value) => String(value ?? '').trim();
const enabledBooleanSetting = (value) => value === true || value === 1 || String(value).toLowerCase() === 'true';
const matchesDailyPasscode = (record, input) => {
  const normalizedInput = normalizeDailyPasscode(input);
  return Boolean(
    normalizedInput &&
    (
      normalizeDailyPasscode(record?.passcode) === normalizedInput ||
      normalizeDailyPasscode(record?.manager_passcode) === normalizedInput
    )
  );
};
const DEFAULT_BREAK_DURATION_MINUTES = 60;
const BREAK_TIME_IN_MISSING_AFTER_MINUTES = 120;
const FINAL_TIME_OUT_MISSING_AFTER_MINUTES = 10;
const ATTENDANCE_LOG_LIST_FIELDS = [
  'id',
  'created_date',
  'updated_date',
  'company_profile_id',
  'employee_record_id',
  'employee_id',
  'employee_name',
  'date',
  'time_in',
  'time_in_actual_punch_at',
  'time_in_original_value',
  'time_in_review_status',
  'time_in_review_category',
  'time_in_review_note',
  'time_in_review_requested_at',
  'time_in_review_requested_by',
  'time_in_review_decision_note',
  'time_in_review_decided_at',
  'time_in_review_decided_by',
  'time_in_adjustment_note',
  'time_in_adjusted_at',
  'time_in_adjusted_by',
  'break_time_out',
  'break_time_out_actual_punch_at',
  'break_time_in',
  'break_time_in_actual_punch_at',
  'time_out',
  'time_out_actual_punch_at',
  'work_schedule',
  'shift_start_time',
  'shift_end_time',
  'shift_overtime_start_time',
  'shift_break_start_time',
  'shift_break_end_time',
  'shift_break_duration_minutes',
  'shift_grace_period_minutes',
  'shift_time_in_allowance_minutes',
  'shift_paid_break_time',
  'status',
  'day_type',
  'hours_worked',
  'undertime_minutes',
  'ot_actual_hours',
  'overtime_hours',
  'ot_requested_hours',
  'ot_status',
  'overtime_request_id',
  'ot_hr_approved',
  'ot_admin_approved',
  'ot_reviewed_at',
  'ot_reviewed_by',
  'ot_review_reason',
  'night_diff_hours',
  'late_minutes',
  'notes',
  'photo_url',
  'photo_action',
  'time_in_photo_url',
  'time_in_photo_captured_at',
  'break_time_out_photo_url',
  'break_time_out_photo_captured_at',
  'break_time_in_photo_url',
  'break_time_in_photo_captured_at',
  'time_out_photo_url',
  'time_out_photo_captured_at',
  'time_in_location',
  'break_time_out_location',
  'break_time_in_location',
  'time_out_location',
  'time_in_verification_method',
  'break_time_out_verification_method',
  'break_time_in_verification_method',
  'time_out_verification_method',
  'record_source',
  'synchronized_at',
  'offline_client_request_id',
].join(',');

const formatHours = (value) => `${(Number(value) || 0).toFixed(2)}h`;
const formatMinutes = (value) => `${Math.round(Number(value) || 0)}m`;

const legacyShiftOptions = [
  { value: 'day_shift', label: 'Day Shift', shortLabel: 'Day' },
  { value: 'night_shift', label: 'Night Shift', shortLabel: 'Night' },
];

function buildShiftOptions(shiftSettings = [], employees = [], logs = [], date = manilaDateString()) {
  const configuredOptions = shiftSettings
    .map(shift => effectiveShiftSetting(shift, date))
    .filter(shift => shift?.is_active !== false)
    .sort((a, b) => {
      const startCompare = String(a.shift_start_time || '').localeCompare(String(b.shift_start_time || ''));
      return startCompare || String(a.setting_name || '').localeCompare(String(b.setting_name || ''));
    })
    .map(shift => ({
      ...shift,
      value: shift.id,
      label: shift.setting_name || 'Unnamed Shift',
      shortLabel: shift.setting_name || 'Unnamed',
    }));

  const configuredValues = new Set(configuredOptions.map(option => option.value));
  const usedValues = new Set([
    ...employees.map(emp => emp.work_schedule),
    ...employees.flatMap(emp => sortedShiftAssignments(emp).map(assignment => assignment.work_schedule)),
    ...logs.map(log => log.work_schedule),
  ].filter(Boolean));

  const legacyOptions = legacyShiftOptions.filter(option =>
    configuredOptions.length === 0 || usedValues.has(option.value)
  );
  const knownValues = new Set([...configuredValues, ...legacyOptions.map(option => option.value)]);
  const unknownUsedOptions = [...usedValues]
    .filter(value => !knownValues.has(value))
    .map(value => ({ value, label: 'Unknown Shift', shortLabel: 'Unknown' }));

  return [...configuredOptions, ...legacyOptions, ...unknownUsedOptions];
}

function getShiftOption(shiftOptions, value, fallbackValue = 'day_shift') {
  const resolvedValue = value || fallbackValue;
  return shiftOptions.find(option => option.value === resolvedValue)
    || legacyShiftOptions.find(option => option.value === resolvedValue)
    || { value: resolvedValue, label: 'Unknown Shift', shortLabel: 'Unknown' };
}

function getBreakDurationMinutes(employee, shift = {}) {
  const minutes = Number(shift?.break_duration_minutes || employee?.break_duration_minutes);
  return minutes > 0 ? minutes : DEFAULT_BREAK_DURATION_MINUTES;
}

function addBreakDuration(time, durationMinutes = DEFAULT_BREAK_DURATION_MINUTES) {
  const [hours, minutes] = String(time || '00:00').split(':').map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  const normalized = total % (24 * 60);
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`,
    crossesMidnight: total >= 24 * 60,
  };
}

function isOvernightShift(shift) {
  const fallback = legacyShiftTimes(shift?.value);
  const shiftStart = shift?.shift_start_time || fallback.shift_start_time;
  const shiftEnd = shift?.shift_end_time || fallback.shift_end_time;
  return shiftEnd <= shiftStart;
}

function scheduledBreak(employee, date, shift) {
  const breakTime = shift?.break_start_time || employee?.break_time;
  if (!breakTime) return null;

  const [breakHour] = breakTime.split(':').map(Number);
  const breakDate = isOvernightShift(shift) && breakHour < 12
    ? format(addDays(new Date(`${date}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : date;
  return {
    break_time_out: new Date(`${breakDate}T${breakTime}:00+08:00`).toISOString(),
  };
}

function scheduledBreakAfterTimeIn(employee, date, timeInValue, shift) {
  const autoBreak = scheduledBreak(employee, date, shift);
  const timeIn = timeInValue ? new Date(timeInValue) : null;
  const breakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !Number.isFinite(timeIn.getTime()) || !Number.isFinite(breakOut.getTime())) {
    return null;
  }

  return breakOut.getTime() > timeIn.getTime() ? autoBreak : null;
}

function isPastAutoScheduledBreak(log, employee, shift) {
  const autoBreak = scheduledBreak(employee, log?.date, shift);
  const timeIn = log?.time_in ? new Date(log.time_in) : null;
  const breakOut = log?.break_time_out ? new Date(log.break_time_out) : null;
  const scheduledBreakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !scheduledBreakOut) return false;
  if (![timeIn, breakOut, scheduledBreakOut].every(date => Number.isFinite(date.getTime()))) return false;

  const matchesScheduledClockTime =
    breakOut.getHours() === scheduledBreakOut.getHours() &&
    breakOut.getMinutes() === scheduledBreakOut.getMinutes();
  return matchesScheduledClockTime && breakOut.getTime() <= timeIn.getTime();
}

function scheduledBreakIn(employee, date, shift) {
  const breakTime = shift?.break_start_time || employee?.break_time;
  if (!breakTime) return null;

  const [breakHour] = breakTime.split(':').map(Number);
  const breakDate = isOvernightShift(shift) && breakHour < 12
    ? format(addDays(new Date(`${date}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : date;
  const breakIn = shift?.break_end_time
    ? { time: shift.break_end_time, crossesMidnight: shift.break_end_time <= breakTime }
    : addBreakDuration(breakTime, getBreakDurationMinutes(employee, shift));
  const breakInDate = breakIn.crossesMidnight
    ? format(addDays(new Date(`${breakDate}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
}

function isBreakTimeInMissing(log, employee, shift, now = new Date()) {
  if (log?.day_type === 'half_day') return false;
  if (!log?.time_in || log.break_time_in || !employee?.break_time) return false;

  const autoBreak = scheduledBreakAfterTimeIn(employee, log.date, log.time_in, shift);
  if (!autoBreak?.break_time_out) return false;

  const missingAfter = new Date(autoBreak.break_time_out);
  missingAfter.setMinutes(missingAfter.getMinutes() + BREAK_TIME_IN_MISSING_AFTER_MINUTES);

  return now.getTime() >= missingAfter.getTime();
}

function legacyShiftTimes(value) {
  if (value === 'night_shift') return { shift_start_time: '20:00', shift_end_time: '05:00', overtime_start_time: '05:30' };
  return { shift_start_time: '08:00', shift_end_time: '17:00', overtime_start_time: '17:30' };
}

function normalizeOvernightTimeInForDisplay(log, shift) {
  if (!log?.time_in || !log?.date || !isOvernightShift(shift)) return log;

  const fallback = legacyShiftTimes(shift?.value);
  const shiftStart = shift?.shift_start_time || fallback.shift_start_time;
  const [shiftStartHour, shiftStartMinute] = String(shiftStart).split(':').map(Number);
  const timeInClock = formatManilaTime(log.time_in, { hour12: false });
  const [timeInHour, timeInMinute] = String(timeInClock).split(':').map(Number);

  if (
    ![shiftStartHour, shiftStartMinute, timeInHour, timeInMinute].every(Number.isFinite)
    || shiftStartHour < 12
    || timeInHour >= 12
    || manilaDateString(log.time_in) !== log.date
  ) {
    return log;
  }

  const correctedHour = timeInHour + 12;
  const correctedMinutes = correctedHour * 60 + timeInMinute;
  const shiftStartMinutes = shiftStartHour * 60 + shiftStartMinute;
  if (correctedMinutes < shiftStartMinutes) return log;

  const correctedTimeIn = new Date(
    `${log.date}T${String(correctedHour).padStart(2, '0')}:${String(timeInMinute).padStart(2, '0')}:00+08:00`,
  );
  const laterPunches = [log.break_time_out, log.break_time_in, log.time_out]
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => Number.isFinite(value.getTime()));

  if (
    !Number.isFinite(correctedTimeIn.getTime())
    || laterPunches.length === 0
    || laterPunches.some(value => value.getTime() <= correctedTimeIn.getTime())
  ) {
    return log;
  }

  return {
    ...log,
    time_in: correctedTimeIn.toISOString(),
  };
}

function scheduledShiftEnd(log, shift) {
  if (!log?.date) return null;

  const fallback = legacyShiftTimes(shift?.value);
  const shiftStart = shift?.shift_start_time || fallback.shift_start_time;
  const shiftEnd = shift?.shift_end_time || fallback.shift_end_time;
  const [startHour, startMinute] = String(shiftStart).split(':').map(Number);
  const [endHour, endMinute] = String(shiftEnd).split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;

  const start = new Date(`${log.date}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00+08:00`);
  const end = new Date(`${log.date}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00+08:00`);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

function isFinalTimeOutMissing(log, employee, shift, now = new Date()) {
  if (!log?.time_in || log.time_out) return false;

  const shiftEnd = scheduledShiftEnd(log, shift);
  if (!shiftEnd) return false;
  const missingAfter = new Date(shiftEnd);
  missingAfter.setMinutes(missingAfter.getMinutes() + FINAL_TIME_OUT_MISSING_AFTER_MINUTES);
  return now.getTime() >= missingAfter.getTime();
}

function missingAttendanceFields(log, employee, shift, now = new Date()) {
  const missing = [];
  if (!log?.time_in) missing.push('Time In(1)');
  if (isBreakTimeInMissing(log, employee, shift, now)) missing.push('Time In(2)');
  if (isFinalTimeOutMissing(log, employee, shift, now)) missing.push('Time Out(2)');
  return missing;
}

const punchPhotoFields = [
  { action: 'time_in', label: 'Time In(1)', timeField: 'time_in', photoField: 'time_in_photo_url', locationField: 'time_in_location', methodField: 'time_in_verification_method' },
  { action: 'break_time_out', label: 'Time Out(1)', timeField: 'break_time_out', photoField: 'break_time_out_photo_url', locationField: 'break_time_out_location', methodField: 'break_time_out_verification_method' },
  { action: 'break_time_in', label: 'Time In(2)', timeField: 'break_time_in', photoField: 'break_time_in_photo_url', locationField: 'break_time_in_location', methodField: 'break_time_in_verification_method' },
  { action: 'time_out', label: 'Time Out(2)', timeField: 'time_out', photoField: 'time_out_photo_url', locationField: 'time_out_location', methodField: 'time_out_verification_method' },
];

function latestPunchAction(log) {
  return punchPhotoFields
    .filter(item => log[item.timeField])
    .map(item => ({
      action: item.action,
      time: new Date(log[item.timeField]).getTime(),
    }))
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time)[0]?.action || null;
}

function attendancePhotoItem(log, action) {
  const punch = punchPhotoFields.find(item => item.action === action);
  if (!punch) return null;

  if (log[punch.photoField]) {
    return {
      ...punch,
      photoUrl: log[punch.photoField],
      timeValue: log[punch.timeField],
      actualPunchValue: log[`${action}_photo_captured_at`] || log[`${action}_actual_punch_at`] || log[punch.locationField]?.captured_at || null,
      verificationMethod: log[punch.methodField],
    };
  }

  if (log.photo_url && log.photo_action === action) {
    return {
      ...punch,
      photoUrl: log.photo_url,
      timeValue: log[punch.timeField],
      actualPunchValue: log[`${action}_photo_captured_at`] || log[`${action}_actual_punch_at`] || log[punch.locationField]?.captured_at || null,
      verificationMethod: log[punch.methodField],
      legacy: true,
    };
  }

  const hasPunchSpecificPhoto = punchPhotoFields.some(item => log[item.photoField]);
  if (log.photo_url && !log.photo_action && !hasPunchSpecificPhoto && latestPunchAction(log) === action) {
    return {
      ...punch,
      photoUrl: log.photo_url,
      timeValue: log[punch.timeField],
      actualPunchValue: log[`${action}_photo_captured_at`] || log[`${action}_actual_punch_at`] || log[punch.locationField]?.captured_at || null,
      verificationMethod: log[punch.methodField],
      legacy: true,
    };
  }

  return null;
}

function hasMaterialPunchTimeMismatch(item) {
  const credited = item?.timeValue ? new Date(item.timeValue).getTime() : NaN;
  const actual = item?.actualPunchValue ? new Date(item.actualPunchValue).getTime() : NaN;
  return Number.isFinite(credited) && Number.isFinite(actual)
    && Math.abs(credited - actual) > 30 * 60 * 1000;
}

function actualTimeForPunch(log, action) {
  const punch = punchPhotoFields.find(item => item.action === action);
  if (!punch || !log) return null;
  return log[`${action}_actual_punch_at`]
    || log[`${action}_photo_captured_at`]
    || log[punch.locationField]?.captured_at
    || log[punch.timeField]
    || null;
}

function attendanceLocationItem(log, action) {
  const punch = punchPhotoFields.find(item => item.action === action);
  const location = punch?.locationField ? log[punch.locationField] : null;
  if (!punch || !location) return null;

  return {
    ...punch,
    location,
    timeValue: log[punch.timeField],
    actualPunchValue: log[`${action}_actual_punch_at`] || location.captured_at || null,
  };
}

function hasCoordinates(location) {
  return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

function locationMapsUrl(location) {
  if (!hasCoordinates(location)) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }

  return data;
}

function entityUrl(entity, params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, key === 'filter' ? JSON.stringify(value) : String(value));
    }
  });

  const query = search.toString();
  return `/api/entities/${encodeURIComponent(entity)}${query ? `?${query}` : ''}`;
}

const entities = {
  list(entity, sort, limit, options = {}) {
    return requestJson(entityUrl(entity, { sort, limit, ...options }));
  },
  filter(entity, filter = {}, sort, limit, options = {}) {
    return requestJson(entityUrl(entity, { filter, sort, limit, ...options }));
  },
  page(entity, filter = {}, sort, page = 1, pageSize = 50, options = {}) {
    return requestJson(entityUrl(entity, { filter, sort, page, pageSize, ...options }));
  },
  create(entity, data) {
    return requestJson(entityUrl(entity), {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
  update(entity, id, data) {
    return requestJson(entityUrl(entity), {
      method: 'PATCH',
      body: JSON.stringify({ id, data }),
    });
  },
};

const ATTENDANCE_PAGE_SIZE = 50;
async function fetchAttendanceLogs(filter, sort = '-date', maximum = 5000) {
  const records = [];
  for (let pageNumber = 1; records.length < maximum; pageNumber += 1) {
    const response = await entities.page('AttendanceLog', filter, sort, pageNumber, ATTENDANCE_PAGE_SIZE, {
      fields: ATTENDANCE_LOG_LIST_FIELDS,
    });
    records.push(...(response.data || []));
    if (!response.pagination?.hasNextPage) break;
  }
  return records.slice(0, maximum);
}

function invokeFunction(name, data) {
  return requestJson(`/api/functions/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

async function uploadFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return requestJson('/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      name: file?.name,
      dataUrl,
    }),
  });
}

// ── Edit Attendance Modal ──
function EditAttendanceModal({ log, employee, defaultWorkSchedule, shiftOptions, resolvedShift, overtimeRequests = [], onClose, onSave, currentUser, activeCompanyId, canCorrectAttendance = false }) {
  const TODAY_STR = manilaDateString();

  // Step 1: passcode gate. Step 2: actual edit form.
  const [step, setStep] = useState('passcode'); // 'passcode' | 'edit'
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [reason, setReason] = useState('');
  const [timeIn, setTimeIn] = useState(log.time_in ? formatManilaTime(log.time_in, { hour12: false }) : '');
  const [breakOut, setBreakOut] = useState(log.break_time_out ? formatManilaTime(log.break_time_out, { hour12: false }) : '');
  const [breakIn, setBreakIn] = useState(log.break_time_in ? formatManilaTime(log.break_time_in, { hour12: false }) : '');
  const [timeOut, setTimeOut] = useState(log.time_out ? formatManilaTime(log.time_out, { hour12: false }) : '');
  const [attendanceDate, setAttendanceDate] = useState(log.date || '');
  const [dayType, setDayType] = useState(log.day_type || 'regular');
  const workSchedule = log.work_schedule || defaultWorkSchedule || 'day_shift';
  const assignedShift = resolvedShift || getShiftOption(shiftOptions, workSchedule, defaultWorkSchedule || 'day_shift');
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('idle'); // idle | capturing | done | error
  const [saving, setSaving] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Only super_admin/admin may edit time on an HR-approved log. Everyone else
  // (with the daily passcode) may only fill in missing punches, and only while
  // the log is still pending — once HR approves it, non-admins are locked out.
  const isApprovedLog = log.status === 'approved';
  // Time In (1) is the immutable employee scan timestamp. Corrections are
  // documented through the review workflow instead of rewriting the punch.
  const canEditTimeIn = false;
  const canEditBreakOut = canCorrectAttendance || (!isApprovedLog && !log.break_time_out);
  const canEditBreakIn = canCorrectAttendance || (!isApprovedLog && !log.break_time_in);
  const canEditTimeOut = canCorrectAttendance || (!isApprovedLog && !log.time_out);
  const canEditAttendanceDate = canCorrectAttendance;

  // Start camera only after passcode is verified
  useEffect(() => {
    if (step !== 'edit') return;
    setPhotoStatus('capturing');
    let stream = null;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise(r => { videoRef.current.onloadedmetadata = r; });
          videoRef.current.play();
          await new Promise(r => setTimeout(r, 1200));
          capturePhoto(stream);
        }
      } catch {
        setPhotoStatus('error');
      }
    };
    start();
    return () => { if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; } };
  }, [step]);

  const capturePhoto = (stream) => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 320;
    canvas.height = videoRef.current.videoHeight || 240;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.85));
    setPhotoStatus('done');
    stream.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const retake = async () => {
    setPhotoStatus('capturing');
    setPhotoDataUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise(r => { videoRef.current.onloadedmetadata = r; });
        videoRef.current.play();
        await new Promise(r => setTimeout(r, 1200));
        capturePhoto(stream);
      }
    } catch { setPhotoStatus('error'); }
  };

  const verifyPasscode = async () => {
    if (!passcodeInput.trim()) { setPasscodeError('Please enter the daily passcode.'); return; }
    setVerifying(true);
    setPasscodeError('');
    const records = await entities.filter('DailyPasscode', { date: TODAY_STR, company_profile_id: activeCompanyId });
    const match = records.find(record => matchesDailyPasscode(record, passcodeInput));
    if (match) {
      setStep('edit');
    } else {
      setPasscodeError('Incorrect HR Officer or Admin passcode. Confirm today’s code and selected company.');
    }
    setVerifying(false);
  };

  const handleSave = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    const updates = {};

    // Preserve the existing punch's calendar day (important for night shifts that
    // cross midnight) and only override the time-of-day; fall back to the log date
    // when filling a previously-missing punch.
    const toISO = (timeStr, existingISO) => {
      const punchDate = existingISO ? manilaDateString(existingISO) : log.date;
      return new Date(`${punchDate}T${timeStr}:00+08:00`).toISOString();
    };

    // Apply a time field: admins may also change or clear already-recorded punches.
    const applyField = (key, timeStr, canEdit) => {
      if (!canEdit) return;
      const existingISO = log[key] || null;
      if (timeStr) {
        const next = toISO(timeStr, existingISO);
        if (next !== existingISO) updates[key] = next;
      } else if (existingISO) {
        updates[key] = null; // admin cleared a recorded punch
      }
    };

    applyField('time_in', timeIn, canEditTimeIn);
    applyField('break_time_out', breakOut, canEditBreakOut);
    applyField('break_time_in', breakIn, canEditBreakIn);
    applyField('time_out', timeOut, canEditTimeOut);
    if (canEditAttendanceDate && attendanceDate && attendanceDate !== log.date) {
      updates.date = attendanceDate;
    }
    if (dayType !== (log.day_type || 'regular')) {
      updates.day_type = dayType;
    }

    // Resolve the final timeout against the last recorded start. Keeping the
    // timeout's old calendar day is incorrect after a manual clock-time edit:
    // e.g. an old next-day timeout changed to 17:30 would remain next-day and
    // add 24 hours. Choose the earliest occurrence of the entered clock time
    // after Time In(2) (or Time In(1)), which also preserves overnight shifts.
    const provisionalBreakIn = 'break_time_in' in updates ? updates.break_time_in : log.break_time_in;
    const provisionalTimeIn = 'time_in' in updates ? updates.time_in : log.time_in;
    const provisionalTimeOut = 'time_out' in updates ? updates.time_out : log.time_out;
    const lastStart = provisionalBreakIn || provisionalTimeIn;
    if (canEditTimeOut && timeOut && provisionalTimeOut && lastStart) {
      const startDate = new Date(lastStart);
      const startDay = manilaDateString(startDate);
      const outDate = new Date(`${startDay}T${timeOut}:00+08:00`);
      if (Number.isFinite(outDate.getTime()) && Number.isFinite(startDate.getTime())) {
        if (outDate.getTime() <= startDate.getTime()) {
          outDate.setUTCDate(outDate.getUTCDate() + 1);
        }
        if (outDate.toISOString() !== log.time_out) {
          updates.time_out = outDate.toISOString();
        }
      }
    }
    const pick = (key) => (key in updates ? updates[key] : log[key]);
    const effDate = pick('date');
    const effTimeIn = pick('time_in');
    const effBreakOut = pick('break_time_out');
    const effBreakIn = pick('break_time_in');
    const effTimeOut = pick('time_out');
    const timesChanged = ['time_in', 'break_time_out', 'break_time_in', 'time_out']
      .some((key) => key in updates);

    if (effTimeIn && effTimeOut) {
      const selectedShift = assignedShift;
      const fallbackShift = legacyShiftTimes(selectedShift.value);
      const hrs = computeCreditedHoursWorked({
        ...log,
        date: effDate,
        time_in: effTimeIn,
        break_time_out: effBreakOut,
        break_time_in: effBreakIn,
        time_out: effTimeOut,
      }, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        timeInAllowanceMinutes: selectedShift.time_in_allowance_minutes || 0,
        lateGraceMinutes: selectedShift.grace_period_minutes || 0,
        breakInGraceMinutes: selectedShift.grace_period_minutes || 0,
        breakDurationMinutes: getBreakDurationMinutes(employee, selectedShift),
        paidBreakTime: enabledBooleanSetting(selectedShift.paid_break_time),
      });
      updates.hours_worked = parseFloat(hrs.toFixed(2));
      const recomputedOvertime = computeOvertimeHours({
        ...log,
        date: effDate,
        time_in: effTimeIn,
        break_time_out: effBreakOut,
        break_time_in: effBreakIn,
        time_out: effTimeOut,
      }, hrs, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        shiftEndTime: selectedShift.shift_end_time || fallbackShift.shift_end_time,
        overtimeStartTime: selectedShift.overtime_start_time || fallbackShift.overtime_start_time,
        breakInGraceMinutes: selectedShift.grace_period_minutes || 0,
        breakDurationMinutes: getBreakDurationMinutes(employee, selectedShift),
        paidBreakTime: enabledBooleanSetting(selectedShift.paid_break_time),
      });
      const attendanceMetrics = {
        ...log,
        date: effDate,
        time_in: effTimeIn,
        break_time_out: effBreakOut,
        break_time_in: effBreakIn,
        time_out: effTimeOut,
      };
      const approvedOtRequest = approvedOvertimeRequestForLog(attendanceMetrics, overtimeRequests, employee);
      const cappedOvertime = capOvertimeByApprovedRequest(recomputedOvertime, approvedOtRequest);
      updates.ot_actual_hours = Number(recomputedOvertime.toFixed(2));
      updates.overtime_hours = cappedOvertime;
      updates.ot_requested_hours = approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0;
      updates.night_diff_hours = computeNightDifferentialHours(attendanceMetrics, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        breakDurationMinutes: getBreakDurationMinutes(employee, selectedShift),
        paidBreakTime: enabledBooleanSetting(selectedShift.paid_break_time),
      });
      updates.late_minutes = computeLateMinutes(attendanceMetrics, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        timeInAllowanceMinutes: selectedShift.time_in_allowance_minutes || 0,
        lateGraceMinutes: selectedShift.grace_period_minutes || 0,
      });
      updates.ot_status = overtimeStatusForComputedHours(recomputedOvertime, cappedOvertime, approvedOtRequest);
      updates.overtime_request_id = approvedOtRequest?.id || null;
      updates.ot_hr_approved = Boolean(approvedOtRequest);
      updates.ot_admin_approved = Boolean(approvedOtRequest);
      updates.ot_reviewed_at = null;
      updates.ot_reviewed_by = null;
      updates.ot_review_reason = null;
    } else if (timesChanged) {
      // Can no longer compute a full day (e.g. a punch was cleared) — zero it out.
      updates.hours_worked = 0;
      updates.ot_actual_hours = 0;
      updates.overtime_hours = 0;
      updates.ot_requested_hours = 0;
      updates.night_diff_hours = 0;
      updates.late_minutes = 0;
      updates.ot_status = null;
      updates.ot_hr_approved = false;
      updates.ot_admin_approved = false;
      updates.ot_reviewed_at = null;
      updates.ot_reviewed_by = null;
      updates.ot_review_reason = null;
    }

    let photoUrl = '';
    if (photoDataUrl) {
      try {
        const blob = await fetch(photoDataUrl).then(r => r.blob());
        const file = new File([blob], `audit_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const { file_url } = await uploadFile(file);
        photoUrl = file_url;
      } catch { /* non-blocking */ }
    }

    const editKind = canCorrectAttendance ? 'Attendance correction' : 'Manual edit';
    updates.passcode_audit_action = canCorrectAttendance ? 'attendance_correction' : 'attendance_manual_edit';
    updates.passcode_audit_at = new Date().toISOString();
    updates.passcode_audit_by = currentUser?.full_name || currentUser?.email || 'unknown';
    updates.passcode_audit_reason = reason.trim();
    updates.passcode_audit_summary = `${editKind} for ${log.date}`;
    const dateCorrectionNote = updates.date
      ? ` | Date corrected: ${log.date || 'none'} to ${updates.date}`
      : '';
    const dayTypeCorrectionNote = updates.day_type
      ? ` | Day type corrected: ${log.day_type || 'regular'} to ${updates.day_type}`
      : '';
    const recomputeNote = 'hours_worked' in updates
      ? ` | Recomputed: ${updates.hours_worked}h worked, ${updates.overtime_hours}h OT`
      : '';
    const previousNotes = log.notes ? `${log.notes}\n` : '';
    updates.notes = `${previousNotes}${editKind} by ${currentUser?.full_name || currentUser?.email || 'unknown'} on ${format(new Date(), 'yyyy-MM-dd HH:mm')} | Reason: ${reason.trim()}${dateCorrectionNote}${dayTypeCorrectionNote}${recomputeNote}${photoUrl ? ` | Audit photo: ${photoUrl}` : ''}`;

    await onSave(log.id, updates);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>
            {step === 'passcode'
              ? 'Enter Daily Passcode'
              : `${canCorrectAttendance ? 'Correct' : 'Edit'} Attendance — ${log.date}`}
          </DialogTitle>
        </DialogHeader>

        {step === 'passcode' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <KeyRound className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                Manual attendance edits accept today&apos;s HR Officer or Admin passcode for the selected company. All modifications are authorized and auditable.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Daily Passcode</label>
              <Input
                type="password"
                placeholder="Enter 6-digit passcode"
                value={passcodeInput}
                onChange={e => setPasscodeInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && verifyPasscode()}
                className="mt-1 font-mono text-center tracking-widest text-lg"
                maxLength={6}
              />
              {passcodeError && <p className="text-xs text-destructive mt-1">{passcodeError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={verifyPasscode} disabled={verifying} className="gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                {verifying ? 'Verifying...' : 'Proceed'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Reason */}
            <div>
              <label className="text-sm font-medium text-foreground">Reason for Manual Edit <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="e.g. Employee forgot to tap out, system was offline, biometric malfunction..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="mt-1 h-20 text-sm"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {canCorrectAttendance
                ? 'Admins can correct the attendance date and any punch, including on approved records. Hours worked and overtime are recomputed automatically when saved. Clear a field to remove a punch.'
                : 'Only missing time fields can be filled in. Shift assignments are read-only here and can only be changed on the Work Schedule page.'}
            </p>

            {canEditAttendanceDate && (
              <div>
                <label className="text-sm font-medium text-foreground">Attendance Date</label>
                <Input
                  type="date"
                  value={attendanceDate}
                  onChange={e => setAttendanceDate(e.target.value)}
                  className="mt-1"
                />
                {attendanceDate !== log.date && (
                  <p className="text-xs text-amber-600 mt-0.5">
                    This moves the record from {log.date || 'no date'} to {attendanceDate}.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-foreground">Day Type</label>
              <Select value={dayType} onValueChange={setDayType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="half_day">Half Day</SelectItem>
                  <SelectItem value="rest_day">Rest Day</SelectItem>
                  <SelectItem value="regular_holiday">Regular Holiday</SelectItem>
                  <SelectItem value="special_holiday">Special Non-Working Holiday</SelectItem>
                  <SelectItem value="special_working_holiday">Special Working Holiday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Shift</label>
              <div className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {assignedShift.label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Shift assignments can only be changed on the Work Schedule page.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Time In(1)</label>
                <Input type="time" value={timeIn} onChange={e => setTimeIn(e.target.value)}
                  disabled={!canEditTimeIn} className={`mt-1 ${!canEditTimeIn ? 'opacity-50 cursor-not-allowed' : ''}`} />
                <p className="text-xs text-muted-foreground mt-0.5">{log.time_in ? 'Immutable actual employee scan' : 'Missing and locked'} — use Review Time In (1) to request an authorized adjustment.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time Out(1)</label>
                <Input type="time" value={breakOut} onChange={e => setBreakOut(e.target.value)}
                  disabled={!canEditBreakOut} className={`mt-1 ${!canEditBreakOut ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditBreakOut ? <p className="text-xs text-muted-foreground mt-0.5">{log.break_time_out ? 'Already recorded' : 'Locked — approved by HR'}</p>
                  : (canCorrectAttendance && log.break_time_out && <p className="text-xs text-amber-600 mt-0.5">Recorded — editable</p>)}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time In(2)</label>
                <Input type="time" value={breakIn} onChange={e => setBreakIn(e.target.value)}
                  disabled={!canEditBreakIn} className={`mt-1 ${!canEditBreakIn ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditBreakIn ? <p className="text-xs text-muted-foreground mt-0.5">{log.break_time_in ? 'Already recorded' : 'Locked — approved by HR'}</p>
                  : (canCorrectAttendance && log.break_time_in && <p className="text-xs text-amber-600 mt-0.5">Recorded — editable</p>)}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time Out(2)</label>
                <Input type="time" value={timeOut} onChange={e => setTimeOut(e.target.value)}
                  disabled={!canEditTimeOut} className={`mt-1 ${!canEditTimeOut ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditTimeOut ? <p className="text-xs text-muted-foreground mt-0.5">{log.time_out ? 'Already recorded' : 'Locked — approved by HR'}</p>
                  : (canCorrectAttendance && log.time_out && <p className="text-xs text-amber-600 mt-0.5">Recorded — editable</p>)}
              </div>
            </div>

            {/* Audit photo */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Editor Identity Capture (Audit)</p>
              <div className="relative w-full aspect-video bg-muted rounded-xl overflow-hidden flex items-center justify-center border border-border">
                <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${photoStatus === 'done' ? 'hidden' : ''}`} />
                {photoStatus === 'done' && photoDataUrl && (
                  <img src={photoDataUrl} alt="Audit" className="w-full h-full object-cover" />
                )}
                {photoStatus === 'capturing' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white text-xs">
                    <Camera className="w-6 h-6 animate-pulse" /><span>Capturing photo...</span>
                  </div>
                )}
                {photoStatus === 'error' && (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground text-xs p-4 text-center">
                    <Camera className="w-6 h-6 opacity-30" /><span>Camera unavailable — no photo saved</span>
                  </div>
                )}
              </div>
              {photoStatus === 'done' && (
                <Button variant="outline" size="sm" onClick={retake} className="gap-1 text-xs">
                  <Camera className="w-3.5 h-3.5" /> Retake
                </Button>
              )}
            </div>

            <div className="sticky bottom-0 z-10 -mx-2 flex justify-end gap-2 border-t border-border bg-background/95 px-2 py-3 backdrop-blur">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !reason.trim() || photoStatus === 'capturing'}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InlinePhotoButton({ photoItem, log, onView }) {
  if (!photoItem?.photoUrl) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40"
        title="No photo captured for this punch"
      >
        <Eye className="w-3.5 h-3.5" />
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-6 w-6 text-sky-600 hover:bg-sky-50"
      title={`View ${photoItem.label} photo`}
      onClick={(event) => {
        event.stopPropagation();
        onView({ log, ...photoItem });
      }}
    >
      <Eye className="w-3.5 h-3.5" />
      <span className="sr-only">View {photoItem.label} photo</span>
    </Button>
  );
}

function InlineVerificationMethodIcon({ photoItem }) {
  if (!photoItem?.verificationMethod) return null;

  const isQrPhoto = ['qr_face', 'qr_photo_liveness'].includes(photoItem.verificationMethod);
  const Icon = isQrPhoto ? QrCode : ScanFace;
  const label = isQrPhoto ? `${photoItem.label} used QR Code + Photo` : `${photoItem.label} used Face Verification`;

  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded ${
        isQrPhoto ? 'text-indigo-600 bg-indigo-50' : 'text-emerald-600 bg-emerald-50'
      }`}
      title={label}
      aria-label={label}
    >
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}

function InlineLocationButton({ locationItem, log, onView }) {
  if (!locationItem?.location) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40"
        title="No location captured for this punch"
      >
        <MapPin className="w-3.5 h-3.5" />
      </span>
    );
  }

  const captured = hasCoordinates(locationItem.location);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={`h-6 w-6 ${captured ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'}`}
      title={captured ? `View ${locationItem.label} GPS location` : `${locationItem.label} GPS not captured`}
      onClick={(event) => {
        event.stopPropagation();
        onView({ log, ...locationItem });
      }}
    >
      <MapPin className="w-3.5 h-3.5" />
      <span className="sr-only">View {locationItem.label} GPS location</span>
    </Button>
  );
}

function RejectAttendanceModal({ log, currentUser, activeCompanyId, onClose, onConfirm }) {
  const TODAY_STR = manilaDateString();
  const [passcodeInput, setPasscodeInput] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const rejectAttendance = async () => {
    if (!passcodeInput.trim()) {
      setError('Please enter the daily passcode.');
      return;
    }
    if (!reason.trim()) {
      setError('Please enter the reason for rejection.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const records = await entities.filter('DailyPasscode', { date: TODAY_STR, company_profile_id: activeCompanyId });
      const match = records.find(record => matchesDailyPasscode(record, passcodeInput));
      if (!match) {
        setError('Incorrect HR Officer or Admin passcode. Confirm today’s code and selected company.');
        return;
      }

      const previousNotes = log.notes ? `${log.notes}\n` : '';
      await onConfirm({
        status: 'rejected',
        passcode_audit_action: 'attendance_rejected',
        passcode_audit_at: new Date().toISOString(),
        passcode_audit_by: currentUser?.full_name || currentUser?.email || 'unknown',
        passcode_audit_reason: reason.trim(),
        passcode_audit_summary: `Attendance rejected for ${log.date}`,
        notes: `${previousNotes}Attendance rejected by ${currentUser?.full_name || currentUser?.email || 'unknown'} on ${format(new Date(), 'yyyy-MM-dd HH:mm')} | Reason: ${reason.trim()}`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Attendance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
            <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-800">
              Rejecting the attendance for {log.date} requires the daily passcode and a rejection reason.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Daily Passcode</label>
            <Input
              type="password"
              placeholder="Enter 6-digit passcode"
              value={passcodeInput}
              onChange={e => setPasscodeInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && rejectAttendance()}
              className="mt-1 font-mono text-center tracking-widest text-lg"
              maxLength={6}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Reason for Rejection <span className="text-destructive">*</span></label>
            <Textarea
              placeholder="e.g. Incorrect punch sequence, wrong employee scan, missing required final time out..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="mt-1 h-24 text-sm"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={rejectAttendance}
              disabled={saving || !reason.trim() || !passcodeInput.trim()}
            >
              {saving ? 'Rejecting...' : 'Reject Attendance'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimeInReviewModal({ log, currentUser, onClose, onConfirm }) {
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submitReview = async () => {
    if (!category) { setError('Please select a review reason.'); return; }
    if (!note.trim()) { setError('Please enter a review note.'); return; }
    setSaving(true);
    setError('');
    const reviewedAt = new Date().toISOString();
    const reviewer = currentUser?.full_name || currentUser?.name || currentUser?.email || 'unknown';
    try {
      await onConfirm({
        time_in_review_status: 'pending',
        time_in_review_requested_at: reviewedAt,
        time_in_review_requested_by: reviewer,
        time_in_original_value: log.time_in_actual_punch_at || log.time_in,
        time_in_review_category: category,
        time_in_review_note: note.trim(),
        time_in_reviewed_at: reviewedAt,
        time_in_reviewed_by: reviewer,
        passcode_audit_action: 'time_in_reviewed',
        passcode_audit_at: reviewedAt,
        passcode_audit_by: reviewer,
        passcode_audit_reason: `${category}: ${note.trim()}`,
        passcode_audit_summary: `Immutable Time In (1) reviewed for ${log.date}`,
      });
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Review Time In (1)</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Recorded actual Time In (1): <strong>{log.time_in ? formatManilaTime(log.time_in) : 'Missing'}</strong>. This timestamp is immutable and will not be changed by this review.
        </div>
        <div><label className="text-sm font-medium">Reason for review</label><Select value={category} onValueChange={setCategory}><SelectTrigger className="mt-1"><SelectValue placeholder="Select a reason" /></SelectTrigger><SelectContent><SelectItem value="system_error">System Error</SelectItem><SelectItem value="employee_error">Employee Error</SelectItem><SelectItem value="others">Others</SelectItem></SelectContent></Select></div>
        <div><label className="text-sm font-medium">Reason or note</label><Textarea className="mt-1" rows={4} value={note} onChange={event => setNote(event.target.value)} placeholder="Describe what happened and what should be reviewed." /></div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={submitReview} disabled={saving}>{saving ? 'Saving…' : 'Save Review'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}

function OvertimeReviewModal({ log, currentUser, activeCompanyId, onClose, onConfirm }) {
  const TODAY_STR = manilaDateString();
  const requestedHours = Number(log.ot_requested_hours ?? log.overtime_hours) || 0;
  const [approvedHours, setApprovedHours] = useState(
    String(Number(log.ot_status === 'approved' ? log.overtime_hours : requestedHours) || 0)
  );
  const [hrPasscode, setHrPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const verifyCodes = async () => {
    const records = await entities.filter('DailyPasscode', {
      date: TODAY_STR,
      company_profile_id: activeCompanyId,
    });
    const todayCode = records.find(record =>
      normalizeDailyPasscode(record.passcode) === normalizeDailyPasscode(hrPasscode) &&
      normalizeDailyPasscode(record.manager_passcode) === normalizeDailyPasscode(adminPasscode)
    );
    if (!todayCode) {
      if (records.length === 0) {
        throw new Error('No daily HR/Admin passcodes have been generated for today and the selected company.');
      }
      throw new Error('Incorrect HR Officer or Admin passcode. Use the matching pair generated today for the selected company.');
    }
  };

  const submitDecision = async (decision) => {
    const nextHours = decision === 'denied' ? 0 : Number(approvedHours);
    if (!hrPasscode.trim() || !adminPasscode.trim()) {
      setError('Both the HR Officer and Admin passcodes are required.');
      return;
    }
    if (decision === 'approved' && (!Number.isFinite(nextHours) || nextHours < 0 || nextHours > requestedHours)) {
      setError(`Approved OT must be between 0 and ${requestedHours} hours.`);
      return;
    }
    if ((decision === 'denied' || nextHours < requestedHours) && !reason.trim()) {
      setError('A reason is required when OT is denied or reduced.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await verifyCodes();
      const reviewer = currentUser?.full_name || currentUser?.email || 'unknown';
      const reviewedAt = new Date().toISOString();
      const previousNotes = log.notes ? `${log.notes}\n` : '';
      const decisionLabel = decision === 'denied'
        ? 'denied'
        : nextHours < requestedHours
          ? `reduced from ${requestedHours}h to ${nextHours}h`
          : `approved at ${nextHours}h`;
      await onConfirm({
        overtime_hours: Number(nextHours.toFixed(2)),
        ot_requested_hours: Number(requestedHours.toFixed(2)),
        ot_status: decision,
        ot_hr_approved: true,
        ot_admin_approved: true,
        ot_reviewed_at: reviewedAt,
        ot_reviewed_by: reviewer,
        ot_review_reason: reason.trim() || null,
        passcode_audit_action: decision === 'denied' ? 'overtime_denied' : nextHours < requestedHours ? 'overtime_reduced' : 'overtime_approved',
        passcode_audit_at: reviewedAt,
        passcode_audit_by: reviewer,
        passcode_audit_reason: reason.trim() || null,
        passcode_audit_summary: `OT ${decisionLabel} for ${log.date}`,
        notes: `${previousNotes}OT ${decisionLabel} with HR Officer and Admin passcodes by ${reviewer} on ${format(new Date(), 'yyyy-MM-dd HH:mm')}${reason.trim() ? ` | Reason: ${reason.trim()}` : ''}`,
      });
      onClose();
    } catch (reviewError) {
      setError(reviewError?.message || 'Unable to review overtime.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Overtime — {log.date}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Computed OT</span>
              <span className="font-semibold">{requestedHours.toFixed(2)} hours</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Approved OT Hours</label>
            <Input
              type="number"
              min="0"
              max={requestedHours}
              step="0.01"
              value={approvedHours}
              onChange={event => setApprovedHours(event.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">OT may be reduced, but cannot exceed the computed hours.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">HR Officer Passcode</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={hrPasscode}
                onChange={event => setHrPasscode(event.target.value)}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Admin Passcode</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={adminPasscode}
                onChange={event => setAdminPasscode(event.target.value)}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">
              Reason <span className="text-muted-foreground">(required for reduction/denial)</span>
            </label>
            <Textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Explain any OT reduction or denial"
              className="mt-1"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="destructive" onClick={() => submitDecision('denied')} disabled={saving}>
              Deny OT
            </Button>
            <Button
              onClick={() => submitDecision('approved')}
              disabled={saving}
            >
              {saving ? 'Verifying...' : 'Approve OT'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OvertimeRequestReviewModal({ request, currentUser, activeCompanyId, onClose, onConfirm, onCorrectAttendance }) {
  const TODAY_STR = manilaDateString();
  const requestedHours = Number(request.requested_hours) || 0;
  const [approvedHours, setApprovedHours] = useState(String(request.approved_hours || requestedHours));
  const [hrPasscode, setHrPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [timeOutConfirmed, setTimeOutConfirmed] = useState(false);
  const [correctedTimeOut, setCorrectedTimeOut] = useState('');
  const { data: requestAttendanceLogs = [], isLoading: loadingAttendance } = useQuery({
    queryKey: ['ot-review-attendance', activeCompanyId, request.employee_id, request.date],
    queryFn: async () => {
      const baseFilter = { company_profile_id: activeCompanyId, date: request.date };
      const [byRecord, byEmployee] = await Promise.all([
        entities.page('AttendanceLog', { ...baseFilter, employee_record_id: request.employee_record_id }, '-updated_date', 1, 20),
        entities.page('AttendanceLog', { ...baseFilter, employee_id: request.employee_id }, '-updated_date', 1, 20),
      ]);
      return [...new Map(
        [...(byRecord.data || []), ...(byEmployee.data || [])].map(log => [log.id, log])
      ).values()];
    },
    enabled: !!activeCompanyId && !!request.date,
  });
  const requestAttendance = requestAttendanceLogs.find(log =>
    (request.employee_record_id && String(log.employee_record_id) === String(request.employee_record_id)) ||
    String(log.employee_id || '').toLowerCase() === String(request.employee_id || '').toLowerCase()
  );
  useEffect(() => {
    if (requestAttendance?.time_out && !correctedTimeOut) {
      setCorrectedTimeOut(formatManilaTime(requestAttendance.time_out, { hour12: false }));
    }
  }, [requestAttendance?.time_out, correctedTimeOut]);
  const originalTimeOut = requestAttendance?.time_out || null;
  const correctedTimeOutIso = correctedTimeOut && requestAttendance
    ? new Date(`${manilaDateString(originalTimeOut || requestAttendance.date)}T${correctedTimeOut}:00+08:00`).toISOString()
    : null;
  const effectiveAttendance = requestAttendance
    ? { ...requestAttendance, time_out: correctedTimeOutIso || originalTimeOut }
    : null;
  const fallbackShift = legacyShiftTimes(requestAttendance?.work_schedule);
  const computationOptions = {
    shiftStartTime: requestAttendance?.shift_start_time || fallbackShift.shift_start_time,
    shiftEndTime: requestAttendance?.shift_end_time || fallbackShift.shift_end_time,
    overtimeStartTime: requestAttendance?.shift_overtime_start_time || fallbackShift.overtime_start_time,
    breakDurationMinutes: DEFAULT_BREAK_DURATION_MINUTES,
    paidBreakTime: enabledBooleanSetting(requestAttendance?.shift_paid_break_time),
  };
  const recomputedHoursWorked = effectiveAttendance?.time_in && effectiveAttendance?.time_out
    ? computeCreditedHoursWorked(effectiveAttendance, computationOptions)
    : 0;
  const actualOvertimeHours = effectiveAttendance?.time_out
    ? computeOvertimeHours(effectiveAttendance, recomputedHoursWorked, computationOptions)
    : 0;
  const hasFinalTimeOut = Boolean(effectiveAttendance?.time_out);
  const originalTimeOutInput = originalTimeOut ? formatManilaTime(originalTimeOut, { hour12: false }) : '';
  const timeOutChanged = Boolean(correctedTimeOutIso && originalTimeOut && correctedTimeOut !== originalTimeOutInput);
  const computedAttendanceChanged = Boolean(requestAttendance) && (
    Math.abs((Number(requestAttendance.hours_worked) || 0) - recomputedHoursWorked) > 0.005 ||
    Math.abs((Number(requestAttendance.ot_actual_hours ?? requestAttendance.overtime_hours) || 0) - actualOvertimeHours) > 0.005
  );

  const verifyCodes = async () => {
    const records = await entities.filter('DailyPasscode', {
      date: TODAY_STR,
      company_profile_id: activeCompanyId,
    });
    const todayCode = records.find(record =>
      normalizeDailyPasscode(record.passcode) === normalizeDailyPasscode(hrPasscode) &&
      normalizeDailyPasscode(record.manager_passcode) === normalizeDailyPasscode(adminPasscode)
    );
    if (!todayCode) {
      if (records.length === 0) {
        throw new Error('No daily HR/Admin passcodes have been generated for today and the selected company.');
      }
      throw new Error('Incorrect HR Officer or Admin passcode. Use today’s matching HR/Admin pair.');
    }
  };

  const submitDecision = async (decision) => {
    const nextHours = decision === 'denied' ? 0 : Number(approvedHours);
    if (!hrPasscode.trim() || !adminPasscode.trim()) {
      setError('Both the HR Officer and Admin passcodes are required.');
      return;
    }
    if (decision === 'approved' && (!Number.isFinite(nextHours) || nextHours <= 0 || nextHours > requestedHours)) {
      setError(`Approved OT must be greater than 0 and not more than ${requestedHours} hours.`);
      return;
    }
    if (decision === 'approved' && !hasFinalTimeOut) {
      setError('A recorded final Time Out is required before this OT request can be approved.');
      return;
    }
    if (decision === 'approved' && !(actualOvertimeHours > 0)) {
      setError('Attendance has no actual overtime. Correct the attendance Time Out before approving this request.');
      return;
    }
    if (decision === 'approved' && nextHours > actualOvertimeHours + 0.005) {
      setError(`Approved OT cannot exceed the ${actualOvertimeHours.toFixed(2)} actual hours supported by Time Out.`);
      return;
    }
    if (decision === 'approved' && !timeOutConfirmed) {
      setError('HR Officer and Admin must confirm the recorded final Time Out.');
      return;
    }
    if ((decision === 'denied' || nextHours < requestedHours) && !reason.trim()) {
      setError('A reason is required when OT is denied or reduced.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await verifyCodes();
      const reviewer = currentUser?.full_name || currentUser?.email || 'unknown';
      const reviewedAt = new Date().toISOString();
      // An approved Time In review invalidates the previously stored attendance
      // totals. Persist the live recalculation before the OT API validates it.
      if (decision === 'approved' && requestAttendance && (timeOutChanged || computedAttendanceChanged)) {
        await onCorrectAttendance(requestAttendance.id, {
          ...(timeOutChanged ? { time_out: correctedTimeOutIso } : {}),
          hours_worked: Number(recomputedHoursWorked.toFixed(2)),
          ot_actual_hours: Number(actualOvertimeHours.toFixed(2)),
          notes: `${requestAttendance.notes ? `${requestAttendance.notes}\n` : ''}${timeOutChanged ? 'Final Time Out corrected and attendance' : 'Attendance'} totals recalculated for OT review by ${reviewer} on ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        }, request);
      }
      await onConfirm({
        status: decision,
        approved_hours: Number(nextHours.toFixed(2)),
        reviewed_at: reviewedAt,
        reviewed_by: reviewer,
        review_reason: reason.trim() || null,
        hr_approved: decision === 'approved',
        admin_approved: decision === 'approved',
        time_out_confirmed: decision === 'approved',
        time_out_confirmed_at: decision === 'approved' ? reviewedAt : null,
        confirmed_time_out: decision === 'approved' ? effectiveAttendance.time_out : null,
        confirmed_actual_ot_hours: decision === 'approved' ? actualOvertimeHours : 0,
        hr_confirmation_passcode: decision === 'approved' ? hrPasscode.trim() : undefined,
        admin_confirmation_passcode: decision === 'approved' ? adminPasscode.trim() : undefined,
        passcode_audit_action: decision === 'denied' ? 'overtime_request_denied' : 'overtime_request_approved',
        passcode_audit_at: reviewedAt,
        passcode_audit_by: reviewer,
        passcode_audit_reason: reason.trim() || null,
        passcode_audit_summary: `OT request ${decision} for ${request.employee_name || request.employee_id} on ${request.date}`,
      });
      onClose();
    } catch (reviewError) {
      setError(reviewError?.message || 'Unable to review OT request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review OT Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Employee</span>
              <span className="font-semibold text-right">{request.employee_name || request.employee_id}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Date</span>
              <span className="font-semibold">{request.date}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Requested</span>
              <span className="font-semibold">{requestedHours.toFixed(2)} hours</span>
            </div>
            <p className="text-xs text-muted-foreground border-t border-border pt-2">{request.reason}</p>
          </div>

          <div className={`rounded-lg border p-3 ${hasFinalTimeOut && actualOvertimeHours > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attendance verification</p>
            <div className="mt-2 flex justify-between text-sm">
              <span>Final Time Out</span>
              <span className="font-semibold">{loadingAttendance ? 'Loading…' : hasFinalTimeOut ? formatManilaTime(effectiveAttendance.time_out) : 'Missing'}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span>Actual OT supported</span>
              <span className="font-semibold">{actualOvertimeHours.toFixed(2)} hours</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Corrected Final Time Out</label>
            <Input
              type="time"
              value={correctedTimeOut}
              disabled={loadingAttendance || !requestAttendance?.time_out}
              onChange={event => {
                setCorrectedTimeOut(event.target.value);
                setTimeOutConfirmed(false);
              }}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Use the employee’s final callback punch. Example: 20 minutes of OT = <span className="font-semibold text-foreground">0.33 hours</span> (for example, 5:20 PM if OT starts at 5:00 PM).
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <Checkbox
              checked={timeOutConfirmed}
              onCheckedChange={value => setTimeOutConfirmed(value === true)}
              disabled={!hasFinalTimeOut || !(actualOvertimeHours > 0)}
            />
            <span>HR Officer and Admin confirm that the recorded final Time Out is correct and supports the approved OT hours.</span>
          </label>

          <div>
            <label className="text-sm font-medium text-foreground">Approved OT Hours</label>
            <Input
              type="number"
              min="0.25"
              max={requestedHours}
              step="0.25"
              value={approvedHours}
              onChange={event => setApprovedHours(event.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">Enter decimal hours: 15 min = 0.25, 20 min = 0.33, 30 min = 0.50.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">HR Officer Passcode</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={hrPasscode}
                onChange={event => setHrPasscode(event.target.value)}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Admin Passcode</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={adminPasscode}
                onChange={event => setAdminPasscode(event.target.value)}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">
              Reason <span className="text-muted-foreground">(required for reduction/denial)</span>
            </label>
            <Textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Explain approval adjustment or denial"
              className="mt-1"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="destructive" onClick={() => submitDecision('denied')} disabled={saving}>
              Deny
            </Button>
            <Button
              onClick={() => submitDecision('approved')}
              disabled={saving || loadingAttendance || !hasFinalTimeOut || !(actualOvertimeHours > 0) || !timeOutConfirmed}
            >
              {saving ? 'Verifying...' : 'Approve'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Attendance() {
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [filterDept, setFilterDept] = useState('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [editingLog, setEditingLog] = useState(null);
  const [reviewingOvertimeLog, setReviewingOvertimeLog] = useState(null);
  const [reviewingOvertimeRequest, setReviewingOvertimeRequest] = useState(null);
  const [otBatchReviews, setOtBatchReviews] = useState({});
  const [showOtBatchFinalize, setShowOtBatchFinalize] = useState(false);
  const [otBatchHrPasscode, setOtBatchHrPasscode] = useState('');
  const [otBatchAdminPasscode, setOtBatchAdminPasscode] = useState('');
  const [otBatchError, setOtBatchError] = useState('');
  const [processingOtBatch, setProcessingOtBatch] = useState(false);
  const [openOtDate, setOpenOtDate] = useState('');
  const [rejectingLog, setRejectingLog] = useState(null);
  const [reviewingTimeInLog, setReviewingTimeInLog] = useState(null);
  const [photoLog, setPhotoLog] = useState(null);
  const [locationLog, setLocationLog] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [summaryDate, setSummaryDate] = useState(() => manilaDateString());
  const [showQuickView, setShowQuickView] = useState(false);
  const [showApprovedOtPage, setShowApprovedOtPage] = useState(false);
  const [approvedOtDetail, setApprovedOtDetail] = useState(null);
  const [approvedOtDate, setApprovedOtDate] = useState('');
  const [approvedOtEmployee, setApprovedOtEmployee] = useState('all');
  const { user: currentUser } = useAuth();
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const canCorrectAttendance = ['admin', 'super_admin'].includes(currentUser?.role);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const baseWeek = new Date();
  const activePeriodConfig = getPayrollPeriodForDate(baseWeek, activeCompany, weekOffset);
  const weekStart = activePeriodConfig.start;
  const weekEnd = activePeriodConfig.end;
  const startStr = activePeriodConfig.start_date;
  const endStr = activePeriodConfig.end_date;
  const summaryStartStr = getPayrollPeriodForDate(baseWeek, activeCompany, -103).start_date;

  const { data: employeeRecords = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', activeCompanyId],
    // Include inactive employees so historical payroll periods can still be
    // reconciled after an employee leaves the company.
    queryFn: () => entities.filter('Employee', { company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });
  // Special-rate employees use the same AttendanceLog and punch workflow as regular employees.
  // Their pay computation remains isolated in Special Rate Payroll.
  const employees = employeeRecords;

  const { data: attendanceData = { logs: [], periodLogs: [] }, isLoading: loadingLogs } = useQuery({
    queryKey: ['attendance', selectedEmployee?.id, selectedEmployee?.employee_id, activeCompanyId, startStr, endStr],
    queryFn: async () => {
      const baseFilter = {
        company_profile_id: activeCompanyId,
        date: { $gte: startStr, $lte: endStr },
      };
      const [byRecord, byEmployee] = await Promise.all([
        fetchAttendanceLogs({ ...baseFilter, employee_record_id: selectedEmployee.id }),
        fetchAttendanceLogs({ ...baseFilter, employee_id: selectedEmployee.employee_id }),
      ]);
      const all = [...new Map([...byRecord, ...byEmployee].map(log => [log.id, log])).values()];
      const selectedRecordId = String(selectedEmployee.id || '');
      const selectedEmployeeId = normalizeAttendanceKey(selectedEmployee.employee_id);
      const selectedEmployeeCode = normalizeAttendanceCode(selectedEmployee.employee_id);
      const periodLogs = all.filter(l => {
        const logCompanyId = String(l.company_profile_id || '');
        const sameCompany = !logCompanyId || logCompanyId === String(activeCompanyId);
        return sameCompany && l.date >= startStr && l.date <= endStr;
      });
      const matchedLogs = periodLogs.filter(l => {
        const logCompanyId = String(l.company_profile_id || '');
        const sameCompany = !logCompanyId || logCompanyId === String(activeCompanyId);
        const sameRecord = selectedRecordId && String(l.employee_record_id || '') === selectedRecordId;
        const sameEmployeeId =
          normalizeAttendanceKey(l.employee_id) === selectedEmployeeId ||
          normalizeAttendanceCode(l.employee_id) === selectedEmployeeCode;

        return sameCompany && (sameRecord || sameEmployeeId);
      });

      return { logs: matchedLogs, periodLogs };
    },
    enabled: !!selectedEmployee && !!activeCompanyId,
  });
  const logs = attendanceData.logs || [];

  const { data: attendanceEditAudits = [] } = useQuery({
    queryKey: ['attendanceEditAudits', selectedEmployee?.id, selectedEmployee?.employee_id, activeCompanyId],
    queryFn: async () => {
      const baseFilter = { company_profile_id: activeCompanyId, source_entity: 'AttendanceLog' };
      const [byRecord, byEmployee] = await Promise.all([
        entities.page('PasscodeAuditLog', { ...baseFilter, employee_record_id: selectedEmployee.id }, '-occurred_at', 1, 200),
        entities.page('PasscodeAuditLog', { ...baseFilter, employee_id: selectedEmployee.employee_id }, '-occurred_at', 1, 200),
      ]);
      return [...new Map(
        [...(byRecord.data || []), ...(byEmployee.data || [])].map(record => [record.id, record])
      ).values()].sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
    },
    enabled: !!selectedEmployee && !!activeCompanyId,
  });

  const { data: payrollPeriods = [] } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => entities.filter('PayrollPeriod', { company_profile_id: activeCompanyId }, '-start_date', 100),
    enabled: !!activeCompanyId,
  });

  const { data: allAttendanceLogs = [], isLoading: loadingQuickView } = useQuery({
    queryKey: ['attendanceSummary', activeCompanyId, summaryStartStr, endStr],
    queryFn: () => fetchAttendanceLogs({
      company_profile_id: activeCompanyId,
      date: { $gte: summaryStartStr, $lte: endStr },
    }),
    enabled: !!activeCompanyId,
  });

  const { data: shiftSettings = [] } = useQuery({
    queryKey: ['settings', activeCompanyId],
    queryFn: () => entities.filter('Settings', { company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const { data: overtimeRequests = [] } = useQuery({
    queryKey: ['overtimeRequests', activeCompanyId],
    queryFn: () => entities.filter('OvertimeRequest', { company_profile_id: activeCompanyId }, '-date', 500),
    enabled: !!activeCompanyId,
  });
  const pendingOvertimeRequests = overtimeRequests
    .filter(request => request.status === 'pending')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
  const pendingOvertimeRows = pendingOvertimeRequests.map(request => {
    const employee = employees.find(item =>
      String(request.employee_record_id || '') === String(item.id || '') ||
      normalizeAttendanceKey(request.employee_id) === normalizeAttendanceKey(item.employee_id)
    );
    const attendance = allAttendanceLogs.find(log =>
      log.date === request.date && (
        (request.employee_record_id && String(log.employee_record_id || '') === String(request.employee_record_id)) ||
        normalizeAttendanceKey(log.employee_id) === normalizeAttendanceKey(request.employee_id)
      )
    );
    const originalTimeOutInput = attendance?.time_out ? formatManilaTime(attendance.time_out, { hour12: false }) : '';
    const correctedTimeOutInput = otBatchReviews[request.id]?.correctedTimeOut ?? originalTimeOutInput;
    const correctedTimeOutIso = correctedTimeOutInput && attendance
      ? new Date(`${manilaDateString(attendance.time_out || attendance.date)}T${correctedTimeOutInput}:00+08:00`).toISOString()
      : null;
    const effectiveAttendance = attendance
      ? { ...attendance, time_out: correctedTimeOutIso || attendance.time_out }
      : null;
    const fallbackShift = legacyShiftTimes(attendance?.work_schedule);
    const computationOptions = {
      shiftStartTime: attendance?.shift_start_time || fallbackShift.shift_start_time,
      shiftEndTime: attendance?.shift_end_time || fallbackShift.shift_end_time,
      overtimeStartTime: attendance?.shift_overtime_start_time || fallbackShift.overtime_start_time,
      breakDurationMinutes: DEFAULT_BREAK_DURATION_MINUTES,
      paidBreakTime: enabledBooleanSetting(attendance?.shift_paid_break_time),
    };
    const hoursWorked = effectiveAttendance?.time_in && effectiveAttendance?.time_out
      ? computeCreditedHoursWorked(effectiveAttendance, computationOptions)
      : 0;
    return {
      request,
      employee,
      department: employee?.department || request.department || '—',
      attendance,
      correctedTimeOutInput,
      correctedTimeOutIso,
      timeOutChanged: Boolean(correctedTimeOutIso && correctedTimeOutInput !== originalTimeOutInput),
      hoursWorked,
      actualOvertimeHours: effectiveAttendance?.time_out
        ? computeOvertimeHours(effectiveAttendance, hoursWorked, computationOptions)
        : 0,
    };
  });
  const selectedPeriodRange = selectedPeriod === 'all'
    ? null
    : getPayrollPeriodForDate(new Date(`${String(selectedPeriod).replace(/^period-/, '')}T00:00:00`), activeCompany);
  const visiblePendingOvertimeRows = openOtDate
    ? pendingOvertimeRows.filter(row => row.request.date === openOtDate)
    : selectedPeriodRange
      ? pendingOvertimeRows.filter(row => row.request.date >= selectedPeriodRange.start_date && row.request.date <= selectedPeriodRange.end_date)
      : pendingOvertimeRows;
  const selectedEmployeeOvertimeRequests = selectedEmployee
    ? overtimeRequests.filter(request =>
      String(request.employee_record_id || '') === String(selectedEmployee.id || '') ||
      String(request.employee_id || '').toLowerCase() === String(selectedEmployee.employee_id || '').toLowerCase()
    )
    : [];

  const updateDayType = useMutation({
    mutationFn: ({ id, day_type }) => entities.update('AttendanceLog', id, { day_type }),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['attendanceSummary'] }),
    ]),
  });

  const updateLog = async (id, updates) => {
    const previousLog = logs.find(log => log.id === id);
    await entities.update('AttendanceLog', id, updates);
    if (updates.passcode_audit_action) {
      const punchLabels = {
        time_in: 'Time In(1)',
        break_time_out: 'Time Out(1)',
        break_time_in: 'Time In(2)',
        time_out: 'Time Out(2)',
        hours_worked: 'Hours',
      };
      const changes = Object.entries(punchLabels)
        .filter(([field]) => field in updates && String(previousLog?.[field] ?? '') !== String(updates[field] ?? ''))
        .map(([field, label]) => ({ field, label, before: previousLog?.[field] ?? null, after: updates[field] ?? null }));
      await entities.create('PasscodeAuditLog', {
        company_profile_id: activeCompanyId,
        source_entity: 'AttendanceLog',
        source_record_id: id,
        action: updates.passcode_audit_action,
        occurred_at: updates.passcode_audit_at,
        authorized_by: updates.passcode_audit_by,
        reason: updates.passcode_audit_reason,
        summary: updates.passcode_audit_summary,
        employee_id: selectedEmployee?.employee_id,
        employee_record_id: selectedEmployee?.id,
        employee_name: employeeFullName(selectedEmployee),
        record_date: updates.date || logs.find(log => log.id === id)?.date,
        changes,
      });
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['attendanceSummary'] }),
      qc.invalidateQueries({ queryKey: ['attendanceEditAudits'] }),
    ]);
  };

  const correctAttendanceForOvertime = async (id, updates, request) => {
    const correctedAt = new Date().toISOString();
    const reviewer = currentUser?.full_name || currentUser?.email || 'unknown';
    const finalTimeOutChanged = Object.prototype.hasOwnProperty.call(updates, 'time_out');
    await entities.update('AttendanceLog', id, updates);
    await entities.create('PasscodeAuditLog', {
      company_profile_id: activeCompanyId,
      source_entity: 'AttendanceLog',
      source_record_id: id,
      action: finalTimeOutChanged ? 'attendance_correction' : 'attendance_recalculation',
      occurred_at: correctedAt,
      authorized_by: reviewer,
      reason: finalTimeOutChanged
        ? 'Final Time Out corrected for callback overtime review'
        : 'Attendance totals recalculated after an approved attendance adjustment',
      summary: `${finalTimeOutChanged ? 'Final Time Out corrected' : 'Attendance totals recalculated'} during OT review for ${request.employee_name || request.employee_id} on ${request.date}`,
      employee_id: request.employee_id,
      employee_name: request.employee_name,
      record_date: request.date,
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['attendanceSummary'] }),
      qc.invalidateQueries({ queryKey: ['ot-review-attendance'] }),
    ]);
  };

  const updateOvertimeRequest = async (id, updates) => {
    const request = overtimeRequests.find(item => item.id === id);
    const reviewedRequest = { ...(request || {}), ...updates, id };
    await entities.update('OvertimeRequest', id, updates);
    if (updates.passcode_audit_action) {
      await entities.create('PasscodeAuditLog', {
        company_profile_id: activeCompanyId,
        source_entity: 'OvertimeRequest',
        source_record_id: id,
        action: updates.passcode_audit_action,
        occurred_at: updates.passcode_audit_at,
        authorized_by: updates.passcode_audit_by,
        reason: updates.passcode_audit_reason,
        summary: updates.passcode_audit_summary,
        employee_id: request?.employee_id,
        employee_name: request?.employee_name,
        record_date: request?.date,
      });
    }

    const requestEmployee = employees.find(employee =>
      String(employee.id || '') === String(reviewedRequest.employee_record_id || '') ||
      String(employee.employee_id || '').toLowerCase() === String(reviewedRequest.employee_id || '').toLowerCase()
    );
    const matchingLogs = allAttendanceLogs.filter(log =>
      log.time_in &&
      log.time_out &&
      employeeRequestMatchesLog(reviewedRequest, log, requestEmployee)
    );

    await Promise.all(matchingLogs.map(log => {
      const computationLog = reviewedRequest.confirmed_time_out
        ? { ...log, time_out: reviewedRequest.confirmed_time_out }
        : log;
      const computationOptions = getEmployeeLogComputationOptions(computationLog, requestEmployee);
      const hoursWorked = computeCreditedHoursWorked(computationLog, computationOptions);
      const actualOvertime = computeOvertimeHours(computationLog, hoursWorked, computationOptions);
      const requestForCredit = reviewedRequest.status === 'approved' || reviewedRequest.status === 'denied'
        ? reviewedRequest
        : null;
      const creditedOvertime = capOvertimeByApprovedRequest(actualOvertime, requestForCredit);
      const nightDiffHours = computeNightDifferentialHours(log, computationOptions);
      const lateMinutes = computeLateMinutes(log, computationOptions);

      return entities.update('AttendanceLog', log.id, {
        ...(reviewedRequest.confirmed_time_out ? { time_out: reviewedRequest.confirmed_time_out } : {}),
        hours_worked: Number(hoursWorked.toFixed(2)),
        ot_actual_hours: Number(actualOvertime.toFixed(2)),
        overtime_hours: creditedOvertime,
        ot_requested_hours: Number((reviewedRequest.approved_hours ?? reviewedRequest.requested_hours) || 0),
        ot_status: overtimeStatusForComputedHours(actualOvertime, creditedOvertime, requestForCredit),
        overtime_request_id: reviewedRequest.status === 'approved' || reviewedRequest.status === 'denied'
          ? reviewedRequest.id
          : null,
        ot_hr_approved: reviewedRequest.status === 'approved',
        ot_admin_approved: reviewedRequest.status === 'approved',
        ot_reviewed_at: reviewedRequest.reviewed_at || null,
        ot_reviewed_by: reviewedRequest.reviewed_by || null,
        ot_review_reason: reviewedRequest.review_reason || null,
        night_diff_hours: Number(nightDiffHours.toFixed(2)),
        late_minutes: lateMinutes,
      });
    }));

    qc.invalidateQueries({ queryKey: ['overtimeRequests'] });
    qc.invalidateQueries({ queryKey: ['attendance'] });
    qc.invalidateQueries({ queryKey: ['attendanceSummary'] });
  };

  const updateOtBatchReview = (requestId, updates) => {
    setOtBatchReviews(previous => ({
      ...previous,
      [requestId]: { ...(previous[requestId] || {}), ...updates },
    }));
    setOtBatchError('');
  };

  const otBatchIsComplete = visiblePendingOvertimeRows.length > 0 && visiblePendingOvertimeRows.every(({ request, attendance, actualOvertimeHours }) => {
    const review = otBatchReviews[request.id];
    if (!['approved', 'denied'].includes(review?.decision)) return false;
    if (review.decision === 'denied') return Boolean(review.reason?.trim());
    const approvedHours = Number(review.approvedHours);
    const requestedHours = Number(request.requested_hours) || 0;
    return Boolean(
      attendance?.time_out &&
      actualOvertimeHours > 0 &&
      review.timeOutConfirmed &&
      Number.isFinite(approvedHours) &&
      approvedHours > 0 &&
      approvedHours <= requestedHours &&
      approvedHours <= actualOvertimeHours + 0.005 &&
      (approvedHours >= requestedHours || review.reason?.trim())
    );
  });

  const processOtBatch = async () => {
    if (!otBatchIsComplete) return;
    if (!otBatchHrPasscode.trim() || !otBatchAdminPasscode.trim()) {
      setOtBatchError('Both the HR Officer and Admin passcodes are required.');
      return;
    }
    setProcessingOtBatch(true);
    setOtBatchError('');
    try {
      const todayCodes = await entities.filter('DailyPasscode', {
        date: manilaDateString(),
        company_profile_id: activeCompanyId,
      });
      const codesMatch = todayCodes.some(record =>
        normalizeDailyPasscode(record.passcode) === normalizeDailyPasscode(otBatchHrPasscode) &&
        normalizeDailyPasscode(record.manager_passcode) === normalizeDailyPasscode(otBatchAdminPasscode)
      );
      if (!codesMatch) throw new Error('Incorrect HR Officer or Admin passcode. Use today’s matching HR/Admin pair.');

      const reviewer = currentUser?.full_name || currentUser?.email || 'unknown';
      const reviewedAt = new Date().toISOString();
      for (const { request, attendance, correctedTimeOutIso, timeOutChanged, hoursWorked, actualOvertimeHours } of visiblePendingOvertimeRows) {
        const review = otBatchReviews[request.id];
        const approved = review.decision === 'approved';
        const approvedHours = approved ? Number(review.approvedHours) : 0;
        const attendanceTotalsChanged = Boolean(attendance) && (
          Math.abs((Number(attendance.hours_worked) || 0) - hoursWorked) > 0.005 ||
          Math.abs((Number(attendance.ot_actual_hours ?? attendance.overtime_hours) || 0) - actualOvertimeHours) > 0.005
        );
        if (approved && attendance && (timeOutChanged || attendanceTotalsChanged)) {
          await correctAttendanceForOvertime(attendance.id, {
            ...(timeOutChanged ? { time_out: correctedTimeOutIso } : {}),
            hours_worked: Number(hoursWorked.toFixed(2)),
            ot_actual_hours: Number(actualOvertimeHours.toFixed(2)),
            notes: `${attendance.notes ? `${attendance.notes}\n` : ''}${timeOutChanged ? 'Final Time Out corrected and attendance' : 'Attendance'} totals recalculated during batch OT review`,
          }, request);
        }
        await updateOvertimeRequest(request.id, {
          status: review.decision,
          approved_hours: Number(approvedHours.toFixed(2)),
          reviewed_at: reviewedAt,
          reviewed_by: reviewer,
          review_reason: review.reason?.trim() || null,
          hr_approved: approved,
          admin_approved: approved,
          time_out_confirmed: approved,
          time_out_confirmed_at: approved ? reviewedAt : null,
          confirmed_time_out: approved ? (correctedTimeOutIso || attendance.time_out) : null,
          confirmed_actual_ot_hours: approved ? actualOvertimeHours : 0,
          hr_confirmation_passcode: otBatchHrPasscode.trim(),
          admin_confirmation_passcode: otBatchAdminPasscode.trim(),
          passcode_audit_action: approved ? 'overtime_request_approved' : 'overtime_request_denied',
          passcode_audit_at: reviewedAt,
          passcode_audit_by: reviewer,
          passcode_audit_reason: review.reason?.trim() || null,
          passcode_audit_summary: `OT request ${review.decision} for ${request.employee_name || request.employee_id} on ${request.date}`,
        });
      }
      setOtBatchReviews({});
      setOtBatchHrPasscode('');
      setOtBatchAdminPasscode('');
      setShowOtBatchFinalize(false);
    } catch (batchError) {
      setOtBatchError(batchError?.message || 'Unable to process the OT reviews.');
    } finally {
      setProcessingOtBatch(false);
    }
  };

  const shiftOptions = buildShiftOptions(shiftSettings, employees, logs);
  const currentShiftSettings = shiftSettings
    .map(shift => effectiveShiftSetting(shift))
    .filter(shift => shift?.is_active !== false);
  const getDefaultShiftValue = (employee = selectedEmployee) =>
    currentShiftSettings.find(s => s.is_default)?.id || currentShiftSettings[0]?.id || employee?.work_schedule || 'day_shift';
  const getEmployeeLogShiftValue = (log, employee = selectedEmployee) =>
    log.work_schedule || resolveEmployeeWorkSchedule(employee, log?.date || manilaDateString(), getDefaultShiftValue(employee));
  const getEmployeeLogShift = (log, employee = selectedEmployee) => {
    const shiftValue = getEmployeeLogShiftValue(log, employee);
    const rawShift = shiftSettings.find(setting => String(setting.id) === String(shiftValue));
    const datedShift = effectiveShiftSetting(rawShift, log?.date || manilaDateString());
    return shiftFromAttendanceSnapshot(
      log,
      datedShift
        ? { ...datedShift, value: datedShift.id, label: datedShift.setting_name, shortLabel: datedShift.setting_name }
        : getShiftOption(shiftOptions, shiftValue, getDefaultShiftValue(employee)),
    );
  };
  const getEmployeeLogComputationOptions = (log, employee = selectedEmployee) => {
    const shift = getEmployeeLogShift(log, employee);
    const fallbackShift = legacyShiftTimes(shift.value);
    return {
      shiftStartTime: shift.shift_start_time || fallbackShift.shift_start_time,
      shiftEndTime: shift.shift_end_time || fallbackShift.shift_end_time,
      overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
      timeInAllowanceMinutes: shift.time_in_allowance_minutes || 0,
      lateGraceMinutes: shift.grace_period_minutes || 0,
      breakInGraceMinutes: shift.grace_period_minutes || 0,
      breakDurationMinutes: getBreakDurationMinutes(employee, shift),
      paidBreakTime: enabledBooleanSetting(shift.paid_break_time),
    };
  };
  const defaultShiftValue = getDefaultShiftValue();
  const getLogShiftValue = (log) => getEmployeeLogShiftValue(log);
  const getLogShift = (log) => getEmployeeLogShift(log);
  const getLogComputationOptions = (log) => getEmployeeLogComputationOptions(log);

  const computeLogSummaryMetrics = (log, employee) => {
    if (!log) {
      return {
        logs: 0,
        completed: false,
        hours: 0,
        undertimeMinutes: 0,
        overtimeHours: 0,
        nightDiffHours: 0,
      };
    }

    const computationOptions = getEmployeeLogComputationOptions(log, employee);
    const completed = Boolean(log.time_in && log.time_out);
    const hours = completed
      ? computeCreditedHoursWorked(log, computationOptions)
      : Number(log.hours_worked) || 0;
    const lateMinutes = computeLateMinutes(log, computationOptions);
    const isHalfDay = (log.day_type || '') === 'half_day';
    const missingMinutesFromHours = hours > 0 && hours < 8 ? (8 - hours) * 60 : 0;
    const manualUndertimeMinutes = Number(log.undertime_minutes) || 0;
    const undertimeMinutes = isHalfDay
      ? 0
      : manualUndertimeMinutes > 0
        ? manualUndertimeMinutes
        : Math.max(0, missingMinutesFromHours - lateMinutes);
    const computedOvertime = completed
      ? computeOvertimeHours(log, hours, computationOptions)
      : Number(log.overtime_hours) || 0;
    const approvedRequest = approvedOvertimeRequestForLog(log, overtimeRequests, employee);
    // Older approved OT flows stored the confirmed actual hours on the request
    // but did not always write the credited hours back to AttendanceLog. Keep
    // the daily/summary view aligned with payroll for those records.
    const recoveredOvertime = approvedRequest
      ? capOvertimeByApprovedRequest(
        Number(approvedRequest.confirmed_actual_ot_hours) || Number(log.ot_actual_hours) || computedOvertime,
        approvedRequest,
      )
      : 0;
    const hasRequestAwareOvertime =
      log.overtime_request_id != null ||
      approvedRequest ||
      ['approved', 'denied'].includes(log.ot_status);
    const overtimeHours = hasRequestAwareOvertime
      ? Number(log.overtime_hours) || recoveredOvertime
      : computedOvertime;
    const nightDiffHours = completed
      ? computeNightDifferentialHours(log, computationOptions)
      : Number(log.night_diff_hours) || 0;

    return {
      logs: 1,
      completed,
      hours,
      undertimeMinutes,
      overtimeHours,
      nightDiffHours,
    };
  };

  const handleApproveLog = async (log) => {
    const logShiftValue = getLogShiftValue(log);
    const logShift = getLogShift(log);
    const logEmployee = { ...selectedEmployee, work_schedule: logShiftValue };
    const missing = missingAttendanceFields(log, logEmployee, logShift, currentTime);

    if (missing.length > 0) {
      alert(`Cannot approve this attendance while ${missing.join(', ')} is still marked Missing. Please edit the missing field first.`);
      return;
    }

    const computationOptions = getLogComputationOptions(log);
    const normalizedBreaks = normalizeOvernightBreakPunches(log, computationOptions);
    const updates = log.time_in && log.time_out
      ? {
          ...normalizedBreaks.updates,
          night_diff_hours: Number(computeNightDifferentialHours(normalizedBreaks.log, computationOptions).toFixed(2)),
        }
      : {};

    const approvedAt = new Date().toISOString();
    await updateLog(log.id, {
      ...updates,
      status: 'approved',
      passcode_audit_action: 'attendance_approved',
      passcode_audit_at: approvedAt,
      passcode_audit_by: currentUser?.full_name || currentUser?.email || 'unknown',
      passcode_audit_reason: 'Attendance reviewed and approved',
      passcode_audit_summary: `Attendance approved for ${log.date}`,
    });
  };

  useEffect(() => {
    if (!selectedEmployee?.break_time || logs.length === 0) return;

    const logsNeedingBreak = logs.filter(log => {
      const logShift = getLogShift(log);
      const autoBreakOut = scheduledBreakAfterTimeIn(selectedEmployee, log.date, log.time_in, logShift);
      const shouldClearPastBreakOut = isPastAutoScheduledBreak(log, selectedEmployee, logShift);
      return log.time_in && ((autoBreakOut && !log.break_time_out) || shouldClearPastBreakOut);
    });

    if (logsNeedingBreak.length === 0) return;

    let cancelled = false;
    const applyScheduledBreaks = async () => {
      await Promise.all(logsNeedingBreak.map(log => {
        const logShift = getLogShift(log);
        const autoBreak = scheduledBreakAfterTimeIn(selectedEmployee, log.date, log.time_in, logShift);
        const shouldClearPastBreakOut = isPastAutoScheduledBreak(log, selectedEmployee, logShift);
        const updates = {
          ...(!log.break_time_out && autoBreak ? { break_time_out: autoBreak.break_time_out } : {}),
          ...(shouldClearPastBreakOut ? { break_time_out: null } : {}),
          ...(shouldClearPastBreakOut ? { break_time_in: null } : {}),
        };

        const effectiveBreakOut = shouldClearPastBreakOut ? null : updates.break_time_out || log.break_time_out;
        const effectiveBreakIn = shouldClearPastBreakOut ? null : log.break_time_in;
        if (log.time_out) {
          const computationOptions = getLogComputationOptions(log);
          const hoursWorked = computeCreditedHoursWorked({
            ...log,
            ...updates,
            break_time_out: effectiveBreakOut,
            break_time_in: effectiveBreakIn,
          }, computationOptions);
          updates.hours_worked = Number(hoursWorked.toFixed(2));
          const recomputedOvertime = computeOvertimeHours({
            ...log,
            ...updates,
            break_time_out: effectiveBreakOut,
            break_time_in: effectiveBreakIn,
          }, hoursWorked, computationOptions);
          const completedLog = {
            ...log,
            ...updates,
            break_time_out: effectiveBreakOut,
            break_time_in: effectiveBreakIn,
          };
          const approvedOtRequest = approvedOvertimeRequestForLog(completedLog, overtimeRequests, selectedEmployee);
          const cappedOvertime = capOvertimeByApprovedRequest(recomputedOvertime, approvedOtRequest);
          updates.ot_actual_hours = Number(recomputedOvertime.toFixed(2));
          updates.overtime_hours = cappedOvertime;
          updates.ot_requested_hours = approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0;
          updates.ot_status = overtimeStatusForComputedHours(recomputedOvertime, cappedOvertime, approvedOtRequest);
          updates.overtime_request_id = approvedOtRequest?.id || null;
        }

        return entities.update('AttendanceLog', log.id, updates);
      }));

      if (!cancelled) {
        qc.invalidateQueries({ queryKey: ['attendance'] });
      }
    };

    applyScheduledBreaks().catch(console.error);
    return () => { cancelled = true; };
  }, [selectedEmployee?.id, selectedEmployee?.break_time, selectedEmployee?.break_duration_minutes, selectedEmployee?.work_schedule, selectedEmployee?.shift_assignments, logs, shiftSettings, overtimeRequests, qc]);

  useEffect(() => {
    if (!selectedEmployee || logs.length === 0) return;

    const misclassifiedFinalPunches = logs.filter(log => {
      if (!log.time_in || log.time_out || log.break_time_in || !log.break_time_out) return false;

      const shiftEnd = scheduledShiftEnd(log, getLogShift(log));
      const recordedBreakOut = new Date(log.break_time_out);
      return Boolean(
        shiftEnd &&
        Number.isFinite(recordedBreakOut.getTime()) &&
        recordedBreakOut.getTime() >= shiftEnd.getTime()
      );
    });

    if (misclassifiedFinalPunches.length === 0) return;

    let cancelled = false;
    Promise.all(misclassifiedFinalPunches.map(log =>
      entities.update('AttendanceLog', log.id, {
        time_out: log.break_time_out,
        time_out_photo_url: log.break_time_out_photo_url || null,
        time_out_location: log.break_time_out_location || null,
        time_out_verification_method: log.break_time_out_verification_method || null,
        break_time_out: null,
        break_time_out_photo_url: null,
        break_time_out_location: null,
        break_time_out_verification_method: null,
      })
    ))
      .then(() => {
        if (!cancelled) qc.invalidateQueries({ queryKey: ['attendance'] });
      })
      .catch(console.error);

    return () => { cancelled = true; };
  }, [selectedEmployee?.id, logs, shiftSettings, qc]);

  useEffect(() => {
    if (!selectedEmployee || logs.length === 0 || shiftOptions.length === 0) return;

    const logsNeedingRecompute = logs
      .filter(log =>
        log.time_in &&
        log.time_out
      )
      .map(log => {
        const computationOptions = getLogComputationOptions(log);
        const normalizedBreaks = normalizeOvernightBreakPunches(log, computationOptions);
        const normalizedLog = normalizedBreaks.log;
        const hoursWorked = computeCreditedHoursWorked(normalizedLog, computationOptions);
        const overtimeHours = computeOvertimeHours(normalizedLog, hoursWorked, computationOptions);
        const approvedOtRequest = approvedOvertimeRequestForLog(normalizedLog, overtimeRequests, selectedEmployee);
        const cappedOvertime = capOvertimeByApprovedRequest(overtimeHours, approvedOtRequest);
        const nightDiffHours = computeNightDifferentialHours(normalizedLog, computationOptions);
        const lateMinutes = computeLateMinutes(normalizedLog, computationOptions);
        const nextHours = Number(hoursWorked.toFixed(2));
        const nextActualOvertime = Number(overtimeHours.toFixed(2));
        const nextOvertime = cappedOvertime;
        const nextRequestedOvertime = approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0;
        const nextNightDiff = Number(nightDiffHours.toFixed(2));
        const nextOtStatus = overtimeStatusForComputedHours(overtimeHours, cappedOvertime, approvedOtRequest);
        const isPending = log.status === 'pending';

        if (!isPending) {
          const approvedRecordNeedsRecompute =
            Object.keys(normalizedBreaks.updates).length > 0 ||
            Math.abs((Number(log.overtime_hours) || 0) - nextOvertime) > 0.005 ||
            Math.abs((Number(log.ot_requested_hours) || 0) - nextRequestedOvertime) > 0.005 ||
            Math.abs((Number(log.night_diff_hours) || 0) - nextNightDiff) > 0.005 ||
            (log.ot_status || null) !== nextOtStatus ||
            String(log.overtime_request_id || '') !== String(approvedOtRequest?.id || '');

          return approvedRecordNeedsRecompute
            ? {
                id: log.id,
                updates: {
                  ...normalizedBreaks.updates,
                  overtime_hours: nextOvertime,
                  ot_requested_hours: nextRequestedOvertime,
                  night_diff_hours: nextNightDiff,
                  ot_status: nextOtStatus,
                  overtime_request_id: approvedOtRequest?.id || null,
                },
              }
            : null;
        }

        if (
          Math.abs((Number(log.hours_worked) || 0) - nextHours) <= 0.005 &&
          Math.abs((Number(log.ot_actual_hours) || 0) - nextActualOvertime) <= 0.005 &&
          Math.abs((Number(log.overtime_hours) || 0) - nextOvertime) <= 0.005 &&
          Math.abs((Number(log.ot_requested_hours) || 0) - nextRequestedOvertime) <= 0.005 &&
          Math.abs((Number(log.night_diff_hours) || 0) - nextNightDiff) <= 0.005 &&
          (Number(log.late_minutes) || 0) === lateMinutes &&
          (log.ot_status || null) === nextOtStatus &&
          String(log.overtime_request_id || '') === String(approvedOtRequest?.id || '')
        ) {
          return null;
        }

        return {
          id: log.id,
          updates: {
            ...normalizedBreaks.updates,
            hours_worked: nextHours,
            ot_actual_hours: nextActualOvertime,
            overtime_hours: nextOvertime,
            ot_requested_hours: nextRequestedOvertime,
            night_diff_hours: nextNightDiff,
            late_minutes: lateMinutes,
            ot_status: nextOtStatus,
            overtime_request_id: approvedOtRequest?.id || null,
          },
        };
      })
      .filter(Boolean);

    if (logsNeedingRecompute.length === 0) return;

    let cancelled = false;
    Promise.all(logsNeedingRecompute.map(({ id, updates }) => entities.update('AttendanceLog', id, updates)))
      .then(() => {
        if (!cancelled) qc.invalidateQueries({ queryKey: ['attendance'] });
      })
      .catch(console.error);

    return () => { cancelled = true; };
  }, [selectedEmployee?.id, selectedEmployee?.break_duration_minutes, selectedEmployee?.work_schedule, selectedEmployee?.shift_assignments, logs, shiftSettings, overtimeRequests, qc]);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const filteredEmployees = filterDept === 'all' ? employees : employees.filter(e => e.department === filterDept);
  const normalizedEmployeeSearch = normalizeAttendanceKey(employeeSearch);
  const visibleEmployees = normalizedEmployeeSearch
    ? filteredEmployees.filter(employee => [
        employeeFullName(employee),
        employee.employee_id,
        employee.position,
        employee.department,
      ].some(value => normalizeAttendanceKey(value).includes(normalizedEmployeeSearch)))
    : filteredEmployees;
  const savedPeriodsByRange = new Map(payrollPeriods.map(period => [`${period.start_date}:${period.end_date}`, period]));
  const attendanceDates = allAttendanceLogs.map(log => log.date).filter(Boolean).sort();
  const earliestAttendanceDate = attendanceDates[0];
  const earliestSavedPeriodDate = payrollPeriods
    .map(period => period.start_date)
    .filter(Boolean)
    .sort()[0];
  const earliestPeriodDate = earliestAttendanceDate && earliestSavedPeriodDate
    ? (earliestAttendanceDate < earliestSavedPeriodDate ? earliestAttendanceDate : earliestSavedPeriodDate)
    : earliestAttendanceDate || earliestSavedPeriodDate || startStr;
  const earliestPeriod = getPayrollPeriodForDate(new Date(`${earliestPeriodDate}T00:00:00`), activeCompany);
  const displayedPayrollPeriods = [];

  for (let offset = 0; offset > -104; offset -= 1) {
    const period = getPayrollPeriodForDate(baseWeek, activeCompany, offset);
    const savedPeriod = savedPeriodsByRange.get(`${period.start_date}:${period.end_date}`);
    displayedPayrollPeriods.push({
      id: `period-${period.start_date}`,
      period_name: savedPeriod?.period_name || `Payroll Period: ${period.label}`,
      start_date: period.start_date,
      end_date: period.end_date,
      payroll_period_id: savedPeriod?.id,
    });

    if (period.start_date <= earliestPeriod.start_date) break;
  }

  const activePeriod = selectedPeriod === 'all' ? null : displayedPayrollPeriods.find(p => p.id === selectedPeriod);
  useEffect(() => {
    if (activePeriod) {
      setSummaryDate(activePeriod.start_date);
      setOpenOtDate('');
    }
  }, [activePeriod?.id]);
  const openOtCountPeriod = activePeriod || {
    period_name: `Payroll Period: ${activePeriodConfig.label}`,
    start_date: startStr,
    end_date: endStr,
  };
  const openOtCountForPeriod = pendingOvertimeRequests.filter(request =>
    request.date >= openOtCountPeriod.start_date && request.date <= openOtCountPeriod.end_date
  ).length;
  const quickViewPeriods = activePeriod
    ? [activePeriod]
    : displayedPayrollPeriods;

  const quickViewRows = quickViewPeriods.flatMap(period =>
    filteredEmployees.map(emp => {
      const empLogs = allAttendanceLogs.filter(log =>
        log.employee_id === emp.employee_id &&
        log.date >= period.start_date &&
        log.date <= period.end_date
      );
      const completedLogs = empLogs.filter(log => log.time_in && log.time_out);
      const incompleteLogs = empLogs.filter(log => log.time_in && !log.time_out);

      return {
        period,
        employee: emp,
        logs: empLogs.length,
        completed: completedLogs.length,
        incomplete: incompleteLogs.length,
        pending: empLogs.filter(log => log.status === 'pending').length,
        approved: empLogs.filter(log => log.status === 'approved').length,
        rejected: empLogs.filter(log => log.status === 'rejected').length,
        hours: empLogs.reduce((sum, log) => sum + (Number(log.hours_worked) || 0), 0),
        overtime: empLogs.reduce((sum, log) => sum + (Number(log.overtime_hours) || 0), 0),
        late: empLogs.reduce((sum, log) => sum + (Number(log.late_minutes) || 0), 0),
      };
    })
  ).sort((a, b) => {
    const periodDiff = String(b.period.start_date || '').localeCompare(String(a.period.start_date || ''));
    if (periodDiff !== 0) return periodDiff;
    return `${a.employee.last_name || ''} ${a.employee.first_name || ''}`.localeCompare(`${b.employee.last_name || ''} ${b.employee.first_name || ''}`);
  });

  const quickViewTotals = quickViewRows.reduce((totals, row) => ({
    employees: totals.employees,
    logs: totals.logs + row.logs,
    completed: totals.completed + row.completed,
    incomplete: totals.incomplete + row.incomplete,
    pending: totals.pending + row.pending,
    approved: totals.approved + row.approved,
    rejected: totals.rejected + row.rejected,
    hours: totals.hours + row.hours,
    overtime: totals.overtime + row.overtime,
    late: totals.late + row.late,
  }), { employees: filteredEmployees.length, logs: 0, completed: 0, incomplete: 0, pending: 0, approved: 0, rejected: 0, hours: 0, overtime: 0, late: 0 });

  const selectedDateLogs = allAttendanceLogs.filter(log => log.date === summaryDate);
  const dailySummaryRows = filteredEmployees
    .map(employee => {
      const employeeLogs = selectedDateLogs.filter(log => {
        const sameRecord = String(log.employee_record_id || '') === String(employee.id || '');
        const sameEmployeeId =
          normalizeAttendanceKey(log.employee_id) === normalizeAttendanceKey(employee.employee_id) ||
          normalizeAttendanceCode(log.employee_id) === normalizeAttendanceCode(employee.employee_id);
        return sameRecord || sameEmployeeId;
      });
      const primaryLog = employeeLogs[0] || null;
      const primaryShift = primaryLog ? getEmployeeLogShift(primaryLog, employee) : null;
      const expectsBreakPunches = Boolean(primaryShift?.break_start_time || employee.break_time) && primaryLog?.day_type !== 'half_day';
      const punchIssues = [];
      if (employeeLogs.length === 0) {
        punchIssues.push('No attendance log');
      } else {
        if (employeeLogs.length > 1) punchIssues.push(`${employeeLogs.length} attendance logs`);
        if (!primaryLog?.time_in) punchIssues.push('Missing Time In(1)');
        if (expectsBreakPunches && !primaryLog?.break_time_out) punchIssues.push('Missing Time Out(1)');
        if (expectsBreakPunches && !primaryLog?.break_time_in) punchIssues.push('Missing Time In(2)');
        if (!primaryLog?.time_out) punchIssues.push('Missing Time Out(2)');

        const orderedPunches = [
          ['Time In(1)', primaryLog?.time_in],
          ['Time Out(1)', primaryLog?.break_time_out],
          ['Time In(2)', primaryLog?.break_time_in],
          ['Time Out(2)', primaryLog?.time_out],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => ({ label, time: new Date(value).getTime() }))
          .filter(item => Number.isFinite(item.time));
        const invalidOrder = orderedPunches.some((item, index) =>
          index > 0 && item.time <= orderedPunches[index - 1].time
        );
        if (invalidOrder) punchIssues.push('Punches out of order');
      }
      const metrics = employeeLogs.reduce((totals, log) => {
        const item = computeLogSummaryMetrics(log, employee);
        return {
          logs: totals.logs + item.logs,
          completed: totals.completed || item.completed,
          hours: totals.hours + item.hours,
          undertimeMinutes: totals.undertimeMinutes + item.undertimeMinutes,
          overtimeHours: totals.overtimeHours + item.overtimeHours,
          nightDiffHours: totals.nightDiffHours + item.nightDiffHours,
        };
      }, {
        logs: 0,
        completed: false,
        hours: 0,
        undertimeMinutes: 0,
        overtimeHours: 0,
        nightDiffHours: 0,
      });

      return {
        employee,
        log: primaryLog,
        ...metrics,
        status: primaryLog?.status || (employeeLogs.length ? 'pending' : 'no_log'),
        punchIssues,
        needsPunchReview: punchIssues.length > 0,
        expectsBreakPunches,
      };
    })
    .sort((a, b) => {
      if (a.needsPunchReview !== b.needsPunchReview) return a.needsPunchReview ? -1 : 1;
      const aHasLog = a.logs > 0 ? 0 : 1;
      const bHasLog = b.logs > 0 ? 0 : 1;
      if (aHasLog !== bHasLog) return aHasLog - bHasLog;
      return `${a.employee.last_name || ''} ${a.employee.first_name || ''}`.localeCompare(`${b.employee.last_name || ''} ${b.employee.first_name || ''}`);
    });

  const dailySummaryTotals = dailySummaryRows.reduce((totals, row) => ({
    employees: totals.employees + 1,
    present: totals.present + (row.logs > 0 ? 1 : 0),
    complete: totals.complete + (row.completed ? 1 : 0),
    incomplete: totals.incomplete + (row.logs > 0 && !row.completed ? 1 : 0),
    noLog: totals.noLog + (row.logs === 0 ? 1 : 0),
    needsReview: totals.needsReview + (row.needsPunchReview ? 1 : 0),
    hours: totals.hours + row.hours,
    undertimeMinutes: totals.undertimeMinutes + row.undertimeMinutes,
    overtimeHours: totals.overtimeHours + row.overtimeHours,
    nightDiffHours: totals.nightDiffHours + row.nightDiffHours,
  }), {
    employees: 0,
    present: 0,
    complete: 0,
    incomplete: 0,
    noLog: 0,
    needsReview: 0,
    hours: 0,
    undertimeMinutes: 0,
    overtimeHours: 0,
    nightDiffHours: 0,
  });

  const filteredEmployeeIds = new Set(filteredEmployees.map(employee => String(employee.id || '')));
  const filteredEmployeeCodes = new Set(filteredEmployees.map(employee => normalizeAttendanceKey(employee.employee_id)));
  const approvedOvertimeSummaryRows = overtimeRequests
    .filter(request => request.status === 'approved')
    .filter(request => {
      if (!activePeriod) return true;
      return request.date >= activePeriod.start_date && request.date <= activePeriod.end_date;
    })
    .map(request => {
      const employee = employees.find(emp =>
        String(request.employee_record_id || '') === String(emp.id || '') ||
        normalizeAttendanceKey(request.employee_id) === normalizeAttendanceKey(emp.employee_id)
      );
      const log = allAttendanceLogs.find(item =>
        item.date === request.date &&
        employeeRequestMatchesLog(request, item, employee)
      );
      const approvedHours = Number((request.approved_hours ?? request.requested_hours) || 0);
      const actualOvertimeHours = Number(log?.ot_actual_hours ?? log?.overtime_hours ?? 0) || 0;
      const creditedOvertimeHours = Number(log?.overtime_hours || 0);
      const lateMinutes = Number(log?.late_minutes || 0);
      const employeeName = employee
        ? employeeFullName(employee)
        : request.employee_name || request.employee_id || 'Unknown employee';

      return {
        request,
        employee,
        log,
        employeeName,
        department: employee?.department || request.department || '—',
        approvedHours,
        actualOvertimeHours,
        creditedOvertimeHours,
        lateMinutes,
        conductedOvertime: actualOvertimeHours > 0 || creditedOvertimeHours > 0,
        period: displayedPayrollPeriods.find(period => request.date >= period.start_date && request.date <= period.end_date),
      };
    })
    .filter(row => {
      if (!row.employee) return filterDept === 'all';
      return filteredEmployeeIds.has(String(row.employee.id || '')) ||
        filteredEmployeeCodes.has(normalizeAttendanceKey(row.employee.employee_id));
    })
    .sort((a, b) =>
      String(b.request.date || '').localeCompare(String(a.request.date || '')) ||
      String(a.employeeName || '').localeCompare(String(b.employeeName || ''))
    );
  const approvedOtEmployeeOptions = [...new Map(approvedOvertimeSummaryRows.map(row => [
    normalizeAttendanceKey(row.employee?.employee_id || row.request.employee_id),
    { id: normalizeAttendanceKey(row.employee?.employee_id || row.request.employee_id), name: row.employeeName },
  ])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const approvedOvertimeFilteredRows = approvedOvertimeSummaryRows.filter(row =>
    (!approvedOtDate || row.request.date === approvedOtDate) &&
    (approvedOtEmployee === 'all' || normalizeAttendanceKey(row.employee?.employee_id || row.request.employee_id) === approvedOtEmployee)
  );
  const approvedOvertimeSummaryTotals = approvedOvertimeFilteredRows.reduce((totals, row) => ({
    count: totals.count + 1,
    approvedHours: totals.approvedHours + row.approvedHours,
    creditedHours: totals.creditedHours + row.creditedOvertimeHours,
    lateCount: totals.lateCount + (row.lateMinutes > 0 ? 1 : 0),
    conductedCount: totals.conductedCount + (row.conductedOvertime ? 1 : 0),
  }), {
    count: 0,
    approvedHours: 0,
    creditedHours: 0,
    lateCount: 0,
    conductedCount: 0,
  });

  const handleDownloadCSV = async () => {
    setDownloading(true);
    try {
      const response = await invokeFunction('exportAttendanceCSV', {
        company_profile_id: activeCompanyId,
        start_date: activePeriod?.start_date,
        end_date: activePeriod?.end_date,
      });
      
      // Handle response data
      const csv = typeof response === 'string' ? response : 
                  typeof response.csv === 'string' ? response.csv :
                  typeof response.data === 'string' ? response.data : 
                  JSON.stringify(response.data ?? response);
      
      const filename = activePeriod
        ? `attendance-${activePeriod.period_name.replace(/\s+/g, '-').toLowerCase()}.csv`
        : `attendance-summary-${new Date().toISOString().split('T')[0]}.csv`;
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('CSV export failed:', error);
    } finally {
      setDownloading(false);
    }
  };

  const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date) || (b.time_in || '').localeCompare(a.time_in || ''));
  const unapprovedOvertimeLogs = selectedEmployee
    ? sortedLogs
      .map(log => {
        let actualOvertime = Number(log.ot_actual_hours) || 0;
        const computationOptions = getLogComputationOptions(log);
        if (!actualOvertime && log.time_in && log.time_out) {
          const hoursWorked = Number(log.hours_worked) || computeCreditedHoursWorked(log, computationOptions);
          actualOvertime = computeOvertimeHours(log, hoursWorked, computationOptions);
        }
        const approvedRequest = approvedOvertimeRequestForLog(log, overtimeRequests, selectedEmployee);
        return actualOvertime > 0.005 && !approvedRequest
          ? { ...log, actualOvertime: Number(actualOvertime.toFixed(2)) }
          : null;
      })
      .filter(Boolean)
    : [];

  if (showApprovedOtPage && !selectedEmployee) {
    return (
      <div className="w-full space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowApprovedOtPage(false)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Approved OT</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Approved overtime summary and employee punch details</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={approvedOtDate}
              onChange={event => setApprovedOtDate(event.target.value)}
              aria-label="Filter approved OT by date"
              className="h-8 w-40 text-sm"
            />
            <Select value={approvedOtEmployee} onValueChange={setApprovedOtEmployee}>
              <SelectTrigger className="h-8 w-52 text-sm"><SelectValue placeholder="All Employees" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {approvedOtEmployeeOptions.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="h-8 w-48 text-sm"><SelectValue placeholder="All Periods" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {displayedPayrollPeriods.map(period => (
                  <SelectItem key={period.id} value={period.id}>{period.period_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterDept} onValueChange={setFilterDept}>
              <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(department => <SelectItem key={department} value={department}>{department}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="overflow-hidden border border-border shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Approved OT Summary</p>
              <p className="text-xs text-muted-foreground">
                {approvedOtDate || (activePeriod ? activePeriod.period_name : 'All payroll periods')} · {approvedOtEmployee === 'all' ? 'All employees' : approvedOtEmployeeOptions.find(employee => employee.id === approvedOtEmployee)?.name} · {filterDept === 'all' ? 'All departments' : filterDept}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{approvedOvertimeSummaryTotals.count} approved</Badge>
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{formatHours(approvedOvertimeSummaryTotals.approvedHours)} approved</Badge>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{approvedOvertimeSummaryTotals.lateCount} late</Badge>
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{approvedOvertimeSummaryTotals.conductedCount} conducted OT</Badge>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Employee</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Department</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Time In(1)</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Time Out(2)</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Approved OT</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Actual OT</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Late</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedOvertimeFilteredRows.map(row => (
                  <tr key={row.request.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">{row.request.date}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{row.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{row.employee?.employee_id || row.request.employee_id || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.department}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-emerald-700">{row.log?.time_in ? formatManilaTime(row.log.time_in) : 'Missing'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-blue-700">{row.log?.time_out ? formatManilaTime(row.log.time_out) : 'Missing'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatHours(row.approvedHours)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-blue-700">{formatHours(row.actualOvertimeHours)}</td>
                    <td className="px-4 py-2.5">
                      {row.lateMinutes > 0
                        ? <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">Late {formatMinutes(row.lateMinutes)}</Badge>
                        : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Not late</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setApprovedOtDetail(row)}>
                        <Eye className="h-3.5 w-3.5" /> View Details
                      </Button>
                    </td>
                  </tr>
                ))}
                {approvedOvertimeFilteredRows.length === 0 && (
                  <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">No approved OT found for this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Dialog open={!!approvedOtDetail} onOpenChange={open => !open && setApprovedOtDetail(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Employee OT Details</DialogTitle></DialogHeader>
            {approvedOtDetail && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="font-semibold">{approvedOtDetail.employeeName}</p>
                  <p className="text-xs text-muted-foreground">{approvedOtDetail.request.date} · {approvedOtDetail.department}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-muted-foreground">Time In(1)</p>
                    <p className="mt-1 font-semibold text-emerald-700">{approvedOtDetail.log?.time_in ? formatManilaTime(approvedOtDetail.log.time_in) : 'Missing'}</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs text-muted-foreground">Time Out(2)</p>
                    <p className="mt-1 font-semibold text-blue-700">{approvedOtDetail.log?.time_out ? formatManilaTime(approvedOtDetail.log.time_out) : 'Missing'}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Approved OT</p>
                    <p className="mt-1 font-semibold">{formatHours(approvedOtDetail.approvedHours)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Actual OT Conducted</p>
                    <p className="mt-1 font-semibold">{formatHours(approvedOtDetail.actualOvertimeHours)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p><span className="text-muted-foreground">Request reason:</span> {approvedOtDetail.request.reason || '—'}</p>
                  <p className="mt-2"><span className="text-muted-foreground">Review note:</span> {approvedOtDetail.request.review_reason || '—'}</p>
                  <p className="mt-2"><span className="text-muted-foreground">Reviewed by:</span> {approvedOtDetail.request.reviewed_by || '—'}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── EMPLOYEE LIST VIEW ──
  if (!selectedEmployee) {
    return (
      <div className="w-full space-y-5 p-4 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Select an employee to view their attendance</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="All Periods" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {displayedPayrollPeriods.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.period_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setShowQuickView(true)} variant="outline" className="gap-1.5">
              <Eye className="w-4 h-4" />
              Quick View
            </Button>
            <Button onClick={() => setShowApprovedOtPage(true)} variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Approved OT
            </Button>
            <Button onClick={handleDownloadCSV} disabled={downloading} variant="outline" className="gap-1.5">
              <Download className="w-4 h-4" />
              {downloading ? 'Downloading...' : 'Download CSV'}
            </Button>
            <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
            </Select>
          </div>
        </div>
        {loadingEmployees ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Card className="border border-border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground">Daily Punch Audit</p>
                    <Badge
                      variant="outline"
                      className={dailySummaryTotals.needsReview > 0
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'}
                    >
                      {dailySummaryTotals.needsReview} need review
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Review all four daily punches for {filterDept === 'all' ? 'all departments' : filterDept} · {summaryDate}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={summaryDate}
                    onChange={event => setSummaryDate(event.target.value || manilaDateString())}
                    className="h-8 w-40 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setSummaryDate(manilaDateString())}
                  >
                    Today
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 border-b border-border">
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Employees</p>
                  <p className="text-lg font-semibold text-foreground">{dailySummaryTotals.employees}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Present</p>
                  <p className="text-lg font-semibold text-emerald-700">{dailySummaryTotals.present}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Complete</p>
                  <p className="text-lg font-semibold text-foreground">{dailySummaryTotals.complete}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Incomplete</p>
                  <p className="text-lg font-semibold text-amber-700">{dailySummaryTotals.incomplete}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Work Hours</p>
                  <p className="text-lg font-semibold text-foreground">{formatHours(dailySummaryTotals.hours)}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Undertime</p>
                  <p className="text-lg font-semibold text-red-700">{formatMinutes(dailySummaryTotals.undertimeMinutes)}</p>
                </div>
                <div className="px-4 py-3 border-r border-border last:border-r-0">
                  <p className="text-xs text-muted-foreground">Overtime</p>
                  <p className="text-lg font-semibold text-blue-700">{formatHours(dailySummaryTotals.overtimeHours)}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Night Diff</p>
                  <p className="text-lg font-semibold text-violet-700">{formatHours(dailySummaryTotals.nightDiffHours)}</p>
                </div>
              </div>

              {loadingQuickView ? (
                <div className="flex justify-center py-8">
                  <div className="w-7 h-7 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/70 backdrop-blur border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Employee</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Department</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Time In(1)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Time Out(1)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Time In(2)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Time Out(2)</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Hours</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">OT</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Review</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailySummaryRows.map(row => (
                        <tr key={row.employee.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedEmployee(row.employee)}
                              className="font-medium text-foreground hover:text-primary text-left"
                            >
                              {employeeFullName(row.employee)}
                            </button>
                            <p className="text-xs text-muted-foreground">{row.employee.employee_id}</p>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{row.employee.department || '—'}</td>
                          <td className={`px-4 py-2 ${row.log?.time_in ? 'text-green-700' : 'text-amber-700 font-medium'}`}>
                            {row.log?.time_in ? formatManilaTime(row.log.time_in) : 'Missing'}
                          </td>
                          <td className={`px-4 py-2 ${row.log?.break_time_out ? 'text-orange-600' : row.expectsBreakPunches ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                            {row.log?.break_time_out ? formatManilaTime(row.log.break_time_out) : row.expectsBreakPunches ? 'Missing' : '—'}
                          </td>
                          <td className={`px-4 py-2 ${row.log?.break_time_in ? 'text-teal-700' : row.expectsBreakPunches ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                            {row.log?.break_time_in ? formatManilaTime(row.log.break_time_in) : row.expectsBreakPunches ? 'Missing' : '—'}
                          </td>
                          <td className={`px-4 py-2 ${row.log?.time_out ? 'text-blue-700' : 'text-amber-700 font-medium'}`}>
                            {row.log?.time_out ? formatManilaTime(row.log.time_out) : 'Missing'}
                          </td>
                          <td className="px-4 py-2 text-right">{formatHours(row.hours)}</td>
                          <td className="px-4 py-2 text-right text-blue-700">{formatHours(row.overtimeHours)}</td>
                          <td className="px-4 py-2">
                            {row.needsPunchReview ? (
                              <div className="flex flex-wrap gap-1">
                                {row.punchIssues.map(issue => (
                                  <Badge
                                    key={issue}
                                    variant="outline"
                                    className="bg-amber-100 text-amber-800 border-amber-200 whitespace-nowrap"
                                  >
                                    {issue}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                Complete
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {row.status === 'no_log' ? (
                              <Badge variant="outline" className="bg-muted text-muted-foreground border-border">No log</Badge>
                            ) : (
                              <Badge className={statusColors[row.status] || statusColors.pending}>
                                {row.status}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                      {dailySummaryRows.length === 0 && (
                        <tr>
                          <td colSpan={10} className="text-center py-8 text-muted-foreground">
                            No employees found for this filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="border border-amber-200 bg-amber-50/40 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Open OT for payroll period</p>
                  <p className="mt-1 text-sm text-muted-foreground">{openOtCountPeriod.start_date} to {openOtCountPeriod.end_date}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-amber-800">{openOtCountForPeriod}</p>
                  <p className="text-xs text-amber-700">request{openOtCountForPeriod === 1 ? '' : 's'} for approval</p>
                </div>
              </div>
            </Card>

            {pendingOvertimeRequests.length > 0 && (
              <Card className="border border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <p className="font-semibold text-sm text-amber-900">Open OT Requests</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={openOtDate}
                      onChange={event => setOpenOtDate(event.target.value)}
                      aria-label="Filter open OT requests by date"
                      className="h-8 w-40 bg-background text-sm"
                    />
                    {openOtDate && <Button size="sm" variant="outline" className="h-8" onClick={() => setOpenOtDate('')}>All Dates</Button>}
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                      {visiblePendingOvertimeRows.length}
                    </Badge>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1450px] text-sm">
                    <thead>
                      <tr className="border-b border-amber-200 bg-amber-100/50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Employee</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Department</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Requested</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Actual Time In(1)</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Actual Time Out(2)</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Credited Time Out(2)</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actual OT</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Approved OT</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Confirm</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reason</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePendingOvertimeRows.map(({ request, department, attendance, correctedTimeOutInput, actualOvertimeHours }) => {
                        const review = otBatchReviews[request.id] || {};
                        const requestedHours = Number(request.requested_hours) || 0;
                        const canApprove = Boolean(attendance?.time_out && actualOvertimeHours > 0);
                        return (
                          <tr key={request.id} className="border-b border-amber-200 last:border-0 align-top">
                            <td className="px-3 py-2">
                              <p className="font-medium text-foreground">{request.employee_name || request.employee_id}</p>
                              <p className="max-w-52 truncate text-xs text-muted-foreground" title={request.reason}>{request.reason || 'No request note'}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{department}</td>
                            <td className="whitespace-nowrap px-3 py-2">{request.date}</td>
                            <td className="px-3 py-2 text-right font-mono">{requestedHours.toFixed(2)}h</td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-emerald-700">
                              {actualTimeForPunch(attendance, 'time_in')
                                ? formatManilaTime(actualTimeForPunch(attendance, 'time_in'))
                                : <span className="text-red-600">Missing</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-blue-700">
                              {actualTimeForPunch(attendance, 'time_out')
                                ? formatManilaTime(actualTimeForPunch(attendance, 'time_out'))
                                : <span className="text-red-600">Missing</span>}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="time"
                                value={correctedTimeOutInput}
                                disabled={!attendance?.time_out}
                                onChange={event => updateOtBatchReview(request.id, {
                                  correctedTimeOut: event.target.value,
                                  timeOutConfirmed: false,
                                })}
                                className="h-8 w-28 text-blue-700"
                              />
                              {!attendance?.time_out && <p className="mt-1 text-xs text-red-600">Missing</p>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{actualOvertimeHours.toFixed(2)}h</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0.25"
                                max={Math.min(requestedHours, actualOvertimeHours)}
                                step="0.25"
                                disabled={review.decision === 'denied'}
                                value={review.approvedHours ?? requestedHours}
                                onChange={event => updateOtBatchReview(request.id, { approvedHours: event.target.value })}
                                className="h-8 w-24"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <label className="flex max-w-36 items-start gap-2 text-xs text-muted-foreground">
                                <Checkbox
                                  checked={review.timeOutConfirmed === true}
                                  disabled={!canApprove || review.decision === 'denied'}
                                  onCheckedChange={value => updateOtBatchReview(request.id, { timeOutConfirmed: value === true })}
                                />
                                Time Out verified
                              </label>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={review.reason || ''}
                                onChange={event => updateOtBatchReview(request.id, { reason: event.target.value })}
                                placeholder="Required for denial/reduction"
                                className="h-8 min-w-48"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-8"
                                  disabled={!canApprove}
                                  variant={review.decision === 'approved' ? 'default' : 'outline'}
                                  onClick={() => updateOtBatchReview(request.id, {
                                    decision: 'approved',
                                    approvedHours: review.approvedHours ?? requestedHours,
                                  })}
                                >Approve</Button>
                                <Button
                                  size="sm"
                                  className="h-8"
                                  variant={review.decision === 'denied' ? 'destructive' : 'outline'}
                                  onClick={() => updateOtBatchReview(request.id, { decision: 'denied', timeOutConfirmed: false })}
                                >Deny</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {visiblePendingOvertimeRows.length === 0 && (
                        <tr><td colSpan={12} className="py-10 text-center text-sm text-muted-foreground">No open OT requests for this date.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-amber-200 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-amber-900">All lines must be completed before the OT approval process can continue.</p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      Select Approve or Deny for every request, verify approved Time Outs, and provide a reason for denials or reductions. Example: 20 minutes OT = 0.33 hours.
                    </p>
                  </div>
                  <Button
                    disabled={!otBatchIsComplete}
                    onClick={() => { setOtBatchError(''); setShowOtBatchFinalize(true); }}
                  >
                    Process OT Approval
                  </Button>
                </div>
              </Card>
            )}

            {showApprovedOtPage && <Card className="border border-border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <div>
                    <p className="font-semibold text-sm text-foreground">Approved OT Summary</p>
                    <p className="text-xs text-muted-foreground">
                      {activePeriod ? `${activePeriod.period_name}: ${activePeriod.start_date} to ${activePeriod.end_date}` : 'All payroll periods'}
                      {filterDept !== 'all' ? ` · ${filterDept}` : ' · All departments'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    {approvedOvertimeSummaryTotals.count} approved
                  </Badge>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {formatHours(approvedOvertimeSummaryTotals.approvedHours)} approved
                  </Badge>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    {approvedOvertimeSummaryTotals.lateCount} late
                  </Badge>
                  <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                    {approvedOvertimeSummaryTotals.conductedCount} conducted OT
                  </Badge>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Date</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Employee</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Department</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Approved OT</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Credited OT</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Late</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">OT Conducted</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedOvertimeSummaryRows.slice(0, 12).map(row => (
                      <tr key={row.request.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 text-xs">{row.request.date}</td>
                        <td className="px-4 py-2">
                          <p className="font-medium text-foreground text-sm">{row.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{row.employee?.employee_id || row.request.employee_id || '—'}</p>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{row.department}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatHours(row.approvedHours)}</td>
                        <td className="px-4 py-2 text-right font-mono text-blue-700">{formatHours(row.creditedOvertimeHours)}</td>
                        <td className="px-4 py-2">
                          {row.lateMinutes > 0 ? (
                            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                              Late {formatMinutes(row.lateMinutes)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              Not late
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {row.conductedOvertime ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              Conducted {formatHours(row.actualOvertimeHours || row.creditedOvertimeHours)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                              No rendered OT
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {!row.log
                            ? 'No matching attendance log found.'
                            : row.lateMinutes > 0 && row.conductedOvertime
                              ? 'Employee was late and still rendered OT.'
                              : row.lateMinutes > 0
                                ? 'Employee was late; no rendered OT recorded.'
                                : row.conductedOvertime
                                  ? 'Employee was not late and rendered OT.'
                                  : 'Approved OT exists but no rendered OT is recorded.'}
                        </td>
                      </tr>
                    ))}
                    {approvedOvertimeSummaryRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-muted-foreground">
                          No approved OT found for this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {approvedOvertimeSummaryRows.length > 12 && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
                  Showing 12 of {approvedOvertimeSummaryRows.length} approved OT records.
                </p>
              )}
            </Card>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={employeeSearch}
                  onChange={event => setEmployeeSearch(event.target.value)}
                  placeholder="Search employee name, ID, or position..."
                  aria-label="Search employees"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Showing {visibleEmployees.length} of {filteredEmployees.length} employees
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleEmployees.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployee(emp)}
                  className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl hover:border-primary hover:shadow-sm transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {emp.photo_url
                      ? <img src={emp.photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                      : <User className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{employeeFullName(emp)}</p>
                    <p className="text-xs text-muted-foreground truncate">{emp.position || emp.department || emp.employee_id}</p>
                  </div>
                </button>
              ))}
              {visibleEmployees.length === 0 && (
                <p className="col-span-3 text-center py-10 text-muted-foreground text-sm">
                  {employeeSearch.trim() ? `No employees match “${employeeSearch.trim()}”.` : 'No employees found.'}
                </p>
              )}
            </div>
          </>
        )}

        <Dialog open={showQuickView} onOpenChange={setShowQuickView}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Attendance Quick View
                {activePeriod ? ` — ${activePeriod.period_name}` : ''}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Employees</p>
                  <p className="text-lg font-semibold text-foreground">{quickViewTotals.employees}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Logs</p>
                  <p className="text-lg font-semibold text-foreground">{quickViewTotals.logs}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Incomplete</p>
                  <p className="text-lg font-semibold text-amber-700">{quickViewTotals.incomplete}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Hours</p>
                  <p className="text-lg font-semibold text-foreground">{quickViewTotals.hours.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Late</p>
                  <p className="text-lg font-semibold text-foreground">{quickViewTotals.late}m</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {activePeriod ? `${activePeriod.period_name}: ${activePeriod.start_date} to ${activePeriod.end_date}` : `All payroll periods (${quickViewPeriods.length})`}
                {filterDept !== 'all' ? ` · ${filterDept}` : ' · All departments'}
              </p>

              {loadingQuickView ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Payroll Period</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Employee</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Department</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Logs</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Complete</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Incomplete</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Pending</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Approved</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Hours</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">OT</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground text-xs">Late</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quickViewRows.map(row => (
                        <tr key={`${row.period.id}-${row.employee.id}`} className="border-b border-border last:border-0">
                          <td className="px-3 py-3">
                            <p className="font-medium text-foreground">{row.period.period_name}</p>
                            <p className="text-xs text-muted-foreground">{row.period.start_date} to {row.period.end_date}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-foreground">{row.employee.first_name} {row.employee.middle_name ? `${row.employee.middle_name} ` : ''}{row.employee.last_name}</p>
                            <p className="text-xs text-muted-foreground">{row.employee.employee_id}</p>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{row.employee.department || '—'}</td>
                          <td className="px-3 py-3 text-right">{row.logs}</td>
                          <td className="px-3 py-3 text-right">{row.completed}</td>
                          <td className="px-3 py-3 text-right text-amber-700 font-medium">{row.incomplete}</td>
                          <td className="px-3 py-3 text-right">{row.pending}</td>
                          <td className="px-3 py-3 text-right">{row.approved}</td>
                          <td className="px-3 py-3 text-right">{row.hours.toFixed(2)}</td>
                          <td className="px-3 py-3 text-right">{row.overtime.toFixed(2)}</td>
                          <td className="px-3 py-3 text-right">{row.late}m</td>
                        </tr>
                      ))}
                      {quickViewRows.length === 0 && (
                        <tr>
                          <td colSpan={11} className="text-center py-10 text-muted-foreground">
                            {quickViewPeriods.length === 0 ? 'No payroll periods found.' : 'No employees found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={showOtBatchFinalize} onOpenChange={open => !processingOtBatch && setShowOtBatchFinalize(open)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Finalize OT Reviews</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You are about to process {visiblePendingOvertimeRows.length} OT request{visiblePendingOvertimeRows.length === 1 ? '' : 's'}{openOtDate ? ` dated ${openOtDate}` : ''}. Enter today’s matching HR Officer and Admin passcodes, then confirm the OT approval process.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">HR Officer Passcode</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={otBatchHrPasscode}
                    onChange={event => setOtBatchHrPasscode(event.target.value)}
                    className="mt-1 text-center font-mono tracking-widest"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Admin Passcode</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={otBatchAdminPasscode}
                    onChange={event => setOtBatchAdminPasscode(event.target.value)}
                    className="mt-1 text-center font-mono tracking-widest"
                  />
                </div>
              </div>
              {otBatchError && <p className="text-xs text-destructive">{otBatchError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={processingOtBatch} onClick={() => setShowOtBatchFinalize(false)}>Cancel</Button>
                <Button
                  disabled={processingOtBatch || !otBatchHrPasscode.trim() || !otBatchAdminPasscode.trim()}
                  onClick={processOtBatch}
                >
                  {processingOtBatch ? 'Processing…' : 'Confirm Processing'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {reviewingOvertimeRequest && (
          <OvertimeRequestReviewModal
            request={reviewingOvertimeRequest}
            currentUser={currentUser}
            activeCompanyId={activeCompanyId}
            onClose={() => setReviewingOvertimeRequest(null)}
            onConfirm={updates => updateOvertimeRequest(reviewingOvertimeRequest.id, updates)}
            onCorrectAttendance={correctAttendanceForOvertime}
          />
        )}
      </div>
    );
  }

  // ── ATTENDANCE LOG VIEW ──
  return (
    <div className="p-6 space-y-5 w-full max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedEmployee(null); setWeekOffset(0); }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{employeeFullName(selectedEmployee)}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Week Covered — {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekOffset(0)}>Current Period</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loadingLogs ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {unapprovedOvertimeLogs.length > 0 && (
            <Card className="border border-amber-200 bg-amber-50/60 shadow-sm">
              <div className="px-4 py-3 flex items-start gap-3">
                <TriangleAlert className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-amber-900">
                    OT detected without approved OT request
                  </p>
                  <p className="text-xs text-amber-800">
                    These OT hours are shown as 0.00h and are not included in payroll until HR Officer and Admin approval is recorded.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {unapprovedOvertimeLogs.slice(0, 6).map(log => (
                      <Badge key={log.id} variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                        {log.date}: actual {log.actualOvertime.toFixed(2)}h
                      </Badge>
                    ))}
                    {unapprovedOvertimeLogs.length > 6 && (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                        +{unapprovedOvertimeLogs.length - 6} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}
          {selectedEmployeeOvertimeRequests.length > 0 && (
            <Card className="border border-border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <p className="font-semibold text-sm text-foreground">OT Requests</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Date</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Requested</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Approved</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Reason</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEmployeeOvertimeRequests
                      .filter(request => request.date >= startStr && request.date <= endStr)
                      .map(request => (
                        <tr key={request.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 text-xs">{request.date}</td>
                          <td className="px-3 py-2 text-xs text-right">{Number(request.requested_hours || 0).toFixed(2)}h</td>
                          <td className="px-3 py-2 text-xs text-right">{request.status === 'approved' ? `${Number((request.approved_hours ?? request.requested_hours) || 0).toFixed(2)}h` : '—'}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={`text-xs capitalize ${overtimeStatusColors[request.status] || 'bg-amber-100 text-amber-700'}`}>
                              {request.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate">{request.reason}</td>
                          <td className="px-3 py-2 text-right">
                            {request.status === 'pending' ? (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewingOvertimeRequest(request)}>
                                Review
                              </Button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto xl:overflow-x-visible">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Date</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Shift</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Time In(1)</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Actual In</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time Out(1)</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time In(2)</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Time Out(2)</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Actual Out</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Hours</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">OT</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">ND</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Late</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Day Type</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-left px-2.5 py-3 font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedLogs.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-10 text-muted-foreground">
                    <div className="space-y-4">
                      <p>No attendance records for this week.</p>
                      <div className="mx-auto max-w-4xl rounded-lg border border-blue-200 bg-blue-50 p-3 text-left">
                        <p className="text-xs font-semibold text-blue-800">
                          No attendance rows were returned for {employeeFullName(selectedEmployee)} from {startStr} to {endStr}.
                        </p>
                      </div>
                    </div>
                  </td></tr>
                ) : (
	                  sortedLogs.map(log => {
	                    const logWorkSchedule = getLogShiftValue(log);
	                    const logShift = getLogShift(log);
	                    const computationOptions = getLogComputationOptions(log);
	                    const normalizedBreakLog = normalizeOvernightBreakPunches(log, computationOptions).log;
	                    const displayLog = normalizeOvernightTimeInForDisplay(normalizedBreakLog, logShift);
	                    const logEmployee = { ...selectedEmployee, work_schedule: logWorkSchedule };
	                    const missingFields = missingAttendanceFields(log, logEmployee, logShift, currentTime);
	                    const breakTimeInMissing = missingFields.includes('Time In(2)');
	                    const finalTimeOutMissing = missingFields.includes('Time Out(2)');
                      const approvalBlocked = missingFields.length > 0;
	                    const timeInPhoto = attendancePhotoItem(displayLog, 'time_in');
	                    const breakOutPhoto = attendancePhotoItem(displayLog, 'break_time_out');
	                    const breakInPhoto = attendancePhotoItem(displayLog, 'break_time_in');
	                    const timeOutPhoto = attendancePhotoItem(displayLog, 'time_out');
	                    const timeInLocation = attendanceLocationItem(displayLog, 'time_in');
	                    const breakOutLocation = attendanceLocationItem(displayLog, 'break_time_out');
	                    const breakInLocation = attendanceLocationItem(displayLog, 'break_time_in');
	                    const timeOutLocation = attendanceLocationItem(displayLog, 'time_out');
                      const actualTimeIn = actualTimeForPunch(displayLog, 'time_in');
                      const actualTimeOut = actualTimeForPunch(displayLog, 'time_out');
	                    const approvedOtRequest = approvedOvertimeRequestForLog(log, overtimeRequests, selectedEmployee);
	                    // Show approved OT immediately even when a legacy approval
	                    // left AttendanceLog.overtime_hours at zero. This mirrors
	                    // the payroll recovery path and avoids hiding valid OT.
	                    const confirmedActualOvertime = Number(approvedOtRequest?.confirmed_actual_ot_hours) || 0;
	                    const actualOvertimeHours = Number(log.ot_actual_hours || log.overtime_hours || confirmedActualOvertime || 0);
	                    const recoveredCreditedOvertime = approvedOtRequest
	                      ? capOvertimeByApprovedRequest(
	                        confirmedActualOvertime || actualOvertimeHours,
	                        approvedOtRequest,
	                      )
	                      : 0;
	                    const creditedOvertimeHours = Number(log.overtime_hours) || recoveredCreditedOvertime;
	                    const hasUnapprovedOvertime = actualOvertimeHours > 0.005 && creditedOvertimeHours <= 0.005 && !log.overtime_request_id;
	                    const displayedNightDiffHours = displayLog.time_in && displayLog.time_out
	                      ? Number(computeNightDifferentialHours(displayLog, computationOptions).toFixed(2))
	                      : Number(log.night_diff_hours) || 0;
	                    const logAudits = attendanceEditAudits.filter(audit => String(audit.source_record_id || '') === String(log.id));
	                    const editAudits = logAudits.filter(audit => ['attendance_correction', 'attendance_manual_edit'].includes(audit.action));
	                    const approvalAudit = logAudits.find(audit => audit.action === 'attendance_approved');
	                    const editedFields = new Set(editAudits.flatMap(audit =>
	                      Array.isArray(audit.changes) && audit.changes.length > 0
	                        ? audit.changes.map(change => change.field)
	                        : ['time_in', 'break_time_out', 'break_time_in', 'time_out', 'hours_worked']
	                    ));
	                    const editedTimeClass = (field, normalClass) => editedFields.has(field)
	                      ? 'rounded bg-red-100 px-1 font-black text-red-700 ring-1 ring-red-500'
	                      : normalClass;
	                    return (
                      <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-2.5 py-3 text-muted-foreground text-xs">{log.date}</td>
                        <td className="px-2.5 py-3 hidden md:table-cell">
                          <span className="inline-flex min-h-7 items-center rounded-md border border-border bg-muted/30 px-2.5 text-xs text-foreground">
                            {logShift.shortLabel || logShift.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-3">
                          <div className="inline-flex items-center gap-1.5">
                            {displayLog.time_in
                              ? <span className={editedTimeClass('time_in', 'text-green-600 text-xs')}>{formatManilaTime(displayLog.time_in)}</span>
                              : <span className="text-amber-500 font-medium text-xs">Missing</span>}
                            <InlinePhotoButton photoItem={timeInPhoto} log={log} onView={setPhotoLog} />
                            <InlineVerificationMethodIcon photoItem={timeInPhoto} />
                            <InlineLocationButton locationItem={timeInLocation} log={log} onView={setLocationLog} />
                          </div>
                          {log.record_source === 'OFFLINE_SYSTEM_DOWN_SYNC' && <p className="mt-1 text-[10px] font-medium text-blue-700" title={log.synchronized_at ? `Synchronized ${formatManilaDateTime(log.synchronized_at)}` : ''}>Offline sync</p>}
                        </td>
                        <td className="px-2.5 py-3 text-xs text-muted-foreground">
                          {actualTimeIn ? formatManilaTime(actualTimeIn) : '—'}
                        </td>
                        <td className="px-2.5 py-3 hidden lg:table-cell">
                          <div className="inline-flex items-center gap-1.5">
                            {displayLog.break_time_out
                              ? <span className={editedTimeClass('break_time_out', 'text-orange-500 text-xs')}>{formatManilaTime(displayLog.break_time_out)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                            <InlinePhotoButton photoItem={breakOutPhoto} log={log} onView={setPhotoLog} />
                            <InlineVerificationMethodIcon photoItem={breakOutPhoto} />
                            <InlineLocationButton locationItem={breakOutLocation} log={log} onView={setLocationLog} />
                          </div>
                        </td>
                        <td className="px-2.5 py-3 hidden lg:table-cell">
                          <div className="inline-flex items-center gap-1.5">
                            {displayLog.break_time_in
                              ? <span className={editedTimeClass('break_time_in', 'text-teal-600 text-xs')}>{formatManilaTime(displayLog.break_time_in)}</span>
                              : breakTimeInMissing
                                ? <span className="text-amber-500 font-medium text-xs">Missing</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                            <InlinePhotoButton photoItem={breakInPhoto} log={log} onView={setPhotoLog} />
                            <InlineVerificationMethodIcon photoItem={breakInPhoto} />
                            <InlineLocationButton locationItem={breakInLocation} log={log} onView={setLocationLog} />
                          </div>
                        </td>
	                        <td className="px-2.5 py-3">
	                          <div className="inline-flex items-center gap-1.5">
	                            {log.time_out
	                              ? <span className={editedTimeClass('time_out', 'text-blue-600 text-xs')}>{formatManilaTime(log.time_out)}</span>
	                              : finalTimeOutMissing
	                                ? <span className="text-amber-500 font-medium text-xs">Missing</span>
	                                : <span className="text-muted-foreground text-xs">—</span>}
                              <InlinePhotoButton photoItem={timeOutPhoto} log={log} onView={setPhotoLog} />
                              <InlineVerificationMethodIcon photoItem={timeOutPhoto} />
                              <InlineLocationButton locationItem={timeOutLocation} log={log} onView={setLocationLog} />
	                          </div>
	                        </td>
                        <td className="px-2.5 py-3 text-xs text-muted-foreground">
                          {actualTimeOut ? formatManilaTime(actualTimeOut) : '—'}
                        </td>
                        <td className="px-2.5 py-3 text-xs">
                          <div className="flex flex-col items-start gap-1">
                            <span className={editAudits.length > 0 ? 'font-black text-red-700' : ''}>{log.hours_worked || '—'}</span>
                            {editAudits.length > 0 && (
                              <Badge
                                variant="outline"
                                className="border-red-500 bg-red-100 px-1 py-0 text-[9px] font-bold text-red-700"
                                title={`Edited by: ${[...new Set(editAudits.map(audit => audit.authorized_by).filter(Boolean))].join(', ') || 'Unknown'}${approvalAudit ? `; approved by ${approvalAudit.authorized_by}` : ''}`}
                              >
                                {editAudits.length} edit{editAudits.length === 1 ? '' : 's'} · {approvalAudit || log.status === 'approved' ? 'approved' : 'review'}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-3 text-xs hidden md:table-cell">
                          {actualOvertimeHours > 0 || creditedOvertimeHours > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md"
                              title={`Actual OT: ${actualOvertimeHours.toFixed(2)}h`}
                            >
                              <span>{creditedOvertimeHours.toFixed(2)}h</span>
                              {hasUnapprovedOvertime && (
                                <Badge
                                  variant="outline"
                                  className="px-1 py-0 text-[9px] bg-amber-100 text-amber-800 border-amber-200"
                                >
                                  no approval
                                </Badge>
                              )}
	                              {(log.ot_status || (approvedOtRequest && creditedOvertimeHours > 0 ? 'approved' : null)) && (
	                                <Badge
	                                  variant="outline"
	                                  className={`px-1 py-0 text-[9px] ${overtimeStatusColors[log.ot_status || 'approved']}`}
	                                >
	                                  {log.ot_status || 'approved'}
	                                </Badge>
	                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-2.5 py-3 text-xs hidden md:table-cell">{displayedNightDiffHours > 0 ? `${displayedNightDiffHours}h` : '—'}</td>
                        <td className="px-2.5 py-3 text-xs hidden md:table-cell">{log.late_minutes > 0 ? `${log.late_minutes}m` : '—'}</td>
                        <td className="px-2.5 py-3 hidden lg:table-cell">
                          <Select value={log.day_type || 'regular'} onValueChange={v => updateDayType.mutate({ id: log.id, day_type: v })}>
                            <SelectTrigger className="h-7 text-xs w-28 xl:w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="regular">Regular</SelectItem>
                              <SelectItem value="half_day">Half Day</SelectItem>
                              <SelectItem value="rest_day">Rest Day</SelectItem>
                              <SelectItem value="regular_holiday">Regular Holiday</SelectItem>
                              <SelectItem value="special_holiday">Special Non-Working Holiday</SelectItem>
                              <SelectItem value="special_working_holiday">Special Working Holiday</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2.5 py-3">
                          <Badge variant="outline" className={`text-xs capitalize ${statusColors[log.status] || ''}`}>{log.status}</Badge>
                        </td>
                        <td className="px-2.5 py-3">
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                              title={canCorrectAttendance ? 'Correct attendance (recomputes hours & overtime)' : 'Edit missing attendance time'}
                              onClick={() => setEditingLog(log)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1 border-blue-200 px-2 text-[10px] text-blue-700 hover:bg-blue-50"
                              title={log.time_in ? 'Review immutable Time In (1)' : 'Request adjustment for missing Time In (1)'}
                              onClick={() => setReviewingTimeInLog(log)}>
                              <Eye className="w-3.5 h-3.5" />
                              Time In Review
                            </Button>
                            <Button size="icon" variant="ghost"
                              className={`h-7 w-7 ${approvalBlocked ? 'text-muted-foreground opacity-50 cursor-not-allowed' : 'text-green-600 hover:bg-green-50'}`}
                              title={approvalBlocked ? `Cannot approve while ${missingFields.join(', ')} is Missing` : 'Approve attendance'}
                              disabled={approvalBlocked}
                              onClick={() => handleApproveLog(log)}>
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="sr-only">Approve attendance</span>
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              title="Reject attendance"
                              onClick={() => setRejectingLog(log)}>
                              <XCircle className="w-4 h-4" />
                              <span className="sr-only">Reject attendance</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </Card>
        </div>
      )}

      {editingLog && (
        <EditAttendanceModal
          log={editingLog}
          employee={selectedEmployee}
          defaultWorkSchedule={getLogShiftValue(editingLog)}
          shiftOptions={shiftOptions}
          resolvedShift={getLogShift(editingLog)}
          overtimeRequests={overtimeRequests}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          canCorrectAttendance={canCorrectAttendance}
          onClose={() => setEditingLog(null)}
          onSave={updateLog}
        />
      )}

      {rejectingLog && (
        <RejectAttendanceModal
          log={rejectingLog}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          onClose={() => setRejectingLog(null)}
          onConfirm={async (updates) => {
            await updateLog(rejectingLog.id, updates);
            setRejectingLog(null);
          }}
        />
      )}

      {reviewingTimeInLog && (
        <TimeInReviewModal
          log={reviewingTimeInLog}
          currentUser={currentUser}
          onClose={() => setReviewingTimeInLog(null)}
          onConfirm={async updates => {
            await updateLog(reviewingTimeInLog.id, updates);
            setReviewingTimeInLog(null);
          }}
        />
      )}

      {reviewingOvertimeLog && (
        <OvertimeReviewModal
          log={reviewingOvertimeLog}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          onClose={() => setReviewingOvertimeLog(null)}
          onConfirm={updates => updateLog(reviewingOvertimeLog.id, updates)}
        />
      )}

      {reviewingOvertimeRequest && (
        <OvertimeRequestReviewModal
          request={reviewingOvertimeRequest}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          onClose={() => setReviewingOvertimeRequest(null)}
          onConfirm={updates => updateOvertimeRequest(reviewingOvertimeRequest.id, updates)}
          onCorrectAttendance={correctAttendanceForOvertime}
        />
      )}

      <Dialog open={!!photoLog} onOpenChange={(open) => !open && setPhotoLog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Employee Capture Photo</DialogTitle>
          </DialogHeader>
          {photoLog && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border border-border bg-muted">
                <img src={photoLog.photoUrl} alt="Employee attendance capture" className="w-full max-h-[70vh] object-contain" />
                <div className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2.5 py-1.5 text-xs font-medium text-white shadow">
                  Actual photo taken: {photoLog.actualPunchValue ? formatManilaDateTime(photoLog.actualPunchValue) : 'Unavailable'}
                </div>
              </div>
              {hasMaterialPunchTimeMismatch(photoLog) && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Audit warning: the actual capture time differs from the credited attendance time.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground">Employee</p>
                  <p>{photoLog.log?.employee_name || selectedEmployee?.first_name || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Date</p>
                  <p>{photoLog.log?.date || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Transaction</p>
                  <p>{photoLog.label || 'Attendance'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Credited Time</p>
                  <p>{photoLog.timeValue ? formatManilaTime(photoLog.timeValue) : '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Actual Photo Taken</p>
                  <p>{photoLog.actualPunchValue ? formatManilaDateTime(photoLog.actualPunchValue) : '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Verification</p>
                  <p>
                    {['qr_face', 'qr_photo_liveness'].includes(photoLog.verificationMethod)
                      ? 'QR Code + Photo'
                      : photoLog.verificationMethod === 'face_verification'
                        ? 'Face Verification'
                        : '—'}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => window.open(photoLog.photoUrl, '_blank', 'noopener,noreferrer')}>
                Open Full Size
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!locationLog} onOpenChange={(open) => !open && setLocationLog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attendance GPS Location</DialogTitle>
          </DialogHeader>
          {locationLog && (
            <div className="space-y-3">
              <div className={`rounded-xl border p-4 ${hasCoordinates(locationLog.location) ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-center gap-2">
                  <MapPin className={`w-5 h-5 ${hasCoordinates(locationLog.location) ? 'text-emerald-700' : 'text-amber-700'}`} />
                  <p className={`text-sm font-semibold ${hasCoordinates(locationLog.location) ? 'text-emerald-900' : 'text-amber-900'}`}>
                    {hasCoordinates(locationLog.location) ? 'GPS captured' : 'GPS not captured'}
                  </p>
                </div>
                {!hasCoordinates(locationLog.location) && (
                  <p className="mt-2 text-xs text-amber-800">
                    {locationLog.location?.error || locationLog.location?.status || 'Location was unavailable for this punch.'}
                  </p>
                )}
              </div>
              {hasMaterialPunchTimeMismatch(locationLog) && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Audit warning: the GPS capture time differs from the credited attendance time.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground">Employee</p>
                  <p>{locationLog.log?.employee_name || selectedEmployee?.first_name || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Date</p>
                  <p>{locationLog.log?.date || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Transaction</p>
                  <p>{locationLog.label || 'Attendance'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Credited Time</p>
                  <p>{locationLog.timeValue ? formatManilaTime(locationLog.timeValue) : '—'}</p>
                </div>
                {hasCoordinates(locationLog.location) && (
                  <>
                    <div>
                      <p className="font-medium text-foreground">Latitude</p>
                      <p>{locationLog.location.latitude}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Longitude</p>
                      <p>{locationLog.location.longitude}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Accuracy</p>
                      <p>{locationLog.location.accuracy ? `${locationLog.location.accuracy} m` : '—'}</p>
                    </div>
                  </>
                )}
                <div>
                  <p className="font-medium text-foreground">Captured</p>
                  <p>{locationLog.location?.captured_at ? formatManilaDateTime(locationLog.location.captured_at) : '—'}</p>
                </div>
              </div>

              {hasCoordinates(locationLog.location) && (
                <Button variant="outline" className="w-full" onClick={() => window.open(locationMapsUrl(locationLog.location), '_blank', 'noopener,noreferrer')}>
                  Open in Google Maps
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
