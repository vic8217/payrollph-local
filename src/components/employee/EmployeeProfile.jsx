import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { User, Clock, FileText, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EmployeeAttendance from './EmployeeAttendance';
import EmployeePayslips from './EmployeePayslips';
import DeductionScheduleView from '@/components/cashadvance/DeductionScheduleView';



export default function EmployeeProfile({ employee }) {
  const [subTab, setSubTab] = useState('info');
  const [showDeductionSchedule, setShowDeductionSchedule] = useState(false);

  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['myCashAdvances', employee?.employee_id],
    queryFn: () => appApi.entities.CashAdvance.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
  });

  if (!employee) return (
    <div className="p-6 text-center text-muted-foreground text-sm">
      <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p>Scan your QR code first to view your profile.</p>
    </div>
  );

  const activeCA = cashAdvances.filter(ca => ['pending', 'approved_by_manager', 'approved'].includes(ca.status));
  const totalBalance = activeCA.reduce((sum, ca) => sum + (ca.amount_approved || ca.amount_requested || 0), 0);
  const maxAllowed = employee?.max_cash_advance || 0;

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
                    <span>Balance used</span>
                    <span>Max: ₱{maxAllowed.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${totalBalance >= maxAllowed ? 'bg-red-500' : 'bg-primary'}`}
                      style={{ width: `${Math.min(100, (totalBalance / maxAllowed) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Available: ₱{Math.max(0, maxAllowed - totalBalance).toLocaleString()}
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

          {/* Employee Info */}
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
        </div>
      )}

      {subTab === 'attendance' && <EmployeeAttendance employee={employee} />}
      {subTab === 'payslips' && <EmployeePayslips employee={employee} />}
    </div>
  );
}