// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import { computeCreditedHoursWorked, computeOvertimeHours } from '@/lib/payrollUtils';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, ArrowLeft, User, Pencil, Camera, KeyRound, Download, Eye, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

const employeeFullName = (employee) =>
  [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');
const normalizeAttendanceKey = (value) => String(value || '').trim().toLowerCase();
const normalizeAttendanceCode = (value) =>
  normalizeAttendanceKey(value)
    .replace(/-payrollph$/i, '')
    .replace(/[^a-z0-9]/g, '');
const nameTokens = (value) =>
  normalizeAttendanceKey(value)
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9]/g, ''))
    .filter(token => token.length > 1);
const employeeNameMatchesAttendanceLog = (employee, log) => {
  const logName = normalizeAttendanceKey(log?.employee_name);
  if (!logName) return false;

  const nameCandidates = [
    employeeFullName(employee),
    [employee?.first_name, employee?.last_name].filter(Boolean).join(' '),
    [employee?.first_name, employee?.middle_name].filter(Boolean).join(' '),
  ].map(normalizeAttendanceKey).filter(Boolean);

  if (nameCandidates.some((name) => logName === name)) return true;

  const firstName = normalizeAttendanceKey(employee?.first_name);
  const lastName = normalizeAttendanceKey(employee?.last_name);
  if (firstName && lastName && logName.includes(firstName) && logName.includes(lastName)) return true;

  const selectedTokens = new Set(nameTokens(employeeFullName(employee)));
  const logTokens = nameTokens(logName);
  const overlap = logTokens.filter(token => selectedTokens.has(token));
  const firstToken = nameTokens(employee?.first_name)[0];

  return Boolean(firstToken && logTokens.includes(firstToken) && overlap.length >= 2);
};
const DEFAULT_BREAK_DURATION_MINUTES = 60;
const BREAK_TIME_IN_MISSING_AFTER_MINUTES = 120;
const FINAL_TIME_OUT_MISSING_AFTER_MINUTES = 10;

const legacyShiftOptions = [
  { value: 'day_shift', label: 'Day Shift', shortLabel: 'Day' },
  { value: 'night_shift', label: 'Night Shift', shortLabel: 'Night' },
];

