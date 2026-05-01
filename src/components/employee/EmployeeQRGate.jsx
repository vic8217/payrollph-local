import { useState, useRef, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import { QrCode, CheckCircle2, Scan, Camera, CameraOff, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

/**
 * @typedef {object} Employee
 * @property {string} employee_id
 * @property {string} first_name
 * @property {string} last_name
 */

/**
 * @typedef {object} ScanResult
 * @property {boolean} success
 * @property {string} message
 * @property {string=} name
 * @property {string=} time
 */

/**
 * @typedef {object} AttendanceInfo
 * @property {string} name
 * @property {string} action
 * @property {string} time
 * @property {string=} logId
 */

/**
 * @typedef {'time_in' | 'break_time_out' | 'break_time_in' | 'time_out' | 'duplicate_scan'} AttendanceAction
 */

// Used both as: standalone QR scanner page AND as gating screen before protected tabs
/**
 * @param {object} props
 * @param {(employee: Employee) => void=} props.onEmployeeScanned
 * @param {(info: AttendanceInfo) => void=} props.onAttendanceLogged
 * @param {string=} props.promptMessage
 */
export default function EmployeeQRGate({ onEmployeeScanned, onAttendanceLogged, promptMessage }) {
  const [mode, setMode] = useState('camera');
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(/** @type {ScanResult | null} */ (null));
  const [cameraError, setCameraError] = useState(/** @type {string | null} */ (null));
  const [cameraStarting, setCameraStarting] = useState(false);
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const scannerRef = useRef(/** @type {any} */ (null));
  const startingRef = useRef(false);
  const startTokenRef = useRef(0);
  const lockedRef = useRef(false); // sync lock to prevent multiple scans
  const today = format(new Date(), 'yyyy-MM-dd');
  const isGateMode = !!promptMessage; // gate mode = just verify, don't log attendance
  const readerId = isGateMode ? 'employee-qr-gate-reader' : 'employee-attendance-reader';

  // No pre-load needed — we use the backend function for lookups

  useEffect(() => {
    return () => { void stopCamera(); };
  }, []);

  useEffect(() => {
    if (mode === 'camera') startCamera();
    else { void stopCamera(); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [mode]);

  const startCamera = async () => {
    if (scannerRef.current || startingRef.current) return;
    startingRef.current = true;
    const token = ++startTokenRef.current;
    setCameraError(null);
    setCameraStarting(true);

    try {
      if (!window.isSecureContext) {
        throw new Error('Camera access requires HTTPS on phones. Open the employee portal using an HTTPS URL, or use manual entry.');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not available in this browser. Use manual entry or try another browser.');
      }

      const { Html5Qrcode } = await import('html5-qrcode');
      // Wait for the element to be in the DOM
      await new Promise(r => setTimeout(r, 100));

      if (token !== startTokenRef.current) return;

      const readerEl = document.getElementById(readerId);
      if (!readerEl) return;

      const scanner = new Html5Qrcode(readerId);

      if (token !== startTokenRef.current) {
        scanner.clear();
        return;
      }

      scannerRef.current = scanner;
      await startScanner(scanner);
    } catch (error) {
      if (token === startTokenRef.current) scannerRef.current = null;
      const message = error instanceof Error ? error.message : '';
      setCameraError(message || 'Camera access was denied or is not available. Allow camera permission, then try again.');
    } finally {
      if (token === startTokenRef.current) startingRef.current = false;
      if (token === startTokenRef.current) setCameraStarting(false);
    }
  };

  /**
   * @param {any} scanner
   */
  const startScanner = async (scanner) => {
    const config = {
      fps: 10,
      qrbox: (/** @type {number} */ viewfinderWidth, /** @type {number} */ viewfinderHeight) => {
        const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
        return { width: Math.max(220, Math.min(size, 320)), height: Math.max(220, Math.min(size, 320)) };
      },
      aspectRatio: 1,
    };

    const onSuccess = (/** @type {string} */ text) => processCode(text);
    const onFailure = () => {};

    try {
      await scanner.start({ facingMode: 'environment' }, config, onSuccess, onFailure);
      return;
    } catch {
      const { Html5Qrcode } = await import('html5-qrcode');
      const devices = await Html5Qrcode.getCameras();
      const preferred = devices.find((/** @type {{ label: string }} */ device) => /back|rear|environment/i.test(device.label)) || devices[0];
      if (!preferred) throw new Error('No camera was found on this device.');
      await scanner.start(preferred.id, config, onSuccess, onFailure);
    }
  };

  const stopCamera = async () => {
    startTokenRef.current += 1;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    setCameraStarting(false);

    if (scanner) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        try { scanner.clear(); } catch {}
      }
    }
  };

  const retryCamera = async () => {
    setCameraError(null);
    setMode('camera');
    await stopCamera();
    setTimeout(() => { void startCamera(); }, 100);
  };

  /**
   * @param {string} value
   */
  const processCode = async (value) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setProcessing(true);

    // Stop camera immediately to prevent multiple scans, then switch to manual to show result
    if (scannerRef.current) {
      const s = scannerRef.current;
      scannerRef.current = null;
      s.stop().then(() => s.clear()).catch(() => {});
      setMode('manual');
    }

    const trimmed = value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Use backend function (service role) so it works even when user is not logged in
    let emp = null;
    try {
      const res = await appApi.functions.invoke('lookupEmployee', { code: trimmed });
      emp = res.employee;
    } catch {
      emp = null;
    }

    if (!emp) {
      setResult({ success: false, message: 'Employee ID not found' });
      setProcessing(false);
      lockedRef.current = false;
      setTimeout(() => { setResult(null); inputRef.current?.focus(); }, 3000);
      return;
    }

    if (isGateMode) {
      // Just verify identity, pass employee up
      setResult({ success: true, message: `Welcome, ${emp.first_name}!`, name: `${emp.first_name} ${emp.last_name}` });
      setProcessing(false);
      setTimeout(() => { lockedRef.current = false; onEmployeeScanned?.(emp); }, 800);
      return;
    }

    // Full attendance logging — use backend function (service role, works on public portal)
    const empName = `${emp.first_name} ${emp.last_name}`;
    const logRes = await appApi.functions.invoke('logAttendance', { employee_id: emp.employee_id, today });
    const { action, log } = logRes;
    const now = new Date();
    if (logRes.duplicate) {
      setResult({ success: false, message: logRes.message || 'Scan already recorded. Please wait before scanning again.' });
      setInput('');
      setProcessing(false);
      lockedRef.current = false;
      setTimeout(() => { setResult(null); setMode('camera'); }, 3000);
      return;
    }

    /** @type {Record<AttendanceAction, string>} */
    const actionLabels = {
      time_in: 'Time In',
      break_time_out: 'Break Out',
      break_time_in: 'Break In',
      time_out: 'Time Out',
      duplicate_scan: 'Duplicate Scan',
    };
    const actionLabel = actionLabels[/** @type {AttendanceAction} */ (action)] || 'Attendance';

    setResult({ success: true, message: `${actionLabel} recorded`, name: empName, time: format(now, 'h:mm a') });
    onAttendanceLogged?.({ name: empName, action: actionLabel, time: format(now, 'h:mm a'), logId: log?.id });

    setInput('');
    setProcessing(false);
    lockedRef.current = false;
    setTimeout(() => { setResult(null); setMode('camera'); }, 5000);
  };

  /**
   * @param {React.FormEvent<HTMLFormElement>} e
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) processCode(input.trim());
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      {isGateMode ? (
        <div className="text-center space-y-1">
          <Scan className="w-10 h-10 text-primary mx-auto" />
          <h2 className="text-lg font-bold text-foreground">{promptMessage}</h2>
          <p className="text-sm text-muted-foreground">Scan or enter your Employee ID to continue</p>
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-bold text-foreground">Attendance Logger</h2>
          <p className="text-muted-foreground text-sm mt-0.5">Scan your QR code to record time in/out</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        {/* Mode toggle — hidden, camera is default */}

        {mode === 'camera' ? (
          <div className="space-y-3">
            <div className="relative min-h-[280px] w-full rounded-lg overflow-hidden bg-muted">
              <div
                id={readerId}
                className="w-full [&_video]:!block [&_video]:!w-full [&_video]:!h-auto"
              />
              {cameraStarting && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
                  <Camera className="h-8 w-8 animate-pulse" />
                  <span>Starting camera...</span>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <CameraOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p>{cameraError}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={retryCamera}>
                <Camera className="mr-1.5 h-4 w-4" /> Retry Camera
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setMode('manual')}>
                <Keyboard className="mr-1.5 h-4 w-4" /> Manual Entry
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-center"><QrCode className="w-10 h-10 text-primary/30" /></div>
            <p className="text-center text-sm text-muted-foreground">Type employee ID or scan with USB QR reader</p>
            <div className="flex gap-2">
              <Input ref={inputRef} value={input} onChange={(/** @type {React.ChangeEvent<HTMLInputElement>} */ e) => setInput(e.target.value)} placeholder="Employee ID..." className="flex-1" autoFocus />
              <Button type="submit" disabled={processing || !input.trim()}>
                {processing ? '...' : isGateMode ? 'Verify' : 'Record'}
              </Button>
            </div>
          </form>
        )}

        {result && (
          <div className={`flex items-center gap-3 p-4 rounded-lg ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <CheckCircle2 className={`w-5 h-5 ${result.success ? 'text-green-600' : 'text-red-500'}`} />
            <div>
              <p className={`text-sm font-medium ${result.success ? 'text-green-800' : 'text-red-700'}`}>
                {result.success ? `${result.name} — ${result.message}` : result.message}
              </p>
              {result.time && <p className="text-xs text-green-600">{result.time}</p>}
            </div>
          </div>
        )}
      </div>


    </div>
  );
}
