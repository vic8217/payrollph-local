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

export default function EmployeePortal() {
  const [activeTab, setActiveTab] = useState('scan');
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
          <EmployeeQRGate
            key={scanKey}
            companyProfileId={activeCompanyId}
            onAttendanceLogged={(info) => setScanConfirm(info)}
          />
        )}
        {showGate && (
          <EmployeeQRGate
            key={`${activeTab}-${scanKey}`}
            companyProfileId={activeCompanyId}
            onEmployeeScanned={handleEmployeeScanned}
            promptMessage={`Scan your QR code to access ${tabs.find(t => t.id === activeTab)?.label}`}
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
              <h2 className="text-xl font-bold text-foreground">{scanConfirm.action} Recorded</h2>
              <p className="text-lg font-medium text-primary">{scanConfirm.name}</p>
              <p className="text-muted-foreground text-sm">{scanConfirm.time}</p>
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
            </div>

            <Button
              className="w-full"
              disabled={photoStatus === 'capturing' || photoStatus === 'uploading'}
              onClick={async () => {
                if (!photoDataUrl || photoStatus !== 'done') {
                  setPhotoSubmitError('Photo is required. Please retake the photo to complete this attendance record.');
                  return;
                }

                if (!scanConfirm.logId) {
                  setPhotoSubmitError('Attendance record was not found. Please scan again.');
                  return;
                }

                try {
                  setPhotoSubmitError('');
                  setPhotoStatus('uploading');
                  const blob = await fetch(photoDataUrl).then(r => r.blob());
                  const action = scanConfirm.attendanceAction;
                  const photoField = attendancePhotoFields[action];
                  const file = new File([blob], `${action || 'attendance'}_photo.jpg`, { type: 'image/jpeg' });
                  const { file_url } = await appApi.integrations.Core.UploadFile({ file });
                  await appApi.entities.AttendanceLog.update(scanConfirm.logId, {
                    ...(photoField ? { [photoField]: file_url, photo_action: action } : {}),
                    photo_url: file_url,
                  });
                } catch {
                  setPhotoStatus('done');
                  setPhotoSubmitError('Photo upload failed. Please retake the photo and try again.');
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
