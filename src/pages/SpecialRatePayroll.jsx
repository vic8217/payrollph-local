// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Calculator, FileBarChart, ShieldCheck, Clock3 } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const money = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const employeeName = employee => [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');
const employeeKey = row => String(row?.employee_record_id || row?.employee_id || '').trim().toLowerCase();
const punch = value => value ? new Date(value).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : 'Missing';

function defaultDates() {
  const manilaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const end = new Date(`${manilaToday}T12:00:00+08:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    start: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(start),
    end: manilaToday,
    attendance: manilaToday,
  };
}

export default function SpecialRatePayroll() {
  const defaults = defaultDates();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('attendance');
  const [attendanceDate, setAttendanceDate] = useState(defaults.attendance);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [payrollPasscode, setPayrollPasscode] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { data: employees = [] } = useQuery({
    queryKey: ['specialRateEmployees', activeCompanyId],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: activeCompanyId }, 'first_name'),
    enabled: !!activeCompanyId,
  });
  const taggedEmployees = useMemo(
    () => employees.filter(employee => employee.status === 'active' && employee.special_rate_enabled),
    [employees],
  );
  const { data: attendanceLogs = [] } = useQuery({
    queryKey: ['specialRateAttendanceLogs', activeCompanyId, attendanceDate],
    queryFn: () => appApi.entities.AttendanceLog.allPages(
      { company_profile_id: activeCompanyId, date: attendanceDate },
      'date',
      { pageSize: 200 },
    ),
    enabled: !!activeCompanyId,
  });
  const { data: periods = [] } = useQuery({
    queryKey: ['specialRatePayrollPeriods', activeCompanyId],
    queryFn: () => appApi.entities.SpecialRatePayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-end_date'),
    enabled: !!activeCompanyId,
  });
  const { data: payrollRecords = [] } = useQuery({
    queryKey: ['specialRatePayrollRecords', activeCompanyId],
    queryFn: () => appApi.entities.SpecialRatePayrollRecord.filter({ company_profile_id: activeCompanyId }, 'employee_name'),
    enabled: !!activeCompanyId,
  });

  useEffect(() => {
    if (!selectedPeriodId && periods[0]?.id) setSelectedPeriodId(String(periods[0].id));
  }, [periods, selectedPeriodId]);

  const generatePayroll = async () => {
    setError(''); setMessage('');
    if (!payrollPasscode.trim()) return setError('Enter today’s Admin Manager passcode.');
    setSaving(true);
    try {
      const result = await appApi.functions.invoke('generateSpecialRatePayroll', {
        company_profile_id: activeCompanyId,
        start_date: startDate,
        end_date: endDate,
        manager_passcode: payrollPasscode.trim(),
      });
      setPayrollPasscode('');
      setSelectedPeriodId(String(result.period.id));
      setMessage(`Special-rate payroll generated for ${result.period.period_name}.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['specialRatePayrollPeriods'] }),
        qc.invalidateQueries({ queryKey: ['specialRatePayrollRecords'] }),
      ]);
      setTab('summary');
    } catch (generateError) {
      setError(generateError.message || 'Unable to generate special-rate payroll.');
    } finally {
      setSaving(false);
    }
  };

  const selectedPeriod = periods.find(period => String(period.id) === String(selectedPeriodId));
  const selectedRecords = payrollRecords.filter(record => String(record.payroll_period_id) === String(selectedPeriodId));

  if (!['super_admin', 'admin'].includes(user?.role)) {
    return <div className="p-6 min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">Special Rate Payroll is restricted to administrators.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Confidential Special Rate Payroll</h1>
        <p className="text-sm text-muted-foreground">Attendance and fixed-fee payroll kept separate from regular employee payroll.</p>
      </div>

      <div className="flex w-fit rounded-lg bg-muted p-1">
        {[
          ['attendance', CalendarCheck, 'Attendance'],
          ['payroll', Calculator, 'Payroll Computation'],
          ['summary', FileBarChart, 'Summary'],
        ].map(([value, Icon, label]) => (
          <button key={value} onClick={() => { setTab(value); setError(''); setMessage(''); }} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${tab === value ? 'bg-background text-foreground shadow' : 'text-muted-foreground'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      {tab === 'attendance' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
            <div>
              <Label>Attendance date</Label>
              <Input type="date" value={attendanceDate} onChange={event => setAttendanceDate(event.target.value)} className="mt-1 w-48" />
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><Clock3 className="mr-1.5 inline h-4 w-4"/>Attendance is recorded through the regular QR/punch workflow.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead><tr className="bg-muted/50 border-b"><th className="p-3 text-left">Employee</th><th className="p-3 text-right">Fixed Daily Fee</th><th className="p-3 text-left">Time In(1)</th><th className="p-3 text-left">Time Out(1)</th><th className="p-3 text-left">Time In(2)</th><th className="p-3 text-left">Time Out(2)</th><th className="p-3 text-right">Hours</th><th className="p-3 text-left">Log Status</th><th className="p-3 text-right">Credited Day</th></tr></thead>
              <tbody>
                {taggedEmployees.length === 0 ? <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">No active employees are tagged for Special Rates.</td></tr> : taggedEmployees.map(employee => {
                  const log = attendanceLogs.find(row => employeeKey(row) === String(employee.id).toLowerCase() || employeeKey(row) === String(employee.employee_id).toLowerCase());
                  const halfDay = log?.day_type === 'half_day';
                  const complete = Boolean(log?.time_in && log?.time_out);
                  const creditedDay = halfDay && complete ? 0.5 : complete ? 1 : 0;
                  return <tr key={employee.id} className="border-b last:border-0">
                    <td className="p-3"><p className="font-medium">{employeeName(employee)}</p><p className="text-xs text-muted-foreground">{employee.employee_id}</p></td>
                    <td className="p-3 text-right font-medium">{money(employee.special_fixed_daily_fee)}</td>
                    <td className="p-3">{punch(log?.time_in)}</td><td className="p-3">{punch(log?.break_time_out)}</td><td className="p-3">{punch(log?.break_time_in)}</td><td className="p-3">{punch(log?.time_out)}</td>
                    <td className="p-3 text-right">{Number(log?.hours_worked || 0).toFixed(2)}h</td>
                    <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${complete ? 'bg-emerald-100 text-emerald-700' : log?.time_in ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{complete ? (halfDay ? 'Complete · Half Day' : 'Complete') : log?.time_in ? 'Incomplete punches' : 'No attendance log'}</span></td>
                    <td className="p-3 text-right font-medium">{creditedDay.toFixed(1)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'payroll' && (
        <Card className="p-5 space-y-5">
          <div>
            <h2 className="font-semibold">Generate Special Rate Payroll</h2>
            <p className="text-sm text-muted-foreground">Gross and net pay are computed as fixed daily fee × credited days from regular AttendanceLog punches. Incomplete punch records must be corrected before generation. Overtime and statutory deductions remain separate from this confidential payroll.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div><Label>Period start</Label><Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="mt-1" /></div>
            <div><Label>Period end</Label><Input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="mt-1" /></div>
            <div><Label>Admin Manager passcode</Label><Input type="password" inputMode="numeric" value={payrollPasscode} onChange={event => setPayrollPasscode(event.target.value)} className="mt-1 text-center font-mono tracking-widest" /></div>
          </div>
          <Button onClick={generatePayroll} disabled={saving} className="gap-2"><ShieldCheck className="h-4 w-4" />{saving ? 'Computing…' : 'Authorize and Generate Payroll'}</Button>
        </Card>
      )}

      {tab === 'summary' && (
        <div className="space-y-4">
          <Card className="p-4">
            <Label>Payroll period</Label>
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}><SelectTrigger className="mt-1 max-w-md"><SelectValue placeholder="Select a generated period" /></SelectTrigger><SelectContent>{periods.map(period => <SelectItem key={period.id} value={String(period.id)}>{period.period_name}</SelectItem>)}</SelectContent></Select>
          </Card>
          {selectedPeriod ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="p-4"><p className="text-xs text-muted-foreground">Employees</p><p className="text-2xl font-bold">{selectedPeriod.employee_count || selectedRecords.length}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Credited Days</p><p className="text-2xl font-bold">{selectedPeriod.total_credited_days || 0}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Total Net Payroll</p><p className="text-2xl font-bold text-primary">{money(selectedPeriod.total_net)}</p></Card>
              </div>
              <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50"><th className="p-3 text-left">Employee</th><th className="p-3 text-right">Daily Fee</th><th className="p-3 text-right">Present</th><th className="p-3 text-right">Half Day</th><th className="p-3 text-right">Absent</th><th className="p-3 text-right">Credited Days</th><th className="p-3 text-right">Gross / Net</th></tr></thead><tbody>{selectedRecords.map(record => <tr key={record.id} className="border-b last:border-0"><td className="p-3"><p className="font-medium">{record.employee_name}</p><p className="text-xs text-muted-foreground">{record.employee_id}</p></td><td className="p-3 text-right">{money(record.fixed_daily_fee)}</td><td className="p-3 text-right">{record.present_days || 0}</td><td className="p-3 text-right">{record.half_days || 0}</td><td className="p-3 text-right">{record.absent_days || 0}</td><td className="p-3 text-right">{record.credited_days || 0}</td><td className="p-3 text-right font-semibold">{money(record.net_pay)}</td></tr>)}</tbody></table></div></Card>
            </>
          ) : <Card className="p-10 text-center text-sm text-muted-foreground">Generate a special-rate payroll period to view its summary.</Card>}
        </div>
      )}
    </div>
  );
}
