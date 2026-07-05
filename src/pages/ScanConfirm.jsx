import { useState, useRef, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import {
  computeCreditedHoursWorked,
  computeLateMinutes,
  computeNightDifferentialHours,
  computeOvertimeHours,
} from '@/lib/payrollUtils';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { LogIn, LogOut, Camera, CameraOff, CheckCircle2, AlertTriangle, Shield, UserCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { manilaDateString } from '@/lib/dateUtils';
import { effectiveShiftSetting, resolveEmployeeWorkSchedule, shiftFromAttendanceSnapshot } from '@/lib/shiftSettings';
import {
  approvedOvertimeRequestForLog,
  capOvertimeByApprovedRequest,
  overtimeStatusForComputedHours,
} from '@/lib/overtimeRequests';
import { faceVerificationApi } from '@/lib/faceVerificationApi';

const LABOR_CODE_INFO = {
  time_in: {
    articles: [
      { code: 'Labor Code Art. 83', title: 'Normal Hours of Work', text: 'The normal hours of work of any employee shall not exceed eight (8) hours a day.' },
      { code: 'DOLE D.O. No. 98-09', title: 'Time-Keeping Requirement', text: 'Employers are required to keep accurate time records of all employees.' },
    ],
    penal: [
      { code: 'Labor Code Art. 303', title: 'Penalties for Violations', text: 'Willful non-compliance with time & attendance requirements may result in fines up to ₱100,000 and/or imprisonment.' },
    ],
  },
  break_time_in: {
    articles: [
      { code: 'DOLE Time-Keeping', title: 'Break Return Record', text: 'Returning from break should be recorded accurately as part of the employee attendance record.' },
    ],
    penal: [
      { code: 'Labor Code Art. 303', title: 'Penalties for Violations', text: 'Failure to keep accurate time records may expose the employer to penalties and payroll corrections.' },
    ],
  },
  time_out: {
    articles: [
      { code: 'Labor Code Art. 84', title: 'Hours Worked', text: 'Hours worked shall include all time during which an employee is required to be on duty or at a prescribed workplace.' },
      { code: 'Labor Code Art. 87', title: 'Overtime Work', text: 'Work beyond 8 hours must be compensated at regular wage plus at least 25% thereof.' },
    ],
    penal: [
      { code: 'Labor Code Art. 303', title: 'Penalties for Violations', text: 'Failure to properly record and compensate overtime or undertime may result in penalties and back pay orders from DOLE.' },
    ],
  },
};
const DEFAULT_BREAK_DURATION_MINUTES = 60;

function addOneDay(date) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return format(d, 'yyyy-MM-dd');
}

function scheduledBreak(employee, date, isOvernightShift = false) {
  if (!employee?.break_time) return null;

  const [breakHour] = employee.break_time.split(':').map(Number);
  const breakDate = isOvernightShift && breakHour < 12 ? addOneDay(date) : date;

  return {
    break_time_out: new Date(`${breakDate}T${employee.break_time}:00+08:00`).toISOString(),
  };
}

function scheduledBreakAfterTimeIn(employee, date, timeInValue, isOvernightShift = false) {
  const autoBreak = scheduledBreak(employee, date, isOvernightShift);
  const timeIn = timeInValue ? new Date(timeInValue) : null;
  const breakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !Number.isFinite(timeIn.getTime()) || !Number.isFinite(breakOut.getTime())) {
    return null;
  }

  return breakOut.getTime() > timeIn.getTime() ? autoBreak : null;
}

function isPastAutoScheduledBreak(log, employee, isOvernightShift = false) {
  const autoBreak = scheduledBreak(employee, log?.date, isOvernightShift);
  const timeIn = log?.time_in ? new Date(log.time_in) : null;
  const breakOut = log?.break_time_out ? new Date(log.break_time_out) : null;
  const scheduledBreakOut = autoBreak?.break_time_out ? new Date(autoBreak.break_time_out) : null;

  if (!timeIn || !breakOut || !scheduledBreakOut) return false;
  if (![timeIn, breakOut, scheduledBreakOut].every(date => Number.isFinite(date.getTime()))) return false;

  return breakOut.getTime() === scheduledBreakOut.getTime() && breakOut.getTime() <= timeIn.getTime();
}

