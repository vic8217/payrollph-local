import { useState, useEffect, useRef } from 'react';
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
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { formatManilaTime } from '@/lib/dateUtils';
import FaceCapture from '@/components/face/FaceCapture';

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

function PortalAccessGate({ activeCompanyId, tabLabel, onAuthorized }) {
  const [mode, setMode] = useState('face');
  const [qrEmployee, setQrEmployee] = useState(null);
  const [imageBase64, setImageBase64] = useState('');
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetKey, setResetKey] = useState(0);

  const resetFaceState = () => {
    setImageBase64('');
    setLivenessConfirmed(false);
    setMessage('');
    setError('');
  };

  const verifyFace = async () => {
    if (!imageBase64 || !livenessConfirmed) {
      setError('Complete the live face capture before continuing.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      setMessage('');
      const result = await faceVerificationApi.attendance({
        companyProfileId: qrEmployee?.company_profile_id || activeCompanyId,
        employeeId: qrEmployee?.employee_id,
        employeeRecordId: qrEmployee?.id,
        imageBase64,
        livenessConfirmed,
      });

      if (result.enabled === false) {
        setError('Face verification is disabled. Please contact HR.');
        return;
      }
      if (result.result !== 'verified' || (!qrEmployee && !result.employee)) {
        setError(`Face verification ${result.result}. Access was not granted.`);
        return;
      }

      await onAuthorized(qrEmployee || result.employee);
      setMessage(`Verified ${employeeDisplayName(qrEmployee || result.employee)}.`);
    } catch (verifyError) {
      setError(verifyError?.message || 'Face verification failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-4 space-y-4">
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('face');
              setQrEmployee(null);
              resetFaceState();
              setResetKey(k => k + 1);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'face'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Face Recognition
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('qr');
              setQrEmployee(null);
              resetFaceState();
              setResetKey(k => k + 1);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'qr'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            QR Code + Face
          </button>
        </div>
      </div>

      {mode === 'qr' && !qrEmployee ? (
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
          description="Scan your QR code, then verify your enrolled face."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">{tabLabel} Face Verification</h2>
            <p className="text-sm text-muted-foreground">
              {qrEmployee
                ? `Verify the enrolled face for ${employeeDisplayName(qrEmployee)}.`
                : 'Verify your enrolled face to continue.'}
            </p>
          </div>
          <FaceCapture
            key={resetKey}
            onCapture={(value) => {
              setImageBase64(value);
              setError('');
              setMessage('');
            }}
            onLivenessDetected={() => setLivenessConfirmed(true)}
            onReset={resetFaceState}
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
            {qrEmployee && (
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
            )}
            <Button
              className="flex-1"
              onClick={verifyFace}
              disabled={submitting || !imageBase64 || !livenessConfirmed}
            >
              {submitting ? 'Verifying...' : 'Verify Face and Continue'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeePortal() {
  const [activeTab, setActiveTab] = useState('scan');
  const [attendanceMode, setAttendanceMode] = useState('face');
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [scannedEmployee, setScannedEmployee] = useState(null);
  const [authorizedTab, setAuthorizedTab] = useState(null);
  const [scanConfirm, setScanConfirm] = useState(null); // { name, action, attendanceAction, time, logId }
  const [scanKey, setScanKey] = useState(0); // increment to reset EmployeeQRGate back to camera
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('idle'); // idle | capturing | done | error | uploading
  const [photoSubmitError, setPhotoSubmitError] = useState('');
  const [photoCaptureKey, setPhotoCaptureKey] = useState(0);
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [facePhoto, setFacePhoto] = useState('');
  const [faceLivenessConfirmed, setFaceLivenessConfirmed] = useState(false);
  const [faceSubmitting, setFaceSubmitting] = useState(false);
  const [faceMessage, setFaceMessage] = useState('');
  const [faceError, setFaceError] = useState('');
  const { activeCompanyId } = useCompany();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    appApi.auth.me().then(setUser).catch(() => {}).finally(() => setLoadingUser(false));
  }, []);

  // Start camera and auto-capture when modal opens
  useEffect(() => {
    if (!scanConfirm) return;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setPhotoDataUrl(null);
    setPhotoSubmitError('');
    setPhotoStatus('capturing');
    setLivenessConfirmed(false);

    let stream = null;
    const startAndCapture = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise(resolve => { videoRef.current.onloadedmetadata = resolve; });
          videoRef.current.play();
          // Wait a moment for camera to adjust
          await new Promise(r => setTimeout(r, 1200));
          capture(stream);
        }
      } catch {
        setPhotoStatus('error');
      }
    };

    const capture = (stream) => {
      if (!videoRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 320;
      canvas.height = videoRef.current.videoHeight || 240;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setPhotoDataUrl(dataUrl);
      setPhotoStatus('done');
      // Stop stream
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };

    startAndCapture();

    return () => {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
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
      return res.employee || faceEmployee;
    } catch {
      return faceEmployee;
    }
  };

  const authorizePortalEmployee = async (faceEmployee) => {
    const employee = await resolveEmployeeFromFaceResult(faceEmployee);
    setScannedEmployee(employee);
    setAuthorizedTab(activeTab);
  };

  const attachAttendancePhoto = async (log, action, photoDataUrl, faceResult) => {
    const blob = await fetch(photoDataUrl).then(r => r.blob());
    const photoField = attendancePhotoFields[action];
    const file = new File([blob], `${action || 'attendance'}_photo.jpg`, { type: 'image/jpeg' });
    const { file_url } = await appApi.integrations.Core.UploadFile({ file });
    await appApi.entities.AttendanceLog.update(log.id, {
      ...(photoField ? { [photoField]: file_url, photo_action: action } : {}),
      photo_url: file_url,
      face_verification_result: faceResult?.result || 'disabled',
      face_verification_confidence: faceResult?.confidenceScore ?? null,
      face_verification_log_id: faceResult?.log?.id || null,
    });
  };

  const recordAttendanceForEmployee = async (employee, photoDataUrl, faceResult) => {
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
    await attachAttendancePhoto(logRes.log, logRes.action, photoDataUrl, faceResult);
    const timeField = attendanceTimeFields[logRes.action];
    return {
      action: attendanceActionLabels[logRes.action] || 'Attendance',
      time: timeField && logRes.log?.[timeField] ? formatManilaTime(logRes.log[timeField]) : '',
    };
  };

  const submitFaceAttendance = async () => {
    if (!facePhoto) {
      setFaceError('Capture your face before recording attendance.');
      return;
    }
    if (!faceLivenessConfirmed) {
      setFaceError('Please complete and confirm the live blink/head-turn check.');
      return;
    }

    try {
      setFaceSubmitting(true);
      setFaceError('');
      setFaceMessage('');
      const faceResult = await faceVerificationApi.attendance({
        companyProfileId: activeCompanyId,
        imageBase64: facePhoto,
        livenessConfirmed: faceLivenessConfirmed,
      });
      if (faceResult.enabled === false) {
        setFaceError('Face verification is disabled. Use QR code instead.');
        return;
      }
      if (faceResult.result !== 'verified' || !faceResult.employee) {
        setFaceError(`Face verification ${faceResult.result}. Attendance was not recorded.`);
        return;
      }

      const attendance = await recordAttendanceForEmployee(faceResult.employee, facePhoto, faceResult);
      setFaceMessage(`${attendance.action} recorded for ${faceResult.employee.employee_name || faceResult.employee.employee_id}${attendance.time ? ` at ${attendance.time}` : ''}.`);
      setFacePhoto('');
      setFaceLivenessConfirmed(false);
    } catch (error) {
      setFaceError(error?.message || 'Face recognition attendance failed. Please try again.');
    } finally {
      setFaceSubmitting(false);
    }
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
              <span className="text-xs font-medium text-green-800">{scannedEmployee.first_name} {scannedEmployee.last_name}</span>
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
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {protectedTabs.has(tab.id) && (!scannedEmployee || authorizedTab !== tab.id) && (
                <Scan className="w-3 h-3 text-muted-foreground/50" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {activeTab === 'scan' && (
          <div className="mx-auto max-w-xl p-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAttendanceMode('face');
                    setFaceError('');
                    setFaceMessage('');
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    attendanceMode === 'face'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Face Recognition
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAttendanceMode('qr');
                    setFaceError('');
                    setFaceMessage('');
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    attendanceMode === 'qr'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  QR Code + Face
                </button>
              </div>
            </div>

            {attendanceMode === 'face' ? (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Attendance Face Recognition</h2>
                  <p className="text-sm text-muted-foreground">
                    Capture your face to identify your enrolled profile and record attendance.
                  </p>
                </div>
                <FaceCapture
                  onCapture={(value) => {
                    setFacePhoto(value);
                    setFaceError('');
                    setFaceMessage('');
                  }}
                  onLivenessDetected={() => setFaceLivenessConfirmed(true)}
                  onReset={() => {
                    setFacePhoto('');
                    setFaceLivenessConfirmed(false);
                    setFaceError('');
                    setFaceMessage('');
                  }}
                  autoStart
                  autoCaptureOnLiveness
                  disabled={faceSubmitting}
                />
                <div className={`rounded-lg border p-3 text-xs ${
                  faceLivenessConfirmed
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  {faceLivenessConfirmed
                    ? 'Liveness detected. Ready to verify.'
                    : 'Blink or turn your head slightly while your face is inside the guide.'}
                </div>
                {faceError && <p className="text-sm font-medium text-destructive">{faceError}</p>}
                {faceMessage && <p className="text-sm font-medium text-emerald-700">{faceMessage}</p>}
                <Button
                  className="w-full"
                  onClick={submitFaceAttendance}
                  disabled={faceSubmitting || !facePhoto || !faceLivenessConfirmed}
                >
                  {faceSubmitting ? 'Verifying...' : 'Verify Face and Record Attendance'}
                </Button>
              </div>
            ) : (
              <EmployeeQRGate
                key={scanKey}
                companyProfileId={activeCompanyId}
                onEmployeeScanned={(employee) => {
                  setScanConfirm({
                    employee,
                    name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
                  });
                }}
                promptMessage="Scan your QR code to start attendance face verification"
                title="Attendance Logger"
                description="Scan your QR code, then verify your face before attendance is recorded"
              />
            )}
          </div>
        )}
        {showGate && (
          <PortalAccessGate
            key={`${activeTab}-${scanKey}`}
            activeCompanyId={activeCompanyId}
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
            {/* Success */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-foreground">
                {scanConfirm.action ? `${scanConfirm.action} Recorded` : 'Verify Face to Record Attendance'}
              </h2>
              <p className="text-lg font-medium text-primary">{scanConfirm.name}</p>
              {scanConfirm.time && <p className="text-muted-foreground text-sm">{scanConfirm.time}</p>}
            </div>

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

            {/* Photo capture preview */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Identity Photo</p>
              <div className="relative w-full aspect-video bg-muted rounded-xl overflow-hidden flex items-center justify-center border border-border">
                <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${photoStatus === 'done' ? 'hidden' : ''}`} />
                {photoStatus === 'done' && photoDataUrl && (
                  <img src={photoDataUrl} alt="Captured" className="w-full h-full object-cover" />
                )}
                {photoStatus !== 'done' && photoStatus !== 'error' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[72%] w-[46%] min-w-32 rounded-[42%] border-2 border-emerald-400/90 shadow-[0_0_0_999px_rgba(15,23,42,0.22)]">
                      <div className="absolute -left-1 -top-1 h-7 w-7 border-l-4 border-t-4 border-white" />
                      <div className="absolute -right-1 -top-1 h-7 w-7 border-r-4 border-t-4 border-white" />
                      <div className="absolute -bottom-1 -left-1 h-7 w-7 border-b-4 border-l-4 border-white" />
                      <div className="absolute -bottom-1 -right-1 h-7 w-7 border-b-4 border-r-4 border-white" />
                    </div>
                    <div className="absolute bottom-3 rounded-md bg-slate-950/70 px-3 py-1 text-xs text-white">
                      Align your whole face inside the guide
                    </div>
                  </div>
                )}
                {photoStatus === 'capturing' && !photoDataUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white text-xs">
                    <Camera className="w-6 h-6 animate-pulse" />
                    <span>Capturing photo...</span>
                  </div>
                )}
                {photoStatus === 'error' && (
                  <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground text-xs p-4 text-center">
                    <Camera className="w-6 h-6 opacity-30" />
                    <span>Camera not available</span>
                  </div>
                )}
              </div>
              {(photoStatus === 'done' || photoStatus === 'error') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    setPhotoSubmitError('');
                    setPhotoCaptureKey(k => k + 1);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" /> Retake Photo
                </Button>
              )}
              {photoSubmitError && (
                <p className="text-xs font-medium text-destructive text-center">{photoSubmitError}</p>
              )}
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={livenessConfirmed}
                  onChange={event => setLivenessConfirmed(event.target.checked)}
                  className="h-4 w-4"
                />
                I blinked or turned my head slightly before this capture.
              </label>
            </div>

            <Button
              className="w-full"
              disabled={photoStatus === 'capturing' || photoStatus === 'uploading'}
              onClick={async () => {
                if (!photoDataUrl || photoStatus !== 'done') {
                  setPhotoSubmitError('Photo is required. Please retake the photo to complete this attendance record.');
                  return;
                }

                if (!livenessConfirmed) {
                  setPhotoSubmitError('Please complete and confirm the live blink/head-turn check.');
                  return;
                }

                try {
                  setPhotoSubmitError('');
                  setPhotoStatus('uploading');
                  const employee = scanConfirm.employee;
                  const faceResult = await faceVerificationApi.attendance({
                    employeeId: employee.employee_id,
                    employeeRecordId: employee.id,
                    companyProfileId: employee.company_profile_id || activeCompanyId,
                    imageBase64: photoDataUrl,
                    livenessConfirmed,
                  });
                  if (faceResult.enabled !== false && faceResult.result !== 'verified') {
                    setPhotoStatus('done');
                    setPhotoSubmitError(`Face verification ${faceResult.result}. Attendance was not recorded.`);
                    return;
                  }

                  const location = await captureAttendanceLocation();
                  const logRes = await appApi.functions.invoke('logAttendance', {
                    employee_id: employee.employee_id,
                    employee_record_id: employee.id,
                    company_profile_id: employee.company_profile_id || activeCompanyId,
                    location,
                  });
                  if (logRes.duplicate) {
                    setPhotoStatus('done');
                    setPhotoSubmitError(logRes.message || 'Scan already recorded. Please wait before scanning again.');
                    return;
                  }

                  const blob = await fetch(photoDataUrl).then(r => r.blob());
                  const action = logRes.action;
                  const photoField = attendancePhotoFields[action];
                  const file = new File([blob], `${action || 'attendance'}_photo.jpg`, { type: 'image/jpeg' });
                  const { file_url } = await appApi.integrations.Core.UploadFile({ file });
                  await appApi.entities.AttendanceLog.update(logRes.log.id, {
                    ...(photoField ? { [photoField]: file_url, photo_action: action } : {}),
                    photo_url: file_url,
                    face_verification_result: faceResult.result,
                    face_verification_confidence: faceResult.confidenceScore ?? null,
                    face_verification_log_id: faceResult.log?.id || null,
                  });
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
                  setScanConfirm({
                    ...scanConfirm,
                    action: actionLabels[action] || 'Attendance',
                    time: timeField && logRes.log?.[timeField] ? formatManilaTime(logRes.log[timeField]) : '',
                  });
                } catch {
                  setPhotoStatus('done');
                  setPhotoSubmitError('Face verification or attendance logging failed. Please retake the photo and try again.');
                  return;
                }
                setScanConfirm(null);
                setScanKey(k => k + 1);
              }}
            >
              {photoStatus === 'capturing' ? 'Capturing photo...' : photoStatus === 'uploading' ? 'Saving photo...' : 'I Understand — Done'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
