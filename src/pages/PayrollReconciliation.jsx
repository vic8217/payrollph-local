// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Save, Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appApi } from '@/lib/appApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  ['total_deductions', 'Total Deductions'], ['gross_pay', 'Gross Pay'], ['net_pay', 'Net Pay'],
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

function ConsolidatedReconciliation({ records, reconciliations, onEmployee }) {
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
    return { record, reconciliation, system, manualValues, variance };
  });
  const reviewed = rows.filter(row => row.reconciliation).length;
  const unresolved = rows.filter(row => row.reconciliation && row.variance > 0).length;
  const totals = CONSOLIDATED_FIELDS.map(([key, label]) => ({
    key,
    label,
    system: rows.reduce((sum, row) => sum + num(row.system[key]), 0),
    manual: rows.reduce((sum, row) => sum + num(row.manualValues[key]), 0),
  }));

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="p-4"><p className="text-xs text-muted-foreground">Total Employees</p><p className="mt-1 text-2xl font-bold">{records.length}</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Reconciled</p><p className="mt-1 text-2xl font-bold text-emerald-700">{reviewed}</p><p className="text-xs text-muted-foreground">{Math.max(records.length-reviewed, 0)} pending</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Unresolved Variances</p><p className={`mt-1 text-2xl font-bold ${unresolved ? 'text-red-600' : 'text-emerald-700'}`}>{unresolved}</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">System Net Payroll</p><p className="mt-1 text-2xl font-bold">{money(totals.find(item => item.key === 'net_pay')?.system)}</p></Card>
    </div>
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3"><h2 className="font-semibold">Consolidated Payroll Totals</h2><p className="text-xs text-muted-foreground">System / Manual / Difference across all employees in this payroll period.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead className="bg-muted/70"><tr><th className="px-3 py-2 text-left">Source</th>{totals.map(item => <th key={item.key} className="px-3 py-2 text-right">{item.label}</th>)}</tr></thead><tbody>
        <tr className="border-t"><td className="px-3 py-2 font-bold text-red-600">System</td>{totals.map(item => <td key={item.key} className="px-3 py-2 text-right font-mono">{item.key === 'overtime_hours' ? display(item.system, 'number') : money(item.system)}</td>)}</tr>
        <tr className="border-t"><td className="px-3 py-2 font-bold text-blue-600">Manual</td>{totals.map(item => <td key={item.key} className="px-3 py-2 text-right font-mono">{item.key === 'overtime_hours' ? display(item.manual, 'number') : money(item.manual)}</td>)}</tr>
        <tr className="border-t bg-yellow-50"><td className="px-3 py-2 font-bold text-amber-700">Difference</td>{totals.map(item => { const difference = item.system-item.manual; return <td key={item.key} className={`px-3 py-2 text-right font-mono font-semibold ${Math.abs(difference) > .005 ? 'bg-red-100 text-red-700' : 'text-emerald-700'}`}>{item.key === 'overtime_hours' ? display(difference, 'number') : money(difference)}</td>; })}</tr>
      </tbody></table></div>
    </Card>
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3"><h2 className="font-semibold">Employee Reconciliation Status</h2><p className="text-xs text-muted-foreground">Select an employee to review the detailed payroll and daily attendance inputs.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-xs"><thead className="bg-muted/70"><tr>{['Employee','Department','OT Hours','OT Pay','Gross Pay','Deductions','Net Pay','Review Status','Variance','Action'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>
        {rows.map(row => <tr key={row.record.id} className="border-t"><td className="px-3 py-2 font-medium">{row.record.employee_name}<br/><span className="text-muted-foreground">{row.record.employee_id}</span></td><td className="px-3 py-2">{row.record.department || '—'}</td><td className="px-3 py-2 font-mono">{display(row.system.overtime_hours, 'number')}</td><td className="px-3 py-2 font-mono">{money(row.system.overtime_pay)}</td><td className="px-3 py-2 font-mono">{money(row.system.gross_pay)}</td><td className="px-3 py-2 font-mono">{money(row.system.total_deductions)}</td><td className="px-3 py-2 font-mono font-semibold">{money(row.system.net_pay)}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 font-medium ${row.reconciliation ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.reconciliation ? 'Reconciled' : 'Pending'}</span></td><td className={`px-3 py-2 font-semibold ${row.variance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{row.variance > 0 ? `${row.variance} field${row.variance === 1 ? '' : 's'}` : 'None'}</td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => onEmployee(String(row.record.employee_id))}>Review</Button></td></tr>)}
      </tbody></table></div>
    </Card>
  </div>;
}

export default function PayrollReconciliation() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const [periodId, setPeriodId] = useState('');
  const [employeeId, setEmployeeId] = useState('all');
  const [manual, setManual] = useState({});
  const [manualDays, setManualDays] = useState({});
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

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
  const existing = reconQuery.data?.[0];
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
    setNote(existing?.variance_note || '');
    setSaved(false);
  }, [record?.id, existing?.id, reconQuery.isLoading, days.join('|'), logsQuery.dataUpdatedAt, overtimeRequestsQuery.dataUpdatedAt]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { company_profile_id: activeCompanyId, payroll_period_id: periodId, period_name: period.period_name || `${period.start_date} to ${period.end_date}`, employee_id: record.employee_id, employee_name: record.employee_name, payroll_record_id: record.id, system_values: Object.fromEntries(SUMMARY_FIELDS.map(([key]) => [key, systemSummaryValue(key)])), manual_values: effectiveManual, system_daily_values: Object.fromEntries(days.map(date => { const log = logByDate.get(date) || {}; return [date, { ...log, overtime_hours: reconciledOvertimeHours(log, overtimeRequests) }]; })), manual_daily_values: manualDays, variance_note: note, reviewed_by: user?.full_name || user?.name || user?.email || 'Unknown officer', reviewed_at: new Date().toISOString() };
      return existing ? appApi.entities.PayrollReconciliation.update(existing.id, payload) : appApi.entities.PayrollReconciliation.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-saved', activeCompanyId, periodId, employeeId] }); qc.invalidateQueries({ queryKey: ['recon-consolidated', activeCompanyId, periodId] }); setSaved(true); },
  });

  const loading = periodsQuery.isLoading || recordsQuery.isLoading || consolidatedReconQuery.isLoading || (!isConsolidated && (logsQuery.isLoading || overtimeRequestsQuery.isLoading || reconQuery.isLoading));
  return <div className="w-full space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => navigate('/payroll')}><ArrowLeft className="h-4 w-4"/></Button><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Scale className="h-6 w-6 text-primary"/>Payroll Reconciliation</h1><p className="text-sm text-muted-foreground">Parallel comparison of system payroll against the officer’s manual computation</p></div></div><Button onClick={() => saveMutation.mutate()} disabled={!record || saveMutation.isPending}><Save className="mr-2 h-4 w-4"/>{saveMutation.isPending ? 'Saving…' : 'Save Reconciliation'}</Button></div>
    <Card className="grid gap-3 p-4 md:grid-cols-2"><div><label className="text-xs font-medium text-muted-foreground">Payroll Period</label><Select value={periodId} onValueChange={value => { setPeriodId(value); setEmployeeId('all'); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select period"/></SelectTrigger><SelectContent>{periods.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.period_name || `${item.start_date} to ${item.end_date}`}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs font-medium text-muted-foreground">Employee</label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger className="mt-1"><SelectValue placeholder="Select employee"/></SelectTrigger><SelectContent><SelectItem value="all">All Employees · Consolidated</SelectItem>{records.map(item => <SelectItem key={item.id} value={String(item.employee_id)}>{item.employee_name} · {item.employee_id}</SelectItem>)}</SelectContent></Select></div></Card>
    {saved && <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Reconciliation saved.</div>}
    {payrollOvertimeIsStale && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Reconciliation includes {currentOvertimeHours.toFixed(2)} approved OT hours. The generated payroll previously contained {num(record.overtime_hours).toFixed(2)}, so regenerate payroll to update OT Pay and the final payroll record.</div>}
    {!loading && isConsolidated && records.length > 0 && <ConsolidatedReconciliation records={records} reconciliations={consolidatedReconQuery.data || []} onEmployee={setEmployeeId}/>}
    {!loading && records.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">Generate payroll for the selected period before starting reconciliation.</Card>}
    {record && <>
      <Card className="overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold">{record.employee_name}</h2><p className="text-xs text-muted-foreground">{record.department || 'Unassigned'} · System / Manual / Difference (System − Manual)</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1800px] text-xs"><thead className="bg-muted/70"><tr><th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Source</th>{SUMMARY_FIELDS.map(([key,label]) => <th key={key} className="whitespace-nowrap px-3 py-2 text-right">{label}</th>)}</tr></thead><tbody><tr className="border-t"><td className="sticky left-0 bg-background px-3 py-2 font-bold text-red-600">System</td>{SUMMARY_FIELDS.map(([key,,type]) => <td key={key} className="px-3 py-2 text-right font-mono">{display(systemSummaryValue(key),type)}</td>)}</tr><tr className="border-t"><td className="sticky left-0 bg-background px-3 py-2 font-bold text-blue-600">Manual</td>{SUMMARY_FIELDS.map(([key]) => <td key={key} className="p-1"><Input type="number" step="0.01" className="h-8 min-w-24 text-right font-mono" value={effectiveManual[key] ?? ''} disabled={DERIVED_SUMMARY_FIELDS.has(key)} title={DERIVED_SUMMARY_FIELDS.has(key) ? 'Automatically calculated from the manual reconciliation inputs' : undefined} onChange={event => setManual(values => ({ ...values, [key]: event.target.value }))}/></td>)}</tr><tr className="border-t bg-yellow-50"><td className="sticky left-0 bg-yellow-50 px-3 py-2 font-bold text-amber-700">Difference</td>{SUMMARY_FIELDS.map(([key,,type]) => { const difference = systemSummaryValue(key)-num(effectiveManual[key]); return <td key={key} className={`px-3 py-2 text-right font-mono font-semibold ${Math.abs(difference) > .005 ? 'bg-red-100 text-red-700' : 'text-emerald-700'}`}>{display(difference,type)}</td>; })}</tr></tbody></table></div></Card>
      <Card className="overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold">Daily Attendance Inputs</h2><p className="text-xs text-muted-foreground">Review every day covered by this payroll period; differences are computed per input.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1850px] text-xs"><thead className="bg-muted/70"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">System Day / Status</th><th className="px-3 py-2 text-left">Manual Day Type</th><th className="px-3 py-2 text-left">System Punches</th><th className="px-3 py-2 text-left">Manual Punches (In 1 / Out 1 / In 2 / Out 2)</th>{DAILY_FIELDS.map(([key,label]) => <th key={key} className="px-3 py-2 text-right">{label}<br/><span className="font-normal">System / Manual / Diff</span></th>)}</tr></thead><tbody>{days.map(date => { const log = logByDate.get(date) || {}; return <tr key={date} className="border-t align-top"><td className="whitespace-nowrap px-3 py-3 font-medium">{date}<br/><span className="text-muted-foreground">{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH',{weekday:'short'})}</span></td><td className="px-3 py-3">{log.day_type || 'No record'}<br/><span className="capitalize text-muted-foreground">{log.status || '—'}</span></td><td className="p-2"><Input className="h-8 min-w-28" value={manualDays[date]?.day_type ?? ''} placeholder="regular" onChange={event => setManualDays(values => ({ ...values, [date]: { ...(values[date] || {}), day_type: event.target.value } }))}/></td><td className="whitespace-nowrap px-3 py-3 font-mono text-[10px]">{time(log.time_in)} · {time(log.break_time_out)}<br/>{time(log.break_time_in)} · {time(log.time_out)}</td><td className="p-2"><div className="grid min-w-64 grid-cols-4 gap-1">{['time_in','break_time_out','break_time_in','time_out'].map(key => <Input key={key} type="time" className="h-8 px-1 text-[10px]" value={manualDays[date]?.[key] ?? ''} onChange={event => setManualDays(values => ({ ...values, [date]: { ...(values[date] || {}), [key]: event.target.value } }))}/>)}</div></td>{DAILY_FIELDS.map(([key]) => { const system = systemDailyValue(log, key); const manualValue = manualDays[date]?.[key] ?? ''; const difference = system-num(manualValue); return <td key={key} className="p-2"><div className="text-right font-mono">{system.toFixed(2)}</div><Input type="number" step="0.01" className="my-1 h-7 min-w-24 text-right font-mono" value={manualValue} onChange={event => setManualDays(values => ({ ...values, [date]: { ...(values[date] || {}), [key]: event.target.value } }))}/><div className={`text-right font-mono font-semibold ${Math.abs(difference) > .005 ? 'text-red-600' : 'text-emerald-600'}`}>{difference.toFixed(2)}</div></td>; })}</tr>; })}</tbody></table></div></Card>
      <Card className="p-4"><label className="text-sm font-semibold">Admin/HR Variance Note</label><p className="mb-2 text-xs text-muted-foreground">Explain the reason for any difference between system and manual computation.</p><Textarea rows={4} value={note} onChange={event => setNote(event.target.value)} placeholder="Example: Manual OT used an unapproved hour; system used the approved OT request."/><p className="mt-2 text-xs text-muted-foreground">Reviewer: {existing?.reviewed_by || user?.full_name || user?.name || user?.email || 'Current officer'}{existing?.reviewed_at ? ` · Last saved ${new Date(existing.reviewed_at).toLocaleString('en-PH')}` : ''}</p></Card>
    </>}
  </div>;
}
