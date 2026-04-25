import { useState, useRef, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, CheckCircle2, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';

// Employee identity is already verified by the QR gate scan — skip QR step, go straight to photo
export default function ReceiveAdvanceDialog({ advance, employee, open, onClose, onSuccess }) {
  const [step, setStep] = useState('photo'); // 'photo' | 'confirming'
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [uploading, setUploading] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Start selfie camera when dialog opens
  useEffect(() => {
    if (!open) return;
    setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        // fallback
      }
    }, 200);
    return () => {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, [open, step]);

  const capturePhoto = () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.9));
    setStep('confirming');
  };

  const handleConfirm = async () => {
    setUploading(true);
    // Convert dataUrl to blob/file
    const res = await fetch(photoDataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'receipt-selfie.jpg', { type: 'image/jpeg' });
    const { file_url } = await appApi.integrations.Core.UploadFile({ file });

    await appApi.entities.CashAdvance.update(advance.id, {
      received: true,
      received_date: format(new Date(), 'yyyy-MM-dd'),
      received_photo_url: file_url,
    });

    setUploading(false);
    onSuccess();
    handleClose();
  };

  const handleClose = () => {
    setStep('photo');
    setPhotoDataUrl(null);
    setUploading(false);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'photo' && <><Camera className="w-4 h-4 text-primary" /> Take Confirmation Photo</>}
            {step === 'confirming' && <><CheckCircle2 className="w-4 h-4 text-green-600" /> Confirm Receipt</>}
          </DialogTitle>
        </DialogHeader>

        {step === 'photo' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center">
              Please take a selfie to confirm receipt of the emergency cash advance.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3]">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button size="sm" className="flex-1 gap-1" onClick={capturePhoto}>
                <Camera className="w-4 h-4" /> Capture
              </Button>
            </div>
          </div>
        )}

        {step === 'confirming' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center">
              Review your photo and confirm receipt of <strong>₱{(advance?.amount_approved || advance?.amount_requested || 0).toLocaleString()}</strong>.
            </p>
            {photoDataUrl && (
              <img src={photoDataUrl} alt="Receipt selfie" className="w-full rounded-lg border border-border object-cover aspect-[4/3]" />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => setStep('photo')}>
                <X className="w-3.5 h-3.5" /> Retake
              </Button>
              <Button size="sm" className="flex-1 gap-1 bg-green-600 hover:bg-green-700" onClick={handleConfirm} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {uploading ? 'Saving...' : 'Confirm Received'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}