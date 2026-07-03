import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, CheckCircle2, XCircle } from 'lucide-react';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusLabel = (profile) => {
  if (!profile) return 'not enrolled';
  return profile.status;
};

export default function EmployeeFaceVerification() {
  const query = useQuery({
    queryKey: ['employeeFaceVerificationStatus'],
    queryFn: () => faceVerificationApi.status(),
  });

  if (query.data && !query.data.enabled) {
    return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">Face Verification is disabled.</Card></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Face Verification</h1>
        <p className="text-sm text-muted-foreground">Standalone face profile status and self-test.</p>
      </div>

      {query.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading face profile status...</Card>
      ) : query.error ? (
        <Card className="p-6 text-sm text-destructive">{query.error.message}</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {query.data?.profile?.status === 'active' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-amber-600" />
                )}
              </div>
              <div>
                <p className="font-semibold">{query.data?.employee?.employee_name || 'Employee profile not linked'}</p>
                <p className="text-xs text-muted-foreground">{query.data?.employee?.employee_id || 'No employee ID'}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge variant="outline">{statusLabel(query.data?.profile)}</Badge>
            </div>
            {query.data?.profile?.enrolledAt && (
              <div>
                <p className="text-xs text-muted-foreground">Enrolled</p>
                <p className="text-sm">{new Date(query.data.profile.enrolledAt).toLocaleString()}</p>
              </div>
            )}
            <Button asChild disabled={!query.data?.profile || query.data.profile.status !== 'active'}>
              <Link to="/employee/face-verification/test"><Camera className="mr-2 h-4 w-4" />Run Self-Test</Link>
            </Button>
          </Card>

          <Card className="p-5">
            <p className="mb-3 font-semibold">Last Verification</p>
            {query.data?.lastLog ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Result</span>
                  <Badge variant="outline">{query.data.lastLog.result}</Badge>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Purpose</span>
                  <span>{query.data.lastLog.purpose}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Confidence</span>
                  <span>{query.data.lastLog.confidenceScore == null ? '-' : Number(query.data.lastLog.confidenceScore).toFixed(4)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Time</span>
                  <span>{new Date(query.data.lastLog.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No verification has been logged yet.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
