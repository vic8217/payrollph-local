import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Clock, Plus, Pencil, Trash2, Star } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { requestJson } from '@/lib/appApi';
import { manilaDateString } from '@/lib/dateUtils';
import { effectiveShiftSetting, pendingShiftVersion } from '@/lib/shiftSettings';
import { Textarea } from '@/components/ui/textarea';

const protectedPortalTabs = [
  { id: 'cash-advance', label: 'Cash Advance' },
  { id: 'personal-leave', label: 'Personal Leave' },
  { id: 'overtime-request', label: 'Overtime Request' },
  { id: 'profile', label: 'My Profile' },
  { id: 'trip-report', label: 'Vehicle Trip Report' },
];

const portalAccessModeOptions = [
  { value: 'choice', label: 'Employee choice' },
  { value: 'face', label: 'Face only' },
  { value: 'qr_face', label: 'QR + face' },
  { value: 'qr_only', label: 'QR only' },
];

const defaultPortalAccessModes = Object.fromEntries(protectedPortalTabs.map(tab => [tab.id, 'choice']));

function ShiftForm({ shift, onSave, onClose }) {
  const [form, setForm] = useState({
    setting_name: shift?.setting_name || '',
    shift_start_time: shift?.shift_start_time || '08:00',
    shift_end_time: shift?.shift_end_time || '17:00',
    overtime_start_time: shift?.overtime_start_time || '17:30',
    grace_period_minutes: shift?.grace_period_minutes || 0,
    time_in_allowance_minutes: shift?.time_in_allowance_minutes || 0,
    is_default: shift?.is_default || false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{shift ? 'Edit Shift' : 'Add Shift'}</DialogTitle>
          <DialogDescription className="sr-only">
            Configure shift start, end, overtime, grace period, and time-in allowance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Shift Name</label>
            <Input
              className="mt-1"
              placeholder="e.g. Morning Shift"
              value={form.setting_name}
              onChange={e => setForm(f => ({ ...f, setting_name: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start Time</label>
              <Input
                type="time"
                className="mt-1"
                value={form.shift_start_time}
                onChange={e => setForm(f => ({ ...f, shift_start_time: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">End Time</label>
              <Input
                type="time"
                className="mt-1"
                value={form.shift_end_time}
                onChange={e => setForm(f => ({ ...f, shift_end_time: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Overtime Starts</label>
            <Input
              type="time"
              className="mt-1"
              value={form.overtime_start_time}
              onChange={e => setForm(f => ({ ...f, overtime_start_time: e.target.value }))}
              required
            />
            <p className="text-xs text-muted-foreground mt-1">Time after which completed work is counted as overtime</p>
          </div>
          <div>
            <label className="text-sm font-medium">Grace Period (minutes)</label>
            <Input
              type="number"
              min="0"
              className="mt-1"
              placeholder="0"
              value={form.grace_period_minutes}
              onChange={e => setForm(f => ({ ...f, grace_period_minutes: parseInt(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground mt-1">Minutes not to be considered late for payroll</p>
          </div>
          <div>
            <label className="text-sm font-medium">Time In(1) Allowance (minutes)</label>
            <Input
              type="number"
              min="0"
              className="mt-1"
              placeholder="0"
              value={form.time_in_allowance_minutes}
              onChange={e => setForm(f => ({ ...f, time_in_allowance_minutes: parseInt(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground mt-1">Credited toward worked hours when first time-in is within this many minutes after shift start</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_default"
              checked={form.is_default}
              onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
              className="rounded"
            />
            <label htmlFor="is_default" className="text-sm font-medium cursor-pointer">
              Set as default shift (used for late calculation)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save Shift</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShiftAuthorizationDialog({ action, onClose, onConfirm, saving }) {
  const [hrPasscode, setHrPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!hrPasscode.trim() || !adminPasscode.trim() || !reason.trim()) {
      setError('HR Officer passcode, Admin passcode, and reason are required.');
      return;
    }
    setError('');
    try {
      await onConfirm({
        hr_passcode: hrPasscode.trim(),
        admin_passcode: adminPasscode.trim(),
        reason: reason.trim(),
      });
    } catch (submitError) {
      setError(submitError?.message || 'Unable to authorize the shift change.');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Authorize Shift Change</DialogTitle>
          <DialogDescription>
            {action.label}. The change will apply on the following business day and will not alter earlier attendance dates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">HR Officer passcode</label>
            <Input type="password" value={hrPasscode} onChange={e => setHrPasscode(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Admin passcode</label>
            <Input type="password" value={adminPasscode} onChange={e => setAdminPasscode(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Reason for changing</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} className="mt-1" rows={3} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Scheduling...' : 'Authorize & Schedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const { activeCompanyId } = useCompany();
  const today = manilaDateString();

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['settings', activeCompanyId],
    queryFn: () => appApi.entities.Settings.filter({ company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const changeMutation = useMutation({
    mutationFn: payload => requestJson('/api/functions/changeShiftSetting', {
      method: 'POST',
      body: JSON.stringify({ ...payload, company_profile_id: activeCompanyId }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setPendingAction(null);
    },
  });

  const { data: portalAccessSettings } = useQuery({
    queryKey: ['employeePortalAccessSettings', activeCompanyId],
    queryFn: () => requestJson(`/api/employee-portal/access-settings?company_profile_id=${encodeURIComponent(activeCompanyId || '')}`),
    enabled: !!activeCompanyId,
  });

  const portalAccessMutation = useMutation({
    mutationFn: modes => requestJson('/api/employee-portal/access-settings', {
      method: 'POST',
      body: JSON.stringify({
        company_profile_id: activeCompanyId,
        protected_tab_access_modes: modes,
      }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employeePortalAccessSettings', activeCompanyId] }),
  });

  const portalAccessModes = {
    ...defaultPortalAccessModes,
    ...(portalAccessSettings?.protected_tab_access_modes || {}),
  };

  const updatePortalAccessMode = (tabId, mode) => {
    portalAccessMutation.mutate({
      ...portalAccessModes,
      [tabId]: mode,
    });
  };

  const setDefault = (shift) => {
    setPendingAction({
      operation: 'set_default',
      shift_id: shift.id,
      label: `Set ${shift.setting_name} as the default shift`,
    });
  };

  const visibleShifts = shifts
    .map(raw => ({
      raw,
      effective: effectiveShiftSetting(raw, today),
      pending: pendingShiftVersion(raw, today),
    }))
    .filter(({ effective, pending }) => effective?.is_active !== false || pending?.is_active !== false);

  const formatTime = (t) => {
    if (!t) return '—';
    const [h, m] = t.split(':');
    const d = new Date();
    d.setHours(parseInt(h), parseInt(m));
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shift Settings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Define work shifts and set a default for late minute calculation</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Shift
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold text-foreground">Employee Portal Access</h2>
            <p className="text-sm text-muted-foreground">
              Choose how protected employee portal tabs verify the employee before opening.
            </p>
          </div>
          <div className="space-y-3">
            {protectedPortalTabs.map(tab => (
              <div key={tab.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{tab.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {portalAccessModeOptions.find(option => option.value === portalAccessModes[tab.id])?.label || 'Employee choice'}
                  </p>
                </div>
                <select
                  value={portalAccessModes[tab.id] || 'choice'}
                  onChange={event => updatePortalAccessMode(tab.id, event.target.value)}
                  disabled={portalAccessMutation.isPending}
                  className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {portalAccessModeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {portalAccessMutation.error && (
            <p className="text-sm text-destructive">{portalAccessMutation.error.message}</p>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : visibleShifts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Clock className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground text-sm">No shifts configured yet.<br />Add a shift to enable late minute tracking.</p>
            <Button onClick={() => setShowForm(true)} variant="outline" className="gap-1.5 mt-2">
              <Plus className="w-4 h-4" /> Add First Shift
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleShifts.map(({ raw, effective: shift, pending }) => (
            <Card key={raw.id} className={`border ${shift.is_default ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{shift.setting_name}</span>
                      {shift.is_default && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-xs gap-1">
                          <Star className="w-3 h-3" /> Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {formatTime(shift.shift_start_time)} — {formatTime(shift.shift_end_time)}
                      <span className="text-xs ml-2">• OT starts: {formatTime(shift.overtime_start_time || '17:30')}</span>
                      {shift.grace_period_minutes > 0 && (
                        <span className="text-xs ml-2">• Grace: {shift.grace_period_minutes}min</span>
                      )}
                      {shift.time_in_allowance_minutes > 0 && (
                        <span className="text-xs ml-2">• Time In(1) allowance: {shift.time_in_allowance_minutes}min</span>
                      )}
                    </p>
                    {pending && (
                      <p className="mt-1 text-xs text-amber-700">
                        Change scheduled for {pending.effective_date}
                        {pending.is_active === false ? ' (shift will be removed)' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!shift.is_default && (
                    <Button size="sm" variant="outline" className="gap-1 text-xs h-8"
                      onClick={() => setDefault(shift)}>
                      <Star className="w-3.5 h-3.5" /> Set Default
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingShift(shift)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={() => setPendingAction({
                      operation: 'delete',
                      shift_id: raw.id,
                      label: `Remove ${shift.setting_name}`,
                    })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <ShiftForm
          onSave={(data) => {
            setShowForm(false);
            setPendingAction({ operation: 'create', data, label: `Add ${data.setting_name}` });
          }}
          onClose={() => setShowForm(false)}
        />
      )}
      {editingShift && (
        <ShiftForm
          shift={editingShift}
          onSave={(data) => {
            setEditingShift(null);
            setPendingAction({
              operation: 'update',
              shift_id: editingShift.id,
              data,
              label: `Update ${editingShift.setting_name}`,
            });
          }}
          onClose={() => setEditingShift(null)}
        />
      )}
      {pendingAction && (
        <ShiftAuthorizationDialog
          action={pendingAction}
          saving={changeMutation.isPending}
          onClose={() => setPendingAction(null)}
          onConfirm={authorization => changeMutation.mutateAsync({
            ...pendingAction,
            ...authorization,
          })}
        />
      )}
    </div>
  );
}
