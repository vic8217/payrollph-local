// @ts-nocheck
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appApi, requestJson } from '@/lib/appApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Users, Save, X, CheckCircle2, Clock3, XCircle, Ban, Trash2, KeyRound, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ACCESS_SCHEDULE_DAYS, DEFAULT_ACCESS_SCHEDULE, describeAccessSchedule } from '@/lib/accessSchedule';
import { useAuth } from '@/lib/AuthContext';

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [editingUserId, setEditingUserId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [resetPasscodes, setResetPasscodes] = useState({});

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => requestJson('/api/users'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['company-profiles'],
    queryFn: () => appApi.entities.CompanyProfile.list(),
  });
  const activeCompanies = companies.filter((company) => company.status !== 'archived');
  const currentUserCompanyIds = Array.isArray(currentUser?.company_profile_ids) && currentUser.company_profile_ids.length
    ? currentUser.company_profile_ids
    : (currentUser?.company_profile_id ? [currentUser.company_profile_id] : []);
  const assignableCompanies = currentUser?.role === 'super_admin'
    ? activeCompanies
    : activeCompanies.filter((company) =>
        company.created_by_user_id === currentUser?.id ||
        !company.created_by_user_id ||
        currentUserCompanyIds.includes(company.id)
      );

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => requestJson('/api/users', {
      method: 'PATCH',
      body: JSON.stringify({ id, data }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUserId(null);
      toast({ title: 'User updated successfully' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ id, data: { approval_status: 'approved' } }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User approved successfully' });
    },
  });

  const denyMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ id, data: { approval_status: 'denied' } }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User denied and removed from the list' });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ id, data: { approval_status: 'suspended' } }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User suspended successfully' });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ id, data: { approval_status: 'approved' } }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User activated successfully' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User removed successfully' });
    },
  });

  const resetPasscodeMutation = useMutation({
    mutationFn: (id) =>
      requestJson('/api/users/reset-passcode', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: (data) => {
      setResetPasscodes((prev) => ({ ...prev, [data.email]: data }));
      toast({
        title: 'Reset passcode created',
        description: `Give this code to ${data.email}. It expires in 30 minutes.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Unable to create passcode',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleEdit = (user) => {
    setEditingUserId(user.id);
    setEditForm({
      role: user.role || 'user',
      company_profile_ids: Array.isArray(user.company_profile_ids)
        ? user.company_profile_ids
        : (user.company_profile_id ? [user.company_profile_id] : []),
      access_schedule: user.access_schedule || { ...DEFAULT_ACCESS_SCHEDULE },
    });
  };

  const handleSave = (userId) => {
    const data = { ...editForm };
    if (data.role === 'super_admin') {
      data.access_schedule = null;
      data.company_profile_ids = [];
    }
    updateMutation.mutate({ id: userId, data });
  };

  const updateAccessSchedule = (patch) => {
    setEditForm((prev) => ({
      ...prev,
      access_schedule: {
        ...DEFAULT_ACCESS_SCHEDULE,
        ...(prev.access_schedule || {}),
        ...patch,
      },
    }));
  };

  const toggleAccessDay = (day, checked) => {
    const currentDays = editForm.access_schedule?.days || DEFAULT_ACCESS_SCHEDULE.days;
    updateAccessSchedule({
      days: checked
        ? [...new Set([...currentDays, day])].sort((a, b) => a - b)
        : currentDays.filter((currentDay) => currentDay !== day),
    });
  };

  const toggleCompany = (companyId, checked) => {
    setEditForm((prev) => {
      const currentIds = Array.isArray(prev.company_profile_ids) ? prev.company_profile_ids : [];
      return {
        ...prev,
        company_profile_ids: checked
          ? [...new Set([...currentIds, companyId])]
          : currentIds.filter((id) => id !== companyId),
      };
    });
  };

  const handleRemove = (user) => {
    if (!window.confirm(`Remove ${user.full_name || user.email} from user management? This cannot be undone.`)) return;
    removeMutation.mutate(user.id);
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date(value));
  };

  const roleColors = {
    super_admin: 'bg-purple-100 text-purple-700 border-purple-200',
    admin: 'bg-red-100 text-red-700 border-red-200',
    hr_staff: 'bg-sky-100 text-sky-700 border-sky-200',
    attendance_staff: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    user: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  const roleLabels = {
    super_admin: 'Super Admin',
    admin: 'Management / Admin',
    hr_staff: 'HR Staff',
    attendance_staff: 'Attendance Staff',
    user: 'User / HR Officer',
  };

  const statusColors = {
    approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    denied: 'bg-red-100 text-red-700 border-red-200',
    suspended: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  const statusLabels = {
    approved: 'Approved',
    pending: 'Pending Approval',
    denied: 'Denied',
    suspended: 'Suspended',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <p className="text-muted-foreground text-sm mt-1">Approve registrations, then assign roles and company access.</p>
      </div>

      {loadingUsers ? (
        <div className="text-center py-10 text-muted-foreground">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No users found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const assignedCompanyIds = Array.isArray(user.company_profile_ids)
              ? user.company_profile_ids
              : (user.company_profile_id ? [user.company_profile_id] : []);
            const assignedCompanies = activeCompanies.filter(c => assignedCompanyIds.includes(c.id));
            const isEditing = editingUserId === user.id;
            const isPending = user.approval_status === 'pending';
            const isApprovedEmployee = user.approval_status === 'approved' && user.role !== 'super_admin';
            const isSuspended = user.approval_status === 'suspended';
            const resetPasscode = resetPasscodes[user.email];
            const actionDisabled = approveMutation.isPending || denyMutation.isPending || suspendMutation.isPending || activateMutation.isPending || removeMutation.isPending || resetPasscodeMutation.isPending;

            return (
              <Card key={user.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground truncate">{user.full_name || '(No name)'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${roleColors[user.role] || roleColors.user}`}>
                          {roleLabels[user.role] || user.role || 'User / HR Officer'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColors[user.approval_status] || statusColors.approved}`}>
                          {statusLabels[user.approval_status] || 'Approved'}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
                      {!isEditing && assignedCompanies.length > 0 && (
                        <p className="text-xs text-primary mt-1">
                          Company access: {assignedCompanies.map(c => c.company_name).join(', ')}
                        </p>
                      )}
                      {!isEditing && assignedCompanies.length === 0 && user.role !== 'super_admin' && (
                        <p className="text-xs text-muted-foreground mt-1 italic">No company assigned (sees all)</p>
                      )}
                      {!isEditing && user.role !== 'super_admin' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          System access: {describeAccessSchedule(user.access_schedule)}
                        </p>
                      )}
                      {!isEditing && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>
                            Login errors: <span className="font-semibold">{user.failed_login_attempts || 0}</span>
                            {user.last_failed_login_at ? ` · Last: ${formatDateTime(user.last_failed_login_at)}` : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    {!isEditing ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {isPending && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => approveMutation.mutate(user.id)}
                              disabled={actionDisabled}
                              className="gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => denyMutation.mutate(user.id)}
                              disabled={actionDisabled}
                              className="gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Deny
                            </Button>
                          </>
                        )}
                        {isApprovedEmployee && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resetPasscodeMutation.mutate(user.id)}
                              disabled={actionDisabled}
                              className="gap-1"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              Reset Code
                            </Button>
                            {currentUser?.role === 'super_admin' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => suspendMutation.mutate(user.id)}
                                  disabled={actionDisabled}
                                  className="gap-1"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  Suspend
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleRemove(user)}
                                  disabled={actionDisabled}
                                  className="gap-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Remove
                                </Button>
                              </>
                            )}
                          </>
                        )}
                        {isSuspended && currentUser?.role === 'super_admin' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => activateMutation.mutate(user.id)}
                            disabled={actionDisabled}
                            className="gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Activate
                          </Button>
                        )}
                        {user.role === 'super_admin' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resetPasscodeMutation.mutate(user.id)}
                            disabled={actionDisabled}
                            className="gap-1"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Reset Code
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleEdit(user)}>
                          {isPending ? (
                            <>
                              <Clock3 className="w-3.5 h-3.5 mr-1" />
                              Review
                            </>
                          ) : (
                            'Edit'
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSave(user.id)} disabled={updateMutation.isPending} className="gap-1">
                          <Save className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border">
                      <div className="space-y-1">
                        <Label className="text-xs">Role</Label>
                        <Select value={editForm.role} onValueChange={v => setEditForm(p => ({ ...p, role: v }))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {currentUser?.role === 'super_admin' && (
                              <SelectItem value="super_admin">Super Admin (all access)</SelectItem>
                            )}
                            <SelectItem value="admin">Management / Admin</SelectItem>
                            <SelectItem value="hr_staff">HR Staff</SelectItem>
                            <SelectItem value="attendance_staff">Attendance Staff</SelectItem>
                            <SelectItem value="user">User / HR Officer (legacy)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {editForm.role !== 'super_admin' && (
                        <div className="space-y-2">
                          <Label className="text-xs">Assigned Companies</Label>
                          <div className="rounded-md border border-border p-2 space-y-2 max-h-40 overflow-y-auto">
                            {assignableCompanies.map(c => (
                              <label key={c.id} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={(editForm.company_profile_ids || []).includes(c.id)}
                                  onCheckedChange={(checked) => toggleCompany(c.id, checked === true)}
                                />
                                <span>{c.company_name}</span>
                              </label>
                            ))}
                            {assignableCompanies.length === 0 && (
                              <p className="text-xs text-muted-foreground">No companies available. Admins can only assign companies they created.</p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {currentUser?.role === 'super_admin'
                              ? 'Leave all unchecked to allow access to all companies. Select two or more to limit this user to only those companies.'
                              : 'Admins can only assign companies they created. Select at least one company.'}
                          </p>
                        </div>
                      )}

                      {editForm.role !== 'super_admin' && (
                        <div className="sm:col-span-2 rounded-md border border-border p-3 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <Label className="text-xs">Access to System Schedule</Label>
                              <p className="text-xs text-muted-foreground">Set specific allowed days and covered hours for HR officers and management.</p>
                            </div>
                            <Switch
                              checked={Boolean(editForm.access_schedule?.enabled)}
                              onCheckedChange={(checked) => updateAccessSchedule({ enabled: checked })}
                            />
                          </div>

                          {editForm.access_schedule?.enabled && (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Specific Days</Label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                                  {ACCESS_SCHEDULE_DAYS.map((day) => (
                                    <label
                                      key={day.value}
                                      className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs"
                                    >
                                      <Checkbox
                                        checked={(editForm.access_schedule?.days || []).includes(day.value)}
                                        onCheckedChange={(checked) => toggleAccessDay(day.value, checked === true)}
                                      />
                                      {day.short}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs">Specific Covered Hours</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">From</Label>
                                    <Input
                                      type="time"
                                      value={editForm.access_schedule?.start_time || DEFAULT_ACCESS_SCHEDULE.start_time}
                                      onChange={(event) => updateAccessSchedule({ start_time: event.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Until</Label>
                                    <Input
                                      type="time"
                                      value={editForm.access_schedule?.end_time || DEFAULT_ACCESS_SCHEDULE.end_time}
                                      onChange={(event) => updateAccessSchedule({ end_time: event.target.value })}
                                    />
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground">Use any covered hours, including weekends or after-office windows. Overnight windows like 20:00 to 02:00 are allowed.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {resetPasscode && (
                    <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-violet-800">Temporary reset passcode</p>
                          <p className="text-xs text-violet-700">Give this to the user. It can be used once and expires in 30 minutes.</p>
                        </div>
                        <div className="select-all rounded bg-white px-3 py-2 font-mono text-base font-semibold tracking-[0.2em] text-violet-800">
                          {resetPasscode.passcode}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