function buildShiftOptions(shiftSettings = [], employees = [], logs = []) {
  const configuredOptions = [...shiftSettings]
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

function getBreakDurationMinutes(employee) {
  const minutes = Number(employee?.break_duration_minutes);
  return [30, 60].includes(minutes) ? minutes : DEFAULT_BREAK_DURATION_MINUTES;
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

function scheduledBreak(employee, date) {
  if (!employee?.break_time) return null;

  const [breakHour] = employee.break_time.split(':').map(Number);
  const breakDate = employee.work_schedule === 'night_shift' && breakHour < 12
    ? format(addDays(new Date(`${date}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : date;
  return {
    break_time_out: new Date(`${breakDate}T${employee.break_time}:00+08:00`).toISOString(),
  };
}

function scheduledBreakAfterTimeIn(employee, date, timeInValue) {
  const autoBreak = scheduledBreak(employee, date);
  const timeIn = timeInValue ? new Date(timeInValue) : null;
  const breakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !Number.isFinite(timeIn.getTime()) || !Number.isFinite(breakOut.getTime())) {
    return null;
  }

  return breakOut.getTime() > timeIn.getTime() ? autoBreak : null;
}

function isPastAutoScheduledBreak(log, employee) {
  const autoBreak = scheduledBreak(employee, log?.date);
  const timeIn = log?.time_in ? new Date(log.time_in) : null;
  const breakOut = log?.break_time_out ? new Date(log.break_time_out) : null;
  const scheduledBreakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !scheduledBreakOut) return false;
  if (![timeIn, breakOut, scheduledBreakOut].every(date => Number.isFinite(date.getTime()))) return false;

  return breakOut.getTime() === scheduledBreakOut.getTime() && breakOut.getTime() <= timeIn.getTime();
}

function scheduledBreakIn(employee, date) {
  if (!employee?.break_time) return null;

  const [breakHour] = employee.break_time.split(':').map(Number);
  const breakDate = employee.work_schedule === 'night_shift' && breakHour < 12
    ? format(addDays(new Date(`${date}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : date;
  const breakIn = addBreakDuration(employee.break_time, getBreakDurationMinutes(employee));
  const breakInDate = breakIn.crossesMidnight
    ? format(addDays(new Date(`${breakDate}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
}

function isBreakTimeInMissing(log, employee, now = new Date()) {
  if (!log?.time_in || log.break_time_in || !employee?.break_time) return false;

  const autoBreak = scheduledBreakAfterTimeIn(employee, log.date, log.time_in);
  if (!autoBreak?.break_time_out) return false;

  const missingAfter = new Date(autoBreak.break_time_out);
  missingAfter.setMinutes(missingAfter.getMinutes() + BREAK_TIME_IN_MISSING_AFTER_MINUTES);

  return now.getTime() >= missingAfter.getTime();
}

function legacyShiftTimes(value) {
  if (value === 'night_shift') return { shift_start_time: '20:00', shift_end_time: '05:00', overtime_start_time: '05:30' };
  return { shift_start_time: '08:00', shift_end_time: '17:00', overtime_start_time: '17:30' };
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

const punchPhotoFields = [
  { action: 'time_in', label: 'Time In(1)', timeField: 'time_in', photoField: 'time_in_photo_url', locationField: 'time_in_location' },
  { action: 'break_time_out', label: 'Time Out(1)', timeField: 'break_time_out', photoField: 'break_time_out_photo_url', locationField: 'break_time_out_location' },
  { action: 'break_time_in', label: 'Time In(2)', timeField: 'break_time_in', photoField: 'break_time_in_photo_url', locationField: 'break_time_in_location' },
  { action: 'time_out', label: 'Time Out(2)', timeField: 'time_out', photoField: 'time_out_photo_url', locationField: 'time_out_location' },
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
    };
  }

  if (log.photo_url && (log.photo_action === action || (!log.photo_action && latestPunchAction(log) === action))) {
    return {
      ...punch,
      photoUrl: log.photo_url,
      timeValue: log[punch.timeField],
      legacy: true,
    };
  }

  return null;
}

function attendanceLocationItem(log, action) {
  const punch = punchPhotoFields.find(item => item.action === action);
  const location = punch?.locationField ? log[punch.locationField] : null;
  if (!punch || !location) return null;

  return {
    ...punch,
    location,
    timeValue: log[punch.timeField],
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
  filter(entity, filter = {}, sort, limit) {
    return requestJson(entityUrl(entity, { filter, sort, limit }));
  },
  update(entity, id, data) {
    return requestJson(entityUrl(entity), {
      method: 'PATCH',
      body: JSON.stringify({ id, data }),
    });
  },
};

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
function EditAttendanceModal({ log, employee, defaultWorkSchedule, shiftOptions, onClose, onSave, currentUser, activeCompanyId, canCorrectAttendance = false }) {
  const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

  // Step 1: passcode gate. Step 2: actual edit form.
  const [step, setStep] = useState('passcode'); // 'passcode' | 'edit'
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [reason, setReason] = useState('');
  const [timeIn, setTimeIn] = useState(log.time_in ? format(new Date(log.time_in), "HH:mm") : '');
  const [breakOut, setBreakOut] = useState(log.break_time_out ? format(new Date(log.break_time_out), "HH:mm") : '');
  const [breakIn, setBreakIn] = useState(log.break_time_in ? format(new Date(log.break_time_in), "HH:mm") : '');
  const [timeOut, setTimeOut] = useState(log.time_out ? format(new Date(log.time_out), "HH:mm") : '');
  const [workSchedule, setWorkSchedule] = useState(log.work_schedule || defaultWorkSchedule || 'day_shift');
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('idle'); // idle | capturing | done | error
  const [saving, setSaving] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Only super_admin/admin may edit time on an HR-approved log. Everyone else
  // (with the daily passcode) may only fill in missing punches, and only while
  // the log is still pending — once HR approves it, non-admins are locked out.
  const isApprovedLog = log.status === 'approved';
  const canEditTimeIn = canCorrectAttendance || (!isApprovedLog && !log.time_in);
  const canEditBreakOut = canCorrectAttendance || (!isApprovedLog && !log.break_time_out);
  const canEditBreakIn = canCorrectAttendance || (!isApprovedLog && !log.break_time_in);
  const canEditTimeOut = canCorrectAttendance || (!isApprovedLog && !log.time_out);

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
    const match = records.find(r => r.passcode === passcodeInput.trim() || r.manager_passcode === passcodeInput.trim());
    if (match) {
      setStep('edit');
    } else {
      setPasscodeError('Incorrect passcode. Please check with your administrator.');
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
      const [h, m] = timeStr.split(':');
      const dt = existingISO ? new Date(existingISO) : new Date(log.date);
      dt.setHours(parseInt(h), parseInt(m), 0, 0);
      return dt.toISOString();
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
    if (workSchedule !== (log.work_schedule || defaultWorkSchedule || 'day_shift')) {
      updates.work_schedule = workSchedule;
    }

    const pick = (key) => (key in updates ? updates[key] : log[key]);
    const effTimeIn = pick('time_in');
    const effBreakOut = pick('break_time_out');
    const effBreakIn = pick('break_time_in');
    const effTimeOut = pick('time_out');
    const timesChanged = ['time_in', 'break_time_out', 'break_time_in', 'time_out']
      .some((key) => key in updates);

    if (effTimeIn && effTimeOut) {
      const selectedShift = getShiftOption(shiftOptions, workSchedule, defaultWorkSchedule || 'day_shift');
      const fallbackShift = legacyShiftTimes(selectedShift.value);
      const hrs = computeCreditedHoursWorked({
        ...log,
        time_in: effTimeIn,
        break_time_out: effBreakOut,
        break_time_in: effBreakIn,
        time_out: effTimeOut,
      }, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        timeInAllowanceMinutes: selectedShift.time_in_allowance_minutes || 0,
        breakInGraceMinutes: selectedShift.grace_period_minutes || 0,
        breakDurationMinutes: getBreakDurationMinutes(employee),
      });
      updates.hours_worked = parseFloat(hrs.toFixed(2));
      updates.overtime_hours = computeOvertimeHours({
        ...log,
        time_in: effTimeIn,
        break_time_out: effBreakOut,
        break_time_in: effBreakIn,
        time_out: effTimeOut,
      }, hrs, {
        shiftStartTime: selectedShift.shift_start_time || fallbackShift.shift_start_time,
        overtimeStartTime: selectedShift.overtime_start_time || fallbackShift.overtime_start_time,
        breakInGraceMinutes: selectedShift.grace_period_minutes || 0,
        breakDurationMinutes: getBreakDurationMinutes(employee),
      });
    } else if (timesChanged) {
      // Can no longer compute a full day (e.g. a punch was cleared) — zero it out.
      updates.hours_worked = 0;
      updates.overtime_hours = 0;
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
    const recomputeNote = 'hours_worked' in updates
      ? ` | Recomputed: ${updates.hours_worked}h worked, ${updates.overtime_hours}h OT`
      : '';
    const previousNotes = log.notes ? `${log.notes}\n` : '';
    updates.notes = `${previousNotes}${editKind} by ${currentUser?.full_name || currentUser?.email || 'unknown'} on ${format(new Date(), 'yyyy-MM-dd HH:mm')} | Reason: ${reason.trim()}${recomputeNote}${photoUrl ? ` | Audit photo: ${photoUrl}` : ''}`;

    await onSave(log.id, updates);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
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
                Manual attendance edits require the administrator's daily passcode. This ensures all modifications are authorized and auditable.
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
                ? 'Admins can correct any punch, including on approved records. Hours worked and overtime are recomputed automatically when saved. Clear a field to remove a punch.'
                : 'Only missing time fields can be filled in. Shift can be corrected for this attendance record.'}
            </p>

            <div>
              <label className="text-sm font-medium text-foreground">Shift</label>
              <Select value={workSchedule} onValueChange={setWorkSchedule}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select shift" />
                </SelectTrigger>
                <SelectContent>
                  {shiftOptions.map(shift => (
                    <SelectItem key={shift.value} value={shift.value}>{shift.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Time In(1)</label>
                <Input type="time" value={timeIn} onChange={e => setTimeIn(e.target.value)}
                  disabled={!canEditTimeIn} className={`mt-1 ${!canEditTimeIn ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditTimeIn ? <p className="text-xs text-muted-foreground mt-0.5">{log.time_in ? 'Already recorded' : 'Locked — approved by HR'}</p>
                  : (canCorrectAttendance && log.time_in && <p className="text-xs text-amber-600 mt-0.5">Recorded — editable</p>)}
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

            <div className="flex justify-end gap-2 pt-1">
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

function ShiftPasscodeModal({ log, shift, currentUser, activeCompanyId, onClose, onConfirm }) {
  const TODAY_STR = format(new Date(), 'yyyy-MM-dd');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const verifyPasscode = async () => {
    if (!passcodeInput.trim()) {
      setPasscodeError('Please enter the daily passcode.');
      return;
    }

    setVerifying(true);
    setPasscodeError('');
    try {
      const records = await entities.filter('DailyPasscode', { date: TODAY_STR, company_profile_id: activeCompanyId });
      const match = records.find(r => r.passcode === passcodeInput.trim() || r.manager_passcode === passcodeInput.trim());
      if (!match) {
        setPasscodeError('Incorrect passcode. Please check with your administrator.');
        return;
      }

      await onConfirm({
        notes: `Shift changed to ${shift.label} by ${currentUser?.full_name || currentUser?.email || 'unknown'} on ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Enter Daily Passcode</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <KeyRound className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Changing the shift for {log.date} requires the administrator's daily passcode.
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
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="text-muted-foreground">New shift</p>
            <p className="font-medium text-foreground">{shift.label}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={verifyPasscode} disabled={verifying} className="gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              {verifying ? 'Verifying...' : 'Save Shift'}
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
  const [editingLog, setEditingLog] = useState(null);
  const [pendingShiftEdit, setPendingShiftEdit] = useState(null);
  const [photoLog, setPhotoLog] = useState(null);
  const [locationLog, setLocationLog] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [showQuickView, setShowQuickView] = useState(false);
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

  const { data: employees = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () => entities.filter('Employee', { status: 'active', company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const { data: attendanceData = { logs: [], periodLogs: [] }, isLoading: loadingLogs } = useQuery({
    queryKey: ['attendance', selectedEmployee?.employee_id, employeeFullName(selectedEmployee || {}), activeCompanyId, startStr, endStr],
    queryFn: async () => {
      const all = await entities.list('AttendanceLog', '-date', 5000);
      const selectedEmployeeId = normalizeAttendanceKey(selectedEmployee.employee_id);
      const selectedEmployeeCode = normalizeAttendanceCode(selectedEmployee.employee_id);
      const selectedEmployeeName = normalizeAttendanceKey(employeeFullName(selectedEmployee));
      const periodLogs = all.filter(l => l.date >= startStr && l.date <= endStr);
      const matchedLogs = periodLogs.filter(l =>
        (
          normalizeAttendanceKey(l.employee_id) === selectedEmployeeId ||
          normalizeAttendanceCode(l.employee_id) === selectedEmployeeCode ||
          normalizeAttendanceKey(l.employee_name) === selectedEmployeeName ||
          employeeNameMatchesAttendanceLog(selectedEmployee, l)
        )
      );

      return { logs: matchedLogs, periodLogs };
    },
    enabled: !!selectedEmployee && !!activeCompanyId,
  });
  const logs = attendanceData.logs || [];
  const unmatchedPeriodLogs = (attendanceData.periodLogs || [])
    .filter(log => !logs.some(matched => matched.id === log.id))
    .slice(0, 8);

  const { data: payrollPeriods = [] } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => entities.filter('PayrollPeriod', { company_profile_id: activeCompanyId }, '-start_date', 100),
    enabled: !!activeCompanyId,
  });

  const { data: allAttendanceLogs = [], isLoading: loadingQuickView } = useQuery({
    queryKey: ['attendanceSummary', activeCompanyId],
    queryFn: () => entities.filter('AttendanceLog', { company_profile_id: activeCompanyId }, '-date', 5000),
    enabled: !!activeCompanyId,
  });

  const { data: shiftSettings = [] } = useQuery({
    queryKey: ['settings', activeCompanyId],
    queryFn: () => entities.filter('Settings', { company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, status }) => entities.update('AttendanceLog', id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });

  const updateDayType = useMutation({
    mutationFn: ({ id, day_type }) => entities.update('AttendanceLog', id, { day_type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });

  const updateLog = async (id, updates) => {
    await entities.update('AttendanceLog', id, updates);
    qc.invalidateQueries({ queryKey: ['attendance'] });
  };

  const shiftOptions = buildShiftOptions(shiftSettings, employees, logs);
  const defaultShiftValue = shiftSettings.find(s => s.is_default)?.id || shiftSettings[0]?.id || selectedEmployee?.work_schedule || 'day_shift';
  const getLogShiftValue = (log) => log.work_schedule || selectedEmployee?.work_schedule || defaultShiftValue;
  const getLogShift = (log) => getShiftOption(shiftOptions, getLogShiftValue(log), defaultShiftValue);
  const getLogComputationOptions = (log) => {
    const shift = getLogShift(log);
    const fallbackShift = legacyShiftTimes(shift.value);
    return {
      shiftStartTime: shift.shift_start_time || fallbackShift.shift_start_time,
      overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
      timeInAllowanceMinutes: shift.time_in_allowance_minutes || 0,
      breakInGraceMinutes: shift.grace_period_minutes || 0,
      breakDurationMinutes: getBreakDurationMinutes(selectedEmployee),
    };
  };

  const handleShiftSelect = (log, value) => {
    if (value === getLogShiftValue(log)) return;
    setPendingShiftEdit({
      log,
      shift: getShiftOption(shiftOptions, value, defaultShiftValue),
    });
  };

  const savePendingShiftEdit = async ({ notes }) => {
    if (!pendingShiftEdit) return;
    const previousNotes = pendingShiftEdit.log.notes ? `${pendingShiftEdit.log.notes}\n` : '';
    const updates = {
      work_schedule: pendingShiftEdit.shift.value,
      notes: `${previousNotes}${notes}`,
    };

    if (pendingShiftEdit.log.time_in && pendingShiftEdit.log.time_out) {
      const fallbackShift = legacyShiftTimes(pendingShiftEdit.shift.value);
      const computationOptions = {
        shiftStartTime: pendingShiftEdit.shift.shift_start_time || fallbackShift.shift_start_time,
        overtimeStartTime: pendingShiftEdit.shift.overtime_start_time || fallbackShift.overtime_start_time,
        timeInAllowanceMinutes: pendingShiftEdit.shift.time_in_allowance_minutes || 0,
        breakInGraceMinutes: pendingShiftEdit.shift.grace_period_minutes || 0,
        breakDurationMinutes: getBreakDurationMinutes(selectedEmployee),
      };
      const logForComputation = {
        ...pendingShiftEdit.log,
        work_schedule: pendingShiftEdit.shift.value,
      };
      const hoursWorked = computeCreditedHoursWorked(logForComputation, computationOptions);
      updates.hours_worked = Number(hoursWorked.toFixed(2));
      updates.overtime_hours = Number(computeOvertimeHours(logForComputation, hoursWorked, computationOptions).toFixed(2));
    }

    await updateLog(pendingShiftEdit.log.id, {
      ...updates,
    });
    setPendingShiftEdit(null);
  };

  useEffect(() => {
    if (!selectedEmployee?.break_time || logs.length === 0) return;

    const logsNeedingBreak = logs.filter(log => {
      const autoBreakOut = scheduledBreakAfterTimeIn(selectedEmployee, log.date, log.time_in);
      const autoBreakIn = scheduledBreakIn(selectedEmployee, log.date);
      const shouldClearAutoBreakIn = log.break_time_in && autoBreakIn && new Date(log.break_time_in).getTime() === new Date(autoBreakIn).getTime();
      const shouldClearPastBreakOut = isPastAutoScheduledBreak(log, selectedEmployee);
      return log.time_in && ((autoBreakOut && (!log.break_time_out || shouldClearAutoBreakIn)) || shouldClearPastBreakOut);
    });

    if (logsNeedingBreak.length === 0) return;

    let cancelled = false;
    const applyScheduledBreaks = async () => {
      await Promise.all(logsNeedingBreak.map(log => {
        const autoBreak = scheduledBreakAfterTimeIn(selectedEmployee, log.date, log.time_in);
        const autoBreakIn = scheduledBreakIn(selectedEmployee, log.date);
        const shouldClearAutoBreakIn = log.break_time_in && autoBreakIn && new Date(log.break_time_in).getTime() === new Date(autoBreakIn).getTime();
        const shouldClearPastBreakOut = isPastAutoScheduledBreak(log, selectedEmployee);
        const updates = {
          ...(!log.break_time_out && autoBreak ? { break_time_out: autoBreak.break_time_out } : {}),
          ...(shouldClearPastBreakOut ? { break_time_out: null } : {}),
          ...(shouldClearAutoBreakIn || shouldClearPastBreakOut ? { break_time_in: null } : {}),
        };

        const effectiveBreakOut = shouldClearPastBreakOut ? null : updates.break_time_out || log.break_time_out;
        const effectiveBreakIn = shouldClearAutoBreakIn || shouldClearPastBreakOut ? null : log.break_time_in;
        if (log.time_out) {
          const computationOptions = getLogComputationOptions(log);
          const hoursWorked = computeCreditedHoursWorked({
            ...log,
            ...updates,
            break_time_out: effectiveBreakOut,
            break_time_in: effectiveBreakIn,
          }, computationOptions);
          updates.hours_worked = Number(hoursWorked.toFixed(2));
          updates.overtime_hours = computeOvertimeHours({
            ...log,
            ...updates,
            break_time_out: effectiveBreakOut,
            break_time_in: effectiveBreakIn,
          }, hoursWorked, computationOptions);
        }

        return entities.update('AttendanceLog', log.id, updates);
      }));

      if (!cancelled) {
        qc.invalidateQueries({ queryKey: ['attendance'] });
      }
    };

    applyScheduledBreaks().catch(console.error);
    return () => { cancelled = true; };
  }, [selectedEmployee?.id, selectedEmployee?.break_time, selectedEmployee?.break_duration_minutes, selectedEmployee?.work_schedule, logs, shiftSettings, qc]);

  useEffect(() => {
    if (!selectedEmployee || logs.length === 0 || shiftOptions.length === 0) return;

    const logsNeedingRecompute = logs
      .filter(log => log.status === 'pending' && log.time_in && log.time_out)
      .map(log => {
        const computationOptions = getLogComputationOptions(log);
        const hoursWorked = computeCreditedHoursWorked(log, computationOptions);
        const overtimeHours = computeOvertimeHours(log, hoursWorked, computationOptions);
        const nextHours = Number(hoursWorked.toFixed(2));
        const nextOvertime = Number(overtimeHours.toFixed(2));

        if (
          Math.abs((Number(log.hours_worked) || 0) - nextHours) <= 0.005 &&
          Math.abs((Number(log.overtime_hours) || 0) - nextOvertime) <= 0.005
        ) {
          return null;
        }

        return {
          id: log.id,
          updates: {
            hours_worked: nextHours,
            overtime_hours: nextOvertime,
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
  }, [selectedEmployee?.id, selectedEmployee?.break_duration_minutes, selectedEmployee?.work_schedule, logs, shiftSettings, qc]);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const filteredEmployees = filterDept === 'all' ? employees : employees.filter(e => e.department === filterDept);
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

  // ── EMPLOYEE LIST VIEW ──
  if (!selectedEmployee) {
    return (
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredEmployees.map(emp => (
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
            {filteredEmployees.length === 0 && (
              <p className="col-span-3 text-center py-10 text-muted-foreground text-sm">No employees found.</p>
            )}
          </div>
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
      </div>
    );
  }

  // ── ATTENDANCE LOG VIEW ──
  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
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
        <Card className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Date</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Shift</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Time In(1)</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time Out(1)</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time In(2)</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Time Out(2)</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Hours</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">OT</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">ND</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Late</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Day Type</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedLogs.length === 0 ? (
                  <tr><td colSpan={13} className="text-center py-10 text-muted-foreground">
                    <div className="space-y-4">
                      <p>No attendance records for this week.</p>
                      {unmatchedPeriodLogs.length > 0 && (
                        <div className="mx-auto max-w-4xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
                          <p className="text-xs font-semibold text-amber-800">
                            Attendance rows exist in this period, but none matched {employeeFullName(selectedEmployee)} / {selectedEmployee.employee_id}.
                          </p>
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-xs text-amber-900">
                              <thead>
                                <tr>
                                  <th className="py-1 pr-3 text-left font-medium">Date</th>
                                  <th className="py-1 pr-3 text-left font-medium">Employee ID</th>
                                  <th className="py-1 pr-3 text-left font-medium">Employee Name</th>
                                  <th className="py-1 pr-3 text-left font-medium">Company ID</th>
                                  <th className="py-1 pr-3 text-left font-medium">Time In</th>
                                </tr>
                              </thead>
                              <tbody>
                                {unmatchedPeriodLogs.map(log => (
                                  <tr key={log.id}>
                                    <td className="py-1 pr-3">{log.date || '—'}</td>
                                    <td className="py-1 pr-3">{log.employee_id || '—'}</td>
                                    <td className="py-1 pr-3">{log.employee_name || '—'}</td>
                                    <td className="py-1 pr-3">{log.company_profile_id || '—'}</td>
                                    <td className="py-1 pr-3">{log.time_in ? format(new Date(log.time_in), 'hh:mm a') : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </td></tr>
                ) : (
	                  sortedLogs.map(log => {
	                    const logWorkSchedule = getLogShiftValue(log);
	                    const logShift = getShiftOption(shiftOptions, logWorkSchedule, defaultShiftValue);
	                    const logEmployee = { ...selectedEmployee, work_schedule: logWorkSchedule };
	                    const breakTimeInMissing = isBreakTimeInMissing(log, logEmployee, currentTime);
	                    const finalTimeOutMissing = isFinalTimeOutMissing(log, logEmployee, logShift, currentTime);
	                    const timeInPhoto = attendancePhotoItem(log, 'time_in');
	                    const breakOutPhoto = attendancePhotoItem(log, 'break_time_out');
	                    const breakInPhoto = attendancePhotoItem(log, 'break_time_in');
	                    const timeOutPhoto = attendancePhotoItem(log, 'time_out');
	                    const timeInLocation = attendanceLocationItem(log, 'time_in');
	                    const breakOutLocation = attendanceLocationItem(log, 'break_time_out');
	                    const breakInLocation = attendanceLocationItem(log, 'break_time_in');
	                    const timeOutLocation = attendanceLocationItem(log, 'time_out');
                    return (
                      <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-3 text-muted-foreground text-xs">{log.date}</td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <Select value={logWorkSchedule} onValueChange={value => handleShiftSelect(log, value)}>
                            <SelectTrigger className="h-7 text-xs w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {shiftOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>{option.shortLabel || option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <div className="inline-flex items-center gap-1.5">
                            {log.time_in
                              ? <span className="text-green-600 text-xs">{format(new Date(log.time_in), 'hh:mm a')}</span>
                              : <span className="text-amber-500 font-medium text-xs">Missing</span>}
                            <InlinePhotoButton photoItem={timeInPhoto} log={log} onView={setPhotoLog} />
                            <InlineLocationButton locationItem={timeInLocation} log={log} onView={setLocationLog} />
                          </div>
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <div className="inline-flex items-center gap-1.5">
                            {log.break_time_out
                              ? <span className="text-orange-500 text-xs">{format(new Date(log.break_time_out), 'hh:mm a')}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                            <InlinePhotoButton photoItem={breakOutPhoto} log={log} onView={setPhotoLog} />
                            <InlineLocationButton locationItem={breakOutLocation} log={log} onView={setLocationLog} />
                          </div>
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <div className="inline-flex items-center gap-1.5">
                            {log.break_time_in
                              ? <span className="text-teal-600 text-xs">{format(new Date(log.break_time_in), 'hh:mm a')}</span>
                              : breakTimeInMissing
                                ? <span className="text-amber-500 font-medium text-xs">Missing</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                            <InlinePhotoButton photoItem={breakInPhoto} log={log} onView={setPhotoLog} />
                            <InlineLocationButton locationItem={breakInLocation} log={log} onView={setLocationLog} />
                          </div>
                        </td>
	                        <td className="px-3 py-3">
	                          <div className="inline-flex items-center gap-1.5">
	                            {log.time_out
	                              ? <span className="text-blue-600 text-xs">{format(new Date(log.time_out), 'hh:mm a')}</span>
	                              : finalTimeOutMissing
	                                ? <span className="text-amber-500 font-medium text-xs">Missing</span>
	                                : <span className="text-muted-foreground text-xs">—</span>}
                              <InlinePhotoButton photoItem={timeOutPhoto} log={log} onView={setPhotoLog} />
                              <InlineLocationButton locationItem={timeOutLocation} log={log} onView={setLocationLog} />
                            </div>
	                        </td>
                        <td className="px-3 py-3 text-xs">{log.hours_worked || '—'}</td>
                        <td className="px-3 py-3 text-xs hidden md:table-cell">{log.overtime_hours > 0 ? `${log.overtime_hours}h` : '—'}</td>
                        <td className="px-3 py-3 text-xs hidden md:table-cell">{log.night_diff_hours > 0 ? `${log.night_diff_hours}h` : '—'}</td>
                        <td className="px-3 py-3 text-xs hidden md:table-cell">{log.late_minutes > 0 ? `${log.late_minutes}m` : '—'}</td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <Select value={log.day_type || 'regular'} onValueChange={v => updateDayType.mutate({ id: log.id, day_type: v })}>
                            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="regular">Regular</SelectItem>
                              <SelectItem value="rest_day">Rest Day</SelectItem>
                              <SelectItem value="regular_holiday">Regular Holiday</SelectItem>
                              <SelectItem value="special_holiday">Special Non-Working Holiday</SelectItem>
                              <SelectItem value="special_working_holiday">Special Working Holiday</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="outline" className={`text-xs capitalize ${statusColors[log.status] || ''}`}>{log.status}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                              title={canCorrectAttendance ? 'Correct attendance (recomputes hours & overtime)' : 'Edit shift or missing time'}
                              onClick={() => setEditingLog(log)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50"
                              title="Approve attendance"
                              onClick={() => approveMutation.mutate({ id: log.id, status: 'approved' })}>
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="sr-only">Approve attendance</span>
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              title="Reject attendance"
                              onClick={() => approveMutation.mutate({ id: log.id, status: 'rejected' })}>
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
      )}

      {editingLog && (
        <EditAttendanceModal
          log={editingLog}
          employee={selectedEmployee}
          defaultWorkSchedule={getLogShiftValue(editingLog)}
          shiftOptions={shiftOptions}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          canCorrectAttendance={canCorrectAttendance}
          onClose={() => setEditingLog(null)}
          onSave={updateLog}
        />
      )}

      {pendingShiftEdit && (
        <ShiftPasscodeModal
          log={pendingShiftEdit.log}
          shift={pendingShiftEdit.shift}
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          onClose={() => setPendingShiftEdit(null)}
          onConfirm={savePendingShiftEdit}
        />
      )}

      <Dialog open={!!photoLog} onOpenChange={(open) => !open && setPhotoLog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Employee Capture Photo</DialogTitle>
          </DialogHeader>
          {photoLog && (
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden border border-border bg-muted">
                <img src={photoLog.photoUrl} alt="Employee attendance capture" className="w-full max-h-[70vh] object-contain" />
              </div>
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
                  <p className="font-medium text-foreground">Time</p>
                  <p>{photoLog.timeValue ? format(new Date(photoLog.timeValue), 'hh:mm a') : '—'}</p>
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
                  <p className="font-medium text-foreground">Time</p>
                  <p>{locationLog.timeValue ? format(new Date(locationLog.timeValue), 'hh:mm a') : '—'}</p>
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
                  <p>{locationLog.location?.captured_at ? format(new Date(locationLog.location.captured_at), 'MMM d, yyyy h:mm a') : '—'}</p>
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
