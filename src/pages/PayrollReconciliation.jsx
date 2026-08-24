// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardList, Eye, Lock, RefreshCw, Save, Scale, Send } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appApi } from '@/lib/appApi';
import { requestJson } from '@/lib/appApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ReviewerNotesCard from '@/components/payroll/ReviewerNotesCard';
import ReconciliationReviewSummary from '@/components/payroll/ReconciliationReviewSummary';
import DailyAttendanceInputsTable from '@/components/payroll/DailyAttendanceInputsTable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { approvedOvertimeRequestForLog, capOvertimeByApprovedRequest } from '@/lib/overtimeRequests';

const SUMMARY_FIELDS = [
  ['regular_days', 'Regular Days', 'number'], ['daily_rate', 'Rate / Day', 'money'], ['basic_pay', 'Basic Pay', 'money'],
  ['overtime_hours', 'OT Hours', 'number'], ['overtime_pay', 'OT Pay', 'money'], ['night_diff_hours', 'Night Diff Hours', 'number'],
  ['night_diff_pay', 'Night Diff Pay', 'money'], ['rest_day_pay', 'Rest Day Pay', 'money'], ['holiday_pay', 'Holiday Pay', 'money'],
  ['cash_advance_received', 'CA Received', 'money'], ['cash_advance_deduction', 'Cash Advance Deduction', 'money'], ['sss_contribution', 'SSS', 'money'], ['philhealth_contribution', 'PhilHealth', 'money'],
  ['pagibig_contribution', 'Pag-IBIG', 'money'], ['withholding_tax', 'Withholding Tax', 'money'], ['incentive_pay', 'Incentives / Adj.', 'money'],
  ['late_deduction', 'Late Deduction', 'money'], ['undertime_deduction', 'Undertime', 'money'], ['absent_deduction', 'Absence Deduction', 'money'],
  ['agency_fee', 'Agency Fee', 'money'], ['total_deductions', 'Total Deductions', 'money'], ['gross_pay', 'Gross Pay', 'money'], ['net_pay', 'Net Pay', 'money'],
];
const DAILY_FIELDS = [
  ['regular_hours', 'Regular Hrs'], ['overtime_hours', 'OT Hrs'], ['night_diff_hours', 'Night Diff Hrs'],
  ['late_minutes', 'Late Min'], ['undertime_minutes', 'Undertime Min'],
];
const num = value => Number(value) || 0;
const money = value => `₱${num(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const display = (value, type) => type === 'money' ? money(value) : num(value).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const dateRange = (start, end) => {
  const dates = [];
  if (!start || !end) return dates;
  const cursor = new Date(`${start}T12:00:00Z`);
  const finish = new Date(`${end}T12:00:00Z`);
  while (cursor <= finish) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return dates;
};
const time = value => value ? new Date(value).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '—';
const timeValue = value => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return `${parts.find(part => part.type === 'hour')?.value || '00'}:${parts.find(part => part.type === 'minute')?.value || '00'}`;
};

const reconciledOvertimeHours = (log = {}, requests = []) => {
  const storedHours = num(log.overtime_hours);
  if (storedHours > 0) return storedHours;

  const approvedRequest = approvedOvertimeRequestForLog(log, requests);
  if (!approvedRequest) return storedHours;

  // OT review validates and snapshots the actual hours supported by Time Out.
  // Use that snapshot if the attendance log was not updated by approval.
  const confirmedActual = num(approvedRequest.confirmed_actual_ot_hours);
  const actualHours = confirmedActual > 0 ? confirmedActual : num(log.ot_actual_hours);
  return capOvertimeByApprovedRequest(actualHours, approvedRequest);
};

const CONSOLIDATED_FIELDS = [
  ['basic_pay', 'Basic Pay'], ['overtime_hours', 'OT Hours'], ['overtime_pay', 'OT Pay'],
  ['night_diff_pay', 'Night Diff Pay'], ['cash_advance_received', 'CA Received'], ['cash_advance_deduction', 'Cash Advance Deduction'],
  ['late_deduction', 'Late Deductions'], ['total_deductions', 'Total Deductions'], ['gross_pay', 'Gross Pay'], ['net_pay', 'Net Pay'],
];
const DERIVED_SUMMARY_FIELDS = new Set(['total_deductions', 'gross_pay', 'net_pay']);
const deriveManualSummary = (values = {}, record = {}) => {
  const next = { ...values };
  // Older saved reconciliations predate this visible field. Default them to the
  // payroll record so opening an existing review does not create a false variance.
  next.cash_advance_received = values.cash_advance_received ?? num(record.cash_advance_received);
  next.gross_pay = num(next.basic_pay) + num(next.overtime_pay) + num(next.night_diff_pay) + num(next.rest_day_pay) + num(next.holiday_pay) + num(next.incentive_pay);
  next.total_deductions = num(next.cash_advance_deduction) + num(next.sss_contribution) + num(next.philhealth_contribution) + num(next.pagibig_contribution) + num(next.withholding_tax) + num(next.late_deduction) + num(next.undertime_deduction) + num(next.absent_deduction) + num(next.agency_fee);
  next.net_pay = next.gross_pay + num(next.cash_advance_received) - next.total_deductions;
  return next;
};

function ConsolidatedReconciliation({ records, reconciliations, onEmployee, period, reviewerNotes = [], companyId, company, user }) {
  const [showDifferenceDetails, setShowDifferenceDetails] = useState(false);
  const [remarkQueue, setRemarkQueue] = useState('');
  const [showReviewSummary, setShowReviewSummary] = useState(false);
  const [differenceFilter, setDifferenceFilter] = useState('all');
  const employeeBreakdownRef = useRef(null);
  const [showDifferenceReasons, setShowDifferenceReasons] = useState(false);
  const remarksSummaryQuery = useQuery({ queryKey: ['reviewer-notes-summary', companyId, period?.id], queryFn: () => requestJson(`/api/payroll-reconciliation/reviewer-notes?action=summary&companyProfileId=${encodeURIComponent(companyId)}&payrollPeriodId=${encodeURIComponent(period.id)}`), enabled: Boolean(companyId && period?.id) });
  const latestByEmployee = new Map();
  reconciliations.forEach(item => {
    const key = String(item.employee_id || '');
    if (!latestByEmployee.has(key)) latestByEmployee.set(key, item);
  });
  const rows = records.map(record => {
    const reconciliation = latestByEmployee.get(String(record.employee_id || ''));
    const system = record;
    const manualValues = deriveManualSummary(reconciliation?.manual_values || system, record);
    const variance = CONSOLIDATED_FIELDS.filter(([key]) => Math.abs(num(system[key]) - num(manualValues[key])) > .005).length;
    const differences = CONSOLIDATED_FIELDS
      .map(([key, label]) => ({
        key,
        label,
        system: num(system[key]),
        manual: num(manualValues[key]),
        difference: num(system[key]) - num(manualValues[key]),
      }))
      .filter(item => Math.abs(item.difference) > .005);
    return { record, reconciliation, system, manualValues, variance, differences };
  });
  const openNoteEmployees = new Set(reviewerNotes.filter(note => ['needs_response','reopened','responded'].includes(note.status)).map(note => String(note.employeeId)));
  const reviewed = rows.filter(row => row.reconciliation && (!row.variance || ['accept_system', 'accept_manual'].includes(row.reconciliation?.resolution_status)) && !openNoteEmployees.has(String(row.record.employee_id))).length;
  const unresolved = rows.filter(row => row.reconciliation && ((row.variance > 0 && !['accept_system', 'accept_manual'].includes(row.reconciliation?.resolution_status)) || openNoteEmployees.has(String(row.record.employee_id)))).length;
  const totals = CONSOLIDATED_FIELDS.map(([key, label]) => ({
    key,
    label,
    system: rows.reduce((sum, row) => sum + num(row.system[key]), 0),
    manual: rows.reduce((sum, row) => sum + (row.reconciliation ? num(row.manualValues[key]) : 0), 0),
  }));
  const netPayTotals = totals.find(item => item.key === 'net_pay');
  const manualNetPayPending = remarksSummaryQuery.data?.pendingEmployees;
  const periodLabel = period?.period_name || (period?.start_date && period?.end_date ? `${period.start_date} – ${period.end_date}` : 'Selected period');
  const noteBadge = employeeId => { const notes = reviewerNotes.filter(note => String(note.employeeId) === String(employeeId)); return notes.some(note => ['needs_response','reopened'].includes(note.status)) ? 'Needs Clarification' : notes.some(note => note.status === 'responded') ? 'For Reviewer Review' : notes.length ? 'Reviewed' : ''; };
  const filteredRows = rows.filter(row => row.variance > 0 && (differenceFilter === 'all' || row.differences.some(item => item.key === differenceFilter)));
  const queuedRemarks = reviewerNotes.filter(note => remarkQueue === 'resolution' ? ['needs_response', 'reopened'].includes(note.status) : note.status === 'responded');
  const selectDifferenceCategory = key => {
    setDifferenceFilter(key);
    setTimeout(() => employeeBreakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Card className="p-4"><p className="text-xs text-muted-foreground">Total Employees</p><p className="mt-1 text-2xl font-bold">{records.length}</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Reconciled</p><p className="mt-1 text-2xl font-bold text-emerald-700">{reviewed}</p><p className="text-xs text-muted-foreground">{Math.max(records.length-reviewed, 0)} pending</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Unresolved Variances</p><p className={`mt-1 text-2xl font-bold ${unresolved ? 'text-red-600' : 'text-emerald-700'}`}>{unresolved}</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">System Net Payroll</p><p className="mt-1 text-2xl font-bold">{money(netPayTotals?.system)}</p><div className="mt-1 flex items-baseline justify-between gap-2 text-xs"><span className="text-muted-foreground">Manual Net Pay</span><span className="font-medium">{money(netPayTotals?.manual)}</span></div><div className={`flex items-baseline justify-between gap-2 text-xs ${Math.abs(num(netPayTotals?.system) - num(netPayTotals?.manual)) > .005 ? 'text-red-600' : 'text-emerald-700'}`}><span>Difference</span><span className="font-mono font-semibold">{money(num(netPayTotals?.system) - num(netPayTotals?.manual))}</span></div>{manualNetPayPending > 0 && <p className="mt-1 text-xs text-muted-foreground">{manualNetPayPending} pending</p>}</Card>
      <Card className="cursor-pointer p-4" onClick={() => !remarksSummaryQuery.isLoading && !remarksSummaryQuery.error && setRemarkQueue('resolution')}><p className="text-xs text-muted-foreground">Remarks for Resolution</p>{remarksSummaryQuery.isLoading ? <p className="mt-1 text-sm">Loading…</p> : remarksSummaryQuery.error ? <button className="mt-1 text-sm text-red-600 underline" onClick={event => { event.stopPropagation(); remarksSummaryQuery.refetch(); }}>Retry</button> : <><p className="mt-1 text-2xl font-bold text-amber-700">{remarksSummaryQuery.data?.remarksForResolution?.noteCount || 0}</p><p className="text-xs text-muted-foreground">{remarksSummaryQuery.data?.remarksForResolution?.employeeCount || 0} employees</p></>}</Card>
      <Card className="cursor-pointer p-4" onClick={() => !remarksSummaryQuery.isLoading && !remarksSummaryQuery.error && setRemarkQueue('review')}><p className="text-xs text-muted-foreground">Remarks for Review</p>{remarksSummaryQuery.isLoading ? <p className="mt-1 text-sm">Loading…</p> : remarksSummaryQuery.error ? <button className="mt-1 text-sm text-red-600 underline" onClick={event => { event.stopPropagation(); remarksSummaryQuery.refetch(); }}>Retry</button> : <><p className="mt-1 text-2xl font-bold text-blue-700">{remarksSummaryQuery.data?.remarksForReview?.noteCount || 0}</p><p className="text-xs text-muted-foreground">{remarksSummaryQuery.data?.remarksForReview?.employeeCount || 0} employees</p></>}</Card>
    </div>
    {remarksSummaryQuery.data && !remarksSummaryQuery.data.reviewerNotesAvailable && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Reviewer-note review is not yet enabled in this environment. Existing payroll release behavior remains active until the reviewer-note migration is deployed.</div>}
    <Dialog open={Boolean(remarkQueue)} onOpenChange={open => !open && setRemarkQueue('')}><DialogContent className="max-h-[80vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>{remarkQueue === 'resolution' ? 'Remarks for Resolution' : 'Remarks for Review'}</DialogTitle></DialogHeader>{queuedRemarks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-xs"><thead className="bg-muted/70"><tr>{['Employee No.','Category','Reviewer Question','Status','Raised At','Latest Response','Action'].map(item => <th key={item} className="px-3 py-2 text-left">{item}</th>)}</tr></thead><tbody>{queuedRemarks.map(note => <tr key={note.id} className="border-t"><td className="px-3 py-2">{note.employeeId}</td><td className="px-3 py-2">{note.category}</td><td className="px-3 py-2">{note.reviewerNote}</td><td className="px-3 py-2">{note.status}</td><td className="px-3 py-2">{new Date(note.createdAt).toLocaleString('en-PH')}</td><td className="px-3 py-2">{note.response || '—'}</td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => { setRemarkQueue(''); onEmployee(String(note.employeeId)); }}>View Reconciliation</Button></td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">No remarks in this queue.</p>}</DialogContent></Dialog>
      <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><h2 className="font-semibold">Consolidated Payroll Totals</h2><p className="text-xs text-muted-foreground">System / Manual / Difference across all employees in this payroll period.</p></div>
        <div className="flex gap-2">{user?.role === 'super_admin' && <Button variant="outline" size="sm" onClick={() => setShowReviewSummary(true)}>Reconciliation Review Summary</Button>}<Button variant="outline" size="sm" className="gap-2" onClick={() => setShowDifferenceReasons(true)} disabled={!rows.some(row => row.variance > 0)}><ClipboardList className="h-4 w-4" /> View Difference Reasons</Button></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-xs"><thead className="bg-muted/70"><tr><th className="px-3 py-2 text-left">Source</th>{totals.map(item => <th key={item.key} className="px-3 py-2 text-right">{item.label}</th>)}<th className="px-3 py-2 text-right">Action</th></tr></thead><tbody>
        <tr className="border-t"><td className="px-3 py-2 font-bold text-red-600">System</td>{totals.map(item => <td key={item.key} className="px-3 py-2 text-right font-mono">{item.key === 'overtime_hours' ? display(item.system, 'number') : money(item.system)}</td>)}</tr>
        <tr className="border-t"><td className="px-3 py-2 font-bold text-blue-600">Manual</td>{totals.map(item => <td key={item.key} className="px-3 py-2 text-right font-mono">{item.key === 'overtime_hours' ? display(item.manual, 'number') : money(item.manual)}</td>)}</tr>
        <tr className="border-t bg-yellow-50"><td className="px-3 py-2 font-bold text-amber-700">Difference</td>{totals.map(item => { const difference = item.system-item.manual; return <td key={item.key} className={`px-3 py-2 text-right font-mono font-semibold ${Math.abs(difference) > .005 ? 'bg-red-100 text-red-700' : 'text-emerald-700'}`}>{item.key === 'overtime_hours' ? display(difference, 'number') : money(difference)}</td>; })}<td className="px-3 py-2 text-right"><Button variant="outline" size="sm" className="gap-1" onClick={() => setShowDifferenceDetails(true)} disabled={!rows.some(row => row.variance > 0)}><Eye className="h-3.5 w-3.5" /> View Difference Details</Button></td></tr>
      </tbody></table></div>
    </Card>
    {user?.role === 'super_admin' && <ReconciliationReviewSummary open={showReviewSummary} onOpenChange={setShowReviewSummary} company={company} period={period} records={records} reconciliations={reconciliations} notes={reviewerNotes} readiness={remarksSummaryQuery.data} user={user}/>}
    <Dialog open={showDifferenceDetails} onOpenChange={setShowDifferenceDetails}>
      <DialogContent className="max-h-[85vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>Payroll Difference Details</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Payroll Period: {periodLabel}</p>
        <section className="space-y-2"><h3 className="font-semibold">Summary</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{totals.map(item => { const difference = item.system - item.manual; const affected = rows.filter(row => row.differences.some(entry => entry.key === item.key)).length; return <Card key={item.key} className="p-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="font-mono font-semibold">{item.key === 'overtime_hours' ? display(difference, 'number') : money(difference)}</p>{affected ? <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => selectDifferenceCategory(item.key)}>View {affected} Employee{affected === 1 ? '' : 's'}</button> : <p className="text-xs text-muted-foreground">0 employees affected</p>}</Card>; })}</div></section>
        <section className="space-y-2"><h3 className="font-semibold">Category Breakdown</h3><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-xs"><thead className="bg-muted/70"><tr>{['Category','System','Manual','Difference','Employees Affected'].map(label => <th key={label} className="px-3 py-2 text-right first:text-left">{label}</th>)}</tr></thead><tbody>{totals.map(item => { const difference = item.system - item.manual; const affected = rows.filter(row => row.differences.some(entry => entry.key === item.key)).length; const format = item.key === 'overtime_hours' ? value => display(value, 'number') : money; return <tr key={item.key} className="border-t"><td className="px-3 py-2 font-medium">{item.label}</td><td className="px-3 py-2 text-right font-mono">{format(item.system)}</td><td className="px-3 py-2 text-right font-mono">{format(item.manual)}</td><td className="px-3 py-2 text-right font-mono font-semibold">{format(difference)}</td><td className="px-3 py-2 text-right">{affected ? <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => selectDifferenceCategory(item.key)}>View {affected}</button> : 0}</td></tr>; })}</tbody></table></div></section>
        <section ref={employeeBreakdownRef} className="scroll-mt-4 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Employee-Level Difference Breakdown</h3><div className="flex items-center gap-2"><Select value={differenceFilter} onValueChange={selectDifferenceCategory}><SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Differences</SelectItem>{totals.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select>{differenceFilter !== 'all' && <Button size="sm" variant="ghost" onClick={() => setDifferenceFilter('all')}>Show All Differences</Button>}</div></div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-xs"><thead className="sticky top-0 z-10 bg-muted/70"><tr>{['Employee','Employee No.','Category','System','Manual','Difference','Reason','Resolution','Reviewer','Reviewed At','Action'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{filteredRows.flatMap(row => row.differences.filter(item => differenceFilter === 'all' || item.key === differenceFilter).map(item => { const format = item.key === 'overtime_hours' ? value => display(value, 'number') : money; const resolution = row.reconciliation?.resolution_status === 'accept_system' ? 'Accepted System' : row.reconciliation?.resolution_status === 'accept_manual' ? 'Accepted Manual' : row.reconciliation ? 'Needs Review' : 'Not Reviewed'; return <tr key={`${row.record.id}-${item.key}`} className="border-t"><td className="px-3 py-2 font-medium">{row.record.employee_name}</td><td className="px-3 py-2">{row.record.employee_id}</td><td className="px-3 py-2">{item.label}</td><td className="px-3 py-2 font-mono">{format(item.system)}</td><td className="px-3 py-2 font-mono">{format(item.manual)}</td><td className="px-3 py-2 font-mono font-semibold text-red-600">{format(item.difference)}</td><td className="px-3 py-2">{row.reconciliation?.resolution_reason || row.reconciliation?.variance_note?.trim() || 'No reason entered'}</td><td className="px-3 py-2">{resolution}</td><td className="px-3 py-2">{row.reconciliation?.resolved_by || row.reconciliation?.reviewed_by || '—'}</td><td className="whitespace-nowrap px-3 py-2">{row.reconciliation?.resolved_at || row.reconciliation?.reviewed_at ? new Date(row.reconciliation.resolved_at || row.reconciliation.reviewed_at).toLocaleString('en-PH') : '—'}</td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => { setShowDifferenceDetails(false); onEmployee(String(row.record.employee_id)); }}>View</Button></td></tr>; }))}</tbody></table></div>{filteredRows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No employees have a difference in this category.</p>}</section>
      </DialogContent>
    </Dialog>
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3"><h2 className="font-semibold">Employee Reconciliation Status</h2><p className="text-xs text-muted-foreground">Select an employee to review the detailed payroll and daily attendance inputs.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-xs"><thead className="bg-muted/70"><tr>{['Employee','Department','OT Hours','OT Pay','Gross Pay','Deductions','Net Pay','Review Status','Variance','Action'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>
        {rows.map(row => <tr key={row.record.id} className="border-t"><td className="px-3 py-2 font-medium">{row.record.employee_name}{noteBadge(row.record.employee_id) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-800">{noteBadge(row.record.employee_id)}</span>}<br/><span className="text-muted-foreground">{row.record.employee_id}</span></td><td className="px-3 py-2">{row.record.department || '—'}</td><td className="px-3 py-2 font-mono">{display(row.system.overtime_hours, 'number')}</td><td className="px-3 py-2 font-mono">{money(row.system.overtime_pay)}</td><td className="px-3 py-2 font-mono">{money(row.system.gross_pay)}</td><td className="px-3 py-2 font-mono">{money(row.system.total_deductions)}</td><td className="px-3 py-2 font-mono font-semibold">{money(row.system.net_pay)}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 font-medium ${row.reconciliation ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.reconciliation ? 'Reconciled' : 'Pending'}</span></td><td className={`px-3 py-2 font-semibold ${row.variance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{row.variance > 0 ? `${row.variance} field${row.variance === 1 ? '' : 's'}` : 'None'}</td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => onEmployee(String(row.record.employee_id))}>Review</Button></td></tr>)}
      </tbody></table></div>
    </Card>
    <Dialog open={showDifferenceReasons} onOpenChange={setShowDifferenceReasons}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>Payroll Difference Reasons</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Employees with differences between system payroll and the saved manual reconciliation.</p>
        <div className="space-y-3">
          {rows.filter(row => row.variance > 0).map(row => (
            <div key={row.record.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{row.record.employee_name}</p><p className="text-xs text-muted-foreground">{row.record.employee_id} · {row.record.department || 'Unassigned'}</p></div>
                <Button size="sm" variant="outline" onClick={() => { setShowDifferenceReasons(false); onEmployee(String(row.record.employee_id)); }}>Review Employee</Button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-muted/70"><tr><th className="px-3 py-2 text-left">Field</th><th className="px-3 py-2 text-right">System</th><th className="px-3 py-2 text-right">Manual</th><th className="px-3 py-2 text-right">Difference</th></tr></thead>
                  <tbody>{row.differences.map(item => {
                    const formatter = item.key === 'overtime_hours' ? value => display(value, 'number') : money;
                    return <tr key={item.key} className="border-t"><td className="px-3 py-2 font-medium">{item.label}</td><td className="px-3 py-2 text-right font-mono">{formatter(item.system)}</td><td className="px-3 py-2 text-right font-mono">{formatter(item.manual)}</td><td className="px-3 py-2 text-right font-mono font-semibold text-red-600">{formatter(item.difference)}</td></tr>;
                  })}</tbody>
                </table>
              </div>
              <div className={`mt-3 rounded-md p-3 text-sm ${row.reconciliation?.variance_note?.trim() ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-800'}`}>
                <p className="text-xs font-semibold uppercase tracking-wide">Reason</p>
                <p className="mt-1 whitespace-pre-wrap">{row.reconciliation?.variance_note?.trim() || 'No variance reason has been entered.'}</p>
                {row.reconciliation && <p className="mt-2 text-xs opacity-75">Resolution: {row.reconciliation.resolution_status === 'accept_system' ? 'Accepted System' : row.reconciliation.resolution_status === 'accept_manual' ? 'Accepted Manual' : 'Needs Review'} · Reviewed by {row.reconciliation.resolved_by || row.reconciliation.reviewed_by || 'Unknown officer'}{row.reconciliation.resolved_at ? ` · ${new Date(row.reconciliation.resolved_at).toLocaleString('en-PH')}` : ''}</p>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

function ReconciliationQueue({ records, reconciliations, reviewerNotes, dailyNotes = [], onEmployee }) {
  const [filter, setFilter] = useState('all');
  const latest = useMemo(() => new Map(reconciliations.map(item => [String(item.employee_id), item])), [reconciliations]);
  const noteStatus = useMemo(() => new Map(reviewerNotes.map(note => [String(note.employeeId), note.status])), [reviewerNotes]);
  const rows = useMemo(() => records.map(record => {
    const reconciliation = latest.get(String(record.employee_id));
    const manual = deriveManualSummary(reconciliation?.manual_values || record, record);
    const variance = CONSOLIDATED_FIELDS.some(([key]) => Math.abs(num(record[key]) - num(manual[key])) > .005);
    const note = noteStatus.get(String(record.employee_id));
    const status = note === 'needs_response' || note === 'reopened' ? 'Needs response' : note === 'responded' ? 'For reviewer review' : !reconciliation ? 'Pending' : variance ? 'With variance' : 'Reconciled';
    const noteCount = dailyNotes.filter(noteItem => String(noteItem.employeeId) === String(record.employee_id)).length;
    return { record, reconciliation, variance, status, difference: num(record.net_pay) - num(manual.net_pay), noteCount };
  }), [records, latest, noteStatus, dailyNotes]);
  const counts = useMemo(() => ({
    total: rows.length,
    reconciled: rows.filter(row => row.status === 'Reconciled').length,
    pending: rows.filter(row => row.status === 'Pending').length,
    variance: rows.filter(row => row.variance).length,
    review: rows.filter(row => row.status === 'Needs response' || row.status === 'For reviewer review').length,
    systemNet: rows.reduce((sum, row) => sum + num(row.record.net_pay), 0),
    manualNet: rows.reduce((sum, row) => sum + num(deriveManualSummary(row.reconciliation?.manual_values || row.record, row.record).net_pay), 0),
  }), [rows]);
  const visible = rows.filter(row => filter === 'all' || (filter === 'pending' && row.status === 'Pending') || (filter === 'variance' && row.variance) || (filter === 'review' && (row.status === 'Needs response' || row.status === 'For reviewer review')));
  const percentage = value => counts.total ? `${Math.round((value / counts.total) * 100)}% of total` : '0% of total';
  const kpis = [
    ['Total Employees', counts.total, 'In this payroll period', 'all'],
    ['Reconciled', counts.reconciled, percentage(counts.reconciled), 'all'],
    ['Pending', counts.pending, `View pending → · ${percentage(counts.pending)}`, 'pending'],
    ['With Variance', counts.variance, `View variance → · ${percentage(counts.variance)}`, 'variance'],
  ];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {kpis.map(([label, value, helper, key]) => <button key={label} type="button" onClick={() => setFilter(key)} className={`rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${filter === key ? 'border-primary' : ''}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{helper}</p></button>)}
      <Card className="p-4"><p className="text-xs text-muted-foreground">System Net Payroll</p><p className="mt-1 text-2xl font-bold">{money(counts.systemNet)}</p><p className="mt-1 text-xs text-muted-foreground">Manual Net Pay <span className="float-right font-medium text-foreground">{money(counts.manualNet)}</span></p><p className="text-xs text-red-600">Difference <span className="float-right font-semibold">{money(counts.systemNet - counts.manualNet)}</span></p></Card>
      <Card className="p-4"><p className="text-xs font-semibold">Review Status</p><p className="mt-1 text-2xl font-bold">{counts.review}</p><button type="button" onClick={() => setFilter('review')} className="mt-1 text-xs text-primary hover:underline">View items requiring action →</button></Card>
    </div>
    {filter !== 'all' && <div className="flex items-center gap-2 text-sm"><span className="rounded-full bg-muted px-3 py-1">Status: {filter === 'pending' ? 'Pending' : filter === 'variance' ? 'With variance' : 'Review required'}</span><Button size="sm" variant="ghost" onClick={() => setFilter('all')}>Clear</Button></div>}
    <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="font-semibold">Employee Reconciliation Queue</h2><p className="text-xs text-muted-foreground">Select an employee to reconcile daily inputs, variances, and notes.</p></div><span className="text-xs text-muted-foreground">{visible.length} employees</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/70"><tr>{['Employee','System Net Pay','Variance','Daily Admin/HR Notes','Status','Action'].map(label => <th key={label} className="px-4 py-3 text-left">{label}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.record.id} className="border-t"><td className="px-4 py-3 font-medium">{row.record.employee_name}<span className="block text-xs font-normal text-muted-foreground">{row.record.employee_id}</span></td><td className="px-4 py-3 font-mono">{money(row.record.net_pay)}</td><td className={`px-4 py-3 font-mono ${row.variance ? 'text-red-600' : 'text-emerald-700'}`}>{row.variance ? money(row.difference) : 'None'}</td><td className="px-4 py-3 text-xs">{row.noteCount ? `${row.noteCount} note${row.noteCount === 1 ? '' : 's'}` : '—'}</td><td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-1 text-xs">{row.status}</span></td><td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => onEmployee(String(row.record.employee_id))}>{row.reconciliation ? 'Open' : 'Reconcile'}</Button></td></tr>)}</tbody></table></div>{!visible.length && <p className="p-8 text-center text-sm text-muted-foreground">No employees match this filter.</p>}</Card>
  </div>;
}

function PayrollDifferenceDetails({ records, reconciliations, period, onEmployee, onSubmit, canSubmit, isSubmitting, submitted }) {
  const latest = useMemo(() => new Map(reconciliations.map(item => [String(item.employee_id), item])), [reconciliations]);
  const categories = useMemo(() => CONSOLIDATED_FIELDS.map(([key, label]) => {
    const system = records.reduce((sum, record) => sum + num(record[key]), 0);
    const manual = records.reduce((sum, record) => {
      const reconciliation = latest.get(String(record.employee_id));
      return sum + (reconciliation ? num(deriveManualSummary(reconciliation.manual_values || record, record)[key]) : 0);
    }, 0);
    const affected = records.filter(record => {
      const reconciliation = latest.get(String(record.employee_id));
      const manualValue = reconciliation ? deriveManualSummary(reconciliation.manual_values || record, record)[key] : 0;
      return Math.abs(num(record[key]) - num(manualValue)) > .005;
    });
    return { key, label, system, manual, difference: system - manual, affected };
  }), [records, latest]);
  const periodLabel = period?.period_name || `${period?.start_date || ''} – ${period?.end_date || ''}`;
  return <div className="space-y-5"><Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Payroll Difference Details</h2><p className="mt-1 text-sm text-muted-foreground">Payroll Period: {periodLabel}</p></div><Button onClick={onSubmit} disabled={!canSubmit || submitted || isSubmitting}><Send className="mr-2 h-4 w-4"/>{submitted ? 'Submitted for review' : isSubmitting ? 'Submitting…' : 'Submit for review'}</Button></div></Card><section><h3 className="mb-3 font-semibold">Summary</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{categories.map(item => <Card key={item.key} className="p-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 font-mono text-lg font-bold">{item.key === 'overtime_hours' ? display(item.difference, 'number') : money(item.difference)}</p>{item.affected.length ? <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => onEmployee(String(item.affected[0].employee_id))}>View {item.affected.length} Employee{item.affected.length === 1 ? '' : 's'}</button> : <p className="mt-1 text-xs text-muted-foreground">0 employees affected</p>}</Card>)}</div></section><Card className="overflow-hidden"><div className="border-b px-4 py-3"><h3 className="font-semibold">Category Breakdown</h3><p className="text-xs text-muted-foreground">System, manual, and difference values from the current reconciliation data.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/70"><tr>{['Category','System','Manual','Difference','Employees Affected'].map(label => <th key={label} className="px-4 py-3 text-right first:text-left">{label}</th>)}</tr></thead><tbody>{categories.map(item => <tr key={item.key} className="border-t"><td className="px-4 py-3 font-medium">{item.label}</td><td className="px-4 py-3 text-right font-mono">{item.key === 'overtime_hours' ? display(item.system, 'number') : money(item.system)}</td><td className="px-4 py-3 text-right font-mono">{item.key === 'overtime_hours' ? display(item.manual, 'number') : money(item.manual)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${Math.abs(item.difference) > .005 ? 'text-red-600' : 'text-emerald-700'}`}>{item.key === 'overtime_hours' ? display(item.difference, 'number') : money(item.difference)}</td><td className="px-4 py-3 text-right">{item.affected.length ? <button type="button" className="text-primary hover:underline" onClick={() => onEmployee(String(item.affected[0].employee_id))}>View {item.affected.length}</button> : 0}</td></tr>)}</tbody></table></div></Card></div>;
}

export default function PayrollReconciliation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();
  const { user } = useAuth();
  const [periodId, setPeriodId] = useState(() => searchParams.get('period') || '');
  const [employeeId, setEmployeeId] = useState('all');
  const [manual, setManual] = useState({});
  const [manualDays, setManualDays] = useState({});
  const [resolutionStatus, setResolutionStatus] = useState('');
  const [resolutionReason, setResolutionReason] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeStep, setActiveStep] = useState(1);

  const periodsQuery = useQuery({ queryKey: ['recon-periods', activeCompanyId], queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-start_date', 100), enabled: Boolean(activeCompanyId) });
  const periods = periodsQuery.data || [];
  useEffect(() => { if (!periodId && periods[0]) setPeriodId(String(periods[0].id)); }, [periods, periodId]);
  const period = periods.find(item => String(item.id) === periodId);
  const recordsQuery = useQuery({ queryKey: ['recon-records', activeCompanyId, periodId], queryFn: () => appApi.entities.PayrollRecord.filter({ company_profile_id: activeCompanyId, payroll_period_id: periodId }, 'employee_name', 5000), enabled: Boolean(activeCompanyId && periodId) });
  const records = recordsQuery.data || [];
  useEffect(() => { if (employeeId !== 'all' && records.length && !records.some(row => String(row.employee_id) === employeeId)) setEmployeeId('all'); }, [records, employeeId]);
  const record = records.find(row => String(row.employee_id) === employeeId);
  const isConsolidated = employeeId === 'all';
  const logsQuery = useQuery({ queryKey: ['recon-logs', activeCompanyId, employeeId, period?.start_date, period?.end_date], queryFn: () => appApi.entities.AttendanceLog.filter({ company_profile_id: activeCompanyId, employee_id: employeeId, date: { $gte: period.start_date, $lte: period.end_date } }, 'date', 100), enabled: Boolean(activeCompanyId && employeeId && !isConsolidated && period?.start_date) });
  const overtimeRequestsQuery = useQuery({ queryKey: ['recon-overtime-requests', activeCompanyId, employeeId, period?.start_date, period?.end_date], queryFn: () => appApi.entities.OvertimeRequest.filter({ company_profile_id: activeCompanyId, employee_id: employeeId, date: { $gte: period.start_date, $lte: period.end_date }, status: 'approved' }, '-reviewed_at', 100), enabled: Boolean(activeCompanyId && employeeId && !isConsolidated && period?.start_date) });
  const reconQuery = useQuery({ queryKey: ['recon-saved', activeCompanyId, periodId, employeeId], queryFn: () => appApi.entities.PayrollReconciliation.filter({ company_profile_id: activeCompanyId, payroll_period_id: periodId, employee_id: employeeId }, '-updated_date', 1), enabled: Boolean(activeCompanyId && periodId && employeeId && !isConsolidated) });
  const consolidatedReconQuery = useQuery({ queryKey: ['recon-consolidated', activeCompanyId, periodId], queryFn: () => appApi.entities.PayrollReconciliation.filter({ company_profile_id: activeCompanyId, payroll_period_id: periodId }, '-updated_date', 5000), enabled: Boolean(activeCompanyId && periodId) });
  const reviewerNotesQuery = useQuery({ queryKey: ['reviewer-notes-period', activeCompanyId, periodId], queryFn: () => requestJson(`/api/payroll-reconciliation/reviewer-notes?action=list&companyProfileId=${encodeURIComponent(activeCompanyId)}&payrollPeriodId=${encodeURIComponent(periodId)}`), enabled: Boolean(activeCompanyId && periodId) });
  const dailyPeriodNotesQuery = useQuery({ queryKey: ['daily-variance-notes-period', activeCompanyId, periodId], queryFn: () => requestJson(`/api/payroll-reconciliation/daily-variance-notes?companyProfileId=${encodeURIComponent(activeCompanyId)}&payrollPeriodId=${encodeURIComponent(periodId)}`), enabled: Boolean(activeCompanyId && periodId), retry: false, refetchOnWindowFocus: false, staleTime: 30_000 });
  const existing = reconQuery.data?.[0];
  const dailyNotesQuery = useQuery({ queryKey: ['daily-variance-notes', activeCompanyId, periodId, employeeId], queryFn: () => requestJson(`/api/payroll-reconciliation/daily-variance-notes?companyProfileId=${encodeURIComponent(activeCompanyId)}&payrollPeriodId=${encodeURIComponent(periodId)}&employeeId=${encodeURIComponent(employeeId)}`), enabled: Boolean(activeCompanyId && periodId && employeeId && !isConsolidated), retry: false, refetchOnWindowFocus: false, staleTime: 30_000 });
  const days = useMemo(() => dateRange(period?.start_date, period?.end_date), [period?.start_date, period?.end_date]);
  const logByDate = useMemo(() => new Map((logsQuery.data || []).map(log => [log.date, log])), [logsQuery.data]);
  const overtimeRequests = overtimeRequestsQuery.data || [];
  const systemDailyValue = (log, key) => num(key === 'regular_hours' ? log.hours_worked : key === 'overtime_hours' ? reconciledOvertimeHours(log, overtimeRequests) : log[key]);
  const currentOvertimeHours = useMemo(() => (logsQuery.data || []).reduce((total, log) => total + reconciledOvertimeHours(log, overtimeRequests), 0), [logsQuery.data, overtimeRequestsQuery.dataUpdatedAt]);
  const payrollOvertimeIsStale = Boolean(record && Math.abs(num(record.overtime_hours) - currentOvertimeHours) > .005);
  const systemSummaryValue = key => key === 'overtime_hours' ? currentOvertimeHours : num(record?.[key]);
  const effectiveManual = deriveManualSummary(manual, record);

  useEffect(() => {
    if (!record || reconQuery.isLoading) return;
    setManual(existing?.manual_values || Object.fromEntries(SUMMARY_FIELDS.map(([key]) => [key, systemSummaryValue(key)])));
    setManualDays(existing?.manual_daily_values || Object.fromEntries(days.map(date => {
      const log = logByDate.get(date) || {};
      return [date, { day_type: log.day_type || '', time_in: timeValue(log.time_in), break_time_out: timeValue(log.break_time_out), break_time_in: timeValue(log.break_time_in), time_out: timeValue(log.time_out), ...Object.fromEntries(DAILY_FIELDS.map(([key]) => [key, systemDailyValue(log, key)])) }];
    })));
    setResolutionStatus(existing?.resolution_status || '');
    setResolutionReason(existing?.resolution_reason || existing?.variance_note || '');
    setSaved(false);
    setSaveError('');
  }, [record?.id, existing?.id, reconQuery.isLoading, days.join('|'), logsQuery.dataUpdatedAt, overtimeRequestsQuery.dataUpdatedAt]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const hasVariance = SUMMARY_FIELDS.some(([key]) => Math.abs(systemSummaryValue(key) - num(effectiveManual[key])) > .005);
      if (activeStep === 4 && hasVariance && !resolutionStatus) throw new Error('Select a resolution decision before saving final review.');
      if (activeStep === 4 && hasVariance && !resolutionReason.trim()) throw new Error('Enter a resolution reason before saving final review.');
      const reviewer = user?.full_name || user?.name || user?.email || 'Unknown officer';
      const now = new Date().toISOString();
      const payload = { company_profile_id: activeCompanyId, payroll_period_id: periodId, period_name: period.period_name || `${period.start_date} to ${period.end_date}`, employee_id: record.employee_id, employee_name: record.employee_name, payroll_record_id: record.id, system_values: Object.fromEntries(SUMMARY_FIELDS.map(([key]) => [key, systemSummaryValue(key)])), manual_values: effectiveManual, system_daily_values: Object.fromEntries(days.map(date => { const log = logByDate.get(date) || {}; return [date, { ...log, overtime_hours: reconciledOvertimeHours(log, overtimeRequests) }]; })), manual_daily_values: manualDays, resolution_status: hasVariance ? resolutionStatus : null, resolution_reason: hasVariance ? resolutionReason.trim() : '', resolved_by: hasVariance ? reviewer : null, resolved_at: hasVariance ? now : null, reviewed_by: reviewer, reviewed_at: now };
      return existing ? appApi.entities.PayrollReconciliation.update(existing.id, payload) : appApi.entities.PayrollReconciliation.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-saved', activeCompanyId, periodId, employeeId] }); qc.invalidateQueries({ queryKey: ['recon-consolidated', activeCompanyId, periodId] }); setSaved(true); setSaveError(''); },
    onError: error => { setSaved(false); setSaveError(error.message || 'Unable to save reconciliation.'); },
  });

  const latestReconciliations = useMemo(() => new Map((consolidatedReconQuery.data || []).map(item => [String(item.employee_id), item])), [consolidatedReconQuery.data]);
  const hasMaterialVariance = reconciliation => {
    if (!reconciliation) return false;
    const systemValues = reconciliation.system_values || {};
    const manualValues = reconciliation.manual_values || {};
    return SUMMARY_FIELDS.some(([key]) => Math.abs(num(systemValues[key]) - num(manualValues[key])) > .005);
  };
  const allReconciled = records.length > 0 && records.every(item => latestReconciliations.has(String(item.employee_id)));
  const allVariancesExplained = allReconciled && records.every(item => {
    const reconciliation = latestReconciliations.get(String(item.employee_id));
    return !hasMaterialVariance(reconciliation) || (dailyPeriodNotesQuery.data || []).some(noteItem => String(noteItem.employeeId) === String(item.employee_id));
  });
  const submittedForReview = allReconciled && records.every(item => Boolean(latestReconciliations.get(String(item.employee_id))?.submitted_for_review_at));
  const openReviewerNotes = (reviewerNotesQuery.data || []).filter(item => ['needs_response', 'reopened', 'responded'].includes(item.status));
  const responseNeeded = (reviewerNotesQuery.data || []).filter(item => ['needs_response', 'reopened'].includes(item.status));
  const finalReviewReady = submittedForReview && openReviewerNotes.length === 0;
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!allReconciled || !allVariancesExplained) throw new Error('Finish reconciliation and explain every material variance before submitting for review.');
      const now = new Date().toISOString();
      await Promise.all(records.map(item => {
        const reconciliation = latestReconciliations.get(String(item.employee_id));
        return appApi.entities.PayrollReconciliation.update(reconciliation.id, { submitted_for_review_at: now, submitted_for_review_by: user?.full_name || user?.name || user?.email || 'Current officer' });
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-consolidated', activeCompanyId, periodId] }); setActiveStep(2); },
  });
  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!finalReviewReady) throw new Error('Resolve all reviewer notes before final review.');
      const now = new Date().toISOString();
      await Promise.all(records.map(item => appApi.entities.PayrollReconciliation.update(latestReconciliations.get(String(item.employee_id)).id, { final_reviewed_at: now, final_reviewed_by: user?.full_name || user?.name || user?.email || 'Current officer' })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-consolidated', activeCompanyId, periodId] }); setSaved(true); },
    onError: error => setSaveError(error.message || 'Unable to complete final review.'),
  });

  const loading = periodsQuery.isLoading || recordsQuery.isLoading || consolidatedReconQuery.isLoading || (!isConsolidated && (logsQuery.isLoading || overtimeRequestsQuery.isLoading || reconQuery.isLoading));
  return <div className="w-full space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => { setEmployeeId('all'); navigate(`/payroll/reconciliation${periodId ? `?period=${encodeURIComponent(periodId)}` : ''}`); }}><ArrowLeft className="h-4 w-4"/></Button><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Scale className="h-6 w-6 text-primary"/>Payroll Reconciliation</h1><p className="text-sm text-muted-foreground">Reconcile payroll inputs, submit them for review, resolve feedback, and complete final review.</p></div></div>{record && activeStep === 1 && <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4"/>{saveMutation.isPending ? 'Saving…' : 'Save changes'}</Button>}</div>
    <div className="grid gap-2 overflow-x-auto rounded-xl border bg-card p-2 md:grid-cols-4" role="tablist" aria-label="Payroll reconciliation workflow">{[
      ['Reconcile','Complete employee reconciliation',true],
      ['Submit for Review','Send completed reconciliation to reviewer',allReconciled && allVariancesExplained],
      ['Resolve Variance','Respond to reviewer notes',submittedForReview && responseNeeded.length > 0],
      ['Final Review','Verify all notes are resolved',finalReviewReady],
    ].map(([label, hint, available], index) => { const value = index + 1; const current = activeStep === value; const completed = (value === 1 && allReconciled && allVariancesExplained) || (value === 2 && submittedForReview) || (value === 3 && submittedForReview && responseNeeded.length === 0); return <button key={label} type="button" role="tab" aria-current={current ? 'step' : undefined} aria-disabled={!available} disabled={!available} onClick={() => setActiveStep(value)} className={`min-w-[220px] rounded-lg border-b-2 px-3 py-3 text-left transition ${current ? 'border-primary bg-primary/5 text-primary' : available ? 'border-transparent hover:bg-muted' : 'cursor-not-allowed border-transparent text-muted-foreground/50'}`}><span className="flex items-center gap-2 text-sm font-semibold"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${completed ? 'border-emerald-600 bg-emerald-600 text-white' : current ? 'border-primary bg-primary text-primary-foreground' : 'border-current'}`}>{completed ? <CheckCircle2 className="h-4 w-4"/> : value}</span>{label}{!available && <Lock className="ml-auto h-3.5 w-3.5"/>}</span><span className="mt-1 block text-xs opacity-75">{hint}</span></button>; })}</div>
    <Card className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]"><div><label className="text-xs font-medium text-muted-foreground">Payroll Period</label><Select value={periodId} onValueChange={value => { setPeriodId(value); setEmployeeId('all'); setActiveStep(1); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select period"/></SelectTrigger><SelectContent>{periods.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.period_name || `${item.start_date} to ${item.end_date}`}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs font-medium text-muted-foreground">Employee</label><Select value={employeeId} onValueChange={value => { setEmployeeId(value); setActiveStep(1); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select employee"/></SelectTrigger><SelectContent><SelectItem value="all">All Employees · Consolidated</SelectItem>{records.map(item => <SelectItem key={item.id} value={String(item.employee_id)}>{item.employee_name} · {item.employee_id}</SelectItem>)}</SelectContent></Select></div><Button variant="outline" className="self-end" onClick={() => { recordsQuery.refetch(); consolidatedReconQuery.refetch(); reviewerNotesQuery.refetch(); if (!isConsolidated) { reconQuery.refetch(); dailyNotesQuery.refetch(); } }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></Card>
    {saved && <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Reconciliation saved.</div>}
    {saveError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
    {payrollOvertimeIsStale && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Reconciliation includes {currentOvertimeHours.toFixed(2)} approved OT hours. The generated payroll previously contained {num(record.overtime_hours).toFixed(2)}, so regenerate payroll to update OT Pay and the final payroll record.</div>}
    {!loading && activeStep === 1 && isConsolidated && records.length > 0 && <><ReconciliationQueue records={records} reconciliations={consolidatedReconQuery.data || []} reviewerNotes={reviewerNotesQuery.data || []} dailyNotes={dailyPeriodNotesQuery.data || []} onEmployee={employee => { setEmployeeId(employee); setActiveStep(1); }}/><Card className={`p-4 text-sm ${allReconciled && allVariancesExplained ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><b>Step 1 readiness:</b> {allReconciled ? 'All employees are reconciled.' : `${records.filter(item => !latestReconciliations.has(String(item.employee_id))).length} employee reconciliation(s) remain.`} {allVariancesExplained ? ' All material variances have daily Admin/HR notes.' : ' Add a daily Admin/HR note for every employee with a material variance before submitting for review.'}</Card></>}
    {!loading && activeStep === 2 && isConsolidated && <PayrollDifferenceDetails records={records} reconciliations={consolidatedReconQuery.data || []} period={period} onEmployee={employee => { setEmployeeId(employee); setActiveStep(1); }} onSubmit={() => submitMutation.mutate()} canSubmit={allReconciled && allVariancesExplained} isSubmitting={submitMutation.isPending} submitted={submittedForReview}/>}
    {!loading && activeStep === 3 && isConsolidated && <Card className="p-5"><h2 className="font-semibold">Resolve Variance</h2><p className="mt-1 text-sm text-muted-foreground">{responseNeeded.length} reviewer note(s) require an Admin/HR response. Select the affected employee below.</p><div className="mt-4 space-y-2">{responseNeeded.map(item => <Button key={item.id} variant="outline" className="mr-2" onClick={() => { setEmployeeId(String(item.employeeId)); setActiveStep(3); }}>{item.employeeId} · {item.category}</Button>)}{!responseNeeded.length && <p className="text-sm text-muted-foreground">No reviewer responses are currently required.</p>}</div></Card>}
    {!loading && activeStep === 4 && isConsolidated && <Card className="p-5"><h2 className="font-semibold">Final Review</h2><p className="mt-1 text-sm text-muted-foreground">Open reviewer notes: {openReviewerNotes.length}</p><Button className="mt-4" onClick={() => finalizeMutation.mutate()} disabled={!finalReviewReady || finalizeMutation.isPending}><CheckCircle2 className="mr-2 h-4 w-4"/>{finalizeMutation.isPending ? 'Completing…' : 'Complete final review'}</Button></Card>}
    {!loading && records.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground"><p className="font-medium text-foreground">No completed payroll records are available for this period.</p><p className="mt-2">This period has {Number(period?.employee_count) || 0} generated employee record{Number(period?.employee_count) === 1 ? '' : 's'}. Return to Payroll, correct any generation error, then generate the selected period again before starting reconciliation.</p><Button className="mt-4" variant="outline" onClick={() => navigate('/payroll')}>Go to Payroll</Button></Card>}
    {record && <>
      {[1, 2, 3, 4].includes(activeStep) && <Card className="overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold">{record.employee_name}</h2><p className="text-xs text-muted-foreground">{record.department || 'Unassigned'} · System / Manual / Variance. Summary values are derived from the existing reconciliation data.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1800px] text-xs"><thead className="bg-muted/70"><tr><th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Source</th>{SUMMARY_FIELDS.map(([key,label]) => <th key={key} className="whitespace-nowrap px-3 py-2 text-right">{label}</th>)}</tr></thead><tbody><tr className="border-t"><td className="sticky left-0 bg-background px-3 py-2 font-bold text-red-600">System</td>{SUMMARY_FIELDS.map(([key,,type]) => <td key={key} className="px-3 py-2 text-right font-mono">{display(systemSummaryValue(key),type)}</td>)}</tr><tr className="border-t"><td className="sticky left-0 bg-background px-3 py-2 font-bold text-blue-600">Manual</td>{SUMMARY_FIELDS.map(([key,,type]) => <td key={key} className="px-3 py-2 text-right font-mono">{display(effectiveManual[key],type)}</td>)}</tr><tr className="border-t bg-yellow-50"><td className="sticky left-0 bg-yellow-50 px-3 py-2 font-bold text-amber-700">Variance</td>{SUMMARY_FIELDS.map(([key,,type]) => { const difference = systemSummaryValue(key)-num(effectiveManual[key]); return <td key={key} className={`px-3 py-2 text-right font-mono font-semibold ${Math.abs(difference) > .005 ? 'bg-red-100 text-red-700' : 'text-emerald-700'}`}>{display(difference,type)}</td>; })}</tr></tbody></table></div></Card>}
      {[2, 3].includes(activeStep) && <ReviewerNotesCard companyId={activeCompanyId} periodId={periodId} employeeId={record.employee_id} reconciliationId={existing?.id} systemValues={Object.fromEntries(SUMMARY_FIELDS.map(([key]) => [key, systemSummaryValue(key)]))} manualValues={effectiveManual} user={user}/>}
      {activeStep === 1 && <DailyAttendanceInputsTable days={days} logByDate={logByDate} manualDays={manualDays} setManualDays={setManualDays} systemDailyValue={systemDailyValue} time={time} onSave={() => saveMutation.mutate()} dailyNotes={dailyNotesQuery.data || []} noteScope={{ companyProfileId: activeCompanyId, payrollPeriodId: periodId, employeeId: record.employee_id }} onNotesSaved={() => dailyNotesQuery.refetch()} />}
      {activeStep === 4 && <Card className="p-5"><h2 className="font-semibold">Final Review</h2><p className="mt-1 text-sm text-muted-foreground">All reviewer notes must be resolved before final review can be completed.</p><p className="mt-3 text-sm">Open reviewer notes: <b>{openReviewerNotes.length}</b></p><Button className="mt-4" onClick={() => finalizeMutation.mutate()} disabled={!finalReviewReady || finalizeMutation.isPending}><CheckCircle2 className="mr-2 h-4 w-4" />{finalizeMutation.isPending ? 'Completing…' : 'Complete final review'}</Button></Card>}
      <Card className={activeStep === 4 ? "space-y-4 p-4" : "hidden"}><div><label className="text-sm font-semibold">Resolution Decision</label><p className="text-xs text-muted-foreground">Choose how this variance should be resolved. This does not change payroll calculations.</p><RadioGroup value={resolutionStatus} onValueChange={setResolutionStatus} className="mt-3 grid gap-2 sm:grid-cols-3"><label className="flex items-center gap-2 rounded-md border p-3 text-sm"><RadioGroupItem value="accept_system" />Accept System Values</label><label className="flex items-center gap-2 rounded-md border p-3 text-sm"><RadioGroupItem value="accept_manual" />Accept Manual Values</label><label className="flex items-center gap-2 rounded-md border p-3 text-sm"><RadioGroupItem value="needs_review" />Needs Review</label></RadioGroup></div><div><label className="text-sm font-semibold">Resolution Reason</label><Textarea rows={3} value={resolutionReason} onChange={event => setResolutionReason(event.target.value)} placeholder="Explain the selected resolution."/></div><Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4"/>Save final decision</Button></Card>
    </>}
  </div>;
}
