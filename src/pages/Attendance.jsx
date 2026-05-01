// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, addWeeks, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, ArrowLeft, User, Pencil, Camera, KeyRound, Download, Eye } from 'lucide-react';
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
const BREAK_DURATION_MINUTES = 60;

function addBreakDuration(time) {
  const [hours, minutes] = String(time || '00:00').split(':').map(Number);
  const total = hours * 60 + minutes + BREAK_DURATION_MINUTES;
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

function diffHours(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3600000);
}

function scheduledBreakIn(employee, date) {
  if (!employee?.break_time) return null;

  const [breakHour] = employee.break_time.split(':').map(Number);
  const breakDate = employee.work_schedule === 'night_shift' && breakHour < 12
    ? format(addDays(new Date(`${date}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : date;
  const breakIn = addBreakDuration(employee.break_time);
  const breakInDate = breakIn.crossesMidnight
    ? format(addDays(new Date(`${breakDate}T00:00:00+08:00`), 1), 'yyyy-MM-dd')
    : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
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
function EditAttendanceModal({ log, onClose, onSave, currentUser, activeCompanyId }) {
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
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('idle'); // idle | capturing | done | error
  const [saving, setSaving] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const canEditTimeIn = !log.time_in;
  const canEditBreakOut = !log.break_time_out;
  const canEditBreakIn = !log.break_time_in;
  const canEditTimeOut = !log.time_out;

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

    const toISO = (timeStr) => {
      const [h, m] = timeStr.split(':');
      const dt = new Date(log.date);
      dt.setHours(parseInt(h), parseInt(m), 0, 0);
      return dt.toISOString();
    };

    if (canEditTimeIn && timeIn) updates.time_in = toISO(timeIn);
    if (canEditBreakOut && breakOut) updates.break_time_out = toISO(breakOut);
    if (canEditBreakIn && breakIn) updates.break_time_in = toISO(breakIn);
    if (canEditTimeOut && timeOut) updates.time_out = toISO(timeOut);

    const effTimeIn = updates.time_in || log.time_in;
    const effBreakOut = updates.break_time_out || log.break_time_out;
    const effBreakIn = updates.break_time_in || log.break_time_in;
    const effTimeOut = updates.time_out || log.time_out;

    if (effTimeIn && effTimeOut) {
      let hrs = 0;
      if (effBreakOut && effBreakIn) {
        // 1st half + 2nd half
        hrs += (new Date(effBreakOut).getTime() - new Date(effTimeIn).getTime()) / 3600000;
        hrs += (new Date(effTimeOut).getTime() - new Date(effBreakIn).getTime()) / 3600000;
      } else {
        hrs = (new Date(effTimeOut).getTime() - new Date(effTimeIn).getTime()) / 3600000;
      }
      hrs = Math.max(0, hrs);
      updates.hours_worked = parseFloat(hrs.toFixed(2));
      updates.overtime_hours = parseFloat(Math.max(0, hrs - 8).toFixed(2));
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

    updates.notes = `Manual edit by ${currentUser?.full_name || currentUser?.email || 'unknown'} on ${format(new Date(), 'yyyy-MM-dd HH:mm')} | Reason: ${reason.trim()}${photoUrl ? ` | Audit photo: ${photoUrl}` : ''}`;

    await onSave(log.id, updates);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'passcode' ? 'Enter Daily Passcode' : `Edit Attendance — ${log.date}`}
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

            <p className="text-xs text-muted-foreground">Only missing time fields can be filled in.</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Time In(1)</label>
                <Input type="time" value={timeIn} onChange={e => setTimeIn(e.target.value)}
                  disabled={!canEditTimeIn} className={`mt-1 ${!canEditTimeIn ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditTimeIn && <p className="text-xs text-muted-foreground mt-0.5">Already recorded</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time Out(1)</label>
                <Input type="time" value={breakOut} onChange={e => setBreakOut(e.target.value)}
                  disabled={!canEditBreakOut} className={`mt-1 ${!canEditBreakOut ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditBreakOut && <p className="text-xs text-muted-foreground mt-0.5">Already recorded</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time In(2)</label>
                <Input type="time" value={breakIn} onChange={e => setBreakIn(e.target.value)}
                  disabled={!canEditBreakIn} className={`mt-1 ${!canEditBreakIn ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditBreakIn && <p className="text-xs text-muted-foreground mt-0.5">Already recorded</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Time Out(2)</label>
                <Input type="time" value={timeOut} onChange={e => setTimeOut(e.target.value)}
                  disabled={!canEditTimeOut} className={`mt-1 ${!canEditTimeOut ? 'opacity-50 cursor-not-allowed' : ''}`} />
                {!canEditTimeOut && <p className="text-xs text-muted-foreground mt-0.5">Already recorded</p>}
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

export default function Attendance() {
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterDept, setFilterDept] = useState('all');
  const [editingLog, setEditingLog] = useState(null);
  const [photoLog, setPhotoLog] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [showQuickView, setShowQuickView] = useState(false);
  const { user: currentUser } = useAuth();
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const baseWeek = new Date();
  const weekStart = startOfWeek(addWeeks(baseWeek, weekOffset), { weekStartsOn: 6 });
  const weekEnd = addDays(weekStart, 6);
  const startStr = format(weekStart, 'yyyy-MM-dd');
  const endStr = format(weekEnd, 'yyyy-MM-dd');

  const { data: employees = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () => entities.filter('Employee', { status: 'active', company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['attendance', selectedEmployee?.employee_id, startStr, endStr],
    queryFn: async () => {
      const all = await entities.filter('AttendanceLog', { employee_id: selectedEmployee.employee_id, company_profile_id: activeCompanyId });
      return all.filter(l => l.date >= startStr && l.date <= endStr);
    },
    enabled: !!selectedEmployee && !!activeCompanyId,
  });

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

  useEffect(() => {
    if (!selectedEmployee?.break_time || logs.length === 0) return;

    const logsNeedingBreak = logs.filter(log => {
      const autoBreakOut = scheduledBreak(selectedEmployee, log.date);
      const autoBreakIn = scheduledBreakIn(selectedEmployee, log.date);
      const shouldClearAutoBreakIn = log.break_time_in && autoBreakIn && new Date(log.break_time_in).getTime() === new Date(autoBreakIn).getTime();
      return log.time_in && autoBreakOut && (!log.break_time_out || shouldClearAutoBreakIn);
    });

    if (logsNeedingBreak.length === 0) return;

    let cancelled = false;
    const applyScheduledBreaks = async () => {
      await Promise.all(logsNeedingBreak.map(log => {
        const autoBreak = scheduledBreak(selectedEmployee, log.date);
        const autoBreakIn = scheduledBreakIn(selectedEmployee, log.date);
        const shouldClearAutoBreakIn = log.break_time_in && autoBreakIn && new Date(log.break_time_in).getTime() === new Date(autoBreakIn).getTime();
        const updates = {
          ...(!log.break_time_out ? { break_time_out: autoBreak.break_time_out } : {}),
          ...(shouldClearAutoBreakIn ? { break_time_in: null } : {}),
        };

        const effectiveBreakOut = updates.break_time_out || log.break_time_out;
        const effectiveBreakIn = shouldClearAutoBreakIn ? null : log.break_time_in;
        if (log.time_out && effectiveBreakOut && effectiveBreakIn) {
          const grossHours = diffHours(log.time_in, log.time_out);
          const breakHours = diffHours(effectiveBreakOut, effectiveBreakIn);
          const hoursWorked = Math.max(0, grossHours - breakHours);
          updates.hours_worked = Number(hoursWorked.toFixed(2));
          updates.overtime_hours = Number(Math.max(0, hoursWorked - 8).toFixed(2));
        }

        return entities.update('AttendanceLog', log.id, updates);
      }));

      if (!cancelled) {
        qc.invalidateQueries({ queryKey: ['attendance'] });
      }
    };

    applyScheduledBreaks().catch(console.error);
    return () => { cancelled = true; };
  }, [selectedEmployee?.id, selectedEmployee?.break_time, selectedEmployee?.work_schedule, logs, qc]);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const filteredEmployees = filterDept === 'all' ? employees : employees.filter(e => e.department === filterDept);
  const derivedPayrollPeriods = [...new Set(allAttendanceLogs.map(log => log.date).filter(Boolean))]
    .map(date => {
      const periodStart = startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 6 });
      const periodEnd = addDays(periodStart, 6);
      const startDate = format(periodStart, 'yyyy-MM-dd');
      const endDate = format(periodEnd, 'yyyy-MM-dd');
      return {
        id: `derived-${startDate}`,
        period_name: `Week of ${format(periodStart, 'MMM d')} - ${format(periodEnd, 'MMM d, yyyy')}`,
        start_date: startDate,
        end_date: endDate,
      };
    })
    .filter((period, index, periods) => periods.findIndex(p => p.id === period.id) === index)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const displayedPayrollPeriods = payrollPeriods.length > 0 ? payrollPeriods : derivedPayrollPeriods;
  const activePeriod = selectedPeriod === 'all' ? null : displayedPayrollPeriods.find(p => p.id === selectedPeriod);
  const quickViewPeriods = activePeriod
    ? [activePeriod]
    : [...payrollPeriods].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

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
            <h1 className="text-2xl font-bold text-foreground">{selectedEmployee.first_name} {selectedEmployee.last_name}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Week Covered — {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekOffset(0)}>Current Week</Button>
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
                    No attendance records for this week.
                  </td></tr>
                ) : (
                  sortedLogs.map(log => {
                    const missingTimeIn = !log.time_in;
                    const missingTimeOut = !log.time_out;
                    const canEdit = missingTimeIn || missingTimeOut;
                    return (
                      <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-3 text-muted-foreground text-xs">{log.date}</td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          {selectedEmployee.work_schedule === 'night_shift'
                            ? <span className="text-xs text-indigo-600 font-medium">Night</span>
                            : <span className="text-xs text-amber-600 font-medium">Day</span>}
                        </td>
                        <td className="px-3 py-3">
                          {log.time_in
                            ? <span className="text-green-600 text-xs">{format(new Date(log.time_in), 'hh:mm a')}</span>
                            : <span className="text-amber-500 font-medium text-xs">Missing</span>}
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          {log.break_time_out
                            ? <span className="text-orange-500 text-xs">{format(new Date(log.break_time_out), 'hh:mm a')}</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          {log.break_time_in
                            ? <span className="text-teal-600 text-xs">{format(new Date(log.break_time_in), 'hh:mm a')}</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {log.time_out
                            ? <span className="text-blue-600 text-xs">{format(new Date(log.time_out), 'hh:mm a')}</span>
                            : <span className="text-amber-500 font-medium text-xs">Missing</span>}
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
                            {canEdit && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                                title="Fill in missing time"
                                onClick={() => setEditingLog(log)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {log.photo_url && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-sky-600 hover:bg-sky-50"
                                title="View employee photo"
                                onClick={() => setPhotoLog(log)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50"
                              onClick={() => approveMutation.mutate({ id: log.id, status: 'approved' })}>
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={() => approveMutation.mutate({ id: log.id, status: 'rejected' })}>
                              <XCircle className="w-4 h-4" />
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
          currentUser={currentUser}
          activeCompanyId={activeCompanyId}
          onClose={() => setEditingLog(null)}
          onSave={updateLog}
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
                <img src={photoLog.photo_url} alt="Employee attendance capture" className="w-full max-h-[70vh] object-contain" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground">Employee</p>
                  <p>{photoLog.employee_name || selectedEmployee?.first_name || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Date</p>
                  <p>{photoLog.date || '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Time In</p>
                  <p>{photoLog.time_in ? format(new Date(photoLog.time_in), 'hh:mm a') : '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Time Out</p>
                  <p>{photoLog.time_out ? format(new Date(photoLog.time_out), 'hh:mm a') : '—'}</p>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => window.open(photoLog.photo_url, '_blank', 'noopener,noreferrer')}>
                Open Full Size
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
