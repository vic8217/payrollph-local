// @ts-nocheck
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { QrCode, CreditCard, User, LogOut, Building2, Scan, CheckCircle2, Camera, BookOpen, Car, Palmtree, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmployeeQRGate from '@/components/employee/EmployeeQRGate';
import EmployeeCashAdvance from '@/components/employee/EmployeeCashAdvance';
import EmployeeProfile from '@/components/employee/EmployeeProfile';
import EmployeePolicies from '@/components/employee/EmployeePolicies';
import EmployeeVehicleTripReport from '@/components/employee/EmployeeVehicleTripReport';
import EmployeePersonalLeave from '@/components/employee/EmployeePersonalLeave';
import EmployeeOvertimeRequest from '@/components/employee/EmployeeOvertimeRequest';
import { useCompany } from '@/lib/CompanyContext';
import { formatManilaDateTime, formatManilaTime } from '@/lib/dateUtils';
import FaceCapture from '@/components/face/FaceCapture';
import { acknowledgeAttendanceAttempt, createClientRequestId, isSystemUnavailableError, pendingAttendance, queueAttendanceAttempt } from '@/lib/offlineAttendance';

const tabs = [
  { id: 'scan', label: 'Attendance Logger', icon: QrCode },
  { id: 'cash-advance', label: 'Cash Advance', icon: CreditCard },
  { id: 'personal-leave', label: 'Personal Leave', icon: Palmtree },
  { id: 'overtime-request', label: 'Overtime Request', icon: Clock },
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'policies', label: 'Policies & Procedures', icon: BookOpen },
  { id: 'trip-report', label: 'Vehicle Trip Report', icon: Car },
];

const protectedTabs = new Set(['cash-advance', 'personal-leave', 'overtime-request', 'profile', 'trip-report']);

const attendancePhotoFields = {
  time_in: 'time_in_photo_url',
  break_time_out: 'break_time_out_photo_url',
  break_time_in: 'break_time_in_photo_url',
  time_out: 'time_out_photo_url',
};

const attendanceActionLabels = {
  time_in: 'Time In',
  break_time_out: 'Break Out',
  break_time_in: 'Break In',
  time_out: 'Time Out',
};

const attendanceTimeFields = {
  time_in: 'time_in',
  break_time_out: 'break_time_out',
  break_time_in: 'break_time_in',
  time_out: 'time_out',
};

function employeeDisplayName(employee) {
  return employee?.employee_name ||
    [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ') ||
    employee?.employee_id ||
    'Employee';
}

function employeePhotoUrl(employee) {
  return employee?.enrolledFacePhotoUrl ||
    employee?.referenceImage ||
    employee?.profile?.referenceImage ||
    employee?.photo_url ||
    employee?.photo ||
    employee?.image ||
    employee?.picture ||
    '';
}

function employeeInitials(employee) {
  return employeeDisplayName(employee)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';
}

function EmployeeShiftCard({ employee }) {
  const schedule = employee?.effective_schedule;
  if (!schedule) return null;
  if (schedule.noSchedule) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">No Work Schedule</p><p>Please contact HR for your schedule.</p></div>;
  }
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-left space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Today&apos;s Shift</p>
      <p className="font-semibold text-foreground">{schedule.name}</p>
      <p className="text-sm text-muted-foreground">{formatManilaDateTime(schedule.startDateTime, { month: 'long' }).split(',').slice(0, 2).join(',')}</p>
      <p className="text-sm font-medium">
        {formatManilaTime(schedule.startDateTime)} – {schedule.isOvernight ? `${formatManilaDateTime(schedule.endDateTime)}` : formatManilaTime(schedule.endDateTime)}
      </p>
      {schedule.breakStartTime && <p className="text-xs text-muted-foreground">Break: {schedule.breakStartTime}{schedule.breakEndTime ? ` – ${schedule.breakEndTime}` : schedule.breakDurationMinutes ? ` (${schedule.breakDurationMinutes} minutes)` : ''}</p>}
      <p className="text-xs"><span className="text-muted-foreground">Status:</span> {schedule.isRestDay ? 'Rest Day' : schedule.attendanceStatus}</p>
      {!schedule.isRestDay && schedule.earliestAllowedTimeIn && <p className="text-xs text-muted-foreground">Time In (1) available from {formatManilaTime(schedule.earliestAllowedTimeIn)}</p>}
    </div>
  );
}

