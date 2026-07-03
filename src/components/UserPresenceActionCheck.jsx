import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import FaceCapture from '@/components/face/FaceCapture';
import { userPresenceApi } from '@/lib/userPresenceApi';
import { Button } from '@/components/ui/button';

export default function UserPresenceActionCheck({ onVerified, disabled = false }) {
  const [challenge, setChallenge] = useState(null);
  const [imageBase64, setImageBase64] = useState('');
  const [captureMetadata, setCaptureMetadata] = useState(null);
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const prepareChallenge = async () => {
    setError('');
    setMessage('');
    setVerified(false);
    onVerified?.(false);
    const result = await userPresenceApi.challenge({ purpose: 'high_risk_action' });
    setChallenge(result.challenge || null);
    setImageBase64('');
    setCaptureMetadata(null);
    setLivenessConfirmed(false);
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await userPresenceApi.verify({
        purpose: 'high_risk_action',
        imageBase64,
        captureMetadata,
        livenessConfirmed,
        challengeId: challenge?.id,
        challengeNonce: challenge?.nonce,
      });
      if (result.enabled === false || result.result === 'verified') {
        setVerified(true);
        onVerified?.(true);
        setMessage('Face verification completed for this action.');
      } else {
        setChallenge(null);
        setImageBase64('');
        setCaptureMetadata(null);
        setLivenessConfirmed(false);
        setError(`Face verification ${result.result}.`);
      }
    } catch (verifyError) {
      setChallenge(null);
      setImageBase64('');
      setCaptureMetadata(null);
      setLivenessConfirmed(false);
      setError(verifyError?.message || 'Face verification failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <p className="text-sm font-medium">Face verification</p>
          <p className="text-xs text-muted-foreground">Required in addition to approval passcodes for this action.</p>
        </div>
      </div>
      {!verified && (
        <>
          <FaceCapture
            onBeforeStart={prepareChallenge}
            onCapture={(value, metadata) => {
              setImageBase64(value);
              setCaptureMetadata(metadata);
              setError('');
            }}
            onLivenessDetected={() => setLivenessConfirmed(true)}
            onReset={() => {
              setImageBase64('');
              setCaptureMetadata(null);
              setLivenessConfirmed(false);
              setMessage('');
            }}
            autoCaptureOnLiveness
            disabled={disabled || busy}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={verify}
            disabled={disabled || busy || !challenge || !imageBase64 || !livenessConfirmed}
          >
            {busy ? 'Verifying...' : 'Verify Face for Action'}
          </Button>
        </>
      )}
      {verified && <p className="text-xs font-medium text-emerald-700">Face verification is ready for this action.</p>}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
