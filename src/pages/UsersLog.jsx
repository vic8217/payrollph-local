// @ts-nocheck
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, LogIn, LogOut, Users } from 'lucide-react';
import { requestJson } from '@/lib/appApi';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const roleLabels = {
  super_admin: 'Super Admin',
  admin: 'Management / Admin',
  user: 'User / HR Officer',
};

const eventLabels = {
  login: 'Login',
  logout: 'Logout',
};

const eventStyles = {
  login: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  logout: 'bg-slate-100 text-slate-700 border-slate-200',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function formatRole(role) {
  return roleLabels[role] || role || 'User';
}

export default function UsersLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['users-log'],
    queryFn: () => requestJson('/api/users/logs'),
    refetchInterval: 30000,
  });

  const users = data?.users || [];
  const logs = data?.logs || [];

  const onlineCount = useMemo(
    () => users.filter((user) => user.is_online).length,
    [users]
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Users Log</h1>
        <p className="text-muted-foreground text-sm mt-1">Review current login status and recent login/logout activity.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Currently Logged In</p>
              <p className="text-2xl font-semibold">{onlineCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-2xl font-semibold">{users.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Recent Events</p>
              <p className="text-2xl font-semibold">{logs.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold">Current User Status</h2>
              <p className="text-xs text-muted-foreground">Status refreshes every 30 seconds.</p>
            </div>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading user status...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active Until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{user.name || '(No name)'}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatRole(user.role)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${user.is_online ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {user.is_online ? 'Logged In' : 'Logged Out'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(user.active_until)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Login / Logout History</h2>
            <p className="text-xs text-muted-foreground">Showing the latest 200 access events.</p>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading activity...</div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No login or logout records yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const Icon = log.event_type === 'login' ? LogIn : LogOut;
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{formatDateTime(log.occurred_at)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${eventStyles[log.event_type] || eventStyles.logout}`}>
                          <Icon className="h-3 w-3" />
                          {eventLabels[log.event_type] || log.event_type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{log.name || '(No name)'}</p>
                          <p className="text-xs text-muted-foreground">{log.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatRole(log.role)}</TableCell>
                      <TableCell className="text-muted-foreground">{log.ip_address || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
