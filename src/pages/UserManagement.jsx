// @ts-nocheck
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appApi, requestJson } from '@/lib/appApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Save, X, CheckCircle2, Clock3 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingUserId, setEditingUserId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => requestJson('/api/users'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['company-profiles'],
    queryFn: () => appApi.entities.CompanyProfile.list(),
  });

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

  const handleEdit = (user) => {
    setEditingUserId(user.id);
    setEditForm({ role: user.role || 'user', company_profile_id: user.company_profile_id || '' });
  };

  const handleSave = (userId) => {
    const data = { ...editForm };
    if (!data.company_profile_id) delete data.company_profile_id;
    updateMutation.mutate({ id: userId, data });
  };

  const roleColors = {
    super_admin: 'bg-purple-100 text-purple-700 border-purple-200',
    admin: 'bg-red-100 text-red-700 border-red-200',
    user: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  const roleLabels = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    user: 'User / HR Officer',
  };

  const statusColors = {
    approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
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
            const assignedCompany = companies.find(c => c.id === user.company_profile_id);
            const isEditing = editingUserId === user.id;
            const isPending = user.approval_status === 'pending';

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
                          {user.approval_status === 'pending' ? 'Pending Approval' : 'Approved'}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
                      {!isEditing && assignedCompany && (
                        <p className="text-xs text-primary mt-1">🏢 {assignedCompany.company_name}</p>
                      )}
                      {!isEditing && !assignedCompany && user.role !== 'super_admin' && (
                        <p className="text-xs text-muted-foreground mt-1 italic">No company assigned (sees all)</p>
                      )}
                    </div>

                    {!isEditing ? (
                      <div className="flex gap-2">
                        {isPending && (
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(user.id)}
                            disabled={approveMutation.isPending}
                            className="gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
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
                            <SelectItem value="super_admin">Super Admin (all access)</SelectItem>
                            <SelectItem value="admin">Admin (no passcode/user mgmt)</SelectItem>
                            <SelectItem value="user">User / HR Officer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Assigned Company</Label>
                        <Select
                          value={editForm.company_profile_id || 'all'}
                          onValueChange={v => setEditForm(p => ({ ...p, company_profile_id: v === 'all' ? '' : v }))}
                        >
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">— All Companies (no restriction) —</SelectItem>
                            {companies.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Leave empty to allow access to all companies. Only Super Admins always see all companies.</p>
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
