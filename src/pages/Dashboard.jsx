// @ts-nocheck
import { appApi, requestJson } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Wallet, CreditCard, Trophy, FileText, Timer, AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { manilaDateString } from '@/lib/dateUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useState } from 'react';

function StatCard({ title, value, icon: Icon, color, sub }) {
  return (
    <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-3 sm:p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">{title}</p>
            <p className="text-xl sm:text-2xl font-bold text-foreground mt-1 truncate">{value}</p>
            {sub && <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 leading-tight">{sub}</p>}
          </div>
          <div className={`p-2 sm:p-2.5 rounded-xl flex-shrink-0 ${color}`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const [showSystemHealth, setShowSystemHealth] = useState(false);
  const systemHealthQuery = useQuery({ queryKey: ['system-health'], queryFn: () => requestJson('/api/admin/system-health'), enabled: user?.role === 'super_admin', staleTime: 60 * 1000 });
  const formatBytes = value => { const n = Number(value || 0); if (!n) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1); return `${(n / 1024 ** i).toFixed(i ? 2 : 0)} ${units[i]}`; };
  const [showApprovedOt, setShowApprovedOt] = useState(false);
  const [showAttendanceExceptions, setShowAttendanceExceptions] = useState(false);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });
  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['cashAdvances', activeCompanyId],
    queryFn: () => appApi.entities.CashAdvance.filter({ company_profile_id: activeCompanyId }, '-created_date', 500),
    enabled: !!activeCompanyId,
  });
  const { data: payrollPeriods = [] } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-created_date', 5),
    enabled: !!activeCompanyId,
  });
  const { data: todayAttendance = [] } = useQuery({
    queryKey: ['todayAttendance', activeCompanyId],
    queryFn: () => appApi.entities.AttendanceLog.allPages(
      { company_profile_id: activeCompanyId, date: manilaDateString() },
      'date',
      { pageSize: 200 },
    ),
    enabled: !!activeCompanyId,
  });

  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const presentToday = todayAttendance.filter(a => a.time_in && !a.is_absent).length;
  const pendingCA = cashAdvances.filter(ca => ca.status === 'pending' || ca.status === 'approved_by_manager').length;
  const latestPayroll = payrollPeriods[0];
  const previousPayroll = payrollPeriods[1];
  const { data: latestOtRecords = [] } = useQuery({
    queryKey: ['dashboard-approved-ot', activeCompanyId, latestPayroll?.id],
    queryFn: () => appApi.entities.PayrollRecord.filter({ company_profile_id: activeCompanyId, payroll_period_id: latestPayroll.id }, 'employee_name', 500),
    enabled: !!activeCompanyId && !!latestPayroll?.id,
  });
  const { data: previousOtRecords = [] } = useQuery({
    queryKey: ['dashboard-approved-ot-previous', activeCompanyId, previousPayroll?.id],
    queryFn: () => appApi.entities.PayrollRecord.filter({ company_profile_id: activeCompanyId, payroll_period_id: previousPayroll.id }, 'employee_name', 500),
    enabled: !!activeCompanyId && !!previousPayroll?.id,
  });
  const approvedOt = latestOtRecords.filter(record => Number(record.overtime_hours) > 0);
  const previousApprovedOt = previousOtRecords.filter(record => Number(record.overtime_hours) > 0);
  const otHours = approvedOt.reduce((sum, record) => sum + (Number(record.overtime_hours) || 0), 0);
  const previousOtHours = previousApprovedOt.reduce((sum, record) => sum + (Number(record.overtime_hours) || 0), 0);
  const otAmount = approvedOt.reduce((sum, record) => sum + (Number(record.overtime_pay) || 0), 0);
  const previousOtAmount = previousApprovedOt.reduce((sum, record) => sum + (Number(record.overtime_pay) || 0), 0);
  const periodFilter = period => period ? { company_profile_id: activeCompanyId, date: { $gte: period.start_date, $lte: period.end_date } } : null;
  const { data: currentAttendancePeriod = [] } = useQuery({
    queryKey: ['dashboard-attendance-period', activeCompanyId, latestPayroll?.id],
    queryFn: () => appApi.entities.AttendanceLog.allPages(periodFilter(latestPayroll), 'date', { pageSize: 500 }),
    enabled: !!activeCompanyId && !!latestPayroll?.start_date && !!latestPayroll?.end_date,
  });
  const { data: previousAttendancePeriod = [] } = useQuery({
    queryKey: ['dashboard-attendance-period-previous', activeCompanyId, previousPayroll?.id],
    queryFn: () => appApi.entities.AttendanceLog.allPages(periodFilter(previousPayroll), 'date', { pageSize: 500 }),
    enabled: !!activeCompanyId && !!previousPayroll?.start_date && !!previousPayroll?.end_date,
  });
  const isAbsent = record => Boolean(record.is_absent || record.status === 'absent' || record.day_type === 'absent');
  const isLate = record => (Number(record.late_minutes) || 0) > 0;
  const currentLate = currentAttendancePeriod.filter(isLate);
  const previousLate = previousAttendancePeriod.filter(isLate);
  const currentAbsent = currentAttendancePeriod.filter(isAbsent);
  const previousAbsent = previousAttendancePeriod.filter(isAbsent);

  const statusColors = {
    draft: 'bg-muted text-muted-foreground',
    processing: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    released: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="w-full p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard title="Active Employees" value={activeEmployees} icon={Users} color="bg-primary" sub="Total workforce" />
        <StatCard title="Present Today" value={presentToday} icon={Clock} color="bg-emerald-500" sub={`Out of ${activeEmployees}`} />
        <StatCard title="Pending Vale" value={pendingCA} icon={CreditCard} color="bg-amber-500" sub="Needs approval" />
        <StatCard
          title="Latest Payroll"
          value={latestPayroll ? `₱${(latestPayroll.total_net || 0).toLocaleString()}` : '—'}
          icon={Wallet}
          color="bg-violet-500"
          sub={latestPayroll?.period_name || 'No payroll yet'}
        />
      </div>
      {user?.role === 'super_admin' && <section><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Health</p><Button variant="ghost" size="sm" onClick={() => systemHealthQuery.refetch()}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${systemHealthQuery.isFetching ? 'animate-spin' : ''}`} />Refresh</Button></div><div className="grid gap-3 sm:grid-cols-2"><Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-primary" />Database</p>{systemHealthQuery.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Checking database...</p> : systemHealthQuery.isError ? <p className="mt-3 text-sm text-red-600">Database status unavailable</p> : <><p className="mt-2 text-sm font-semibold capitalize text-emerald-700">● {systemHealthQuery.data?.database?.status}</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>Size<br/><b>{formatBytes(systemHealthQuery.data?.database?.sizeBytes)}</b></span><span>Connections<br/><b>{systemHealthQuery.data?.database?.activeConnections} / {systemHealthQuery.data?.database?.maxConnections}</b></span><span>Utilization<br/><b>{systemHealthQuery.data?.database?.connectionUtilizationPercent}%</b></span><span>Largest table<br/><b>{systemHealthQuery.data?.database?.tables?.[0]?.name || '—'}</b></span></div><Button variant="link" className="mt-2 h-auto p-0 text-xs" onClick={() => setShowSystemHealth(true)}>View Details</Button></>}</CardContent></Card><Card><CardContent className="p-4"><p className="text-sm font-semibold">Application</p><p className="mt-2 text-sm font-semibold text-emerald-700">● Online</p><p className="mt-1 text-xs text-muted-foreground">Database connectivity and application runtime responding.</p></CardContent></Card></div></section>}
      <Dialog open={showSystemHealth} onOpenChange={setShowSystemHealth}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>System Health Details</DialogTitle></DialogHeader>{systemHealthQuery.data && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><Card className="p-3"><p className="text-xs text-muted-foreground">Database size</p><p className="font-semibold">{formatBytes(systemHealthQuery.data.database.sizeBytes)}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">Connections</p><p className="font-semibold">{systemHealthQuery.data.database.activeConnections} / {systemHealthQuery.data.database.maxConnections}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">Utilization</p><p className="font-semibold">{systemHealthQuery.data.database.connectionUtilizationPercent}%</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">Last checked</p><p className="font-semibold">{new Date(systemHealthQuery.data.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}</p></Card></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Table','Estimated Rows','Data','Indexes','Total'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{(systemHealthQuery.data.database.tables || []).map(table => <tr key={table.name} className="border-t"><td className="px-3 py-2 font-medium">{table.name}</td><td className="px-3 py-2">{table.estimatedRows.toLocaleString()}</td><td className="px-3 py-2">{formatBytes(table.dataBytes)}</td><td className="px-3 py-2">{formatBytes(table.indexBytes)}</td><td className="px-3 py-2 font-semibold">{formatBytes(table.totalBytes)}</td></tr>)}</tbody></table></div></div>}</DialogContent></Dialog>

      {/* Quick Access */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick Access</p>
        <Link to="/payroll-summary">
          <Button variant="outline" className="gap-2 w-full sm:w-auto border-primary/30 text-primary hover:bg-primary/5">
            <FileText className="w-4 h-4" /> View Approved Payroll Summary
          </Button>
        </Link>
        {user?.role === 'super_admin' && <Link to="/payroll?override=1"><Button variant="outline" className="ml-2 gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"><AlertTriangle className="w-4 h-4" /> Override Payroll Release Block</Button></Link>}
        <Button variant="outline" className="ml-2 gap-2 border-primary/30 text-primary hover:bg-primary/5" onClick={() => setShowApprovedOt(true)}>
          <Timer className="w-4 h-4" /> Approved OT Details
        </Button>
        <Button variant="outline" className="ml-2 gap-2 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => setShowAttendanceExceptions(true)}>
          <AlertTriangle className="w-4 h-4" /> Late & Absent Details
        </Button>
      </div>

      <Card className="border border-border shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4 text-violet-600" /> Approved Overtime</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Current period OT</p><p className="text-2xl font-bold">{otHours.toFixed(2)} hrs</p><p className="text-xs text-muted-foreground">{latestPayroll?.period_name || 'No payroll period'}</p></div>
            <div><p className="text-xs text-muted-foreground">Previous period OT</p><p className="text-2xl font-bold">{previousOtHours.toFixed(2)} hrs</p><p className="text-xs text-muted-foreground">{previousPayroll?.period_name || 'No previous period'}</p></div>
            <div><p className="text-xs text-muted-foreground">OT amount equivalent</p><p className="text-2xl font-bold text-violet-700">₱{otAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p><p className={`text-xs ${otHours >= previousOtHours ? 'text-emerald-600' : 'text-amber-600'}`}>{otHours >= previousOtHours ? '▲' : '▼'} {Math.abs(otHours - previousOtHours).toFixed(2)} hrs vs previous period</p></div>
          </div>
          <div className="mt-4 space-y-2"><p className="text-xs font-medium text-muted-foreground">OT hours comparison</p>{[[latestPayroll?.period_name || 'Current', otHours, 'bg-violet-500'], [previousPayroll?.period_name || 'Previous', previousOtHours, 'bg-slate-400']].map(([label, value, color]) => <div key={label} className="flex items-center gap-3 text-xs"><span className="w-28 truncate">{label}</span><div className="h-5 flex-1 rounded bg-muted"><div className={`h-5 rounded ${color}`} style={{ width: `${Math.max(value / Math.max(otHours, previousOtHours, 1) * 100, value ? 4 : 0)}%` }} /></div><span className="w-16 text-right font-semibold">{Number(value).toFixed(2)}h</span></div>)}</div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-500" /> Late & Absent Comparison</CardTitle></CardHeader>
        <CardContent><div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Late records</p><p className="text-2xl font-bold">{currentLate.length}</p><p className="text-xs text-muted-foreground">Previous period: {previousLate.length}</p></div><div><p className="text-xs text-muted-foreground">Absent records</p><p className="text-2xl font-bold">{currentAbsent.length}</p><p className="text-xs text-muted-foreground">Previous period: {previousAbsent.length}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['Late', currentLate.length, previousLate.length, 'bg-amber-500'], ['Absent', currentAbsent.length, previousAbsent.length, 'bg-red-500']].map(([label, current, previous, color]) => <div key={label}><p className="mb-1 text-xs font-medium text-muted-foreground">{label} · current / previous</p><div className="flex items-center gap-2"><div className="h-5 flex-1 rounded bg-muted"><div className={`h-5 rounded ${color}`} style={{ width: `${Math.max(current / Math.max(current, previous, 1) * 100, current ? 4 : 0)}%` }} /></div><span className="w-20 text-right text-xs font-semibold">{current} / {previous}</span></div></div>)}</div></CardContent>
      </Card>

      <Dialog open={showAttendanceExceptions} onOpenChange={setShowAttendanceExceptions}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Late and Absent Details</DialogTitle></DialogHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Name','Employee No.','Payroll Period','Status','Late Minutes'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{[...currentLate.map(record => ({ ...record, exception: 'Late' })), ...currentAbsent.map(record => ({ ...record, exception: 'Absent' }))].map(record => <tr key={`${record.id}-${record.exception}`} className="border-t"><td className="px-3 py-2 font-medium">{record.employee_name || '—'}</td><td className="px-3 py-2">{record.employee_id || '—'}</td><td className="px-3 py-2">{latestPayroll?.period_name || '—'}</td><td className={`px-3 py-2 font-semibold ${record.exception === 'Absent' ? 'text-red-600' : 'text-amber-600'}`}>{record.exception}</td><td className="px-3 py-2">{record.exception === 'Late' ? Number(record.late_minutes || 0) : '—'}</td></tr>)}{!currentLate.length && !currentAbsent.length && <tr><td colSpan="5" className="px-3 py-6 text-center text-muted-foreground">No late or absent records in the current payroll period.</td></tr>}</tbody></table></div></DialogContent></Dialog>

      <Dialog open={showApprovedOt} onOpenChange={setShowApprovedOt}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Approved Overtime Details</DialogTitle></DialogHeader><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Card className="p-3"><p className="text-xs text-muted-foreground">Current period</p><p className="font-semibold">{latestPayroll?.period_name || '—'}</p><p className="text-sm">{otHours.toFixed(2)} hours · ₱{otAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p></Card><Card className="p-3"><p className="text-xs text-muted-foreground">Previous period</p><p className="font-semibold">{previousPayroll?.period_name || '—'}</p><p className="text-sm">{previousOtHours.toFixed(2)} hours · ₱{previousOtAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p></Card></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Name','Employee No.','Payroll Period','OT Hours Approved','OT Amount Equivalent'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{approvedOt.map(record => <tr key={record.id} className="border-t"><td className="px-3 py-2 font-medium">{record.employee_name || '—'}</td><td className="px-3 py-2">{record.employee_id || '—'}</td><td className="px-3 py-2">{latestPayroll?.period_name || '—'}</td><td className="px-3 py-2">{Number(record.overtime_hours).toFixed(2)}</td><td className="px-3 py-2">₱{Number(record.overtime_pay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>)}{!approvedOt.length && <tr><td colSpan="5" className="px-3 py-6 text-center text-muted-foreground">No approved overtime in the current payroll period.</td></tr>}</tbody></table></div></div></DialogContent></Dialog>

      {/* Cash Advance Leaderboard */}
      {(() => {
        const activeStatuses = ['pending', 'approved_by_manager', 'approved_by_hr', 'approved'];
        const byEmployee = {};
        cashAdvances.filter(ca => activeStatuses.includes(ca.status)).forEach(ca => {
          if (!byEmployee[ca.employee_id]) byEmployee[ca.employee_id] = { name: ca.employee_name, department: ca.department, regular: 0, emergency: 0 };
          const amt = ca.remaining_balance != null ? ca.remaining_balance : (ca.amount_approved || ca.amount_requested || 0);
          if (ca.advance_type === 'emergency') byEmployee[ca.employee_id].emergency += amt;
          else byEmployee[ca.employee_id].regular += amt;
        });
        employees.forEach(employee => {
          const beginningBalance = parseFloat(employee.cash_advance_beginning_balance) || 0;
          if (beginningBalance <= 0) return;

          const hasBeginningCashAdvanceRecord = cashAdvances.some(ca =>
            ca.employee_id === employee.employee_id &&
            ca.advance_type === 'beginning_balance' &&
            activeStatuses.includes(ca.status)
          );
          if (hasBeginningCashAdvanceRecord) return;

          if (!byEmployee[employee.employee_id]) {
            byEmployee[employee.employee_id] = {
              name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
              department: employee.department,
              regular: 0,
              emergency: 0,
            };
          }
          byEmployee[employee.employee_id].regular += beginningBalance;
        });
        const leaderboard = Object.values(byEmployee)
          .map(e => ({ ...e, total: e.regular + e.emergency }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10);

        if (leaderboard.length === 0) return null;

        const rankColors = ['text-yellow-500', 'text-slate-400', 'text-amber-600'];
        const rankBg = ['bg-yellow-50 border-yellow-200', 'bg-slate-50 border-slate-200', 'bg-amber-50 border-amber-200'];

        return (
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" /> Top Cash Advance — Active Balances
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Employee</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Regular</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Emergency</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((emp, idx) => (
                      <tr key={idx} className={`border-b border-border last:border-0 ${idx < 3 ? rankBg[idx] : 'hover:bg-muted/20'}`}>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`font-bold text-sm ${idx < 3 ? rankColors[idx] : 'text-muted-foreground'}`}>
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{emp.name}</p>
                          <p className="text-xs text-muted-foreground">{emp.department}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-blue-700">
                          {emp.regular > 0 ? `₱${emp.regular.toLocaleString()}` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-orange-600">
                          {emp.emergency > 0 ? `₱${emp.emergency.toLocaleString()}` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-foreground">₱{emp.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Recent Cash Advance Requests */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" /> Recent Vale Requests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cashAdvances.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No vale requests yet</p>
            ) : (
              cashAdvances.slice(0, 5).map(ca => (
                <div key={ca.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{ca.employee_name}</p>
                    <p className="text-xs text-muted-foreground">{ca.reason?.slice(0, 40)}...</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">₱{ca.amount_requested?.toLocaleString()}</p>
                    <Badge variant="outline" className={`text-xs ${statusColors[ca.status] || ''}`}>
                      {ca.status?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Payroll Periods */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" /> Recent Payroll Periods
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {payrollPeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No payroll periods yet</p>
            ) : (
              payrollPeriods.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.period_name}</p>
                    <p className="text-xs text-muted-foreground">{p.start_date} – {p.end_date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">₱{(p.total_net || 0).toLocaleString()}</p>
                    <Badge variant="outline" className={`text-xs capitalize ${statusColors[p.status] || ''}`}>
                      {p.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
