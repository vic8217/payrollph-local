// @ts-nocheck
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Pie, PieChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, BarChart3, BriefcaseBusiness, CalendarDays, ChevronLeft,
  ChevronRight, Clock3, Download, Eye, Filter, Moon, PhilippinePeso,
  RefreshCw, TrendingDown, TrendingUp, Users, WalletCards, X, ArrowRight,
} from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import { formatManilaTime } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const COLORS = ['#315ce8', '#7c3aed', '#17a673', '#f5a623', '#e54b4b', '#1e9bb5', '#8b5cf6'];
const ATTENDANCE_COLORS = { Present: '#20a464', Late: '#f5b21b', Incomplete: '#e44d55', Leave: '#8a94a6' };
const OT_THRESHOLDS = { warningPercent: 3, criticalPercent: 6, employeeHours: 20 };
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0);
const preciseMoney = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
const compactMoney = value => {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1_000_000) return `₱${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `₱${(amount / 1_000).toFixed(0)}K`;
  return `₱${amount.toFixed(0)}`;
};
const hours = value => `${(Number(value) || 0).toFixed(1)}h`;
const fullName = employee => [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ');
const employeeKey = record => String(record?.employee_record_id || record?.employee_id || '').trim().toLowerCase();
const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
const percentChange = (current, previous) => Number(previous) ? ((Number(current) - Number(previous)) / Number(previous)) * 100 : null;
const periodLabel = period => period?.period_name || period?.label || `${period?.start_date || ''} - ${period?.end_date || ''}`;

function ChartCard({ title, subtitle, children, className = '' }) {
  return <Card className={`min-w-0 border-border/80 p-4 shadow-sm ${className}`}>
    <div className="mb-3"><h3 className="text-sm font-semibold">{title}</h3>{subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}</div>
    {children}
  </Card>;
}

function KpiCard({ label, value, icon: Icon, color, change, detail, inverse = false, onClick }) {
  const available = change != null && Number.isFinite(change);
  const increased = available && change > 0;
  const favorable = inverse ? !increased : increased;
  return <Card role="button" tabIndex={0} onClick={onClick} onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && onClick?.()} className="cursor-pointer border-border/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30">
    <div className="flex items-start gap-3">
      <div className={`rounded-xl p-2.5 ${color}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xl font-bold tracking-tight">{value}</p>
        <p className={`mt-1 flex items-center gap-1 text-[11px] ${!available ? 'text-muted-foreground' : favorable ? 'text-emerald-600' : 'text-red-600'}`}>
          {available ? (increased ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />) : null}
          {available ? `${Math.abs(change).toFixed(1)}% vs last period` : detail || 'No previous-period data'}
        </p>
      </div>
    </div>
  </Card>;
}

function EmptyChart({ children }) {
  return <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">{children}</div>;
}

function TrendChart({ data, dataKey, color, formatter, onPeriod }) {
  if (!data.some(item => Number(item[dataKey]) > 0)) return <EmptyChart>No processed data available for this trend.</EmptyChart>;
  return <ResponsiveContainer width="100%" height={220}>
    <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={state => state?.activePayload?.[0]?.payload?.period && onPeriod(state.activePayload[0].payload.period)}>
      <defs><linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={color} stopOpacity={0.25}/><stop offset="95%" stopColor={color} stopOpacity={0}/></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6eaf0" />
      <XAxis dataKey="shortLabel" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tickFormatter={formatter} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={48} />
      <Tooltip formatter={(value) => formatter(value)} labelFormatter={(_, payload) => payload?.[0]?.payload?.label} />
      <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill={`url(#fill-${dataKey})`} activeDot={{ r: 5, cursor: 'pointer' }} />
    </AreaChart>
  </ResponsiveContainer>;
}

