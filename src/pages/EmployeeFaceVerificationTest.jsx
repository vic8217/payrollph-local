import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import FaceCapture from '@/components/face/FaceCapture';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

export default function EmployeeFaceVerificationTest() {
  const [imageBase64, setImageBase64] = useState('');
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['employeeFaceVerificationStatus'],
    queryFn: () => faceVerificationApi.status(),
  });
  const verifyMutation = useMutation({
    mutationFn: () => faceVerificationApi.verify({
      purpose: 'employee_self_test',
      imageBase64,
      livenessConfirmed,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employeeFaceVerificationStatus'] }),
  });

  if (statusQuery.data && !statusQuery.data.enabled) {
    return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">Face Verification is disabled.</Card></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Face Verification Self-Test</h1>
          <p className="text-sm text-muted-foreground">This test does not submit attendance or acknowledge a payslip.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/employee/face-verification"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="p-4 space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Blink and turn your head slightly, then capture a fresh selfie with your whole face inside the guide.
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <Checkbox checked={livenessConfirmed} onCheckedChange={checked => setLivenessConfirmed(Boolean(checked))} />
            <span className="text-sm">I completed the live blink/head-turn challenge.</span>
          </div>
          <Button
            onClick={() => verifyMutation.mutate()}
            disabled={!imageBase64 || !livenessConfirmed || verifyMutation.isPending}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {verifyMutation.isPending ? 'Verifying...' : 'Run Verification'}
          </Button>
          {verifyMutation.error && <p className="text-sm text-destructive">{verifyMutation.error.message}</p>}
          {verifyMutation.data && (
            <div className="rounded-lg border border-border p-4 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground">Result</span>
                <Badge variant="outline">{verifyMutation.data.result}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Confidence</span>
                <span>{verifyMutation.data.confidenceScore == null ? '-' : Number(verifyMutation.data.confidenceScore).toFixed(4)}</span>
              </div>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <FaceCapture onCapture={setImageBase64} disabled={verifyMutation.isPending} />
        </Card>
      </div>
    </div>
  );
}
