import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import FaceCapture from '@/components/face/FaceCapture';
import { userPresenceApi } from '@/lib/userPresenceApi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

const verifiedKey = (userId) => `payrollph:user-presence-verified:${userId || 'unknown'}`;

export default function UserPresenceGate({ user, children }) {
  const qc = useQueryClient();
  const [imageBase64, setImageBase64] = useState('');
  const [captureMetadata, setCaptureMetadata] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [clientVerified, setClientVerified] = useState(() =>
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem(verifiedKey(user?.id)) === 'true'
  );

  const statusQuery = useQuery({
    queryKey: ['userPresenceStatus', user?.id],
    queryFn: () => userPresenceApi.status(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const enrollMutation = useMutation({
    mutationFn: () => userPresenceApi.enroll({
      imageBase64,
      livenessConfirmed,
      consentAccepted,
      captureMetadata,
      challengeId: challenge?.id,
      challengeNonce: challenge?.nonce,
    }),
    onSuccess: () => {
      setMessage('Face profile enrolled. Verification is now required for this session.');
      setImageBase64('');
      setCaptureMetadata(null);
      setChallenge(null);
      setLivenessConfirmed(false);
      qc.invalidateQueries({ queryKey: ['userPresenceStatus', user?.id] });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => userPresenceApi.verify({
      imageBase64,
      livenessConfirmed,
      purpose: 'post_login',
      captureMetadata,
      challengeId: challenge?.id,
      challengeNonce: challenge?.nonce,
    }),
    onSuccess: (result) => {
      if (result.enabled === false || result.result === 'verified') {
        sessionStorage.setItem(verifiedKey(user?.id), 'true');
        setClientVerified(true);
      } else {
        setMessage(`Face verification ${result.result}.`);
        setChallenge(null);
        setImageBase64('');
        setCaptureMetadata(null);
        setLivenessConfirmed(false);
      }
    },
  });

  const prepareChallenge = async () => {
    const purpose = hasProfile ? 'post_login' : 'user_enrollment';
    const result = await userPresenceApi.challenge({ purpose });
    setChallenge(result.challenge || null);
    setImageBase64('');
    setCaptureMetadata(null);
    setLivenessConfirmed(false);
  };

  if (statusQuery.isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (statusQuery.data?.enabled === false || clientVerified) {
    return children;
  }

  const hasProfile = statusQuery.data?.profile?.status === 'active';
  const busy = enrollMutation.isPending || verifyMutation.isPending;
  const error = enrollMutation.error?.message || verifyMutation.error?.message;

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="w-full max-w-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-lg bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Face Verification Required</h1>
            <p className="text-sm text-muted-foreground">
              This confirms the signed-in user is physically present on this device.
            </p>
          </div>
        </div>

        <FaceCapture
          onBeforeStart={prepareChallenge}
          onCapture={(value, metadata) => {
            setImageBase64(value);
            setCaptureMetadata(metadata);
            setMessage('');
          }}
          onLivenessDetected={() => setLivenessConfirmed(true)}
          onReset={() => {
            setImageBase64('');
            setCaptureMetadata(null);
            setLivenessConfirmed(false);
            setMessage('');
          }}
          autoStart
          autoCaptureOnLiveness
          disabled={busy}
        />

        {!hasProfile && (
          <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <Checkbox checked={consentAccepted} onCheckedChange={(checked) => setConsentAccepted(Boolean(checked))} />
            I consent to encrypted face enrollment for user-presence verification.
          </label>
        )}

        <div className={`rounded-lg border p-3 text-xs ${
          livenessConfirmed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {livenessConfirmed
            ? 'Liveness detected. Ready to continue.'
            : 'Blink or turn your head slightly while using the live webcam.'}
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          className="w-full"
          disabled={busy || !challenge || !imageBase64 || !livenessConfirmed || (!hasProfile && !consentAccepted)}
          onClick={() => hasProfile ? verifyMutation.mutate() : enrollMutation.mutate()}
        >
          {busy
            ? 'Checking...'
            : hasProfile
              ? 'Verify Face and Continue'
              : 'Enroll Face Profile'}
        </Button>
      </Card>
    </div>
  );
}
