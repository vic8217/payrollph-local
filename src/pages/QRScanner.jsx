import { useState, useRef, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { QrCode, Camera, CameraOff, Keyboard, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

const normalizeQrValue = (value) => String(value || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/-PayrollPH$/i, '');

function addOneDay(date) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return format(d, 'yyyy-MM-dd');
}

function scheduledBreakIn(employee, date) {
  if (!employee?.break_time) return null;

  const [hours, minutes] = String(employee.break_time).split(':').map(Number);
  const breakDate = employee.work_schedule === 'night_shift' && hours < 12 ? addOneDay(date) : date;
  const total = hours * 60 + minutes + 30;
  const normalized = total % (24 * 60);
  const breakInDate = total >= 24 * 60 ? addOneDay(breakDate) : breakDate;
  const breakInTime = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;

  return new Date(`${breakInDate}T${breakInTime}:00+08:00`).toISOString();
}

function isAutoScheduledBreakIn(employee, date, value) {
  const autoBreakIn = scheduledBreakIn(employee, date);
  return !!value && !!autoBreakIn && new Date(value).getTime() === new Date(autoBreakIn).getTime();
}

export default function QRScanner() {
  const navigate = useNavigate();
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cameraMode, setCameraMode] = useState(true);
  const [cameraError, setCameraError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const inputRef = useRef(null);
  const html5QrRef = useRef(null);
  const lockedRef = useRef(false);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => appApi.entities.Employee.list('-created_date', 200),
  });
  const employeesRef = useRef([]);
  useEffect(() => { employeesRef.current = employees; }, [employees]);

  useEffect(() => {
    if (!cameraMode) inputRef.current?.focus();
  }, [cameraMode]);

  // After scanning, look up employee + today's log, then navigate to confirm page
  const handleQRDetected = async (qrValue) => {
    if (lockedRef.current || loading) return;
    lockedRef.current = true;
    setLoading(true);
    setScanError(null);

    // Stop scanner immediately
    if (html5QrRef.current) {
      const s = html5QrRef.current;
      html5QrRef.current = null;
      s.stop().catch(() => {});
    }

    const trimmed = qrValue.trim();
    const normalized = normalizeQrValue(trimmed);
    const employee = employeesRef.current.find(e =>
      normalizeQrValue(e.qr_code) === normalized || normalizeQrValue(e.employee_id) === normalized
    );

    if (!employee) {
      setScanError(`No employee found for: ${trimmed}`);
      setScanInput('');
      setLoading(false);
      lockedRef.current = false;
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const existing = await appApi.entities.AttendanceLog.filter({ employee_id: employee.employee_id, date: today });
    const sorted = existing.sort((a, b) => (b.time_in || '').localeCompare(a.time_in || ''));
    const todayLog = sorted[0];

    let action;
    const hasActualBreakIn = todayLog?.break_time_in && !isAutoScheduledBreakIn(employee, today, todayLog.break_time_in);
    if (!todayLog || !todayLog.time_in) {
      action = 'time_in';
    } else if (employee.break_time && !hasActualBreakIn && !todayLog.time_out) {
      action = 'break_time_in';
    } else if (todayLog.time_in && !todayLog.time_out) {
      action = 'time_out';
    } else {
      setScanError(`${employee.first_name} already completed attendance today.`);
      setScanInput('');
      setLoading(false);
      lockedRef.current = false;
      return;
    }

    // Navigate to confirm page — pass data via query params
    const params = new URLSearchParams({
      empId: employee.employee_id,
      action,
      logId: todayLog?.id || '',
    });
    navigate(`/scan/confirm?${params.toString()}`);
  };

  // Camera list
  useEffect(() => {
    if (!cameraMode) return;
    lockedRef.current = false;
    Html5Qrcode.getCameras()
      .then((devices) => {
        setCameras(devices);
        if (devices.length > 0 && !selectedCameraId) {
          const back = devices.find(d => /back|rear|environment/i.test(d.label));
          setSelectedCameraId(back ? back.id : devices[0].id);
        }
      })
      .catch(() => setCameraError('Camera access denied or not available.'));
  }, [cameraMode]);

  // Start QR scanner
  useEffect(() => {
    if (!cameraMode || !selectedCameraId) return;
    setCameraError(null);
    lockedRef.current = false;

    const qrScanner = new Html5Qrcode('qr-reader');
    html5QrRef.current = qrScanner;

    qrScanner.start(
      selectedCameraId,
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
      (decodedText) => { handleQRDetected(decodedText); },
      () => {}
    ).catch(() => setCameraError('Camera access denied. Please allow camera permissions.'));

    return () => {
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
      }
    };
  }, [cameraMode, selectedCameraId]);

  const handleManualScan = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    handleQRDetected(scanInput.trim());
  };

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">QR Scanner</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Scan employee QR code to record attendance</p>
      </div>

      <Card className="border border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-4">
            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button variant={cameraMode ? 'default' : 'outline'} size="sm"
                onClick={() => { setCameraMode(true); setScanError(null); }}
                className={cameraMode ? 'bg-green-600 hover:bg-green-700' : ''}>
                <Camera className="w-4 h-4 mr-1" /> Camera
              </Button>
              <Button variant={!cameraMode ? 'default' : 'outline'} size="sm"
                onClick={() => { setCameraMode(false); setScanError(null); }}>
                <Keyboard className="w-4 h-4 mr-1" /> Manual
              </Button>
            </div>

            {cameraMode ? (
              <div className="w-full flex flex-col items-center gap-3">
                {cameraError ? (
                  <div className="flex flex-col items-center gap-2 p-6 text-center">
                    <CameraOff className="w-12 h-12 text-red-400" />
                    <p className="text-sm text-red-600">{cameraError}</p>
                    <Button variant="outline" size="sm" onClick={() => { setCameraMode(false); setCameraError(null); }}>
                      Switch to Manual
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center">
                      {loading ? '⏳ Looking up employee...' : 'Point camera at employee QR code'}
                    </p>
                    {cameras.length > 1 && (
                      <select
                        className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground w-full max-w-xs"
                        value={selectedCameraId || ''}
                        onChange={e => setSelectedCameraId(e.target.value)}
                      >
                        {cameras.map(cam => (
                          <option key={cam.id} value={cam.id}>{cam.label || `Camera ${cam.id}`}</option>
                        ))}
                      </select>
                    )}
                    <div id="qr-reader" className="w-full rounded-xl overflow-hidden" style={{ maxWidth: 380 }} />
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
                  <QrCode className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground text-center">Type employee ID or scan with USB QR reader</p>
                <form onSubmit={handleManualScan} className="w-full flex gap-2">
                  <Input
                    ref={inputRef}
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    placeholder="Employee ID..."
                    className="flex-1 text-center font-mono"
                    autoFocus
                    disabled={loading}
                  />
                  <Button type="submit" disabled={loading || !scanInput.trim()}>
                    {loading ? 'Looking up...' : 'Scan'}
                  </Button>
                </form>
              </>
            )}

            {scanError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 w-full">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {scanError}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
