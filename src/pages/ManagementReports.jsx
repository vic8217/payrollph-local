// @ts-nocheck
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import { formatManilaTime } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const fullName = employee => [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ');
const employeeKey = record => String(record?.employee_record_id || record?.employee_id || '').trim().toLowerCase();
const hours = value => `${(Number(value) || 0).toFixed(2)}h`;
const minutes = value => `${Math.round(Number(value) || 0)}m`;
const punch = value => value ? formatManilaTime(value) : 'Missing';

function periodDates(start, end) {
  const result = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function summarize(logs, employeeCount) {
  return {
    employees: employeeCount,
    present: new Set(logs.filter(log => log.time_in).map(log => `${log.date}:${employeeKey(log)}`)).size,
    complete: logs.filter(log => log.status === 'approved').length,
    incomplete: logs.filter(log => log.status !== 'approved').length,
    workHours: logs.reduce((sum, log) => sum + (Number(log.hours_worked) || 0), 0),
    undertime: logs.reduce((sum, log) => sum + (Number(log.undertime_minutes) || 0), 0),
    overtime: logs.reduce((sum, log) => sum + (Number(log.overtime_hours) || 0), 0),
    nightDiff: logs.reduce((sum, log) => sum + (Number(log.night_diff_hours) || 0), 0),
  };
}

export default function ManagementReports() {
  const { activeCompany } = useCompany();
  const [periodOffset, setPeriodOffset] = useState(0);
  const [otEmployee, setOtEmployee] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(null);
  const [attendanceDepartment, setAttendanceDepartment] = useState(null);
  const companyId = activeCompany?.id;
  const period = getPayrollPeriodForDate(new Date(), activeCompany, periodOffset);

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['management-reports-employees', companyId],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: companyId, status: 'active' }, 'last_name', 5000),
    enabled: Boolean(companyId),
  });
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['management-reports-attendance', companyId, period.start_date, period.end_date],
    queryFn: () => appApi.entities.AttendanceLog.filter({ company_profile_id: companyId, date: { $gte: period.start_date, $lte: period.end_date } }, 'date', 10000),
    enabled: Boolean(companyId),
  });
  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['management-reports-ot', companyId, period.start_date, period.end_date],
    queryFn: () => appApi.entities.OvertimeRequest.filter({ company_profile_id: companyId, status: 'approved', date: { $gte: period.start_date, $lte: period.end_date } }, 'date', 10000),
    enabled: Boolean(companyId),
  });

  const activeEmployees = useMemo(() => employees.filter(employee => !employee.special_rate_enabled), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.flatMap(employee => [
    [String(employee.id || '').toLowerCase(), employee],
    [String(employee.employee_id || '').toLowerCase(), employee],
  ])), [activeEmployees]);
  const logsByDate = useMemo(() => logs.reduce((grouped, log) => {
    (grouped[log.date] ||= []).push(log);
    return grouped;
  }, {}), [logs]);
  const otRows = useMemo(() => {
    const groups = new Map();
    requests.forEach(request => {
      const key = employeeKey(request);
      const employee = employeeMap.get(key);
      const current = groups.get(key) || { key, employee, requests: [], requested: 0, approved: 0 };
      current.requests.push(request);
      current.requested += Number(request.requested_hours) || 0;
      current.approved += Number(request.approved_hours ?? request.requested_hours) || 0;
      groups.set(key, current);
    });
    return [...groups.values()].sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)));
  }, [requests, employeeMap]);
  const departments = useMemo(() => [...new Set(activeEmployees.map(employee => employee.department || 'Unassigned'))].sort(), [activeEmployees]);
  const dailyRows = useMemo(() => periodDates(period.start_date, period.end_date).flatMap(date => departments.map(department => {
    const departmentEmployees = activeEmployees.filter(employee => (employee.department || 'Unassigned') === department);
    const departmentKeys = new Set(departmentEmployees.flatMap(employee => [String(employee.id || '').toLowerCase(), String(employee.employee_id || '').toLowerCase()]));
    const departmentLogs = (logsByDate[date] || []).filter(log => departmentKeys.has(employeeKey(log)));
    return { date, department, ...summarize(departmentLogs, departmentEmployees.length) };
  })), [period.start_date, period.end_date, departments, logsByDate, activeEmployees]);
  const periodSummary = useMemo(() => summarize(logs, activeEmployees.length), [logs, activeEmployees.length]);
  const loading = employeesLoading || logsLoading || requestsLoading;
  const detailRows = useMemo(() => {
    if (!attendanceDate) return [];
    const dayLogs = logsByDate[attendanceDate] || [];
    const byEmployee = new Map(dayLogs.map(log => [employeeKey(log), log]));
    return activeEmployees
      .filter(employee => !attendanceDepartment || (employee.department || 'Unassigned') === attendanceDepartment)
      .map(employee => ({ employee, log: byEmployee.get(String(employee.id || '').toLowerCase()) || byEmployee.get(String(employee.employee_id || '').toLowerCase()) || null }));
  }, [attendanceDate, attendanceDepartment, logsByDate, activeEmployees]);

  const SummaryTiles = ({ value }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 border-b border-border">
      {[
        ['Employees', value.employees], ['Present Days', value.present], ['Complete', value.complete], ['Incomplete', value.incomplete],
        ['Work Hours', hours(value.workHours)], ['Undertime', minutes(value.undertime)], ['Overtime', hours(value.overtime)], ['Night Diff', hours(value.nightDiff)],
      ].map(([label, number]) => <div key={label} className="px-4 py-3 border-r border-border last:border-r-0"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{number}</p></div>)}
    </div>
  );

  return <div className="w-full p-4 md:p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" />Management Reports</h1><p className="text-sm text-muted-foreground">Payroll-period overtime and attendance reports</p></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setPeriodOffset(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" onClick={() => setPeriodOffset(0)}>{period.label}</Button><Button variant="outline" size="icon" onClick={() => setPeriodOffset(value => value + 1)} disabled={periodOffset >= 0}><ChevronRight className="h-4 w-4" /></Button></div>
    </div>

    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b"><div className="flex justify-between"><div><h2 className="font-semibold">OT Summary per Employee</h2><p className="text-xs text-muted-foreground">Approved overtime for {period.label}</p></div><Badge variant="secondary">{otRows.length} employees</Badge></div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-muted-foreground"><tr>{['Employee','Department','Requests','Requested OT','Approved OT','Action'].map(label => <th key={label} className="text-left font-medium px-4 py-2">{label}</th>)}</tr></thead><tbody>
        {!loading && otRows.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-muted-foreground">No approved overtime in this payroll period.</td></tr>}
        {otRows.map(row => <tr key={row.key} className="border-t"><td className="px-4 py-3"><p className="font-medium">{fullName(row.employee) || row.requests[0]?.employee_name || 'Unknown employee'}</p><p className="text-xs text-muted-foreground">{row.employee?.employee_id}</p></td><td className="px-4 py-3">{row.employee?.department || '—'}</td><td className="px-4 py-3">{row.requests.length}</td><td className="px-4 py-3">{hours(row.requested)}</td><td className="px-4 py-3 text-primary font-medium">{hours(row.approved)}</td><td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => setOtEmployee(row)}><Eye className="h-4 w-4 mr-1" />View Details</Button></td></tr>)}
      </tbody></table></div>
    </Card>

    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b"><h2 className="font-semibold">Attendance Summary</h2><p className="text-xs text-muted-foreground">Daily attendance totals for {period.label}</p></div>
      <SummaryTiles value={periodSummary} />
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-muted-foreground"><tr>{['Date','Department','Employees','Present','Complete','Incomplete','Work Hours','Undertime','Overtime','Night Diff','Action'].map(label => <th key={label} className="text-left font-medium px-4 py-2">{label}</th>)}</tr></thead><tbody>
        {dailyRows.map(row => <tr key={`${row.date}:${row.department}`} className="border-t"><td className="px-4 py-3 font-medium">{row.date}</td><td className="px-4 py-3 font-medium text-muted-foreground">{row.department}</td><td className="px-4 py-3">{row.employees}</td><td className="px-4 py-3">{row.present}</td><td className="px-4 py-3 text-emerald-700">{row.complete}</td><td className="px-4 py-3 text-amber-700">{row.incomplete}</td><td className="px-4 py-3">{hours(row.workHours)}</td><td className="px-4 py-3">{minutes(row.undertime)}</td><td className="px-4 py-3 text-blue-700">{hours(row.overtime)}</td><td className="px-4 py-3 text-violet-700">{hours(row.nightDiff)}</td><td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => { setAttendanceDepartment(row.department); setAttendanceDate(row.date); }}><Eye className="h-4 w-4 mr-1" />View Day</Button></td></tr>)}
      </tbody></table></div>
    </Card>

    <Dialog open={Boolean(otEmployee)} onOpenChange={open => !open && setOtEmployee(null)}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Employee OT Details — {fullName(otEmployee?.employee)} · {otEmployee?.employee?.department || 'Unassigned'}</DialogTitle></DialogHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Date','Department','Time In(1)','Time Out(2)','Requested','Approved','Reason'].map(label => <th key={label} className="text-left px-3 py-2">{label}</th>)}</tr></thead><tbody>{otEmployee?.requests.map(request => { const log = logs.find(item => item.date === request.date && employeeKey(item) === otEmployee.key); return <tr key={request.id} className="border-t"><td className="px-3 py-3">{request.date}</td><td className="px-3 py-3">{otEmployee?.employee?.department || request.department || 'Unassigned'}</td><td className="px-3 py-3">{punch(log?.time_in)}</td><td className="px-3 py-3">{punch(log?.time_out)}</td><td className="px-3 py-3">{hours(request.requested_hours)}</td><td className="px-3 py-3">{hours(request.approved_hours ?? request.requested_hours)}</td><td className="px-3 py-3">{request.reason || '—'}</td></tr>})}</tbody></table></div></DialogContent></Dialog>

    <Dialog open={Boolean(attendanceDate)} onOpenChange={open => !open && setAttendanceDate(null)}><DialogContent className="max-w-[96vw]"><DialogHeader><DialogTitle>Daily Punch Audit — {attendanceDate}</DialogTitle></DialogHeader><div className="max-h-[70vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr>{['Employee','Department','Time In(1)','Time Out(1)','Time In(2)','Time Out(2)','Hours','OT','Review','Status'].map(label => <th key={label} className="text-left px-3 py-2 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{detailRows.map(({ employee, log }) => { const missing = log ? [['Time In(1)',log.time_in],['Time Out(1)',log.break_time_out],['Time In(2)',log.break_time_in],['Time Out(2)',log.time_out]].filter(([,value]) => !value).map(([label]) => label) : []; return <tr key={employee.id} className="border-t"><td className="px-3 py-3"><p className="font-medium">{fullName(employee)}</p><p className="text-xs text-muted-foreground">{employee.employee_id}</p></td><td className="px-3 py-3">{employee.department || '—'}</td><td className="px-3 py-3">{punch(log?.time_in)}</td><td className="px-3 py-3">{punch(log?.break_time_out)}</td><td className="px-3 py-3">{punch(log?.break_time_in)}</td><td className="px-3 py-3">{punch(log?.time_out)}</td><td className="px-3 py-3">{hours(log?.hours_worked)}</td><td className="px-3 py-3">{hours(log?.overtime_hours)}</td><td className="px-3 py-3">{!log ? 'No attendance log' : missing.length ? `Missing ${missing.join(', ')}` : 'Complete'}</td><td className="px-3 py-3"><Badge variant={log?.status === 'approved' ? 'default' : 'secondary'}>{log?.status || 'No log'}</Badge></td></tr>})}</tbody></table></div></DialogContent></Dialog>
  </div>;
}
