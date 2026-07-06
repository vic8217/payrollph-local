import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Keyboard, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { requestJson } from '@/lib/appApi';
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
  const [qrCode, setQrCode] = useState('');
  const [passkey, setPasskey] = useState('');
  const [scannerMode, setScannerMode] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoMetadata, setPhotoMetadata] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scannerRef = useRef(null);

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try { await scanner.stop(); } catch {}
      try { scanner.clear(); } catch {}
    }
  };

  const reset = () => {
    void stopScanner();
    setQrCode('');
    setPasskey('');
    setScannerMode(false);
    setPhotoDataUrl('');
    setPhotoMetadata(null);
    setPhotoError('');
    setLivenessConfirmed(false);
    setError('');
    setSaving(false);
  };

  useEffect(() => {
    if (!open) reset();
    return () => {
      void stopScanner();
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

  const submitAcknowledgement = async () => {
    if (!qrCode.trim() || !/^\d{4}$/.test(passkey) || !photoDataUrl || !photoMetadata || !livenessConfirmed) {
      setError('Scan the employee QR, enter the 4-digit passkey, and complete the live photo check.');
      return;
    }
    if (photoError) {
      setError(photoError);
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
            Confirm receipt of {record?.period_name} with employee QR, passkey, and a live identity photo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <label className="text-sm font-medium">Employee live identity photo</label>
            <FaceCapture
              onCapture={(value, metadata) => {
                setPhotoDataUrl(value);
                setPhotoMetadata(metadata);
                setPhotoError('');
                setError('');
              }}
              onLivenessDetected={() => setLivenessConfirmed(true)}
              onReset={() => {
                setPhotoDataUrl('');
                setPhotoMetadata(null);
                setPhotoError('');
                setLivenessConfirmed(false);
                setError('');
              }}
              onErrorChange={setPhotoError}
              autoStart
              autoCaptureOnLiveness
              disabled={saving}
            />
            <div className={`rounded-lg border p-3 text-xs ${
              livenessConfirmed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              {livenessConfirmed
                ? 'Liveness detected. Ready to acknowledge.'
                : 'Blink or turn your head slightly while your face is inside the guide.'}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={submitAcknowledgement}
              disabled={saving || !qrCode.trim() || !/^\d{4}$/.test(passkey) || !photoDataUrl || !photoMetadata || !livenessConfirmed || Boolean(photoError)}
              className="gap-2"
            >
              <Keyboard className="w-4 h-4" />
              {saving ? 'Acknowledging...' : 'Acknowledge Receipt'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
