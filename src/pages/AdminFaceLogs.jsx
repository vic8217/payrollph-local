import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function AdminFaceLogs() {
  const { user } = useAuth();
  const { activeCompanyId } = useCompany();
  const [result, setResult] = useState('');
  const canAdmin = ['super_admin', 'admin', 'user'].includes(user?.role);

  const statusQuery = useQuery({
    queryKey: ['faceVerificationLogsStatus', activeCompanyId],
    queryFn: () => faceVerificationApi.status({ scope: 'admin', company_profile_id: activeCompanyId || '' }),
    enabled: !!activeCompanyId && canAdmin,
  });
  const logsQuery = useQuery({
    queryKey: ['faceVerificationLogs', activeCompanyId, result],
    queryFn: () => faceVerificationApi.logs({
      scope: 'admin',
      company_profile_id: activeCompanyId || '',
      ...(result ? { result } : {}),
      limit: '200',
    }),
    enabled: !!activeCompanyId && canAdmin && statusQuery.data?.enabled,
  });

  if (!canAdmin) return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">You are not authorized to view face verification logs.</Card></div>;
  if (statusQuery.data && !statusQuery.data.enabled) return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">Face Verification is disabled.</Card></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Face Verification Logs</h1>
          <p className="text-sm text-muted-foreground">Verification outcomes and audit metadata.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/face-verification"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <select
            value={result}
            onChange={event => setResult(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All results</option>
            <option value="verified">Verified</option>
            <option value="failed">Failed</option>
            <option value="no profile">No Profile</option>
            <option value="liveness failed">Liveness Failed</option>
          </select>
          <Button variant="ghost" onClick={() => logsQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Employee</th>
                <th className="px-4 py-3 text-left font-medium">Purpose</th>
                <th className="px-4 py-3 text-left font-medium">Result</th>
                <th className="px-4 py-3 text-left font-medium">Confidence</th>
                <th className="px-4 py-3 text-left font-medium">Device</th>
              </tr>
            </thead>
            <tbody>
              {(logsQuery.data?.logs || []).map(log => (
                <tr key={log.id} className="border-t border-border">
                  <td className="px-4 py-3 text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{log.employeeName || log.employeeId}</p>
                    <p className="text-xs text-muted-foreground">{log.employeeId}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{log.purpose}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{log.result}</Badge></td>
                  <td className="px-4 py-3">{log.confidenceScore == null ? '-' : Number(log.confidenceScore).toFixed(4)}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-muted-foreground">{log.deviceUserAgent || '-'}</td>
                </tr>
              ))}
              {(logsQuery.data?.logs || []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No logs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