function Donut({ data, total, totalLabel, colors = COLORS }) {
  if (!data.some(item => item.value > 0)) return <EmptyChart>No data available.</EmptyChart>;
  const denominator = typeof total === 'number' ? total : data.reduce((sumValue, item) => sumValue + item.value, 0);
  return <div className="grid grid-cols-[minmax(150px,1fr)_minmax(130px,1fr)] items-center gap-2">
    <div className="relative h-[220px]">
      <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={1}>{data.map((item, index) => <Cell key={item.name} fill={item.color || colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name]} /></PieChart></ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-lg">{typeof total === 'number' ? total.toLocaleString() : total}</strong><span className="text-[10px] text-muted-foreground">{totalLabel}</span></div>
    </div>
    <div className="space-y-2">{data.map((item, index) => <div key={item.name} className="flex items-start gap-2 text-[11px]"><span className="mt-1 h-2 w-2 rounded-full" style={{ background: item.color || colors[index % colors.length] }}/><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span>{item.name}</span><strong>{denominator ? `${((item.value / denominator) * 100).toFixed(1)}%` : '0%'}</strong></div><p className="text-muted-foreground">{item.display || item.value.toLocaleString()}</p></div></div>)}</div>
  </div>;
}

function isIncompletePunch(log) {
  if (!log?.time_in) return false;
  if (!log.time_out) return true;
  const expectsBreak = Boolean(log.shift_break_start_time || log.break_time_out || log.break_time_in);
  return expectsBreak && (!log.break_time_out || !log.break_time_in);
}

function aggregateRecords(records, employeeMap) {
  const groups = new Map();
  records.forEach(record => {
    const employee = employeeMap.get(String(record.employee_id || '').toLowerCase());
    const department = record.department || employee?.department || 'Unassigned';
    const current = groups.get(department) || { department, employeeKeys: new Set(), records: [], basicPay: 0, payroll: 0, netPay: 0, otCost: 0, otHours: 0, nightDiff: 0, allowances: 0, holidayPay: 0 };
    current.records.push(record);
    current.employeeKeys.add(String(record.employee_id || record.id));
    current.basicPay += Number(record.basic_pay) || 0;
    current.payroll += Number(record.gross_pay) || 0;
    current.netPay += Number(record.net_pay) || 0;
    current.otCost += Number(record.overtime_pay) || 0;
    current.otHours += Number(record.overtime_hours) || 0;
    current.nightDiff += Number(record.night_diff_pay) || 0;
    current.allowances += (Number(record.allowance_pay) || Number(record.allowances) || Number(record.incentive_pay) || 0);
    current.holidayPay += Number(record.holiday_pay) || 0;
    groups.set(department, current);
  });
  return [...groups.values()].map(row => ({ ...row, employees: row.employeeKeys.size, average: row.employeeKeys.size ? row.payroll / row.employeeKeys.size : 0, otPercent: row.payroll ? row.otCost / row.payroll * 100 : 0 })).sort((a, b) => b.payroll - a.payroll);
}

export default function ManagementReports() {
  const { activeCompany, activeCompanyId } = useCompany();
  const companyId = activeCompanyId || activeCompany?.id;
  const [periodOffset, setPeriodOffset] = useState(0);
  const [department, setDepartment] = useState('all');
  const [employmentStatus, setEmploymentStatus] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(null);
  const [showPendingOt, setShowPendingOt] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState(null);
  const [showNightDiffDetails, setShowNightDiffDetails] = useState(false);
  const [showOvertimeDetails, setShowOvertimeDetails] = useState(false);
  const [overtimeDepartment, setOvertimeDepartment] = useState(null);
  const [nightDiffDepartment, setNightDiffDepartment] = useState(null);
  const fallbackPeriod = getPayrollPeriodForDate(new Date(), activeCompany, periodOffset);

  const periodsQuery = useQuery({ queryKey: ['management-dashboard-periods', companyId], queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: companyId }, '-start_date', 50), enabled: Boolean(companyId) });
  const employeesQuery = useQuery({ queryKey: ['management-dashboard-employees', companyId], queryFn: () => appApi.entities.Employee.filter({ company_profile_id: companyId }, 'last_name', 5000), enabled: Boolean(companyId) });
  const periods = periodsQuery.data || [];
  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))), [periods]);
  const selectedPeriod = useMemo(() => {
    const eligible = sortedPeriods.filter(item => item.start_date <= fallbackPeriod.end_date);
    return eligible.at(-1) || { ...fallbackPeriod, id: null };
  }, [sortedPeriods, fallbackPeriod.start_date, fallbackPeriod.end_date]);
  const selectedIndex = sortedPeriods.findIndex(item => String(item.id) === String(selectedPeriod.id));
  const previousPeriod = selectedIndex > 0 ? sortedPeriods[selectedIndex - 1] : null;
  const trendPeriods = sortedPeriods.slice(Math.max(0, selectedIndex - 6), selectedIndex + 1);

  const recordsQuery = useQuery({ queryKey: ['management-dashboard-records', companyId], queryFn: () => appApi.entities.PayrollRecord.filter({ company_profile_id: companyId }, '-created_date', 10000), enabled: Boolean(companyId) });
  const logsQuery = useQuery({ queryKey: ['management-dashboard-attendance', companyId, selectedPeriod.start_date, selectedPeriod.end_date], queryFn: () => appApi.entities.AttendanceLog.filter({ company_profile_id: companyId, date: { $gte: selectedPeriod.start_date, $lte: selectedPeriod.end_date } }, 'date', 10000), enabled: Boolean(companyId && selectedPeriod.start_date) });
  const requestsQuery = useQuery({ queryKey: ['management-dashboard-ot', companyId, selectedPeriod.start_date, selectedPeriod.end_date], queryFn: () => appApi.entities.OvertimeRequest.filter({ company_profile_id: companyId, date: { $gte: selectedPeriod.start_date, $lte: selectedPeriod.end_date } }, 'date', 10000), enabled: Boolean(companyId && selectedPeriod.start_date) });
  const refresh = () => { periodsQuery.refetch(); employeesQuery.refetch(); recordsQuery.refetch(); logsQuery.refetch(); requestsQuery.refetch(); };

  const employees = employeesQuery.data || [];
  const allRecords = recordsQuery.data || [];
  const logs = logsQuery.data || [];
  const requests = requestsQuery.data || [];
  const employeeMap = useMemo(() => new Map(employees.flatMap(employee => [[String(employee.id || '').toLowerCase(), employee], [String(employee.employee_id || '').toLowerCase(), employee]])), [employees]);
  const departments = useMemo(() => [...new Set(employees.map(employee => employee.department || 'Unassigned'))].sort(), [employees]);
  const employeeAllowed = employee => (employmentStatus === 'all' || employee?.status === employmentStatus) && (department === 'all' || (employee?.department || 'Unassigned') === department);
  const recordAllowed = record => employeeAllowed(employeeMap.get(String(record.employee_id || '').toLowerCase()) || { department: record.department, status: 'active' });
  const currentRecords = allRecords.filter(record => String(record.payroll_period_id) === String(selectedPeriod.id) && recordAllowed(record));
  const previousRecords = previousPeriod ? allRecords.filter(record => String(record.payroll_period_id) === String(previousPeriod.id) && recordAllowed(record)) : [];
  const filteredLogs = logs.filter(log => employeeAllowed(employeeMap.get(employeeKey(log)) || {}));
  const filteredRequests = requests.filter(request => employeeAllowed(employeeMap.get(employeeKey(request)) || {}));

  const totalPayroll = sum(currentRecords, 'gross_pay');
  const totalNetPayroll = sum(currentRecords, 'net_pay');
  const previousPayroll = sum(previousRecords, 'gross_pay');
  const previousNetPayroll = sum(previousRecords, 'net_pay');
  const overtimeCost = sum(currentRecords, 'overtime_pay');
  const previousOtCost = sum(previousRecords, 'overtime_pay');
  const overtimeHours = sum(currentRecords, 'overtime_hours');
  const nightDiff = sum(currentRecords, 'night_diff_pay');
  const previousNightDiff = sum(previousRecords, 'night_diff_pay');
  const payrollEmployees = new Set(currentRecords.map(record => String(record.employee_id || record.id))).size;
  const payrollChange = percentChange(totalPayroll, previousPayroll);
  const payrollComparisonRows = useMemo(() => {
    const rows = new Map();
    const addRecords = (records, period) => records.forEach(record => {
      const key = String(record.employee_id || record.employee_record_id || record.id || '').trim().toLowerCase();
      const employee = employeeMap.get(key);
      const current = rows.get(key) || {
        key,
        employeeName: record.employee_name || fullName(employee) || 'Unknown employee',
        employeeId: record.employee_id || employee?.employee_id || '—',
        department: record.department || employee?.department || 'Unassigned',
        currentGross: 0,
        currentNet: 0,
        previousGross: 0,
        previousNet: 0,
        hasCurrent: false,
        hasPrevious: false,
      };
      current[`${period}Gross`] += Number(record.gross_pay) || 0;
      current[`${period}Net`] += Number(record.net_pay) || 0;
      current[period === 'current' ? 'hasCurrent' : 'hasPrevious'] = true;
      rows.set(key, current);
    });
    addRecords(currentRecords, 'current');
    addRecords(previousRecords, 'previous');
    return [...rows.values()].map(row => ({
      ...row,
      grossDifference: row.currentGross - row.previousGross,
      netDifference: row.currentNet - row.previousNet,
    })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [currentRecords, previousRecords, employeeMap]);
  const previousDepartments = aggregateRecords(previousRecords, employeeMap);
  const departmentRows = aggregateRecords(currentRecords, employeeMap).map(row => {
    const previous = previousDepartments.find(item => item.department === row.department);
    return { ...row, change: percentChange(row.payroll, previous?.payroll || 0) };
  });

  const trends = trendPeriods.map(period => {
    const rows = allRecords.filter(record => String(record.payroll_period_id) === String(period.id) && recordAllowed(record));
    return { period, label: periodLabel(period), shortLabel: String(period.start_date || '').slice(5), payroll: sum(rows, 'gross_pay'), overtimeHours: sum(rows, 'overtime_hours'), overtimeCost: sum(rows, 'overtime_pay') };
  });
  const attendanceByKey = new Map();
  filteredLogs.forEach(log => attendanceByKey.set(`${log.date}:${employeeKey(log)}`, log));
  const attendanceCounts = { Present: 0, Late: 0, Incomplete: 0, Leave: 0 };
  attendanceByKey.forEach(log => {
    if (isIncompletePunch(log)) attendanceCounts.Incomplete += 1;
    else if ((Number(log.late_minutes) || 0) > 0) attendanceCounts.Late += 1;
    else if (log.time_in) attendanceCounts.Present += 1;
    else if (String(log.day_type || '').includes('leave')) attendanceCounts.Leave += 1;
  });
  const attendanceData = Object.entries(attendanceCounts).map(([name, value]) => ({ name, value, color: ATTENDANCE_COLORS[name] }));
  const attendanceTotal = attendanceData.reduce((total, item) => total + item.value, 0);
  const incompleteLogs = filteredLogs.filter(isIncompletePunch);
  const pendingOt = filteredRequests.filter(request => !['approved', 'denied', 'rejected', 'cancelled'].includes(String(request.status || '').toLowerCase()));
  const approvedRequests = filteredRequests.filter(request => String(request.status).toLowerCase() === 'approved');

  const topOvertime = useMemo(() => {
    const groups = new Map();
    approvedRequests.forEach(request => {
      const key = employeeKey(request);
      const employee = employeeMap.get(key);
      const current = groups.get(key) || { key, employee, requests: [], approvedHours: 0, otCost: 0 };
      current.requests.push(request);
      current.approvedHours += Number(request.approved_hours ?? request.requested_hours) || 0;
      groups.set(key, current);
    });
    currentRecords.forEach(record => {
      const key = String(record.employee_id || '').toLowerCase();
      const current = groups.get(key);
      if (current) current.otCost += Number(record.overtime_pay) || 0;
    });
    return [...groups.values()].sort((a, b) => b.approvedHours - a.approvedHours).slice(0, 10);
  }, [approvedRequests, currentRecords, employeeMap]);

  const allowances = currentRecords.reduce((total, record) => total + (Number(record.allowance_pay) || Number(record.allowances) || Number(record.incentive_pay) || 0), 0);
  const composition = [
    { name: 'Basic Pay', value: sum(currentRecords, 'basic_pay'), display: money(sum(currentRecords, 'basic_pay')) },
    { name: 'Overtime Pay', value: overtimeCost, display: money(overtimeCost) },
    { name: 'Night Differential', value: nightDiff, display: money(nightDiff) },
    { name: 'Allowances', value: allowances, display: money(allowances) },
    { name: 'Holiday Pay', value: sum(currentRecords, 'holiday_pay'), display: money(sum(currentRecords, 'holiday_pay')) },
  ].filter(item => item.value > 0);
  const knownComposition = composition.reduce((total, item) => total + item.value, 0);
  if (totalPayroll - knownComposition > 0.01) composition.push({ name: 'Other Earnings', value: totalPayroll - knownComposition, display: money(totalPayroll - knownComposition) });

  const budgetAmount = Number(activeCompany?.payroll_period_budget || activeCompany?.payroll_budget_per_period) || null;
  const budgetPercent = budgetAmount ? totalPayroll / budgetAmount * 100 : null;
  const insights = [];
  if (payrollChange != null) insights.push(`Gross payroll ${payrollChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(payrollChange).toFixed(1)}% compared with the previous period.`);
  if (departmentRows[0] && totalPayroll) insights.push(`${departmentRows[0].department} accounts for ${(departmentRows[0].payroll / totalPayroll * 100).toFixed(1)}% of gross payroll.`);
  const otLeader = [...departmentRows].sort((a, b) => b.otHours - a.otHours)[0];
  if (otLeader && overtimeHours) insights.push(`${otLeader.department} generated ${(otLeader.otHours / overtimeHours * 100).toFixed(1)}% of approved overtime hours.`);
  const highOtDepartments = departmentRows.filter(row => row.otPercent > OT_THRESHOLDS.criticalPercent);
  if (highOtDepartments.length) insights.push(`${highOtDepartments.map(row => row.department).join(', ')} exceeded the ${OT_THRESHOLDS.criticalPercent}% overtime-cost threshold.`);
  if (budgetPercent != null) insights.push(`Payroll has used ${budgetPercent.toFixed(1)}% of the configured period budget.`);
  if (incompleteLogs.length || pendingOt.length) insights.push(`${incompleteLogs.length} incomplete attendance log${incompleteLogs.length === 1 ? '' : 's'} and ${pendingOt.length} unprocessed OT request${pendingOt.length === 1 ? '' : 's'} require review.`);

  const loading = periodsQuery.isLoading || employeesQuery.isLoading || recordsQuery.isLoading || logsQuery.isLoading || requestsQuery.isLoading;
  const error = periodsQuery.error || employeesQuery.error || recordsQuery.error || logsQuery.error || requestsQuery.error;
  const selectTrendPeriod = period => {
    const index = sortedPeriods.findIndex(item => String(item.id) === String(period.id));
    if (index >= 0 && selectedIndex >= 0) setPeriodOffset(value => value + index - selectedIndex);
  };
  const exportCsv = () => {
    const header = ['Department', 'Employees', 'Basic Pay', 'Gross Payroll', 'OT Cost', 'OT Hours', 'Night Differential', 'Allowances', 'Average Payroll', 'OT %'];
    const rows = departmentRows.map(row => [row.department, row.employees, row.basicPay, row.payroll, row.otCost, row.otHours, row.nightDiff, row.allowances, row.average, row.otPercent]);
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `payroll-management-${selectedPeriod.start_date}-${selectedPeriod.end_date}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (error) return <div className="p-6"><Card className="border-red-200 bg-red-50 p-6"><h2 className="font-semibold text-red-700">Unable to load management dashboard</h2><p className="mt-1 text-sm text-red-600">{error.message}</p><Button className="mt-4" variant="outline" onClick={refresh}>Retry</Button></Card></div>;

  return <div className="w-full space-y-4 p-4 md:p-6">
    <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 className="h-6 w-6 text-primary" />Payroll Management Dashboard</h1><p className="text-sm text-muted-foreground">Overview of gross payroll cost, overtime and attendance performance</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setPeriodOffset(value => value - 1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" className="min-w-52 justify-start gap-2"><CalendarDays className="h-4 w-4" />{periodLabel(selectedPeriod)}</Button>
        <Button variant="outline" size="icon" onClick={() => setPeriodOffset(value => value + 1)} disabled={periodOffset >= 0} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
        <Select value={department} onValueChange={setDepartment}><SelectTrigger className="w-44"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={employmentStatus} onValueChange={setEmploymentStatus}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All payroll employees</SelectItem><SelectItem value="active">Currently active</SelectItem><SelectItem value="inactive">Currently inactive</SelectItem></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export</Button>
      </div>
    </div>

    {department !== 'all' && <div className="flex"><Badge variant="secondary" className="gap-2 px-3 py-1.5">Department: {department}<button onClick={() => setDepartment('all')} aria-label="Clear department filter"><X className="h-3.5 w-3.5" /></button></Badge></div>}

    <Card className="border-blue-200 bg-blue-50/50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><div className="rounded-lg bg-blue-100 p-2 text-blue-700"><WalletCards className="h-5 w-5"/></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Generated Payroll Source</h2><Badge variant="secondary" className="capitalize">{selectedPeriod.status || (currentRecords.length ? 'generated' : 'not generated')}</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">Dashboard figures come from the same processed PayrollRecord entries used by Payroll for {periodLabel(selectedPeriod)}.</p></div></div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><div><p className="text-[10px] uppercase text-muted-foreground">Payroll records</p><p className="font-bold">{payrollEmployees}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Gross payroll</p><p className="font-bold">{preciseMoney(totalPayroll)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Net payroll</p><p className="font-bold text-blue-700">{preciseMoney(totalNetPayroll)}</p></div><Button variant="outline" className="bg-white" onClick={() => { window.location.href = '/payroll'; }}>View Payroll <ArrowRight className="ml-2 h-4 w-4"/></Button></div>
      </div>
    </Card>

    {(incompleteLogs.length > 0 || pendingOt.length > 0) && <Card className="border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"/><div className="flex-1"><h2 className="text-sm font-semibold">Payroll data may be incomplete</h2><p className="mt-0.5 text-xs text-amber-800">Management review is required before relying on this period’s totals.</p><div className="mt-3 flex flex-wrap gap-2">{incompleteLogs.length > 0 && <Button size="sm" variant="outline" className="border-amber-300 bg-white" onClick={() => setAttendanceDate(incompleteLogs[0]?.date)}>{incompleteLogs.length} missing punch record{incompleteLogs.length === 1 ? '' : 's'}</Button>}{pendingOt.length > 0 && <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => setShowPendingOt(true)}>{pendingOt.length} unprocessed OT request{pendingOt.length === 1 ? '' : 's'}</Button>}</div></div></div>
    </Card>}

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <KpiCard label="Total Gross Payroll" value={money(totalPayroll)} icon={WalletCards} color="bg-blue-100 text-blue-700" change={payrollChange} onClick={() => setSelectedKpi('payroll')}/>
      <KpiCard label="Overtime Cost" value={money(overtimeCost)} icon={Clock3} color="bg-violet-100 text-violet-700" change={percentChange(overtimeCost, previousOtCost)} inverse onClick={() => setShowOvertimeDetails(true)}/>
      <KpiCard label="Night Differential" value={money(nightDiff)} icon={Moon} color="bg-orange-100 text-orange-600" change={percentChange(nightDiff, previousNightDiff)} inverse onClick={() => setShowNightDiffDetails(true)}/>
      <KpiCard label="Payroll Employees" value={payrollEmployees} icon={Users} color="bg-emerald-100 text-emerald-700" detail={`${payrollEmployees} included in this period's payroll`} onClick={() => setSelectedKpi('employees')}/>
      <KpiCard label="Average Gross Pay" value={money(payrollEmployees ? totalPayroll / payrollEmployees : 0)} icon={PhilippinePeso} color="bg-cyan-100 text-cyan-700" change={percentChange(payrollEmployees ? totalPayroll / payrollEmployees : 0, previousRecords.length ? previousPayroll / new Set(previousRecords.map(r => r.employee_id)).size : 0)} onClick={() => setSelectedKpi('average')} />
      <KpiCard label="Payroll vs Last Period" value={payrollChange == null ? '—' : `${payrollChange >= 0 ? '+' : ''}${payrollChange.toFixed(1)}%`} icon={payrollChange > 0 ? TrendingUp : TrendingDown} color="bg-red-100 text-red-600" change={payrollChange} detail={`${money(totalPayroll - previousPayroll)} difference`} inverse onClick={() => setSelectedKpi('comparison')}/>
    </div>

    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="text-sm font-semibold">Employee Payroll Comparison</h3><p className="text-[11px] text-muted-foreground">Gross and net pay for {periodLabel(selectedPeriod)} versus {previousPeriod ? periodLabel(previousPeriod) : 'the previous payroll'}</p></div>
        <Badge variant="secondary">{payrollComparisonRows.length} employee{payrollComparisonRows.length === 1 ? '' : 's'}</Badge>
      </div>
      {!previousPeriod ? <div className="p-8 text-center text-sm text-muted-foreground">No previous payroll period is available for comparison.</div> : <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Employee</th><th className="px-3 py-2 text-left font-medium">Employee ID</th><th className="px-3 py-2 text-left font-medium">Department</th><th className="px-3 py-2 text-right font-medium">Previous Gross</th><th className="px-3 py-2 text-right font-medium">Current Gross</th><th className="px-3 py-2 text-right font-medium">Gross Change</th><th className="px-3 py-2 text-right font-medium">Previous Net</th><th className="px-3 py-2 text-right font-medium">Current Net</th><th className="px-3 py-2 text-right font-medium">Net Change</th></tr></thead>
          <tbody>{payrollComparisonRows.map(row => <tr key={row.key} className="border-t"><td className="px-3 py-2.5 font-semibold">{row.employeeName}{(!row.hasCurrent || !row.hasPrevious) && <Badge variant="outline" className="ml-2 text-[9px]">{row.hasCurrent ? 'New this payroll' : 'Not in current payroll'}</Badge>}</td><td className="px-3 py-2.5 text-muted-foreground">{row.employeeId}</td><td className="px-3 py-2.5">{row.department}</td><td className="px-3 py-2.5 text-right">{preciseMoney(row.previousGross)}</td><td className="px-3 py-2.5 text-right font-semibold">{preciseMoney(row.currentGross)}</td><td className={`px-3 py-2.5 text-right font-semibold ${row.grossDifference > 0 ? 'text-red-600' : row.grossDifference < 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>{row.grossDifference > 0 ? '+' : ''}{preciseMoney(row.grossDifference)}</td><td className="px-3 py-2.5 text-right">{preciseMoney(row.previousNet)}</td><td className="px-3 py-2.5 text-right font-semibold">{preciseMoney(row.currentNet)}</td><td className={`px-3 py-2.5 text-right font-semibold ${row.netDifference > 0 ? 'text-blue-700' : row.netDifference < 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{row.netDifference > 0 ? '+' : ''}{preciseMoney(row.netDifference)}</td></tr>)}</tbody>
          <tfoot className="sticky bottom-0 bg-muted/95"><tr className="border-t-2 font-bold"><td className="px-3 py-2.5" colSpan={3}>TOTAL</td><td className="px-3 py-2.5 text-right">{preciseMoney(previousPayroll)}</td><td className="px-3 py-2.5 text-right">{preciseMoney(totalPayroll)}</td><td className="px-3 py-2.5 text-right">{totalPayroll - previousPayroll > 0 ? '+' : ''}{preciseMoney(totalPayroll - previousPayroll)}</td><td className="px-3 py-2.5 text-right">{preciseMoney(previousNetPayroll)}</td><td className="px-3 py-2.5 text-right">{preciseMoney(totalNetPayroll)}</td><td className="px-3 py-2.5 text-right">{totalNetPayroll - previousNetPayroll > 0 ? '+' : ''}{preciseMoney(totalNetPayroll - previousNetPayroll)}</td></tr></tfoot>
        </table>
        {payrollComparisonRows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No processed payroll records exist in either period.</p>}
      </div>}
    </Card>

    {!loading && currentRecords.length === 0 && <Card className="border-dashed p-10 text-center"><BriefcaseBusiness className="mx-auto h-9 w-9 text-muted-foreground"/><h2 className="mt-3 font-semibold">Payroll has not been processed for this period</h2><p className="mt-1 text-sm text-muted-foreground">Attendance insights remain available, while payroll charts will populate after payroll records are generated.</p></Card>}

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <ChartCard title="Payroll Cost Trend" subtitle="Gross payroll across processed periods"><TrendChart data={trends} dataKey="payroll" color="#315ce8" formatter={compactMoney} onPeriod={selectTrendPeriod}/></ChartCard>
      <ChartCard title="Overtime Hours Trend" subtitle="Payroll-calculated approved OT hours"><TrendChart data={trends} dataKey="overtimeHours" color="#7c3aed" formatter={hours} onPeriod={selectTrendPeriod}/></ChartCard>
      <ChartCard title="Overtime Cost Trend" subtitle="Overtime amount stored in payroll records"><TrendChart data={trends} dataKey="overtimeCost" color="#9b43e6" formatter={compactMoney} onPeriod={selectTrendPeriod}/></ChartCard>
      <ChartCard title="Attendance Overview" subtitle="One status per employee and date"><Donut data={attendanceData} total={attendanceTotal} totalLabel="Attendance days" colors={Object.values(ATTENDANCE_COLORS)}/></ChartCard>
    </div>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <ChartCard title="Payroll Cost by Department" subtitle="Click a bar to filter the dashboard"><ResponsiveContainer width="100%" height={250}><BarChart data={departmentRows.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={compactMoney} tick={{ fontSize: 9 }}/><YAxis type="category" dataKey="department" width={85} tick={{ fontSize: 10 }}/><Tooltip formatter={value => money(value)}/><Bar dataKey="payroll" fill="#315ce8" radius={[0, 5, 5, 0]} cursor="pointer" onClick={row => setDepartment(row.department)}/></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Overtime Hours by Department" subtitle={`Red bars exceed ${OT_THRESHOLDS.criticalPercent}% of payroll`}><ResponsiveContainer width="100%" height={250}><BarChart data={[...departmentRows].sort((a,b) => b.otHours-a.otHours).slice(0,10)} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={hours} tick={{ fontSize: 9 }}/><YAxis type="category" dataKey="department" width={85} tick={{ fontSize: 10 }}/><Tooltip formatter={value => hours(value)}/><Bar dataKey="otHours" radius={[0,5,5,0]} cursor="pointer" onClick={row => setDepartment(row.department)}>{departmentRows.map(row => <Cell key={row.department} fill={row.otPercent > OT_THRESHOLDS.criticalPercent ? '#e54b4b' : '#8b5cf6'}/>)}</Bar></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Payroll vs Overtime" subtitle="Bubble size represents payroll-covered employees"><ResponsiveContainer width="100%" height={250}><ComposedChart margin={{ left: 4, right: 10 }}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" dataKey="payroll" name="Payroll" tickFormatter={compactMoney} tick={{fontSize:9}}/><YAxis type="number" dataKey="otHours" name="OT Hours" tickFormatter={hours} tick={{fontSize:9}}/><Tooltip cursor={{strokeDasharray:'3 3'}} formatter={(value,name) => name === 'Payroll' ? money(value) : hours(value)}/><Scatter data={departmentRows} fill="#315ce8" onClick={row => setDepartment(row.department)} shape={({cx,cy,payload}) => <g cursor="pointer"><circle cx={cx} cy={cy} r={Math.max(5, Math.min(18, 5 + payload.employees))} fill="#315ce8" fillOpacity=".72"/><text x={cx} y={cy-12-Math.min(10,payload.employees)} fontSize="9" textAnchor="middle">{payload.department}</text></g>}/></ComposedChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Payroll Composition" subtitle="Components of gross payroll"><Donut data={composition} total={money(totalPayroll)} totalLabel="Gross payroll"/></ChartCard>
    </div>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <Card className="overflow-hidden xl:col-span-2"><div className="border-b px-4 py-3"><h3 className="text-sm font-semibold">Department Summary</h3><p className="text-[11px] text-muted-foreground">Gross payroll and approved overtime performance</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr>{['Department','Employees','Basic Pay','Gross Payroll','OT Cost','OT Hours','Night Diff','Allowances','Average','OT %','Change','Action'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead><tbody>{departmentRows.map((row,index) => <tr key={row.department} className="border-t"><td className="px-3 py-2.5 font-semibold"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{background:COLORS[index%COLORS.length]}}/>{row.department}</td><td className="px-3 py-2.5">{row.employees}</td><td className="px-3 py-2.5">{money(row.basicPay)}</td><td className="px-3 py-2.5 font-semibold">{money(row.payroll)}</td><td className="px-3 py-2.5">{money(row.otCost)}</td><td className="px-3 py-2.5">{hours(row.otHours)}</td><td className="px-3 py-2.5">{money(row.nightDiff)}</td><td className="px-3 py-2.5">{money(row.allowances)}</td><td className="px-3 py-2.5">{money(row.average)}</td><td className={`px-3 py-2.5 font-semibold ${row.otPercent > 6 ? 'text-red-600' : row.otPercent >= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>{row.otPercent.toFixed(2)}%</td><td className="px-3 py-2.5">{row.change == null ? '—' : `${row.change >= 0 ? '+' : ''}${row.change.toFixed(1)}%`}</td><td className="px-3 py-2.5"><Button size="sm" variant="ghost" onClick={() => setSelectedDepartment(row)}><Eye className="mr-1 h-3.5 w-3.5"/>View</Button></td></tr>)}</tbody></table></div></Card>

      <Card className="p-4"><div className="mb-3"><h3 className="text-sm font-semibold">Top Employees by Overtime</h3><p className="text-[11px] text-muted-foreground">Approved OT requests for this period</p></div>{topOvertime.length === 0 ? <EmptyChart>No approved overtime exists for this period.</EmptyChart> : <div className="space-y-3">{topOvertime.map((row,index) => <button key={row.key} className="grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 text-left" onClick={() => setSelectedEmployee(row)}><span className="text-xs text-muted-foreground">{index+1}</span><div className="min-w-0"><div className="flex justify-between gap-2 text-xs"><span className="truncate font-medium">{fullName(row.employee) || row.requests[0]?.employee_name || row.key}</span><span>{hours(row.approvedHours)}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500" style={{width:`${row.approvedHours / (topOvertime[0]?.approvedHours || 1) * 100}%`}}/></div><p className="mt-0.5 text-[10px] text-muted-foreground">{row.employee?.department || 'Unassigned'} · {money(row.otCost)}</p></div><ChevronRight className="h-3.5 w-3.5 text-muted-foreground"/></button>)}</div>}</Card>

      <div className="space-y-4"><Card className="p-4"><h3 className="text-sm font-semibold">Payroll Budget</h3>{!budgetAmount ? <div className="flex h-32 flex-col items-center justify-center text-center"><WalletCards className="h-7 w-7 text-muted-foreground"/><p className="mt-2 text-sm font-medium">Payroll budget not configured</p><p className="text-[11px] text-muted-foreground">Add a per-period budget to the company settings.</p></div> : <div className="py-3 text-center"><p className={`text-3xl font-bold ${budgetPercent > 90 ? 'text-red-600' : budgetPercent >= 80 ? 'text-amber-600' : 'text-emerald-600'}`}>{budgetPercent.toFixed(0)}%</p><p className="text-xs text-muted-foreground">of budget used</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${budgetPercent > 90 ? 'bg-red-500' : budgetPercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width:`${Math.min(100,budgetPercent)}%`}}/></div><div className="mt-3 flex justify-between text-[11px]"><span>Current {money(totalPayroll)}</span><span>Budget {money(budgetAmount)}</span></div><p className="mt-1 text-[11px] text-muted-foreground">Remaining {money(Math.max(0,budgetAmount-totalPayroll))}</p></div>}</Card><Card className="border-blue-100 bg-blue-50/40 p-4"><h3 className="text-sm font-semibold">Executive Insights</h3><ul className="mt-3 space-y-2">{insights.length ? insights.map((item,index) => <li key={index} className="flex gap-2 text-[11px]"><span className="text-blue-600">✓</span><span>{item}</span></li>) : <li className="text-xs text-muted-foreground">Insights will appear when payroll data is available.</li>}</ul><p className="mt-4 text-[9px] text-muted-foreground">Generated on {new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></Card></div>
    </div>

    <Dialog open={showOvertimeDetails} onOpenChange={open => { setShowOvertimeDetails(open); if (!open) setOvertimeDepartment(null); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Overtime Cost — {periodLabel(selectedPeriod)}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Payroll-calculated approved overtime for processed payroll records{department !== 'all' ? ` · ${department}` : ''}.</p>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department Summary</p>{overtimeDepartment && <Button size="sm" variant="ghost" onClick={() => setOvertimeDepartment(null)}>Show all departments</Button>}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {departmentRows.filter(row => row.otHours > 0 || row.otCost > 0).map(row => <button key={row.department} onClick={() => setOvertimeDepartment(row.department)} className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:border-violet-400 hover:shadow-md ${overtimeDepartment === row.department ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-200' : 'bg-background'}`}><div className="flex items-center justify-between"><p className="font-semibold">{row.department}</p><ChevronRight className="h-4 w-4 text-muted-foreground"/></div><p className="mt-1 text-xs text-muted-foreground">{row.records.filter(record => Number(record.overtime_hours) > 0 || Number(record.overtime_pay) > 0).length} employee(s)</p><div className="mt-3 flex justify-between text-sm"><span className="font-bold text-violet-700">{hours(row.otHours)}</span><span className="font-bold text-violet-700">{money(row.otCost)}</span></div></button>)}
            <div className="rounded-lg border-2 border-violet-200 bg-violet-50 p-3"><p className="font-semibold">TOTAL</p><p className="mt-1 text-xs text-muted-foreground">{currentRecords.filter(record => Number(record.overtime_hours) > 0 || Number(record.overtime_pay) > 0).length} employee(s)</p><div className="mt-3 flex justify-between text-sm"><span className="font-bold text-violet-700">{hours(overtimeHours)}</span><span className="font-bold text-violet-700">{money(overtimeCost)}</span></div></div>
          </div>
        </div>
        <div className="max-h-[42vh] overflow-auto rounded-md border">
          <div className="sticky top-0 z-10 border-b bg-muted/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{overtimeDepartment ? `${overtimeDepartment} Computation: sum of employee approved OT hours and payroll-calculated OT pay` : 'Employee Computation Details'}</div>
          <table className="w-full text-sm"><thead className="sticky top-8 bg-muted"><tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Employee ID</th><th className="px-3 py-2 text-left">Department</th><th className="px-3 py-2 text-right">OT Hours</th><th className="px-3 py-2 text-right">OT Cost</th></tr></thead><tbody>{currentRecords.filter(record => (!overtimeDepartment || (record.department || 'Unassigned') === overtimeDepartment) && (Number(record.overtime_hours) > 0 || Number(record.overtime_pay) > 0)).map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2 font-medium">{record.employee_name || 'Unknown employee'}</td><td className="px-3 py-2 text-muted-foreground">{record.employee_id || '—'}</td><td className="px-3 py-2">{record.department || 'Unassigned'}</td><td className="px-3 py-2 text-right font-bold text-violet-700">{hours(record.overtime_hours)}</td><td className="px-3 py-2 text-right font-bold text-violet-700">{money(record.overtime_pay)}</td></tr>)}</tbody></table>
          {overtimeCost <= 0 && overtimeHours <= 0 && <p className="p-8 text-center text-sm text-muted-foreground">No approved overtime exists for this period.</p>}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-background pt-3"><p className="text-sm">Total: <strong className="text-violet-700">{hours(overtimeHours)} · {money(overtimeCost)}</strong></p><Button variant="outline" onClick={() => setShowOvertimeDetails(false)}>Close</Button></div>
      </DialogContent>
    </Dialog>

    <Dialog open={showNightDiffDetails} onOpenChange={open => { setShowNightDiffDetails(open); if (!open) setNightDiffDepartment(null); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Night Differential — {periodLabel(selectedPeriod)}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Night differential pay from processed payroll records{department !== 'all' ? ` · ${department}` : ''}.</p>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department Summary</p>{nightDiffDepartment && <Button size="sm" variant="ghost" onClick={() => setNightDiffDepartment(null)}>Show all departments</Button>}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {departmentRows.filter(row => row.nightDiff > 0).map(row => <button key={row.department} onClick={() => setNightDiffDepartment(row.department)} className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:border-orange-400 hover:shadow-md ${nightDiffDepartment === row.department ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200' : 'bg-background'}`}><div className="flex items-center justify-between"><p className="font-semibold">{row.department}</p><ChevronRight className="h-4 w-4 text-muted-foreground"/></div><p className="mt-1 text-xs text-muted-foreground">{row.records.filter(record => Number(record.night_diff_pay) > 0).length} employee(s)</p><p className="mt-3 text-lg font-bold text-orange-600">{money(row.nightDiff)}</p></button>)}
            <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-3"><p className="font-semibold">TOTAL</p><p className="mt-1 text-xs text-muted-foreground">{currentRecords.filter(record => Number(record.night_diff_pay) > 0).length} employee(s)</p><p className="mt-3 text-lg font-bold text-orange-600">{money(nightDiff)}</p></div>
          </div>
        </div>
        <div className="max-h-[42vh] overflow-auto rounded-md border">
          <div className="sticky top-0 z-10 border-b bg-muted/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{nightDiffDepartment ? `${nightDiffDepartment} Computation: sum of employee payroll-calculated night differential pay` : 'Employee Computation Details'}</div>
          <table className="w-full text-sm"><thead className="sticky top-8 bg-muted"><tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Employee ID</th><th className="px-3 py-2 text-left">Department</th><th className="px-3 py-2 text-right">Night Differential</th></tr></thead><tbody>{currentRecords.filter(record => (!nightDiffDepartment || (record.department || 'Unassigned') === nightDiffDepartment) && Number(record.night_diff_pay) > 0).map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2 font-medium">{record.employee_name || 'Unknown employee'}</td><td className="px-3 py-2 text-muted-foreground">{record.employee_id || '—'}</td><td className="px-3 py-2">{record.department || 'Unassigned'}</td><td className="px-3 py-2 text-right font-bold text-orange-600">{money(record.night_diff_pay)}</td></tr>)}</tbody></table>
          {nightDiff <= 0 && <p className="p-8 text-center text-sm text-muted-foreground">No night differential pay exists for this period.</p>}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-background pt-3"><p className="text-sm">Total night differential: <strong className="text-orange-600">{money(nightDiff)}</strong></p><Button variant="outline" onClick={() => setShowNightDiffDetails(false)}>Close</Button></div>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(selectedDepartment)} onOpenChange={open => !open && setSelectedDepartment(null)}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>{selectedDepartment?.department} Department Details</DialogTitle></DialogHeader>{selectedDepartment && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Card className="p-3"><p className="text-xs text-muted-foreground">Gross payroll</p><p className="font-bold">{money(selectedDepartment.payroll)}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">Employees</p><p className="font-bold">{selectedDepartment.employees}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">OT hours</p><p className="font-bold">{hours(selectedDepartment.otHours)}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">OT cost</p><p className="font-bold">{money(selectedDepartment.otCost)}</p></Card></div><div className="max-h-[55vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-right">Basic Pay</th><th className="px-3 py-2 text-right">OT Hours</th><th className="px-3 py-2 text-right">OT Cost</th><th className="px-3 py-2 text-right">Gross Pay</th></tr></thead><tbody>{selectedDepartment.records.map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2">{record.employee_name}<p className="text-xs text-muted-foreground">{record.employee_id}</p></td><td className="px-3 py-2 text-right">{money(record.basic_pay)}</td><td className="px-3 py-2 text-right">{hours(record.overtime_hours)}</td><td className="px-3 py-2 text-right">{money(record.overtime_pay)}</td><td className="px-3 py-2 text-right font-semibold">{money(record.gross_pay)}</td></tr>)}</tbody></table></div></div>}</DialogContent></Dialog>

    <Dialog open={Boolean(selectedKpi)} onOpenChange={open => !open && setSelectedKpi(null)}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>{{ payroll: 'Total Gross Payroll', overtime: 'Overtime Cost', nightDiff: 'Night Differential', employees: 'Payroll Employees', average: 'Average Gross Pay', comparison: 'Payroll vs Last Period' }[selectedKpi]} — {periodLabel(selectedPeriod)}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Processed payroll records for the selected payroll period{department !== 'all' ? ` · ${department}` : ''}.</p>{selectedKpi === 'comparison' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-muted-foreground">Current period</p><p className="text-xl font-bold">{money(totalPayroll)}</p><p className="text-xs">{periodLabel(selectedPeriod)}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Previous period</p><p className="text-xl font-bold">{previousPeriod ? money(previousPayroll) : '—'}</p><p className="text-xs">{previousPeriod ? periodLabel(previousPeriod) : 'No previous-period data'}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Difference</p><p className={`text-xl font-bold ${totalPayroll > previousPayroll ? 'text-red-600' : 'text-emerald-600'}`}>{previousPeriod ? money(totalPayroll - previousPayroll) : '—'}</p><p className="text-xs">{payrollChange == null ? 'Comparison unavailable' : `${payrollChange >= 0 ? '+' : ''}${payrollChange.toFixed(1)}%`}</p></Card></div>}
      <div className="overflow-x-auto rounded-md border"><div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department Summary</div><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted"><tr>{['Department','Employees','Basic Pay','OT Hours','OT Cost','Night Differential','Gross Pay','Net Pay'].map(label => <th key={label} className={`whitespace-nowrap px-3 py-2 ${label === 'Department' ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead><tbody>{departmentRows.map(row => <tr key={row.department} className="border-t"><td className="px-3 py-2 font-medium">{row.department}</td><td className="px-3 py-2 text-right">{row.employees}</td><td className="px-3 py-2 text-right">{money(row.basicPay)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'overtime' ? 'font-bold text-violet-700' : ''}`}>{hours(row.otHours)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'overtime' ? 'font-bold text-violet-700' : ''}`}>{money(row.otCost)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'nightDiff' ? 'font-bold text-orange-600' : ''}`}>{money(row.nightDiff)}</td><td className="px-3 py-2 text-right font-semibold">{money(row.payroll)}</td><td className="px-3 py-2 text-right font-semibold">{money(row.netPay)}</td></tr>)}</tbody><tfoot><tr className="border-t-2 bg-muted/60 font-bold"><td className="px-3 py-2">TOTAL</td><td className="px-3 py-2 text-right">{payrollEmployees}</td><td className="px-3 py-2 text-right">{money(sum(currentRecords, 'basic_pay'))}</td><td className="px-3 py-2 text-right">{hours(overtimeHours)}</td><td className="px-3 py-2 text-right">{money(overtimeCost)}</td><td className="px-3 py-2 text-right">{money(nightDiff)}</td><td className="px-3 py-2 text-right">{money(totalPayroll)}</td><td className="px-3 py-2 text-right">{money(totalNetPayroll)}</td></tr></tfoot></table></div>
      <div className="max-h-[42vh] overflow-auto rounded-md border"><div className="sticky top-0 z-10 border-b bg-muted/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employee Details</div><table className="w-full min-w-[980px] text-sm"><thead className="sticky top-8 bg-muted"><tr>{['Employee','Employee ID','Department','Basic Pay','OT Hours','OT Cost','Night Differential','Gross Pay','Net Pay'].map(label => <th key={label} className={`whitespace-nowrap px-3 py-2 ${label === 'Employee' || label === 'Employee ID' || label === 'Department' ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead><tbody>{currentRecords.map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2 font-medium">{record.employee_name || 'Unknown employee'}</td><td className="px-3 py-2 text-muted-foreground">{record.employee_id || '—'}</td><td className="px-3 py-2">{record.department || 'Unassigned'}</td><td className="px-3 py-2 text-right">{money(record.basic_pay)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'overtime' ? 'font-bold text-violet-700' : ''}`}>{hours(record.overtime_hours)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'overtime' ? 'font-bold text-violet-700' : ''}`}>{money(record.overtime_pay)}</td><td className={`px-3 py-2 text-right ${selectedKpi === 'nightDiff' ? 'font-bold text-orange-600' : ''}`}>{money(record.night_diff_pay)}</td><td className={`px-3 py-2 text-right ${['payroll','average','comparison'].includes(selectedKpi) ? 'font-bold text-blue-700' : 'font-semibold'}`}>{money(record.gross_pay)}</td><td className="px-3 py-2 text-right font-semibold">{money(record.net_pay)}</td></tr>)}</tbody></table>{currentRecords.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No processed payroll records exist for this period.</p>}</div><div className="flex flex-wrap justify-end gap-4 border-t pt-3 text-sm"><span>Employees: <strong>{payrollEmployees}</strong></span><span>OT cost: <strong>{money(overtimeCost)}</strong></span><span>Night differential: <strong>{money(nightDiff)}</strong></span><span>Gross: <strong>{money(totalPayroll)}</strong></span><span>Net: <strong>{money(totalNetPayroll)}</strong></span></div></DialogContent></Dialog>

    <Dialog open={Boolean(selectedEmployee)} onOpenChange={open => !open && setSelectedEmployee(null)}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Employee Overtime — {fullName(selectedEmployee?.employee) || selectedEmployee?.key}</DialogTitle></DialogHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Date','Department','Approved Hours','Status','Reason'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{selectedEmployee?.requests.map(request => <tr key={request.id} className="border-t"><td className="px-3 py-3">{request.date}</td><td className="px-3 py-3">{selectedEmployee.employee?.department || request.department || 'Unassigned'}</td><td className="px-3 py-3">{hours(request.approved_hours ?? request.requested_hours)}</td><td className="px-3 py-3"><Badge>{request.status}</Badge></td><td className="px-3 py-3">{request.reason || '—'}</td></tr>)}</tbody></table></div></DialogContent></Dialog>

    <Dialog open={showPendingOt} onOpenChange={setShowPendingOt}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Unprocessed Overtime Requests — {periodLabel(selectedPeriod)}</DialogTitle></DialogHeader><div className="mb-2 flex items-center justify-between"><p className="text-sm text-muted-foreground">These requests are not yet approved or denied and are excluded from approved overtime reporting.</p><Badge className="bg-amber-600">{pendingOt.length} pending review</Badge></div><div className="max-h-[65vh] overflow-auto rounded-md border"><table className="w-full min-w-[950px] text-sm"><thead className="sticky top-0 bg-muted"><tr>{['Employee','Employee ID','Department','OT Date','Requested Hours','Status','Reason','Submitted'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead><tbody>{pendingOt.map(request => { const employee = employeeMap.get(employeeKey(request)); const submitted = request.submitted_at || request.created_date || request.created_at; return <tr key={request.id} className="border-t"><td className="px-3 py-3 font-medium">{fullName(employee) || request.employee_name || 'Unknown employee'}</td><td className="px-3 py-3 text-muted-foreground">{employee?.employee_id || request.employee_id || '—'}</td><td className="px-3 py-3">{employee?.department || request.department || 'Unassigned'}</td><td className="px-3 py-3 whitespace-nowrap">{request.date || '—'}</td><td className="px-3 py-3 font-semibold">{hours(request.requested_hours)}</td><td className="px-3 py-3"><Badge variant="secondary" className="capitalize">{request.status || 'Pending'}</Badge></td><td className="max-w-xs px-3 py-3">{request.reason || '—'}</td><td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{submitted ? new Date(submitted).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td></tr>; })}</tbody></table></div></DialogContent></Dialog>

    <Dialog open={Boolean(attendanceDate)} onOpenChange={open => !open && setAttendanceDate(null)}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Incomplete Punches — {attendanceDate}</DialogTitle></DialogHeader><div className="max-h-[65vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr>{['Employee','Date','Time In(1)','Time Out(1)','Time In(2)','Time Out(2)','Status'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{incompleteLogs.filter(log => !attendanceDate || log.date === attendanceDate).map(log => <tr key={log.id} className="border-t"><td className="px-3 py-2">{log.employee_name || fullName(employeeMap.get(employeeKey(log)))}</td><td className="px-3 py-2">{log.date}</td><td className="px-3 py-2">{log.time_in ? formatManilaTime(log.time_in) : 'Missing'}</td><td className="px-3 py-2">{log.break_time_out ? formatManilaTime(log.break_time_out) : 'Missing'}</td><td className="px-3 py-2">{log.break_time_in ? formatManilaTime(log.break_time_in) : 'Missing'}</td><td className="px-3 py-2">{log.time_out ? formatManilaTime(log.time_out) : 'Missing'}</td><td className="px-3 py-2"><Badge variant="destructive">Incomplete</Badge></td></tr>)}</tbody></table></div></DialogContent></Dialog>
  </div>;
}
