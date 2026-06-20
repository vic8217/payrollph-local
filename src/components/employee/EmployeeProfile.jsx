import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { User, Clock, FileText, CalendarClock, Bell, QrCode, Keyboard, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import EmployeeAttendance from './EmployeeAttendance';
import EmployeePayslips from './EmployeePayslips';
import DeductionScheduleView from '@/components/cashadvance/DeductionScheduleView';
import { requestJson } from '@/lib/appApi';

const getCashAdvanceBalance = (ca) => ca.remaining_balance != null
  ? ca.remaining_balance
  : (ca.amount_approved || ca.amount_requested || 0);

const normalizeQrValue = (value) => String(value || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/-PayrollPH$/i, '');

export default function EmployeeProfile({ employee }) {
  const [subTab, setSubTab] = useState('info');
  const [showDeductionSchedule, setShowDeductionSchedule] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [noticeTab, setNoticeTab] = useState('unsigned');
  const [signRequest, setSignRequest] = useState(null);
  const [signMode, setSignMode] = useState('manual');
  const [signCode, setSignCode] = useState('');
  const [signError, setSignError] = useState('');
  const [verifyingSign, setVerifyingSign] = useState(false);
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [passkey, setPasskey] = useState('');
  const [confirmPasskey, setConfirmPasskey] = useState('');
  const [passkeyError, setPasskeyError] = useState('');
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [passkeySetAt, setPasskeySetAt] = useState(employee?.payslip_passkey_set_at || null);
  const [revealedPasskey, setRevealedPasskey] = useState('');
  const [revealSeconds, setRevealSeconds] = useState(0);
  const revealTimerRef = useRef(null);
  const qc = useQueryClient();

  useEffect(() => {
    setPasskeySetAt(employee?.payslip_passkey_set_at || null);
  }, [employee?.id, employee?.payslip_passkey_set_at]);

  useEffect(() => () => {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current);
  }, []);

  const closePasskeyDialog = () => {
    setPasskeyDialogOpen(false);
    setPasskey('');
    setConfirmPasskey('');
    setPasskeyError('');
  };

  const savePasskey = async () => {
    if (!/^\d{4}$/.test(passkey)) {
      setPasskeyError('Enter exactly four numeric digits.');
      return;
    }
    if (passkey !== confirmPasskey) {
      setPasskeyError('Passkeys do not match.');
      return;
    }
    setPasskeySaving(true);
    setPasskeyError('');
    try {
      const result = await requestJson('/api/functions/employeePasskey', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'setup',
          employee_record_id: employee.id,
          identity_code: employee.qr_code || employee.employee_id,
          passkey,
        }),
      });
      setPasskeySetAt(result.set_at);
      qc.invalidateQueries({ queryKey: ['employees'] });
      closePasskeyDialog();
    } catch (error) {
      setPasskeyError(error?.message || 'Unable to save passkey.');
    } finally {
      setPasskeySaving(false);
    }
  };

  const revealPasskeyForFiveSeconds = async () => {
    setPasskeyError('');
    try {
      const result = await requestJson('/api/functions/employeePasskey', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'reveal',
          employee_record_id: employee.id,
          identity_code: employee.qr_code || employee.employee_id,
        }),
      });
      setRevealedPasskey(result.passkey);
      setRevealSeconds(5);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      revealTimerRef.current = setInterval(() => {
        setRevealSeconds(seconds => {
          if (seconds <= 1) {
            clearInterval(revealTimerRef.current);
            revealTimerRef.current = null;
            setRevealedPasskey('');
            return 0;
          }
          return seconds - 1;
        });
      }, 1000);
    } catch (error) {
      setPasskeyError(error?.message || 'Unable to reveal passkey.');
    }
  };

  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['myCashAdvances', employee?.employee_id],
    queryFn: () => appApi.entities.CashAdvance.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  const { data: memos = [] } = useQuery({
    queryKey: ['employeeMemos', employee?.employee_id],
    queryFn: () => appApi.entities.EmployeeMemo.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  const { data: suspensions = [] } = useQuery({
    queryKey: ['employeeSuspensions', employee?.employee_id],
    queryFn: () => appApi.entities.EmployeeSuspension.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  const { data: terminations = [] } = useQuery({
    queryKey: ['employeeTerminations', employee?.employee_id],
    queryFn: () => appApi.entities.EmployeeTermination.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  const { data: promissoryNotes = [] } = useQuery({
    queryKey: ['employeePromissoryNotes', employee?.employee_id],
    queryFn: () => appApi.entities.EmployeePromissoryNote.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  const signMutation = useMutation({
    mutationFn: ({ entity, id }) => appApi.entities[entity].update(id, {
      signed: true,
      signed_date: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employeeMemos', employee?.employee_id] });
      qc.invalidateQueries({ queryKey: ['employeeSuspensions', employee?.employee_id] });
      qc.invalidateQueries({ queryKey: ['employeePromissoryNotes', employee?.employee_id] });
    },
  });

  const closeSignDialog = () => {
    setSignRequest(null);
    setSignCode('');
    setSignError('');
    setVerifyingSign(false);
    setSignMode('manual');
  };

  const processSignatureCode = async (code) => {
    const trimmed = normalizeQrValue(code);
    if (!trimmed || !signRequest) return;

    setVerifyingSign(true);
    setSignError('');

    try {
      const res = await appApi.functions.invoke('lookupEmployee', { code: trimmed });
      const scannedEmployee = res.employee;
      if (!scannedEmployee || normalizeQrValue(scannedEmployee.employee_id) !== normalizeQrValue(employee.employee_id)) {
        setSignError('QR code does not match this employee.');
        setVerifyingSign(false);
        return;
      }

      await signMutation.mutateAsync({
        entity: signRequest.entity,
        id: signRequest.item.id,
      });
      closeSignDialog();
    } catch {
      setSignError('Employee QR code was not found. Please try again.');
      setVerifyingSign(false);
    }
  };

  const startQrSignature = async () => {
    setSignMode('camera');
    setSignError('');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      await new Promise(resolve => setTimeout(resolve, 100));
      const scanner = new Html5Qrcode('document-sign-reader');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        async (text) => {
          try {
            await scanner.stop();
            scanner.clear();
          } catch {}
          setSignMode('manual');
          processSignatureCode(text);
        },
        () => {}
      );
    } catch {
      setSignMode('manual');
      setSignError('Camera is not available. Enter or scan the ID manually.');
    }
  };

  if (!employee) return (
    <div className="p-6 text-center text-muted-foreground text-sm">
      <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p>Scan your QR code first to view your profile.</p>
    </div>
  );

  const activeCA = cashAdvances.filter(ca => ['pending', 'approved_by_hr', 'approved_by_manager', 'approved'].includes(ca.status));
  const totalBalance = activeCA.reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
  const regularLimitBalance = activeCA
    .filter(ca => ca.advance_type !== 'emergency' && ca.advance_type !== 'beginning_balance')
    .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
  const maxAllowed = employee?.max_cash_advance || 0;
  const unsignedMemos = memos.filter(item => item.requires_signature !== false && !item.signed).length;
  const unsignedSuspensions = suspensions.filter(item => item.requires_signature !== false && !item.signed).length;
  const unsignedPromissory = promissoryNotes.filter(item => item.requires_signature !== false && !item.signed).length;
  const unsignedNotices = unsignedMemos + unsignedSuspensions + unsignedPromissory;
  const noticeGroups = [
    { title: 'Memos', entity: 'EmployeeMemo', items: memos },
    { title: 'Suspensions', entity: 'EmployeeSuspension', items: suspensions },
    { title: 'Termination', entity: 'EmployeeTermination', items: terminations },
    { title: 'Promissory Notes', entity: 'EmployeePromissoryNote', items: promissoryNotes },
  ];
  const noticeItems = noticeGroups
    .flatMap(group => group.items.map(item => ({ ...item, groupTitle: group.title, entity: group.entity })))
    .sort((a, b) => {
      const dateA = a.signed_date || a.issue_date || a.notice_date || a.note_date || a.effective_date || a.created_date || '';
      const dateB = b.signed_date || b.issue_date || b.notice_date || b.note_date || b.effective_date || b.created_date || '';
      return dateB.localeCompare(dateA);
    });
  const signedNoticeItems = noticeItems.filter(item => item.signed || item.entity === 'EmployeeTermination' || item.requires_signature === false);
  const unsignedNoticeItems = noticeItems.filter(item => item.requires_signature !== false && !item.signed && item.entity !== 'EmployeeTermination');
  const displayedNoticeItems = noticeTab === 'signed' ? signedNoticeItems : unsignedNoticeItems;

  const fields = [
    { label: 'Employee ID', value: employee.employee_id },
    { label: 'Full Name', value: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ') },
    { label: 'Department', value: employee.department },
    { label: 'Position', value: employee.position },
    { label: 'Employment Type', value: employee.employment_type?.replace('_', ' ') },
    { label: 'Date Hired', value: employee.date_hired },
    { label: 'Daily Rate', value: employee.daily_rate ? `₱${Number(employee.daily_rate).toLocaleString()}` : null },
  ].filter(f => f.value);

  return (
    <div className="flex flex-col">
      {subTab === 'info' && (
        <div className="p-4 max-w-2xl mx-auto w-full space-y-4">
          {/* Cash Advance Balance */}
          <Card className="border border-primary/20 bg-primary/5">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground mb-1">Cash Advance Balance</p>
              <p className="text-3xl font-bold text-primary">₱{totalBalance.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{activeCA.length} active advance(s)</p>
              {maxAllowed > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Regular limit used</span>
                    <span>Max: ₱{maxAllowed.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${regularLimitBalance >= maxAllowed ? 'bg-red-500' : 'bg-primary'}`}
                      style={{ width: `${Math.min(100, (regularLimitBalance / maxAllowed) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Available: ₱{Math.max(0, maxAllowed - regularLimitBalance).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSubTab('attendance')}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Attendance</p>
                <p className="text-xs text-muted-foreground">View records</p>
              </div>
            </button>
            <button
              onClick={() => setSubTab('payslips')}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Payslips</p>
                <p className="text-xs text-muted-foreground">View payroll</p>
              </div>
            </button>
            <button
              onClick={() => setShowDeductionSchedule(true)}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left col-span-2"
            >
              <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                <CalendarClock className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Deduction Schedule</p>
                <p className="text-xs text-muted-foreground">{activeCA.length > 0 ? `${activeCA.length} active advance(s) — view payroll deductions` : 'No active cash advances'}</p>
              </div>
            </button>
            <button
              onClick={() => setShowNotices(true)}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left col-span-2"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Bell className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Memos & Notices</p>
                  {unsignedNotices > 0 && <Badge className="bg-amber-100 text-amber-700 border-0">{unsignedNotices} unsigned</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {unsignedNotices > 0 ? `${unsignedNotices} item(s) need your acknowledgment` : 'View memos, notices, and promissory notes'}
                </p>
              </div>
            </button>
          </div>

          {/* Deduction Schedule Dialog */}
          <Dialog open={showDeductionSchedule} onOpenChange={setShowDeductionSchedule}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-purple-600" /> Deduction Schedule
                </DialogTitle>
              </DialogHeader>
              {cashAdvances.some(ca => ca.status === 'approved' && ca.deduction_payroll_periods > 0) ? (
                <DeductionScheduleView cashAdvances={cashAdvances} employeeMode={true} />
              ) : (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <CalendarClock className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No approved cash advance deduction schedules yet.</p>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={showNotices} onOpenChange={setShowNotices}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-amber-600" /> Memos & Notices
                  {unsignedNotices > 0 && <Badge className="bg-amber-100 text-amber-700 border-0">{unsignedNotices} unsigned</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={noticeTab === 'unsigned' ? 'default' : 'outline'}
                  onClick={() => setNoticeTab('unsigned')}
                  className="gap-2"
                >
                  Unsigned
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${noticeTab === 'unsigned' ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'}`}>
                    {unsignedNoticeItems.length}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant={noticeTab === 'signed' ? 'default' : 'outline'}
                  onClick={() => setNoticeTab('signed')}
                  className="gap-2"
                >
                  Signed
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${noticeTab === 'signed' ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'}`}>
                    {signedNoticeItems.length}
                  </span>
                </Button>
              </div>
              <div className="space-y-4">
                {displayedNoticeItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No {noticeTab === 'signed' ? 'signed' : 'unsigned'} memos or notices.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {displayedNoticeItems.map(item => {
                      const needsSignature = item.requires_signature !== false && !item.signed && item.entity !== 'EmployeeTermination';
                      return (
                        <Card key={item.id}>
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm text-foreground">{item.title || item.reason || 'Untitled document'}</p>
                                  <Badge variant="outline" className="text-xs">{item.groupTitle}</Badge>
                                  {item.requires_signature !== false && item.entity !== 'EmployeeTermination' && (
                                    <Badge className={`text-xs border-0 ${item.signed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                      {item.signed ? 'Signed' : 'Unsigned'}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {item.issue_date || item.notice_date || item.note_date || item.effective_date || 'No date'}
                                  {item.amount ? ` · ₱${item.amount.toLocaleString()}` : ''}
                                </p>
                              </div>
                              {needsSignature && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSignRequest({ entity: item.entity, item });
                                    setSignCode('');
                                    setSignError('');
                                  }}
                                  disabled={signMutation.isPending}
                                >
                                  Sign
                                </Button>
                              )}
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{item.body || item.reason || item.terms || 'No details provided.'}</p>
                            {item.signed && item.signed_date && (
                              <p className="text-xs font-medium text-green-700">
                                Acknowledged by employee on {item.signed_date}
                              </p>
                            )}
                            {(item.start_date || item.end_date || item.due_date || item.signed_date) && (
                              <p className="text-xs text-muted-foreground">
                                {item.start_date && item.end_date ? `Period: ${item.start_date} to ${item.end_date}` : ''}
                                {item.due_date ? `Due: ${item.due_date}` : ''}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!signRequest} onOpenChange={(open) => { if (!open) closeSignDialog(); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-primary" /> Scan Employee QR to Sign
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Scan the employee QR code to acknowledge: <span className="font-medium text-foreground">{signRequest?.item?.title}</span>
                </p>
                {signMode === 'camera' ? (
                  <div id="document-sign-reader" className="rounded-lg overflow-hidden border border-border" />
                ) : (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      processSignatureCode(signCode);
                    }}
                  >
                    <Input
                      value={signCode}
                      onChange={e => { setSignCode(e.target.value); setSignError(''); }}
                      placeholder="Scan or enter Employee ID"
                      autoFocus
                    />
                    <Button type="submit" className="w-full gap-2" disabled={verifyingSign || !signCode.trim()}>
                      <Keyboard className="w-4 h-4" /> Verify and Sign
                    </Button>
                  </form>
                )}
                {signError && <p className="text-xs text-destructive">{signError}</p>}
                <div className="flex justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={closeSignDialog}>Cancel</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={startQrSignature} disabled={verifyingSign}>
                    <QrCode className="w-4 h-4" /> Use Camera
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Employee Info */}
          <Card className="border border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-primary" /> Payslip Receipt Passkey
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Your four-digit passkey is required together with your employee QR code and photo when acknowledging a released payslip.
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div>
                  <p className="font-mono text-lg tracking-[0.35em] text-foreground">
                    {revealedPasskey || (passkeySetAt ? '••••' : 'Not set')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {revealedPasskey ? `Masks again in ${revealSeconds}s` : passkeySetAt ? 'Passkey configured' : 'Setup required'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {passkeySetAt && (
                    <Button variant="outline" size="sm" onClick={revealPasskeyForFiveSeconds} disabled={revealSeconds > 0}>
                      {revealedPasskey ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                      {revealedPasskey ? `${revealSeconds}s` : 'View'}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setPasskeyDialogOpen(true)}>
                    {passkeySetAt ? 'Change' : 'Set Passkey'}
                  </Button>
                </div>
              </div>
              {passkeyError && <p className="text-xs text-destructive">{passkeyError}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Employee Information</CardTitle></CardHeader>
            <CardContent>
              {fields.map(f => (
                <div key={f.label} className="flex justify-between py-2.5 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">{f.label}</span>
                  <span className="text-sm font-medium text-foreground capitalize">{f.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Dialog open={passkeyDialogOpen} onOpenChange={(open) => { if (!open) closePasskeyDialog(); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{passkeySetAt ? 'Change' : 'Set'} Payslip Passkey</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Choose exactly four numbers. Do not share this passkey.</p>
                <div>
                  <label className="text-sm font-medium">4-digit passkey</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={passkey}
                    onChange={e => setPasskey(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="mt-1 text-center font-mono tracking-[0.5em]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Confirm passkey</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={confirmPasskey}
                    onChange={e => setConfirmPasskey(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="mt-1 text-center font-mono tracking-[0.5em]"
                  />
                </div>
                {passkeyError && <p className="text-xs text-destructive">{passkeyError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={closePasskeyDialog}>Cancel</Button>
                  <Button onClick={savePasskey} disabled={passkeySaving}>
                    {passkeySaving ? 'Saving...' : 'Save Passkey'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {subTab === 'attendance' && <EmployeeAttendance employee={employee} />}
      {subTab === 'payslips' && (
        <EmployeePayslips employee={{ ...employee, payslip_passkey_set_at: passkeySetAt }} />
      )}
    </div>
  );
}
