// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { formatManilaTime } from '@/lib/dateUtils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const categoryLabel = value => ({ system_error: 'System Error', employee_error: 'Employee Error', others: 'Others' }[value] || value || '—');
const statusClass = value => ({ pending: 'bg-amber-100 text-amber-800', approved: 'bg-blue-100 text-blue-800', denied: 'bg-red-100 text-red-700', adjusted: 'bg-emerald-100 text-emerald-700' }[value] || '');
const timeInput = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '';

export default function TimeInReviews() {
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [adjustedTime, setAdjustedTime] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => setPage(1), [activeCompanyId]);

  const query = useQuery({
    queryKey: ['time-in-reviews', activeCompanyId, page],
    queryFn: async () => {
      const baseFilter = { company_profile_id: activeCompanyId };
      const [records, pendingCount, approvedCount, completedCount] = await Promise.all([
        appApi.entities.AttendanceLog.page({
          ...baseFilter,
          time_in_review_status: { $in: ['pending', 'approved', 'denied', 'adjusted'] },
        }, '-time_in_review_requested_at', page, pageSize),
        appApi.entities.AttendanceLog.page({ ...baseFilter, time_in_review_status: 'pending' }, '-time_in_review_requested_at', 1, 1),
        appApi.entities.AttendanceLog.page({ ...baseFilter, time_in_review_status: 'approved' }, '-time_in_review_requested_at', 1, 1),
        appApi.entities.AttendanceLog.page({ ...baseFilter, time_in_review_status: { $in: ['denied', 'adjusted'] } }, '-time_in_review_requested_at', 1, 1),
      ]);
      return {
        items: records.data || [],
        pagination: records.pagination,
        counts: {
          pending: Number(pendingCount.pagination?.total || 0),
          approved: Number(approvedCount.pagination?.total || 0),
          completed: Number(completedCount.pagination?.total || 0),
        },
      };
    },
    enabled: Boolean(activeCompanyId),
  });
  const items = useMemo(() => query.data?.items || [], [query.data?.items]);
  const pending = items.filter(item => item.time_in_review_status === 'pending');
  const approved = items.filter(item => item.time_in_review_status === 'approved');
  const completed = items.filter(item => ['denied', 'adjusted'].includes(item.time_in_review_status));
  const canDecide = user?.role === 'super_admin';
  const canAdjust = ['admin', 'user'].includes(user?.role);

  const mutation = useMutation({
    mutationFn: payload => appApi.functions.invoke('reviewTimeInAdjustment', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-in-reviews', activeCompanyId] }); qc.invalidateQueries({ queryKey: ['attendance'] }); qc.invalidateQueries({ queryKey: ['attendanceSummary'] }); setSelected(null); setAction(''); setNote(''); setAdjustedTime(''); setPasscode(''); setError(''); },
    onError: err => setError(err?.message || 'Unable to update this review.'),
  });

  const open = (item, nextAction) => { setSelected(item); setAction(nextAction); setNote(''); setAdjustedTime(timeInput(item.time_in)); setPasscode(''); setError(''); };
  const submit = () => {
    if (!note.trim()) { setError('A note is required.'); return; }
    mutation.mutate({ attendance_log_id: selected.id, action, decision_note: note.trim(), adjustment_note: note.trim(), adjusted_time: adjustedTime, passcode });
  };

  const Table = ({ rows, mode }) => <Card className="overflow-hidden">
    <div className="border-b px-4 py-3"><h2 className="font-semibold">{mode === 'pending' ? 'Awaiting Super Admin Decision' : mode === 'approved' ? 'Approved for HR/Admin Adjustment' : 'Completed Reviews'}</h2><p className="text-xs text-muted-foreground">{rows.length} item{rows.length === 1 ? '' : 's'}</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-muted/60"><tr>{['Employee','Date','Actual Time In (1)','Review Reason','Request Note','Decision','Status','Actions'].map(label => <th key={label} className="px-3 py-2 text-left text-xs">{label}</th>)}</tr></thead><tbody>
      {rows.map(item => <tr key={item.id} className="border-t align-top"><td className="px-3 py-3 font-medium">{item.employee_name || item.employee_id}<br/><span className="text-xs text-muted-foreground">{item.employee_id}</span></td><td className="px-3 py-3">{item.date}</td><td className="px-3 py-3 font-mono">{item.time_in_original_value || item.time_in_actual_punch_at || item.time_in ? formatManilaTime(item.time_in_original_value || item.time_in_actual_punch_at || item.time_in) : '—'}</td><td className="px-3 py-3">{categoryLabel(item.time_in_review_category)}</td><td className="max-w-xs whitespace-pre-wrap px-3 py-3">{item.time_in_review_note || '—'}</td><td className="max-w-xs whitespace-pre-wrap px-3 py-3">{item.time_in_review_decision_note || item.time_in_adjustment_note || '—'}</td><td className="px-3 py-3"><Badge variant="outline" className={statusClass(item.time_in_review_status)}>{item.time_in_review_status}</Badge></td><td className="px-3 py-3"><div className="flex gap-2">{mode === 'pending' && canDecide && <><Button size="sm" onClick={() => open(item, 'approve')}><CheckCircle2 className="mr-1 h-4 w-4"/>Approve</Button><Button size="sm" variant="destructive" onClick={() => open(item, 'deny')}><XCircle className="mr-1 h-4 w-4"/>Deny</Button></>}{mode === 'approved' && canAdjust && <Button size="sm" onClick={() => open(item, 'adjust')}><Clock3 className="mr-1 h-4 w-4"/>Adjust</Button>}{((mode === 'pending' && !canDecide) || (mode === 'approved' && !canAdjust) || mode === 'completed') && <span className="text-xs text-muted-foreground">—</span>}</div></td></tr>)}
      {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No items in this section.</td></tr>}
    </tbody></table></div>
  </Card>;

  return <div className="space-y-5 p-4 md:p-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="h-6 w-6 text-primary"/>Time In (1) Review Items</h1><p className="text-sm text-muted-foreground">Super Admin decisions and passcode-confirmed HR/Admin adjustments. Original scan timestamps remain in the audit trail.</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-muted-foreground">Pending Decision</p><p className="mt-1 text-2xl font-bold text-amber-700">{query.data?.counts?.pending || 0}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Approved to Adjust</p><p className="mt-1 text-2xl font-bold text-blue-700">{query.data?.counts?.approved || 0}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Completed</p><p className="mt-1 text-2xl font-bold text-emerald-700">{query.data?.counts?.completed || 0}</p></Card></div>
    <Table rows={pending} mode="pending"/><Table rows={approved} mode="approved"/><Table rows={completed} mode="completed"/>
    <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Page {page} of {Math.max(1, Number(query.data?.pagination?.totalPages || 0))}</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage(current => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><Button type="button" size="sm" variant="outline" disabled={page >= Number(query.data?.pagination?.totalPages || 0) || query.isFetching} onClick={() => setPage(current => current + 1)}>Next<ChevronRight className="ml-1 h-4 w-4"/></Button></div></div>
    <Dialog open={Boolean(selected)} onOpenChange={openState => !openState && setSelected(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{action === 'approve' ? 'Approve Time In Review' : action === 'deny' ? 'Deny Time In Review' : 'Apply Approved Time In Adjustment'}</DialogTitle></DialogHeader>{selected && <div className="space-y-4"><div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-semibold">{selected.employee_name || selected.employee_id} · {selected.date}</p><p className="mt-1">Original actual scan: <strong>{selected.time_in_original_value || selected.time_in_actual_punch_at || selected.time_in ? formatManilaTime(selected.time_in_original_value || selected.time_in_actual_punch_at || selected.time_in) : 'Missing'}</strong></p><p className="mt-1 text-muted-foreground">{categoryLabel(selected.time_in_review_category)} — {selected.time_in_review_note}</p>{selected.time_in_review_decision_note && <p className="mt-2 text-blue-700">Super Admin: {selected.time_in_review_decision_note}</p>}</div>{action === 'adjust' && <><div><label className="text-sm font-medium">Authorized adjusted Time In (1)</label><Input type="time" className="mt-1" value={adjustedTime} onChange={event => setAdjustedTime(event.target.value)}/></div><div><label className="text-sm font-medium">Daily HR/Admin passcode</label><Input type="password" maxLength={6} className="mt-1 text-center font-mono tracking-widest" value={passcode} onChange={event => setPasscode(event.target.value)}/></div></>}<div><label className="text-sm font-medium">{action === 'adjust' ? 'Adjustment note' : 'Decision note'}</label><Textarea rows={4} className="mt-1" value={note} onChange={event => setNote(event.target.value)} placeholder="Explain the decision or authorized adjustment."/></div>{error && <p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSelected(null)} disabled={mutation.isPending}>Cancel</Button><Button variant={action === 'deny' ? 'destructive' : 'default'} onClick={submit} disabled={mutation.isPending || (action === 'adjust' && (!adjustedTime || !passcode))}>{mutation.isPending ? 'Saving…' : action === 'adjust' ? 'Confirm Adjustment' : action === 'deny' ? 'Deny Review' : 'Approve Review'}</Button></div></div>}</DialogContent></Dialog>
  </div>;
}