function captureAttendanceLocation() {
  const capturedAt = new Date().toISOString();

  if (!window.isSecureContext) {
    return Promise.resolve({ status: 'unavailable', error: 'Location requires HTTPS', captured_at: capturedAt });
  }
  if (!navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable', error: 'Geolocation is not supported by this browser', captured_at: capturedAt });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { coords } = position;
        resolve({
          status: 'captured',
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          altitude: coords.altitude,
          altitude_accuracy: coords.altitudeAccuracy,
          heading: coords.heading,
          speed: coords.speed,
          captured_at: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      (error) => {
        const statuses = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
        resolve({
          status: statuses[error.code] || 'error',
          error: error.message || 'Location could not be captured',
          captured_at: new Date().toISOString(),
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

function PortalAccessGate({ activeCompanyId, tabId, tabLabel, onAuthorized }) {
  const [qrEmployee, setQrEmployee] = useState(null);
  const [imageBase64, setImageBase64] = useState('');
  const [captureMetadata, setCaptureMetadata] = useState(null);
  const [captureError, setCaptureError] = useState('');
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetKey, setResetKey] = useState(0);

  const resetFaceState = () => {
    setImageBase64('');
    setCaptureMetadata(null);
    setCaptureError('');
    setLivenessConfirmed(false);
    setMessage('');
    setError('');
  };

  const confirmLivePhoto = async () => {
    if (!imageBase64 || !livenessConfirmed) {
      setError('Complete the live face capture before continuing.');
      return;
    }
    if (!captureMetadata) {
      setError('Retake the live face capture before continuing.');
      return;
    }
    if (captureError) {
      setError(captureError);
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      setMessage('');
      if (!qrEmployee) {
        setError('Scan your QR code before taking the live confirmation photo.');
        return;
      }

      await onAuthorized(qrEmployee);
      setMessage(`Confirmed ${employeeDisplayName(qrEmployee)}.`);
    } catch (verifyError) {
      setError(verifyError?.message || 'Live photo confirmation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    setQrEmployee(null);
    resetFaceState();
    setResetKey(k => k + 1);
  }, [tabId]);

  return (
    <div className="mx-auto max-w-xl p-4 space-y-4">
      {!qrEmployee ? (
        <EmployeeQRGate
          key={`portal-access-${tabLabel}`}
          companyProfileId={activeCompanyId}
          onEmployeeScanned={(employee) => {
            setQrEmployee(employee);
            resetFaceState();
            setResetKey(k => k + 1);
          }}
          promptMessage={`Scan your QR code to access ${tabLabel}`}
          title={tabLabel}
          description="Scan your QR code, then take a live confirmation photo."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">{tabLabel} Photo Confirmation</h2>
            <p className="text-sm text-muted-foreground">
              Take a live confirmation photo for {employeeDisplayName(qrEmployee)}.
            </p>
          </div>
          <FaceCapture
            key={resetKey}
            onCapture={(value, metadata) => {
              setImageBase64(value);
              setCaptureMetadata(metadata);
              setCaptureError('');
              setError('');
              setMessage('');
            }}
            onLivenessDetected={() => setLivenessConfirmed(true)}
            onReset={resetFaceState}
            onErrorChange={setCaptureError}
            autoStart
            autoCaptureOnLiveness
            disabled={submitting}
          />
          <div className={`rounded-lg border p-3 text-xs ${
            livenessConfirmed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            {livenessConfirmed
              ? 'Liveness detected. Ready to verify.'
              : 'Blink or turn your head slightly while your face is inside the guide.'}
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          {message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQrEmployee(null);
                resetFaceState();
              }}
            >
              Scan Different QR
            </Button>
            <Button
              className="flex-1"
              onClick={confirmLivePhoto}
              disabled={submitting || !imageBase64 || !captureMetadata || !livenessConfirmed || Boolean(captureError)}
            >
              {submitting ? 'Confirming...' : 'Confirm Photo and Continue'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeePortal() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('scan');
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [scannedEmployee, setScannedEmployee] = useState(null);
  const [authorizedTab, setAuthorizedTab] = useState(null);
  const [scanConfirm, setScanConfirm] = useState(null); // { name, action, attendanceAction, time, logId }
  const [scanKey, setScanKey] = useState(0); // increment to reset EmployeeQRGate back to camera
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('idle'); // idle | capturing | done | error | uploading
  const [photoSubmitError, setPhotoSubmitError] = useState('');
  const [photoCaptureKey, setPhotoCaptureKey] = useState(0);
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [photoCaptureMetadata, setPhotoCaptureMetadata] = useState(null);
  const [photoCaptureError, setPhotoCaptureError] = useState('');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const { activeCompanyId, activeCompany } = useCompany();
  const explicitPortalCompanyId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('company_profile_id') ||
      new URLSearchParams(window.location.search).get('companyId')
    : null;
  const isCompanySubdomain = typeof window !== 'undefined' && Boolean(
    activeCompany?.subdomain &&
    window.location.hostname.toLowerCase().startsWith(`${String(activeCompany.subdomain).toLowerCase()}.`)
  );
  // A root-domain portal has no reliable company context. Do not scope employee
  // lookup to CompanyContext's first-company fallback; after identity is found,
  // all writes use the company_profile_id from the employee record itself.
  const portalCompanyId = explicitPortalCompanyId || (isCompanySubdomain ? activeCompanyId : null);

  const refreshPendingSyncCount = () => {
    if (typeof window !== 'undefined') setPendingSyncCount(pendingAttendance(window.localStorage).length);
  };

  const queueOfflineAttempt = ({ employee, attemptedAt, location }) => {
    const schedule = employee?.effective_schedule;
    const next = queueAttendanceAttempt(window.localStorage, {
      temporaryIncidentId: createClientRequestId(),
      clientRequestId: createClientRequestId(),
      attemptedAction: schedule?.attendanceStatus === 'Not Yet Timed In' ? 'TIME_IN_1' : 'AUTO_SEQUENCE',
      attemptedAt,
      employeeRecordId: employee.id,
      employeeId: employee.employee_id,
      companyProfileId: employee.company_profile_id || activeCompanyId,
      shiftIdAtAttempt: schedule?.id || null,
      scheduledStartAtAttempt: schedule?.startDateTime || null,
      earliestAllowedAtAttempt: schedule?.earliestAllowedTimeIn || null,
      source: 'EMPLOYEE_PORTAL',
      location,
      createdAt: new Date().toISOString(),
    });
    setPendingSyncCount(next.length);
  };

  const syncPendingAttendance = async () => {
    if (typeof window === 'undefined' || syncingAttendance) return;
    const events = pendingAttendance(window.localStorage);
    if (!events.length) return refreshPendingSyncCount();
    setSyncingAttendance(true);
    let synchronized = 0;
    let lastResult = null;
    try {
      for (const event of events) {
        try {
          lastResult = await appApi.functions.invoke('syncOfflineAttendance', event);
          acknowledgeAttendanceAttempt(window.localStorage, event.clientRequestId);
          synchronized += 1;
        } catch (error) {
          if (isSystemUnavailableError(error)) break;
          // Acknowledged business/security outcomes are retained server-side only
          // when the endpoint returns success. Other failures remain pending.
          break;
        }
      }
      refreshPendingSyncCount();
      if (synchronized) {
        setSyncMessage(lastResult?.attendanceResult === 'OFFICIAL_ATTENDANCE_CREATED'
          ? `Attendance synchronized successfully. Official Time In: ${formatManilaTime(lastResult.officialTimeIn)}.`
          : lastResult?.attendanceResult === 'EARLY_ATTEMPT_ONLY'
            ? 'Attendance attempt synchronized for HR reference. It did not become an official Time In.'
            : lastResult?.attendanceResult?.includes('CONFLICT') || lastResult?.attendanceResult === 'DUPLICATE_EXISTING_ATTENDANCE'
              ? 'Attendance sync requires HR review because another or conflicting record exists.'
              : `${synchronized} attendance attempt(s) synchronized.`);
      }
    } finally {
      setSyncingAttendance(false);
    }
  };

  const closeAttendanceLogger = () => {
    setScanConfirm(null);
    setScanKey(k => k + 1);
  };

  const attendanceSaved = Boolean(scanConfirm?.action && scanConfirm?.receiptId);

  const recordFailedAttendance = async ({ employee, stage, reason, location, attendanceLogId, punchAction }) => {
    try {
      await appApi.functions.invoke('recordAttendanceFailure', {
        employee_id: employee?.employee_id,
        employee_record_id: employee?.id,
        company_profile_id: employee?.company_profile_id || activeCompanyId,
        attendance_log_id: attendanceLogId,
        punch_action: punchAction,
        stage,
        reason,
        location,
      });
    } catch {
      // Failure auditing is best-effort and must not trap the employee in the logger.
    }
  };

  useEffect(() => {
    let cancelled = false;
    appApi.auth.me()
      .then(currentUser => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshPendingSyncCount();
    const reconnect = () => void syncPendingAttendance();
    const resume = () => { if (document.visibilityState === 'visible' && navigator.onLine) void syncPendingAttendance(); };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', resume);
    if (navigator.onLine) void syncPendingAttendance();
    return () => { window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', resume); };
  }, [user, activeCompanyId]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return undefined;
    }

    const isLocalDev = process.env.NODE_ENV !== 'production' ||
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

    if (isLocalDev) {
      navigator.serviceWorker
        .getRegistrations()
        .then(registrations => {
          registrations
            .filter(registration => registration.scope.includes('/employee-portal'))
            .forEach(registration => registration.unregister());
        })
        .catch(() => {});
      return undefined;
    }

    if (!window.isSecureContext) {
      return undefined;
    }

    navigator.serviceWorker
      .register('/employee-portal-sw.js', { scope: '/employee-portal' })
      .catch(() => {});

    return undefined;
  }, []);

  useEffect(() => {
    if (!scanConfirm) return;
    setPhotoDataUrl(null);
    setPhotoCaptureMetadata(null);
    setPhotoCaptureError('');
    setPhotoSubmitError('');
    setPhotoStatus('idle');
    setLivenessConfirmed(false);
  }, [scanConfirm, photoCaptureKey]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);

    if (protectedTabs.has(tabId)) {
      setScannedEmployee(null);
      setAuthorizedTab(null);
      setScanKey(k => k + 1);
      return;
    }

    setScannedEmployee(null);
    setAuthorizedTab(null);
    if (tabId === 'scan') setScanKey(k => k + 1);
  };

  const handleEmployeeScanned = (employee) => {
    setScannedEmployee(employee);
    setAuthorizedTab(activeTab);
  };

  const resolveEmployeeFromFaceResult = async (faceEmployee) => {
    if (!faceEmployee?.employee_id) return faceEmployee;
    try {
      const res = await appApi.functions.invoke('lookupEmployee', {
        code: faceEmployee.employee_id,
        company_profile_id: faceEmployee.company_profile_id || activeCompanyId,
      });
      return res.employee ? { ...res.employee, ...faceEmployee } : faceEmployee;
    } catch {
      return faceEmployee;
    }
  };

  const authorizePortalEmployee = async (faceEmployee) => {
    const employee = await resolveEmployeeFromFaceResult(faceEmployee);
    setScannedEmployee(employee);
    setAuthorizedTab(activeTab);
  };

  const attachAttendancePhoto = async (log, action, photoDataUrl, faceResult, verificationMethod = 'face_verification') => {
    const blob = await fetch(photoDataUrl).then(r => r.blob());
    const photoField = attendancePhotoFields[action];
    const file = new File([blob], `${action || 'attendance'}_photo.jpg`, { type: 'image/jpeg' });
    const { file_url } = await appApi.integrations.Core.UploadFile({ file });
    await appApi.entities.AttendanceLog.update(log.id, {
      ...(photoField ? { [photoField]: file_url, photo_action: action } : {}),
      ...(action ? { [`${action}_photo_captured_at`]: new Date().toISOString() } : {}),
      ...(action ? { [`${action}_verification_method`]: verificationMethod } : {}),
      photo_url: file_url,
      face_verification_result: faceResult?.result || 'disabled',
      face_verification_confidence: faceResult?.confidenceScore ?? null,
      face_verification_log_id: faceResult?.log?.id || null,
    });
  };

  const recordAttendanceForEmployee = async (employee, photoDataUrl, faceResult, verificationMethod = 'face_verification') => {
    const location = await captureAttendanceLocation();
    const logRes = await appApi.functions.invoke('logAttendance', {
      employee_id: employee.employee_id,
      employee_record_id: employee.id,
      company_profile_id: employee.company_profile_id || activeCompanyId,
      location,
    });
    if (logRes.duplicate) {
      throw new Error(logRes.message || 'Scan already recorded. Please wait before scanning again.');
    }
    await attachAttendancePhoto(logRes.log, logRes.action, photoDataUrl, faceResult, verificationMethod);
    const timeField = attendanceTimeFields[logRes.action];
    return {
      action: attendanceActionLabels[logRes.action] || 'Attendance',
      time: timeField && logRes.log?.[timeField] ? formatManilaTime(logRes.log[timeField]) : '',
    };
  };

  const requiresScan = protectedTabs.has(activeTab);
  const showGate = requiresScan && (!scannedEmployee || authorizedTab !== activeTab);

  if (loadingUser) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Building2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">PayrollPH</p>
            <p className="text-xs text-muted-foreground">Employee Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {scannedEmployee && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              {employeePhotoUrl(scannedEmployee) ? (
                <img
                  src={employeePhotoUrl(scannedEmployee)}
                  alt={employeeDisplayName(scannedEmployee)}
                  className="h-7 w-7 rounded-full border border-green-200 object-cover object-top"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-green-200 bg-green-100 text-[10px] font-semibold text-green-700">
                  {employeeInitials(scannedEmployee)}
                </span>
              )}
              <span className="text-xs font-medium text-green-800">{employeeDisplayName(scannedEmployee)}</span>
              <button onClick={() => { setScannedEmployee(null); setAuthorizedTab(null); setActiveTab('scan'); setScanKey(k => k + 1); }} className="text-green-600 hover:text-green-800 ml-1 text-xs">✕</button>
            </div>
          )}
          {user && !scannedEmployee && (
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-foreground">{user.full_name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => appApi.auth.logout()} className="text-muted-foreground hover:text-destructive">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-border bg-card">
        <div className="flex overflow-x-auto">
          {tabs.map(tab => {
            const disabled = false;
            return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${disabled ? 'cursor-not-allowed opacity-50 hover:text-muted-foreground' : ''}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {protectedTabs.has(tab.id) && (!scannedEmployee || authorizedTab !== tab.id) && (
                <Scan className="w-3 h-3 text-muted-foreground/50" />
              )}
            </button>
          );
          })}
        </div>
      </div>

      {scannedEmployee && protectedTabs.has(activeTab) && authorizedTab === activeTab && (
        <div className="border-b border-green-200 bg-green-50 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            {employeePhotoUrl(scannedEmployee) ? (
              <img
                src={employeePhotoUrl(scannedEmployee)}
                alt={employeeDisplayName(scannedEmployee)}
                className="h-12 w-12 rounded-lg border border-green-200 object-cover object-top"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-green-200 bg-green-100 text-sm font-semibold text-green-700">
                {employeeInitials(scannedEmployee)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Verified Employee</p>
              <p className="truncate text-sm font-semibold text-foreground">{employeeDisplayName(scannedEmployee)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {scannedEmployee.employee_id || '-'}{scannedEmployee.department ? ` · ${scannedEmployee.department}` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {activeTab === 'scan' && (
          <div className="mx-auto max-w-xl p-4 space-y-4">
            {(pendingSyncCount > 0 || syncMessage) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p>{pendingSyncCount > 0 ? `${pendingSyncCount} attendance attempt${pendingSyncCount === 1 ? '' : 's'} pending synchronization.` : syncMessage}</p>{pendingSyncCount > 0 && <Button type="button" variant="outline" size="sm" className="mt-2" disabled={syncingAttendance} onClick={() => void syncPendingAttendance()}>{syncingAttendance ? 'Synchronizing…' : 'Sync Now'}</Button>}</div>}
            <EmployeeQRGate
              key={scanKey}
              companyProfileId={portalCompanyId}
              onEmployeeScanned={(employee) => {
                appApi.functions.invoke('recordAttendanceAttempt', {
                  employee_id: employee.employee_id,
                  employee_record_id: employee.id,
                  company_profile_id: employee.company_profile_id || activeCompanyId,
                }).catch(() => {
                  // Attempt auditing is best-effort and must not block attendance.
                });
                setScanConfirm({
                  employee,
                  name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
                });
              }}
              promptMessage="Scan your QR code to start attendance photo verification"
              title="Attendance Logger"
              description="Scan your QR code, then complete a live photo before attendance is recorded"
            />
          </div>
        )}
        {showGate && (
          <PortalAccessGate
            key={`${activeTab}-${scanKey}`}
            activeCompanyId={portalCompanyId}
            tabId={activeTab}
            tabLabel={tabs.find(t => t.id === activeTab)?.label || 'Employee Portal'}
            onAuthorized={authorizePortalEmployee}
          />
        )}
        {!showGate && activeTab === 'cash-advance' && <EmployeeCashAdvance employee={scannedEmployee} />}
        {!showGate && activeTab === 'personal-leave' && <EmployeePersonalLeave employee={scannedEmployee} />}
        {!showGate && activeTab === 'overtime-request' && <EmployeeOvertimeRequest employee={scannedEmployee} />}
        {!showGate && activeTab === 'profile' && <EmployeeProfile employee={scannedEmployee} />}
        {activeTab === 'policies' && <EmployeePolicies />}
        {activeTab === 'trip-report' && <EmployeeVehicleTripReport employee={scannedEmployee} />}
      </main>

      {/* Attendance confirmation modal */}
      {scanConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Punch result */}
            <div className="text-center space-y-2">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${scanConfirm.earlyAttempt || scanConfirm.systemUnavailable ? 'bg-amber-100' : 'bg-green-100'}`}>
                <CheckCircle2 className={`w-8 h-8 ${scanConfirm.earlyAttempt || scanConfirm.systemUnavailable ? 'text-amber-600' : 'text-green-600'}`} />
              </div>
              <h2 className="text-xl font-bold text-foreground">
                {scanConfirm.systemUnavailable ? 'Unable to Process Attendance' : scanConfirm.earlyAttempt ? 'Early Time In Recorded' : scanConfirm.action ? `${scanConfirm.action} Recorded` : 'Complete Live Photo to Record Attendance'}
              </h2>
              <p className="text-lg font-medium text-primary">{scanConfirm.name}</p>
              {scanConfirm.time && <p className="text-muted-foreground text-sm">{scanConfirm.time}</p>}
            </div>

            <EmployeeShiftCard employee={scanConfirm.employee} />

            {scanConfirm.systemUnavailable && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-xs text-amber-900"><p className="font-semibold">System Temporarily Unavailable</p><p className="mt-1">PayrollPH is temporarily unavailable. Your attendance attempt has been saved on this device and will be checked automatically when the system becomes available again.</p><p className="mt-2 font-semibold">This is not yet a confirmed official attendance punch.</p></div>}

            {scanConfirm.earlyAttempt && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-xs text-amber-900 space-y-1">
                <p>Your attempt at <strong>{formatManilaTime(scanConfirm.earlyAttempt.attemptedAt)}</strong> was recorded for HR audit purposes.</p>
                <p>Official Time In (1) is available from <strong>{formatManilaTime(scanConfirm.earlyAttempt.earliestAllowedTimeIn)}</strong> for your {formatManilaTime(scanConfirm.earlyAttempt.scheduledStart)} shift.</p>
                <p className="font-semibold">You are not yet timed in. Please punch again when the allowed window begins.</p>
                {scanConfirm.earlyAttempt.receiptId && <p className="break-all font-mono text-[11px]">Audit receipt: {scanConfirm.earlyAttempt.receiptId}</p>}
              </div>
            )}

            {attendanceSaved && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left">
                <p className="text-sm font-semibold text-emerald-900">Attendance saved successfully</p>
                <p className="mt-1 text-xs text-emerald-800">
                  This punch is recorded in the attendance audit history and can be reviewed later by an administrator.
                </p>
                <p className="mt-2 break-all font-mono text-[11px] text-emerald-700">Receipt: {scanConfirm.receiptId}</p>
                {scanConfirm.photoWarning && (
                  <p className="mt-2 text-xs font-medium text-amber-700">{scanConfirm.photoWarning}</p>
                )}
              </div>
            )}

            {/* Fraud Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚖️</span>
                <p className="text-sm font-bold text-amber-900">Applicable Laws (Philippines)</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800 underline">1. Labor Code of the Philippines</p>
                <p className="text-xs text-amber-800">Employers may <strong>discipline or terminate</strong> employees for:</p>
                <ul className="text-xs text-amber-800 list-disc ml-4 space-y-0.5">
                  <li>Serious misconduct</li>
                  <li>Fraud or willful breach of trust</li>
                  <li>"Buddy punching" (signing for another) — <strong>fraud / dishonesty</strong></li>
                </ul>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800 underline">2. Revised Penal Code</p>
                <p className="text-xs text-amber-800">Possible criminal liability:</p>
                <p className="text-xs font-semibold text-amber-800">📌 Article 172 – Falsification of Private Documents</p>
                <ul className="text-xs text-amber-800 list-disc ml-4 space-y-0.5">
                  <li>If time records (DTR, logbook) are falsified</li>
                  <li>Penalty: <strong>Prisión correccional</strong> (6 months – 6 years) + possible <strong>fine</strong></li>
                </ul>
              </div>

              <p className="text-xs font-bold text-amber-900 text-center border-t border-amber-200 pt-2">
                ⚠️ By scanning, you confirm this is your own attendance record.
              </p>
            </div>

            {/* Live photo capture */}
            {!attendanceSaved && !scanConfirm.earlyAttempt && !scanConfirm.systemUnavailable && <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Identity Photo</p>
              <div className="rounded-xl border border-border p-2">
                <FaceCapture
                  key={photoCaptureKey}
                  onCapture={(value, metadata) => {
                    setPhotoDataUrl(value);
                    setPhotoCaptureMetadata(metadata);
                    setPhotoCaptureError('');
                    setPhotoSubmitError('');
                    setPhotoStatus('done');
                  }}
                  onLivenessDetected={() => setLivenessConfirmed(true)}
                  onReset={() => {
                    setPhotoDataUrl(null);
                    setPhotoCaptureMetadata(null);
                    setPhotoCaptureError('');
                    setPhotoStatus('idle');
                    setLivenessConfirmed(false);
                  }}
                  onErrorChange={setPhotoCaptureError}
                  autoStart
                  autoCaptureOnLiveness
                  disabled={photoStatus === 'uploading'}
                />
              </div>
              <div className={`rounded-lg border p-3 text-xs ${
                livenessConfirmed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {livenessConfirmed
                  ? 'Liveness detected. Ready to record attendance.'
                  : 'Blink or turn your head slightly while your face is inside the guide.'}
              </div>
              {photoDataUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    setPhotoSubmitError('');
                    setPhotoStatus('idle');
                    setPhotoDataUrl(null);
                    setPhotoCaptureMetadata(null);
                    setPhotoCaptureError('');
                    setLivenessConfirmed(false);
                    setPhotoCaptureKey(k => k + 1);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" /> Retake Photo
                </Button>
              )}
              {photoSubmitError && (
                <p className="text-xs font-medium text-destructive text-center">{photoSubmitError}</p>
              )}
            </div>}

            {scanConfirm.earlyAttempt || scanConfirm.systemUnavailable ? <Button className="w-full" onClick={closeAttendanceLogger}>I Understand — Try Again Later</Button> : !attendanceSaved ? <Button
              className="w-full"
              disabled={photoStatus === 'uploading' || !photoDataUrl || !photoCaptureMetadata || !livenessConfirmed || Boolean(photoCaptureError)}
              onClick={async () => {
                if (!photoDataUrl || photoStatus !== 'done') {
                  void recordFailedAttendance({ employee: scanConfirm.employee, stage: 'photo_capture', reason: 'Live photo was not completed' });
                  setPhotoSubmitError('Live photo is required. Please complete the liveness capture.');
                  return;
                }

                if (!livenessConfirmed || !photoCaptureMetadata) {
                  void recordFailedAttendance({ employee: scanConfirm.employee, stage: 'liveness_check', reason: 'Liveness check was not completed' });
                  setPhotoSubmitError('Please complete the live blink/head-turn check.');
                  return;
                }

                if (photoCaptureError) {
                  void recordFailedAttendance({ employee: scanConfirm.employee, stage: 'photo_capture', reason: photoCaptureError });
                  setPhotoSubmitError(photoCaptureError);
                  return;
                }

                const attendanceAttemptedAt = new Date().toISOString();
                let attendanceLocation = null;
                try {
                  setPhotoSubmitError('');
                  setPhotoStatus('uploading');
                  const employee = scanConfirm.employee;

                  const location = await captureAttendanceLocation();
                  attendanceLocation = location;
                  const logRes = await appApi.functions.invoke('logAttendance', {
                    employee_id: employee.employee_id,
                    employee_record_id: employee.id,
                    company_profile_id: employee.company_profile_id || activeCompanyId,
                    location,
                  });
                  if (logRes.code === 'EARLY_TIME_IN_RECORDED') {
                    if (logRes.receiptId && photoDataUrl) {
                      try {
                        const blob = await fetch(photoDataUrl).then(r => r.blob());
                        const file = new File([blob], 'early_time_in_attempt_photo.jpg', { type: 'image/jpeg' });
                        const { file_url } = await appApi.integrations.Core.UploadFile({ file });
                        await appApi.entities.PasscodeAuditLog.update(logRes.receiptId, {
                          photo_url: file_url,
                          photo_captured_at: new Date().toISOString(),
                          verification_method: 'qr_photo_liveness',
                          liveness_confirmed: true,
                        });
                        queryClient.invalidateQueries({ queryKey: ['passcodeAudit'] });
                      } catch {
                        // The server-side event and location remain authoritative if photo attachment fails.
                      }
                    }
                    setScanConfirm(current => ({
                      ...current,
                      earlyAttempt: {
                        attemptedAt: logRes.attemptedAt,
                        scheduledStart: logRes.scheduledStart,
                        earliestAllowedTimeIn: logRes.earliestAllowedTimeIn,
                        receiptId: logRes.receiptId,
                      },
                    }));
                    setPhotoStatus('done');
                    return;
                  }
                  if (logRes.duplicate) {
                    await recordFailedAttendance({
                      employee,
                      stage: 'duplicate_or_sequence_check',
                      reason: logRes.message || 'Duplicate attendance scan',
                      location,
                      attendanceLogId: logRes.log?.id,
                      punchAction: logRes.action,
                    });
                    closeAttendanceLogger();
                    return;
                  }

                  const action = logRes.action;
                  const actionLabels = {
                    time_in: 'Time In',
                    break_time_out: 'Break Out',
                    break_time_in: 'Break In',
                    time_out: 'Time Out',
                  };
                  const timeField = {
                    time_in: 'time_in',
                    break_time_out: 'break_time_out',
                    break_time_in: 'break_time_in',
                    time_out: 'time_out',
                  }[action];
                  const savedConfirmation = {
                    ...scanConfirm,
                    action: actionLabels[action] || 'Attendance',
                    time: timeField && logRes.log?.[timeField] ? formatManilaTime(logRes.log[timeField]) : '',
                    receiptId: logRes.receipt?.id || logRes.log?.id,
                  };

                  // The punch is already committed at this point. Publish its
                  // receipt immediately so a later photo failure cannot be
                  // mistaken for a missing punch or encourage a second scan.
                  setScanConfirm(savedConfirmation);
                  queryClient.invalidateQueries({
                    queryKey: ['employee-attendance', employee.employee_id],
                  });

                  try {
                    const blob = await fetch(photoDataUrl).then(r => r.blob());
                    const photoField = attendancePhotoFields[action];
                    const file = new File([blob], `${action || 'attendance'}_photo.jpg`, { type: 'image/jpeg' });
                    const { file_url } = await appApi.integrations.Core.UploadFile({ file });
                    await appApi.entities.AttendanceLog.update(logRes.log.id, {
                      ...(photoField ? { [photoField]: file_url, photo_action: action } : {}),
                      ...(action ? { [`${action}_photo_captured_at`]: new Date().toISOString() } : {}),
                      ...(action ? { [`${action}_verification_method`]: 'qr_photo_liveness' } : {}),
                      photo_url: file_url,
                      face_verification_result: 'disabled',
                      face_verification_confidence: null,
                      face_verification_log_id: null,
                    });
                  } catch (photoError) {
                    const photoMessage = photoError?.message || 'The verification photo could not be attached.';
                    await recordFailedAttendance({
                      employee,
                      stage: 'photo_attachment',
                      reason: photoMessage,
                      location,
                      attendanceLogId: logRes.log?.id,
                      punchAction: action,
                    });
                    setScanConfirm({
                      ...savedConfirmation,
                      photoWarning: 'The punch was saved, but its verification photo needs administrator review.',
                    });
                  }
                } catch (error) {
                  const errorMessage = error?.message || 'Live photo or attendance logging failed. Please retake the photo and try again.';
                  if (isSystemUnavailableError(error)) {
                    const employee = scanConfirm.employee;
                    queueOfflineAttempt({ employee, attemptedAt: attendanceAttemptedAt, location: attendanceLocation });
                    setScanConfirm(current => ({ ...current, systemUnavailable: true }));
                    setPhotoStatus('done');
                    setPhotoSubmitError('System Temporarily Unavailable. Your attendance attempt has been saved on this device and will be checked automatically when PayrollPH is available again. You are not yet officially timed in.');
                    return;
                  }
                  await recordFailedAttendance({
                    employee: scanConfirm.employee,
                    stage: 'attendance_submission',
                    reason: errorMessage,
                  });
                  if (
                    error?.status === 409 ||
                    /already complete|already recorded|please wait/i.test(errorMessage)
                  ) {
                    closeAttendanceLogger();
                    return;
                  }
                  setPhotoStatus('done');
                  setPhotoSubmitError(errorMessage || 'Live photo or attendance logging failed. Please retake the photo and try again.');
                  return;
                }
              }}
            >
              {photoStatus === 'uploading' ? 'Saving photo...' : 'I Understand — Done'}
            </Button> : (
              <Button className="w-full" onClick={closeAttendanceLogger}>Done</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
