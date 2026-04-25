import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CalendarDays } from 'lucide-react';
import { addWeeks, format, startOfWeek } from 'date-fns';

/**
 * Generates the week-by-week deduction schedule for a single cash advance.
 * Week 1 starts from the Monday on/after today.
 */
function buildWeekRows(ca) {
  const total = ca.deduction_payroll_periods || 1;
  const deducted = total - (ca.deduction_periods_remaining ?? total);
  const perWeek = ca.deduction_amount_per_payroll || 0;
  const startMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const rows = [];
  for (let i = 0; i < total; i++) {
    const weekStart = addWeeks(startMonday, i - deducted); // already-deducted weeks are in the past
    const weekLabel = `Week ${i + 1} (${format(weekStart, 'MMM d')})`;
    const isDone = i < deducted;
    rows.push({ weekLabel, perWeek, isDone, weekIndex: i });
  }
  return rows;
}

function AdvanceScheduleCard({ ca }) {
  const rows = buildWeekRows(ca);
  const totalRemaining = (ca.deduction_amount_per_payroll || 0) * (ca.deduction_periods_remaining || 0);
  const totalApproved = ca.amount_approved || ca.amount_requested || 0;

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{ca.reason}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="outline" className={`text-xs ${ca.advance_type === 'emergency' ? 'bg-orange-50 text-orange-700 border-orange-200' : ca.advance_type === 'worked_day' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
              {ca.advance_type === 'emergency' ? 'Emergency' : ca.advance_type === 'worked_day' ? 'Worked Day' : 'Regular'}
            </Badge>
            <span className="text-xs text-muted-foreground">Approved: ₱{totalApproved.toLocaleString()}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="font-bold text-amber-600 text-sm">₱{totalRemaining.toLocaleString()}</p>
        </div>
      </div>

      {/* Week-by-week timeline */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Payroll Week</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Deduction</th>
              <th className="text-center px-3 py-1.5 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.weekIndex} className={`border-b border-border last:border-0 ${row.isDone ? 'opacity-50' : ''}`}>
                <td className="px-3 py-1.5 text-foreground flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  {row.weekLabel}
                </td>
                <td className="px-3 py-1.5 text-right font-medium text-primary">
                  ₱{row.perWeek.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {row.isDone ? (
                    <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 text-xs font-medium">✓ Deducted</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 text-xs font-medium">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Full deduction schedule view — grouped by employee (for employer/admin use).
 * Pass employeeMode=true to show only one employee's advances (no employee grouping header).
 */
export default function DeductionScheduleView({ cashAdvances, employeeMode = false }) {
  const scheduled = cashAdvances.filter(ca => ca.status === 'approved' && ca.deduction_payroll_periods > 0);

  if (scheduled.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-30" />
        No active deduction schedules.
      </div>
    );
  }

  if (employeeMode) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">My Deduction Schedule</p>
        <Card className="border border-border shadow-sm p-4 space-y-4">
          {scheduled.map(ca => <AdvanceScheduleCard key={ca.id} ca={ca} />)}
        </Card>
      </div>
    );
  }

  // Group by employee
  const byEmployee = {};
  scheduled.forEach(ca => {
    if (!byEmployee[ca.employee_id]) byEmployee[ca.employee_id] = { name: ca.employee_name, department: ca.department, advances: [] };
    byEmployee[ca.employee_id].advances.push(ca);
  });
  const entries = Object.values(byEmployee);

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Deduction Schedules</p>
      {entries.map((emp, i) => {
        const totalRemaining = emp.advances.reduce((s, ca) => s + (ca.deduction_amount_per_payroll || 0) * (ca.deduction_periods_remaining || 0), 0);
        return (
          <Card key={i} className="border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
              <div>
                <p className="font-semibold text-foreground text-sm">{emp.name}</p>
                <p className="text-xs text-muted-foreground">{emp.department}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total balance</p>
                <p className="font-bold text-amber-600 text-sm">₱{totalRemaining.toLocaleString()}</p>
              </div>
            </div>
            <div className="p-4 space-y-5">
              {emp.advances.map(ca => <AdvanceScheduleCard key={ca.id} ca={ca} />)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}