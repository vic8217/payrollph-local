import { useState, useRef, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { LogIn, LogOut, Camera, CameraOff, CheckCircle2, AlertTriangle, Shield, UserCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
  const action = params.get('action'); // 'time_in' or 'time_out'
  const logId = params.get('logId');

  const [employee, setEmployee] = useState(null);
  const [todayLog, setTodayLog] = useState(null);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null); // { action, employee, hoursWorked }
  const [loadError, setLoadError] = useState(null);

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
    setConfirming(true);
    const today = format(new Date(), 'yyyy-MM-dd');
    const now = new Date().toISOString();

    if (action === 'time_in') {
      // Lunch window rule: snap time_in to 1:00pm, no overtime
      let effectiveTimeIn = now;
      if (isLunchWindow) {
        const snapped = new Date();
        snapped.setHours(13, 0, 0, 0);
        effectiveTimeIn = snapped.toISOString();
      }
      await appApi.entities.AttendanceLog.create({
        employee_id: employee.employee_id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        date: today,
        time_in: effectiveTimeIn,
        day_type: 'regular',
        status: 'pending',
        notes: isLunchWindow ? 'Time-in snapped to 1:00 PM (lunch window rule). No overtime credited.' : (capturedPhoto ? 'Photo captured on time-in' : ''),
      });
      setDone({ action: 'time_in', employee, lunchSnapped: isLunchWindow });
    } else if (action === 'time_out' && todayLog) {
      const timeIn = new Date(todayLog.time_in);
      const timeOut = new Date(now);
      const hoursWorked = Math.max(0, (timeOut - timeIn) / (1000 * 60 * 60));
      const overtime = Math.max(0, hoursWorked - 8);
      const workStart = new Date(timeIn);
      workStart.setHours(8, 0, 0, 0);
      const lateMinutes = Math.floor(Math.max(0, timeIn - workStart) / 60000);

      await appApi.entities.AttendanceLog.update(todayLog.id, {
        time_out: now,
        hours_worked: parseFloat(hoursWorked.toFixed(2)),
        overtime_hours: parseFloat(overtime.toFixed(2)),
        late_minutes: lateMinutes,
        notes: capturedPhoto ? 'Photo captured on time-out' : '',
      });
      setDone({ action: 'time_out', employee, hoursWorked });
    }

    setConfirming(false);
  };

  const handleCancel = () => navigate('/scan');

  const laborInfo = action ? LABOR_CODE_INFO[action] : null;

  // ── Success screen ──
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border border-border shadow-lg">
          <CardContent className="p-8 flex flex-col items-center gap-4 text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${done.action === 'time_in' ? 'bg-green-100' : 'bg-blue-100'}`}>
              {done.action === 'time_in'
                ? <LogIn className="w-10 h-10 text-green-600" />
                : <LogOut className="w-10 h-10 text-blue-600" />}
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {done.action === 'time_in' ? 'Time IN Recorded!' : 'Time OUT Recorded!'}
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
              {action === 'time_in'
                ? <><LogIn className="w-5 h-5 text-green-600" /> Confirm Time IN</>
                : <><LogOut className="w-5 h-5 text-blue-600" /> Confirm Time OUT</>}
            </h1>
            <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, MMMM d, yyyy · hh:mm a')}</p>
          </div>
        </div>

        {/* Employee Info */}
        <Card className={`border-2 ${action === 'time_in' ? 'border-green-300 bg-green-50' : 'border-blue-300 bg-blue-50'}`}>
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
            <div className={`px-3 py-1.5 rounded-full text-sm font-semibold ${action === 'time_in' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
              {action === 'time_in' ? 'TIME IN' : 'TIME OUT'}
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
            <FaceCapture onCapture={setCapturedPhoto} captured={capturedPhoto} />
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
            className={`flex-1 text-white ${action === 'time_in' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? 'Recording...' : `Confirm ${action === 'time_in' ? 'Time IN ✓' : 'Time OUT ✓'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}