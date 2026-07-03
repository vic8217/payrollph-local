import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Keyboard, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { requestJson } from '@/lib/appApi';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import FaceCapture from '@/components/face/FaceCapture';

async function uploadPhoto(dataUrl) {
  return requestJson('/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      name: `payslip-acknowledgement-${Date.now()}.jpg`,
      dataUrl,
    }),
  });
}

export default function PayslipAcknowledgementDialog({ employee, record, open, onClose, onAcknowledged }) {
  const [mode, setMode] = useState('face');
  const [qrCode, setQrCode] = useState('');
  const [passkey, setPasskey] = useState('');
  const [scannerMode, setScannerMode] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoStatus, setPhotoStatus] = useState('idle');
  const [facePhoto, setFacePhoto] = useState('');
  const [faceLivenessConfirmed, setFaceLivenessConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);
  const photoStreamRef = useRef(null);

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try { await scanner.stop(); } catch {}
      try { scanner.clear(); } catch {}
    }
  };

  const stopPhoto = () => {
    if (photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach(track => track.stop());
      photoStreamRef.current = null;
    }
  };

  const reset = () => {
    void stopScanner();
    stopPhoto();
    setQrCode('');
    setPasskey('');
    setMode('face');
    setScannerMode(false);
    setPhotoDataUrl('');
    setPhotoStatus('idle');
    setFacePhoto('');
    setFaceLivenessConfirmed(false);
    setError('');
    setSaving(false);
  };

  useEffect(() => {
    if (!open) reset();
    return () => {
      void stopScanner();
      stopPhoto();
    };
  }, [open]);

  const startQrScanner = async () => {
    setError('');
    setScannerMode(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      await new Promise(resolve => setTimeout(resolve, 100));
      const scanner = new Html5Qrcode('payslip-acknowledgement-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: 220 },
        async text => {
          setQrCode(text);
          await stopScanner();
          setScannerMode(false);
        },
        () => {},
      );
    } catch {
      await stopScanner();
      setScannerMode(false);
      setError('QR camera is unavailable. Use a QR scanner or enter the employee code.');
    }
  };

  const capturePhoto = async () => {
    stopPhoto();
    setError('');
    setPhotoDataUrl('');
    setPhotoStatus('capturing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      photoStreamRef.current = stream;
      if (!videoRef.current) throw new Error('Camera preview unavailable');
      videoRef.current.srcObject = stream;
      await new Promise(resolve => { videoRef.current.onloadedmetadata = resolve; });
      await videoRef.current.play();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.85));
      setPhotoStatus('done');
      stopPhoto();
    } catch {
      stopPhoto();
      setPhotoStatus('error');
      setError('Employee photo is required. Allow camera access and try again.');
    }
  };

  const submitFace = async () => {
    if (!facePhoto || !faceLivenessConfirmed) {
      setError('Complete the live face capture before acknowledging this payslip.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const faceResult = await faceVerificationApi.attendance({
        employeeId: employee.employee_id,
        employeeRecordId: employee.id,
        companyProfileId: employee.company_profile_id,
        imageBase64: facePhoto,
        livenessConfirmed: faceLivenessConfirmed,
      });
      if (faceResult.enabled === false) {
        setError('Face verification is disabled. Use QR code + passkey instead.');
        return;
      }
      if (faceResult.result !== 'verified') {
        setError(`Face verification ${faceResult.result}. Payslip was not acknowledged.`);
        return;
      }

      const uploaded = await uploadPhoto(facePhoto);
      const result = await requestJson('/api/functions/acknowledgePayslip', {
        method: 'POST',
        body: JSON.stringify({
          payroll_record_id: record.id,
          employee_record_id: employee.id,
          photo_url: uploaded.file_url,
          face_verification_result: faceResult.result,
          face_verification_confidence: faceResult.confidenceScore ?? null,
          face_verification_log_id: faceResult.log?.id || null,
        }),
      });
      onAcknowledged(result.record);
      onClose();
    } catch (submitError) {
      setError(submitError?.message || 'Unable to acknowledge payslip.');
    } finally {
      setSaving(false);
    }
  };

  const submitLegacy = async () => {
    if (!qrCode.trim() || !/^\d{4}$/.test(passkey) || !photoDataUrl) {
      setError('Scan the employee QR, enter the 4-digit passkey, and capture the employee photo.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const uploaded = await uploadPhoto(photoDataUrl);
      const result = await requestJson('/api/functions/acknowledgePayslip', {
        method: 'POST',
        body: JSON.stringify({
          payroll_record_id: record.id,
          employee_record_id: employee.id,
          qr_code: qrCode.trim(),
          passkey,
          photo_url: uploaded.file_url,
        }),
      });
      onAcknowledged(result.record);
      onClose();
    } catch (submitError) {
      setError(submitError?.message || 'Unable to acknowledge payslip.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Acknowledge Payslip Receipt</DialogTitle>
          <DialogDescription>
            Confirm receipt of {record?.period_name} using your enrolled face. QR code + passkey remains available as fallback.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('face');
                  setError('');
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
                  setMode('legacy');
                  setError('');
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'legacy'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                QR + Passkey
              </button>
            </div>
          </div>

          {mode === 'face' ? (
            <>
              <FaceCapture
                onCapture={(value) => {
                  setFacePhoto(value);
                  setError('');
                }}
                onLivenessDetected={() => setFaceLivenessConfirmed(true)}
                onReset={() => {
                  setFacePhoto('');
                  setFaceLivenessConfirmed(false);
                  setError('');
                }}
                autoStart
                autoCaptureOnLiveness
                disabled={saving}
              />
              <div className={`rounded-lg border p-3 text-xs ${
                faceLivenessConfirmed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {faceLivenessConfirmed
                  ? 'Liveness detected. Ready to acknowledge.'
                  : 'Blink or turn your head slightly while your face is inside the guide.'}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Employee QR code</label>
                {scannerMode ? (
                  <div id="payslip-acknowledgement-reader" className="overflow-hidden rounded-lg border border-border" />
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={qrCode}
                      onChange={event => setQrCode(event.target.value)}
                      placeholder="Scan or enter employee QR"
                    />
                    <Button variant="outline" size="icon" onClick={startQrScanner} title="Use camera">
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {qrCode && (
                  <p className="flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> QR value captured
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium">4-digit passkey</label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={passkey}
                  onChange={event => setPasskey(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="mt-1 text-center font-mono tracking-[0.5em]"
                  placeholder="••••"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Employee identity photo</label>
                <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
                  {photoDataUrl ? (
                    <img src={photoDataUrl} alt="Employee acknowledgement" className="w-full h-full object-cover" />
                  ) : (
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  )}
                  {photoStatus === 'idle' && <Camera className="w-8 h-8 text-muted-foreground absolute" />}
                </div>
                <Button variant="outline" className="w-full gap-2" onClick={capturePhoto}>
                  <Camera className="w-4 h-4" />
                  {photoDataUrl ? 'Retake Photo' : photoStatus === 'capturing' ? 'Capturing...' : 'Capture Photo'}
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={mode === 'face' ? submitFace : submitLegacy}
              disabled={saving || (mode === 'face' && (!facePhoto || !faceLivenessConfirmed))}
              className="gap-2"
            >
              {mode === 'face' ? <CheckCircle2 className="w-4 h-4" /> : <Keyboard className="w-4 h-4" />}
              {saving ? 'Verifying...' : 'Acknowledge Receipt'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
