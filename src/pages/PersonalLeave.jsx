import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { Palmtree, CheckCircle2, XCircle, Loader2, KeyRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';

const statusStyles = {
  submitted: 'bg-amber-100 text-amber-800 border-amber-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
};

const statusLabels = {
  submitted: 'Submitted',
  approved: 'Approved',
  declined: 'Declined',
};

const typeLabels = {
  personal: 'Personal',
  sick: 'Sick',
  vacation: 'Vacation',
};

export default function PersonalLeave() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const [actionDialog, setActionDialog] = useState(null); // { row, status: 'approved' | 'declined' }
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [dialogNotes, setDialogNotes] = useState('');

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const { data: dailyPasscodes = [] } = useQuery({
    queryKey: ['dailyPasscodes', activeCompanyId],
    queryFn: () =>
      appApi.entities.DailyPasscode.filter({ company_profile_id: activeCompanyId }, '-date', 14),
    enabled: !!activeCompanyId,
  });
  const todayPasscode = dailyPasscodes.find((p) => p.date === todayStr);

  const { data: allLeaves = [], isLoading } = useQuery({
    queryKey: ['personalLeavesAdmin', activeCompanyId],
    queryFn: () => appApi.entities.PersonalLeave.filter({}, '-created_date', 500),
    enabled: !!activeCompanyId,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const leaves = useMemo(
    () => allLeaves.filter((l) => l.company_profile_id === activeCompanyId),
    [allLeaves, activeCompanyId]
  );

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const updated = await appApi.entities.PersonalLeave.update(id, data);
      if (data.passcode_audit_action) {
        await appApi.entities.PasscodeAuditLog.create({
          company_profile_id: activeCompanyId,
          source_entity: 'PersonalLeave',
          source_record_id: id,
          action: data.passcode_audit_action,
          occurred_at: data.passcode_audit_at,
          authorized_by: data.passcode_audit_by,
          reason: data.passcode_audit_reason,
          summary: data.passcode_audit_summary,
          employee_id: updated.employee_id,
          employee_name: updated.employee_name,
          record_date: updated.start_date,
        });
      }
      return updated;
    },
    onSuccess: (_, { data }) => {
      qc.invalidateQueries({ queryKey: ['personalLeavesAdmin'] });
      qc.invalidateQueries({ queryKey: ['personalLeaves'] });
      setActionDialog(null);
      setPasscodeInput('');
      setPasscodeError('');
      setDialogNotes('');
      toast({
        title: data.status === 'approved' ? 'Leave approved' : 'Leave declined',
        description: 'The employee will see the update in their portal.',
      });
    },
    onError: (err) => {
      toast({
        title: 'Update failed',
        description: err?.message || 'Try again.',
        variant: 'destructive',
      });
    },
  });

  const verifyDailyPasscode = () => {
    if (!todayPasscode) {
      setPasscodeError(
        'No passcode for today. A super admin must generate one under Daily Passcode.'
      );
      return false;
    }
    const input = passcodeInput.trim();
    if (input !== todayPasscode.passcode && input !== todayPasscode.manager_passcode) {
      setPasscodeError("Incorrect code. Use today's HR or manager passcode from Daily Passcode.");
      return false;
    }
    setPasscodeError('');
    return true;
  };

  const confirmDecision = () => {
    if (!actionDialog) return;
    const { row, status } = actionDialog;
    const notes = dialogNotes.trim();
    if (status === 'declined' && notes.length < 3) {
      toast({
        title: 'Note required',
        description: 'Add a short note for the employee explaining the decline.',
        variant: 'destructive',
      });
      return;
    }
    if (!verifyDailyPasscode()) return;
    updateMutation.mutate({
      id: row.id,
      data: {
        status,
        decided_at: new Date().toISOString(),
        hr_notes: notes || null,
        passcode_audit_action: status === 'approved' ? 'leave_approved' : 'leave_declined',
        passcode_audit_at: new Date().toISOString(),
        passcode_audit_by: user?.full_name || user?.email || 'unknown',
        passcode_audit_reason: notes || null,
        passcode_audit_summary: `${status === 'approved' ? 'Leave approved' : 'Leave declined'} for ${row.employee_name || row.employee_id || 'employee'}`,
      },
    });
  };

  const openActionDialog = (row, status) => {
    setActionDialog({ row, status });
    setPasscodeInput('');
    setPasscodeError('');
    setDialogNotes('');
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Palmtree className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Personal leave</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve or decline employee leave requests. HR officers and admins must enter
            today&apos;s code from <strong>Daily Passcode</strong> (HR or manager passcode).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex justify-center text-muted-foreground text-sm">Loading…</div>
          ) : leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No leave requests for this company.</p>
          ) : (
            <div className="space-y-4">
              {leaves.map((row) => {
                const st = row.status || 'submitted';
                const decided = st === 'approved' || st === 'declined';
                return (
                  <div
                    key={row.id}
                    className="rounded-xl border border-border p-4 space-y-3 bg-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{row.employee_name || row.employee_id}</p>
                        <p className="text-sm text-muted-foreground">
                          {typeLabels[row.leave_type] || row.leave_type} · {row.start_date} →{' '}
                          {row.end_date}
                        </p>
                        <p className="text-sm mt-2 text-foreground">{row.reason}</p>
                      </div>
                      <Badge variant="outline" className={statusStyles[st] || statusStyles.submitted}>
                        {statusLabels[st] || st}
                      </Badge>
                    </div>
                    {row.hr_notes && decided && (
                      <p className="text-xs text-muted-foreground border-t border-border pt-2">
                        <span className="font-medium">HR note: </span>
                        {row.hr_notes}
                      </p>
                    )}
                    {row.decided_at && decided && (
                      <p className="text-xs text-muted-foreground">
                        Decided {format(parseISO(row.decided_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    )}
                    {st === 'submitted' && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={updateMutation.isPending}
                          onClick={() => openActionDialog(row, 'approved')}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          disabled={updateMutation.isPending}
                          onClick={() => openActionDialog(row, 'declined')}
                        >
                          <XCircle className="w-4 h-4" />
                          Decline
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!actionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setActionDialog(null);
            setPasscodeInput('');
            setPasscodeError('');
            setDialogNotes('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              {actionDialog?.status === 'approved' ? 'Approve leave' : 'Decline leave'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Enter today&apos;s 6-digit passcode from <strong>Daily Passcode</strong>. Either the HR
              officer or manager code is accepted.
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Daily passcode *</Label>
              <Input
                type="password"
                autoComplete="off"
                value={passcodeInput}
                onChange={(e) => {
                  setPasscodeInput(e.target.value);
                  setPasscodeError('');
                }}
                className="h-9 text-sm font-mono tracking-widest"
                placeholder="6-digit code"
                maxLength={6}
              />
              {passcodeError && <p className="text-xs text-destructive">{passcodeError}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Note to employee {actionDialog?.status === 'declined' ? '(required)' : '(optional)'}
              </Label>
              <Textarea
                value={dialogNotes}
                onChange={(e) => setDialogNotes(e.target.value)}
                className="text-sm min-h-[72px]"
                placeholder={
                  actionDialog?.status === 'declined'
                    ? 'Reason for decline…'
                    : 'Optional message for the employee…'
                }
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActionDialog(null);
                  setPasscodeInput('');
                  setPasscodeError('');
                  setDialogNotes('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={actionDialog?.status === 'declined' ? 'destructive' : 'default'}
                disabled={updateMutation.isPending}
                onClick={confirmDecision}
                className="gap-1"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : actionDialog?.status === 'approved' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Confirm approve
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" /> Confirm decline
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