function legacyShiftTimes(value) {
  if (value === 'night_shift') {
    return { shift_start_time: '20:00', shift_end_time: '05:00', overtime_start_time: '05:30' };
  }
  return { shift_start_time: '08:00', shift_end_time: '17:00', overtime_start_time: '17:30' };
}

function resolveEmployeeShiftOptions(employee, shiftSettings, date, log = null) {
  const effectiveShifts = shiftSettings
    .map(setting => effectiveShiftSetting(setting, date))
    .filter(setting => setting?.is_active !== false);
  const defaultShift = effectiveShifts.find(setting => setting.is_default) || effectiveShifts[0] || {};
  const shiftValue = log?.work_schedule || resolveEmployeeWorkSchedule(employee, date, defaultShift.id || 'day_shift');
  const rawShift = shiftSettings.find(setting => String(setting.id) === String(shiftValue));
  const matchedShift = shiftFromAttendanceSnapshot(log, effectiveShiftSetting(rawShift, date));
  const shift = matchedShift || (shiftValue ? {} : defaultShift);
  const fallbackShift = legacyShiftTimes(shiftValue);
  const shiftStartTime = shift.shift_start_time || fallbackShift.shift_start_time;
  const shiftEndTime = shift.shift_end_time || fallbackShift.shift_end_time;

  return {
    shiftStartTime,
    shiftEndTime,
    overtimeStartTime: shift.overtime_start_time || fallbackShift.overtime_start_time,
    timeInAllowanceMinutes: Number(shift.time_in_allowance_minutes) || 0,
    breakInGraceMinutes: Number(shift.grace_period_minutes) || 0,
    lateGraceMinutes: Number(shift.grace_period_minutes) || 0,
    isOvernightShift: shiftEndTime <= shiftStartTime,
  };
}

function scheduledShiftStart(logDate, shiftOptions) {
  if (!logDate || !shiftOptions?.shiftStartTime) return null;
  const start = new Date(`${logDate}T${shiftOptions.shiftStartTime}:00+08:00`);
  return Number.isFinite(start.getTime()) ? start : null;
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

function scheduledBreakIn(employee, date, isOvernightShift = false) {
  if (!employee?.break_time) return null;

  const [breakHour] = employee.break_time.split(':').map(Number);
  const breakDate = isOvernightShift && breakHour < 12 ? addOneDay(date) : date;
  const breakIn = addBreakDuration(employee.break_time, getBreakDurationMinutes(employee));
  const breakInDate = breakIn.crossesMidnight ? addOneDay(breakDate) : breakDate;

  return new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString();
}

const attendancePhotoFields = {
  time_in: 'time_in_photo_url',
  break_time_out: 'break_time_out_photo_url',
  break_time_in: 'break_time_in_photo_url',
  time_out: 'time_out_photo_url',
};

async function uploadAttendancePhoto(photoDataUrl, action) {
  if (!photoDataUrl || !attendancePhotoFields[action]) return {};

  const blob = await fetch(photoDataUrl).then(r => r.blob());
  const file = new File([blob], `${action}_photo.jpg`, { type: 'image/jpeg' });
  const { file_url } = await appApi.integrations.Core.UploadFile({ file });

  return {
    [attendancePhotoFields[action]]: file_url,
    [`${action}_verification_method`]: 'qr_face',
    photo_url: file_url,
    photo_action: action,
  };
}

// Face capture component
function FaceCapture({ onCapture, captured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (captured) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setReady(true);
        }
      })
      .catch(() => setError('Camera not available for photo capture.'));

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [captured]);

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    onCapture(dataUrl);
  };

  if (captured) {
    return (
      <div className="relative rounded-xl overflow-hidden border-2 border-green-400">
        <img src={captured} alt="Captured" className="w-full object-cover max-h-52" />
        <div className="absolute bottom-2 left-2 bg-green-600 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Photo captured
        </div>
        <Button
          size="sm"
          variant="outline"
          className="absolute top-2 right-2 text-xs h-7"
          onClick={() => onCapture(null)}
        >
          Retake
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 bg-muted/40 rounded-xl border border-dashed border-border">
        <CameraOff className="w-8 h-8 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">You may still confirm without a photo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black border border-border">
        <video ref={videoRef} className="w-full max-h-52 object-cover" playsInline muted />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-white text-sm">Starting camera...</p>
          </div>
        )}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-28 h-36 border-2 border-white/70 rounded-full opacity-70" style={{ borderStyle: 'dashed' }} />
            <div className="absolute bottom-3 rounded-md bg-slate-950/70 px-3 py-1 text-xs text-white">
              Align your whole face inside the guide
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <Button size="sm" className="w-full" onClick={takePhoto} disabled={!ready}>
        <Camera className="w-4 h-4 mr-2" /> Take Confirmation Photo
      </Button>
    </div>
  );
}

