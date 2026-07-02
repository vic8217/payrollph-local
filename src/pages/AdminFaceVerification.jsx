import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileText, RefreshCw, ShieldCheck, ShieldOff, UserPlus, Users } from 'lucide-react';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { userPresenceApi } from '@/lib/userPresenceApi';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusColors = {
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-amber-100 text-amber-700',
  revoked: 'bg-red-100 text-red-700',
};

function Disabled({ message = 'Face Verification is disabled.' }) {
  return (
    <div className="p-6">
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">{message}</p>
      </Card>
    </div>
  );
}

export default function AdminFaceVerification() {
  const { activeCompanyId } = useCompany();
  const { user, navigateToLogin } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const canAdmin = ['super_admin', 'admin', 'user'].includes(user?.role);

  const query = useQuery({
    queryKey: ['faceVerificationAdminStatus', activeCompanyId],
    queryFn: () => faceVerificationApi.status({ scope: 'admin', company_profile_id: activeCompanyId || '' }),
    enabled: !!activeCompanyId && canAdmin,
  });
  const userPresenceQuery = useQuery({
    queryKey: ['userPresenceAdminStatus', activeCompanyId],
    queryFn: () => userPresenceApi.status({ scope: 'admin', company_profile_id: activeCompanyId || '' }),
    enabled: !!activeCompanyId && canAdmin,
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, profileId }) => faceVerificationApi[action]({ profileId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['faceVerificationAdminStatus'] }),
  });

  const employees = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const rows = query.data?.employees || [];
    if (!term) return rows;
    return rows.filter(employee =>
      `${employee.employee_id || ''} ${employee.employee_name || ''} ${employee.department || ''}`
        .toLowerCase()
        .includes(term)
    );
  }, [filter, query.data?.employees]);

  if (!canAdmin) return <Disabled message="You are not authorized for face verification administration." />;
  if (query.data && !query.data.enabled) return <Disabled />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Face Verification</h1>
          <p className="text-sm text-muted-foreground">Standalone enrollment, verification tests, and monitoring.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/admin/face-verification/logs"><FileText className="mr-2 h-4 w-4" />Logs</Link>
          </Button>
          <Button asChild>
            <Link to="/admin/face-verification/enroll"><UserPlus className="mr-2 h-4 w-4" />Enroll</Link>
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading face verification dashboard...</Card>
      ) : query.error ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-6">
          <p className="text-sm text-destructive">
            {query.error.status === 401
              ? 'Your sign-in session has expired. Please sign in again.'
              : query.error.message}
          </p>
          {query.error.status === 401 && (
            <Button type="button" onClick={() => navigateToLogin('/landing')}>
              Sign in
            </Button>
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card className="p-4">
              <Users className="mb-2 h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Enrolled</p>
              <p className="text-2xl font-semibold">{query.data?.stats?.totalEnrolled || 0}</p>
            </Card>
            <Card className="p-4">
              <Camera className="mb-2 h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Without Profile</p>
              <p className="text-2xl font-semibold">{query.data?.stats?.withoutProfile || 0}</p>
            </Card>
            <Card className="p-4">
              <ShieldOff className="mb-2 h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Suspended / Revoked</p>
              <p className="text-2xl font-semibold">{query.data?.stats?.suspendedOrRevoked || 0}</p>
            </Card>
            <Card className="p-4">
              <ShieldCheck className="mb-2 h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Failed Verifications</p>
              <p className="text-2xl font-semibold">{query.data?.stats?.failedCount || 0}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <p className="font-semibold">Employee Face Profiles</p>
              <input
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Search employee"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Department</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Enrolled</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(employee => (
                    <tr key={employee.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <p className="font-medium">{employee.employee_name || 'Unnamed'}</p>
                        <p className="text-xs text-muted-foreground">{employee.employee_id}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{employee.department || '-'}</td>
                      <td className="px-4 py-3">
                        {employee.profile ? (
                          <Badge className={statusColors[employee.profile.status] || statusColors.revoked}>{employee.profile.status}</Badge>
                        ) : (
                          <Badge variant="outline">not enrolled</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {employee.profile?.enrolledAt ? new Date(employee.profile.enrolledAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/admin/face-verification/enroll?employee_id=${encodeURIComponent(employee.employee_id || '')}`}>
                              {employee.profile ? 'Re-enroll' : 'Enroll'}
                            </Link>
                          </Button>
                          {employee.profile?.status === 'active' && (
                            <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: 'suspend', profileId: employee.profile.id })}>
                              Suspend
                            </Button>
                          )}
                          {employee.profile && employee.profile.status !== 'revoked' && (
                            <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate({ action: 'revoke', profileId: employee.profile.id })}>
                              Revoke
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border p-4 font-semibold">Recent Verification Logs</div>
            <div className="divide-y divide-border">
              {(query.data?.recentLogs || []).map(log => (
                <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div>
                    <p className="font-medium">{log.employeeName || log.employeeId}</p>
                    <p className="text-xs text-muted-foreground">{log.purpose} · {new Date(log.createdAt).toLocaleString()}</p>
                  </div>
                  <Badge variant="outline">{log.result}</Badge>
                </div>
              ))}
              {(query.data?.recentLogs || []).length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No verification logs yet.</p>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <p className="font-semibold">ACCURA User Presence</p>
              <p className="text-xs text-muted-foreground">Authenticated user face enrollment and failed attempt monitoring.</p>
            </div>
            {userPresenceQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading user presence status...</p>
            ) : userPresenceQuery.error ? (
              <p className="p-4 text-sm text-destructive">{userPresenceQuery.error.message}</p>
            ) : (
              <>
                <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Enrolled Users</p>
                    <p className="text-2xl font-semibold">{userPresenceQuery.data?.stats?.enrolledUsers || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Failed Attempts</p>
                    <p className="text-2xl font-semibold">{userPresenceQuery.data?.stats?.failedCount || 0}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">User</th>
                        <th className="px-4 py-3 text-left font-medium">Role</th>
                        <th className="px-4 py-3 text-left font-medium">Status</th>
                        <th className="px-4 py-3 text-left font-medium">Enrolled</th>
                        <th className="px-4 py-3 text-left font-medium">Failed Attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(userPresenceQuery.data?.users || []).map(row => (
                        <tr key={row.userId} className="border-t border-border">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.name || row.email || 'User'}</p>
                            <p className="text-xs text-muted-foreground">{row.email}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{row.role || '-'}</td>
                          <td className="px-4 py-3">
                            <Badge className={statusColors[row.profile?.status] || statusColors.revoked}>{row.profile?.status || 'not enrolled'}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.profile?.enrolledAt ? new Date(row.profile.enrolledAt).toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {(userPresenceQuery.data?.recentLogs || []).filter(log => log.userId === row.userId && ['failed', 'liveness failed', 'no profile'].includes(log.result)).length}
                          </td>
                        </tr>
                      ))}
                      {(userPresenceQuery.data?.users || []).length === 0 && (
                        <tr><td colSpan={5} className="p-4 text-sm text-muted-foreground">No user face profiles enrolled yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Button variant="ghost" onClick={() => query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </>
      )}
    </div>
  );
}
