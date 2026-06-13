// @ts-nocheck
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Wallet, CreditCard, Trophy, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useCompany } from '@/lib/CompanyContext';
import { manilaDateString } from '@/lib/dateUtils';

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
    queryFn: () => appApi.entities.AttendanceLog.filter({ company_profile_id: activeCompanyId, date: manilaDateString() }),
    enabled: !!activeCompanyId,
  });

  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const presentToday = todayAttendance.filter(a => a.time_in && !a.is_absent).length;
  const pendingCA = cashAdvances.filter(ca => ca.status === 'pending' || ca.status === 'approved_by_manager').length;
  const latestPayroll = payrollPeriods[0];

  const statusColors = {
    draft: 'bg-muted text-muted-foreground',
    processing: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    released: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
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

      {/* Quick Access */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick Access</p>
        <Link to="/payroll-summary">
          <Button variant="outline" className="gap-2 w-full sm:w-auto border-primary/30 text-primary hover:bg-primary/5">
            <FileText className="w-4 h-4" /> View Approved Payroll Summary
          </Button>
        </Link>
      </div>

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