export default function ScanConfirm() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const empId = params.get('empId');
  const action = params.get('action'); // 'time_in', 'break_time_in', or 'time_out'
  const logId = params.get('logId');

  const [employee, setEmployee] = useState(null);
  const [todayLog, setTodayLog] = useState(null);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null); // { action, employee, hoursWorked }
  const [loadError, setLoadError] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);

  // Lunch window: if scanning Time In between 12:00pm–12:59pm, snap to 1:00pm, no OT
  const nowHour = new Date().getHours();
  const isLunchWindow = action === 'time_in' && nowHour === 12;

  // Load employee data on mount
  useEffect(() => {
    if (!empId || !action) {
      setLoadError('Invalid scan. Please scan again.');
      return;
    }
    appApi.entities.Employee.filter({ employee_id: empId })
      .then(results => {
        if (!results || results.length === 0) {
          setLoadError('Employee not found.');
          return;
        }
        setEmployee(results[0]);
      })
      .catch(() => setLoadError('Failed to load employee.'));

    if (logId) {
      appApi.entities.AttendanceLog.filter({ id: logId })
        .then(results => { if (results.length > 0) setTodayLog(results[0]); })
        .catch(() => {});
    }
  }, [empId, action, logId]);

  const handleConfirm = async () => {
    if (!employee || confirming) return;

    if (!capturedPhoto) {
      setPhotoError('Photo is required. Please take or retake the photo to complete this attendance record.');
      return;
    }
    if (!livenessConfirmed) {
      setPhotoError('Please complete and confirm the live blink/head-turn check.');
      return;
    }

    setConfirming(true);
    const today = manilaDateString();
    const now = new Date().toISOString();
    const shiftSettings = await appApi.entities.Settings.filter({ company_profile_id: employee.company_profile_id });
    const overtimeRequests = await appApi.entities.OvertimeRequest.filter({ company_profile_id: employee.company_profile_id });
    const logDate = todayLog?.date || today;
    const effectiveWorkSchedule = todayLog?.work_schedule || resolveEmployeeWorkSchedule(employee, logDate);
    const shiftEmployee = {
      ...employee,
      work_schedule: effectiveWorkSchedule,
    };
    const shiftOptions = resolveEmployeeShiftOptions(shiftEmployee, shiftSettings, logDate, todayLog);
    if (action === 'time_in' && shiftOptions.isOvernightShift) {
      const shiftStart = scheduledShiftStart(today, shiftOptions);
      if (shiftStart && new Date(now).getTime() < shiftStart.getTime()) {
        setPhotoError(
          `Time In is not available until the night shift starts at ${shiftOptions.shiftStartTime}.`
        );
        setConfirming(false);
        return;
      }
    }
    let faceResult = null;
    try {
      faceResult = await faceVerificationApi.attendance({
        employeeId: employee.employee_id,
        employeeRecordId: employee.id,
        companyProfileId: employee.company_profile_id,
        imageBase64: capturedPhoto,
        livenessConfirmed,
      });
      if (faceResult.enabled !== false && faceResult.result !== 'verified') {
        setPhotoError(`Face verification ${faceResult.result}. Attendance was not recorded.`);
        setConfirming(false);
        return;
      }
    } catch {
      setPhotoError('Face verification failed. Please retake the photo and try again.');
      setConfirming(false);
      return;
    }
    let photoUpdates = {};
    try {
      photoUpdates = await uploadAttendancePhoto(capturedPhoto, action);
    } catch {
      setPhotoError('Photo upload failed. Please retake the photo and try again.');
      setConfirming(false);
      return;
    }

    if (action === 'time_in') {
      // Lunch window rule: snap time_in to 1:00pm, no overtime
      let effectiveTimeIn = now;
      if (isLunchWindow) {
        const snapped = new Date();
        snapped.setHours(13, 0, 0, 0);
        effectiveTimeIn = snapped.toISOString();
      }
      await appApi.entities.AttendanceLog.create({
        company_profile_id: employee.company_profile_id,
        employee_id: employee.employee_id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        date: today,
        time_in: effectiveTimeIn,
        work_schedule: effectiveWorkSchedule,
        shift_start_time: shiftOptions.shiftStartTime,
        shift_end_time: shiftOptions.shiftEndTime,
        shift_overtime_start_time: shiftOptions.overtimeStartTime,
        shift_grace_period_minutes: shiftOptions.lateGraceMinutes,
        shift_time_in_allowance_minutes: shiftOptions.timeInAllowanceMinutes,
        ...(scheduledBreakAfterTimeIn(employee, today, effectiveTimeIn, shiftOptions.isOvernightShift) || {}),
        day_type: 'regular',
        status: 'pending',
        ...photoUpdates,
        face_verification_result: faceResult?.result || 'disabled',
        face_verification_confidence: faceResult?.confidenceScore ?? null,
        face_verification_log_id: faceResult?.log?.id || null,
        notes: isLunchWindow ? 'Time-in snapped to 1:00 PM (lunch window rule). No overtime credited.' : (capturedPhoto ? 'Photo captured on time-in' : ''),
      });
      setDone({ action: 'time_in', employee, lunchSnapped: isLunchWindow });
    } else if (action === 'break_time_in' && todayLog) {
      const autoBreak = scheduledBreakAfterTimeIn(
        employee,
        logDate,
        todayLog.time_in,
        shiftOptions.isOvernightShift,
      );
      await appApi.entities.AttendanceLog.update(todayLog.id, {
        ...(!todayLog.break_time_out && autoBreak ? { break_time_out: autoBreak.break_time_out } : {}),
        break_time_in: now,
        ...photoUpdates,
        face_verification_result: faceResult?.result || 'disabled',
        face_verification_confidence: faceResult?.confidenceScore ?? null,
        face_verification_log_id: faceResult?.log?.id || null,
        notes: capturedPhoto ? 'Photo captured on time-in after break' : '',
      });
      setDone({ action: 'break_time_in', employee });
    } else if (action === 'time_out' && todayLog) {
      const autoBreak = scheduledBreakAfterTimeIn(
        employee,
        logDate,
        todayLog.time_in,
        shiftOptions.isOvernightShift,
      );
      const shouldClearPastBreakOut = isPastAutoScheduledBreak(
        todayLog,
        employee,
        shiftOptions.isOvernightShift,
      );
      const breakUpdates = autoBreak ? {
        ...(!todayLog.break_time_out ? { break_time_out: autoBreak.break_time_out } : {}),
      } : shouldClearPastBreakOut ? {
        break_time_out: null,
        break_time_in: null,
      } : {};
      const effectiveBreakOut = breakUpdates.break_time_out === null ? null : breakUpdates.break_time_out || todayLog.break_time_out;
      const effectiveBreakIn = breakUpdates.break_time_in === null ? null : todayLog.break_time_in;
      const hoursWorked = computeCreditedHoursWorked({
        ...todayLog,
        ...breakUpdates,
        time_out: now,
        break_time_out: effectiveBreakOut,
        break_time_in: effectiveBreakIn,
      }, {
        ...shiftOptions,
        breakDurationMinutes: getBreakDurationMinutes(employee),
      });
      const overtimeHours = computeOvertimeHours({
        ...todayLog,
        ...breakUpdates,
        time_out: now,
        break_time_out: effectiveBreakOut,
        break_time_in: effectiveBreakIn,
      }, hoursWorked, {
        ...shiftOptions,
        breakDurationMinutes: getBreakDurationMinutes(employee),
      });
      const completedLog = {
        ...todayLog,
        ...breakUpdates,
        time_out: now,
        break_time_out: effectiveBreakOut,
        break_time_in: effectiveBreakIn,
      };
      const approvedOtRequest = approvedOvertimeRequestForLog(completedLog, overtimeRequests, employee);
      const cappedOvertimeHours = capOvertimeByApprovedRequest(overtimeHours, approvedOtRequest);
      const nightDiffHours = computeNightDifferentialHours(completedLog, {
        shiftStartTime: shiftOptions.shiftStartTime,
        breakDurationMinutes: getBreakDurationMinutes(employee),
      });
      const lateMinutes = computeLateMinutes(completedLog, {
        ...shiftOptions,
      });

      await appApi.entities.AttendanceLog.update(todayLog.id, {
        ...breakUpdates,
        time_out: now,
        hours_worked: parseFloat(hoursWorked.toFixed(2)),
        ot_actual_hours: parseFloat(overtimeHours.toFixed(2)),
        overtime_hours: cappedOvertimeHours,
        ot_requested_hours: approvedOtRequest ? Number((approvedOtRequest.approved_hours ?? approvedOtRequest.requested_hours) || 0) : 0,
        ot_status: overtimeStatusForComputedHours(overtimeHours, cappedOvertimeHours, approvedOtRequest),
        overtime_request_id: approvedOtRequest?.id || null,
        night_diff_hours: parseFloat(nightDiffHours.toFixed(2)),
        late_minutes: lateMinutes,
        ...photoUpdates,
        face_verification_result: faceResult?.result || 'disabled',
        face_verification_confidence: faceResult?.confidenceScore ?? null,
        face_verification_log_id: faceResult?.log?.id || null,
        notes: capturedPhoto ? 'Photo captured on time-out' : '',
      });
      setDone({ action: 'time_out', employee, hoursWorked });
    }

    setConfirming(false);
  };

  const handleCancel = () => navigate('/scan');

  const laborInfo = action ? LABOR_CODE_INFO[action] : null;
  const actionMeta = {
    time_in: {
      title: 'Time IN',
      confirmTitle: 'Confirm Time IN',
      successTitle: 'Time IN Recorded!',
      pill: 'TIME IN',
      button: 'Confirm Time IN ✓',
      color: 'green',
      icon: <LogIn className="w-5 h-5 text-green-600" />,
    },
    break_time_in: {
      title: 'Time In(2)',
      confirmTitle: 'Confirm Time In(2)',
      successTitle: 'Time In(2) Recorded!',
      pill: 'TIME IN(2)',
      button: 'Confirm Time In(2) ✓',
      color: 'blue',
      icon: <LogIn className="w-5 h-5 text-blue-600" />,
    },
    time_out: {
      title: 'Time OUT',
      confirmTitle: 'Confirm Time OUT',
      successTitle: 'Time OUT Recorded!',
      pill: 'TIME OUT',
      button: 'Confirm Time OUT ✓',
      color: 'blue',
      icon: <LogOut className="w-5 h-5 text-blue-600" />,
    },
  }[action] || {
    title: 'Attendance',
    confirmTitle: 'Confirm Attendance',
    successTitle: 'Attendance Recorded!',
    pill: 'ATTENDANCE',
    button: 'Confirm Attendance ✓',
    color: 'blue',
    icon: <LogOut className="w-5 h-5 text-blue-600" />,
  };
  const isGreenAction = actionMeta.color === 'green';

  // ── Success screen ──
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border border-border shadow-lg">
          <CardContent className="p-8 flex flex-col items-center gap-4 text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${done.action === 'time_in' ? 'bg-green-100' : 'bg-blue-100'}`}>
              {done.action === 'time_out'
                ? <LogOut className="w-10 h-10 text-blue-600" />
                : <LogIn className={`w-10 h-10 ${done.action === 'time_in' ? 'text-green-600' : 'text-blue-600'}`} />}
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {actionMeta.successTitle}
              </p>
              <p className="text-muted-foreground mt-1">
                {done.employee.first_name} {done.employee.last_name}
              </p>
              {done.hoursWorked != null && (
                <p className="text-sm text-muted-foreground mt-0.5">{done.hoursWorked.toFixed(1)} hours worked</p>
              )}
              {done.lunchSnapped && (
                <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Time In set to 1:00 PM · No overtime credited</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">{format(new Date(), 'hh:mm:ss a · MMM d, yyyy')}</p>
            </div>
            {capturedPhoto && (
              <img src={capturedPhoto} alt="Confirmation" className="w-24 h-24 rounded-full object-cover border-4 border-white shadow" />
            )}
            <Button className="w-full mt-2" onClick={() => navigate('/scan')}>
              Scan Next Employee
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error screen ──
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border border-red-200 shadow">
          <CardContent className="p-8 flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400" />
            <p className="text-red-600 font-medium">{loadError}</p>
            <Button variant="outline" onClick={() => navigate('/scan')}>Back to Scanner</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loading ──
  if (!employee) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── Confirm screen ──
  return (
    <div className="min-h-screen bg-background p-4 flex items-start justify-center pt-8">
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              {actionMeta.icon} {actionMeta.confirmTitle}
            </h1>
            <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, MMMM d, yyyy · hh:mm a')}</p>
          </div>
        </div>

        {/* Employee Info */}
        <Card className={`border-2 ${isGreenAction ? 'border-green-300 bg-green-50' : 'border-blue-300 bg-blue-50'}`}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 flex-shrink-0 border-2 border-white shadow">
              {employee.photo_url
                ? <img src={employee.photo_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-2xl">
                    {employee.first_name?.[0]}{employee.last_name?.[0]}
                  </div>
              }
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold text-foreground">{employee.first_name} {employee.last_name}</p>
              <p className="text-sm text-muted-foreground">{employee.position} · {employee.department}</p>
              <p className="text-xs font-mono text-muted-foreground">{employee.employee_id}</p>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-sm font-semibold ${isGreenAction ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
              {actionMeta.pill}
            </div>
          </CardContent>
        </Card>

        {/* Lunch Window Alert */}
        {isLunchWindow && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Lunch Break Window Detected</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Time In is being recorded between 12:00 PM – 12:59 PM. <strong>Time In(1) will be set to 1:00 PM</strong> and <strong>no overtime hours</strong> will be credited for this record.
              </p>
            </div>
          </div>
        )}

        {/* Face Capture */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <UserCheck className="w-3.5 h-3.5" /> Identity Confirmation Photo
            </div>
            <FaceCapture
              onCapture={(value) => {
                setPhotoError('');
                setCapturedPhoto(value);
              }}
              captured={capturedPhoto}
            />
            <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={livenessConfirmed}
                onChange={event => setLivenessConfirmed(event.target.checked)}
                className="h-4 w-4"
              />
              I blinked or turned my head slightly before this capture.
            </label>
            {photoError && (
              <p className="text-xs font-medium text-destructive text-center">{photoError}</p>
            )}
          </CardContent>
        </Card>

        {/* Labor Code */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <Shield className="w-3.5 h-3.5" /> Philippine Labor Code
            </div>
            {laborInfo?.articles.map((art, i) => (
              <div key={i} className="bg-muted/60 rounded-md px-3 py-2 border border-border">
                <p className="text-[11px] font-bold text-primary">{art.code} — {art.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{art.text}</p>
              </div>
            ))}
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Penal Provisions
            </div>
            {laborInfo?.penal.map((p, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <p className="text-[11px] font-bold text-amber-700">{p.code} — {p.title}</p>
                <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">{p.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-3 pb-8">
          <Button variant="outline" className="flex-1" onClick={handleCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button
            className={`flex-1 text-white ${isGreenAction ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? 'Recording...' : actionMeta.button}
          </Button>
        </div>
      </div>
    </div>
  );
}
