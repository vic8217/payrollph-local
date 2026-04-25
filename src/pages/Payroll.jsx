import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, addWeeks, addDays } from 'date-fns';
import { Play, CheckCircle2, FileText, Printer, History, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCompany } from '@/lib/CompanyContext';
import { computeWeeklyPayroll } from '@/lib/payrollUtils';
import PayslipView from '@/components/payroll/PayslipView';
import GrossBreakdownDialog from '@/components/payroll/GrossBreakdownDialog';

const statusColors = {
  draft: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  released: 'bg-emerald-100 text-emerald-700',
};

export default function Payroll() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [reviewRecord, setReviewRecord] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [incompleteLogsError, setIncompleteLogsError] = useState(null); // { employeeName, date }[]
  const [pendingAttendanceError, setPendingAttendanceError] = useState(null); // { employeeName, count }[]
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();

  const baseWeek = new Date();
  // Week starts on Saturday (pay day), ends on Friday
  const weekStart = startOfWeek(addWeeks(baseWeek, weekOffset), { weekStartsOn: 6 });
  const weekEnd = addDays(weekStart, 6); // Saturday + 6 = Friday
  const startStr = format(weekStart, 'yyyy-MM-dd');
  const endStr = format(weekEnd, 'yyyy-MM-dd');

  const { data: periods = [] } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-created_date', 20),
    enabled: !!activeCompanyId,
  });

  const { data: records = [] } = useQuery({
    queryKey: ['payrollRecords', selectedPeriod?.id],
    queryFn: () => selectedPeriod
      ? appApi.entities.PayrollRecord.filter({ payroll_period_id: selectedPeriod.id, company_profile_id: activeCompanyId })
      : [],
    enabled: !!selectedPeriod && !!activeCompanyId,
  });

  const { data: employees = [] } = useQuery({ queryKey: ['employees', activeCompanyId], queryFn: () => appApi.entities.Employee.filter({ company_profile_id: activeCompanyId }, '-created_date', 200), enabled: !!activeCompanyId });
  const { data: holidays = [] } = useQuery({ queryKey: ['holidays', activeCompanyId], queryFn: () => appApi.entities.Holiday.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const { data: cashAdvances = [] } = useQuery({ queryKey: ['cashAdvances', activeCompanyId], queryFn: () => appApi.entities.CashAdvance.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });
  const { data: noWorkDays = [] } = useQuery({ queryKey: ['noWorkDays', activeCompanyId], queryFn: () => appApi.entities.NoWorkDay.filter({ company_profile_id: activeCompanyId }), enabled: !!activeCompanyId });

  const { data: periodAttendanceLogs = [] } = useQuery({
    queryKey: ['attendanceLogs', selectedPeriod?.start_date, selectedPeriod?.end_date, activeCompanyId],
    queryFn: async () => {
      const all = await appApi.entities.AttendanceLog.filter({ company_profile_id: activeCompanyId }, '-date', 1000);
      return all.filter(l => l.date >= selectedPeriod.start_date && l.date <= selectedPeriod.end_date);
    },
    enabled: !!selectedPeriod && !!activeCompanyId,
  });

  const approvePeriod = useMutation({
    mutationFn: ({ id, status }) => appApi.entities.PayrollPeriod.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payrollPeriods'] }),
  });

  const generatePayroll = async () => {
    if (weekStart > new Date()) return;
    setGenerating(true);
    setIncompleteLogsError(null);
    setPendingAttendanceError(null);
    const periodName = `Week of ${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

    // Pre-check: block if any employee has time_in but no time_out
    const allLogsForCheck = await appApi.entities.AttendanceLog.list('-date', 1000);
    const activeEmployeesForCheck = employees.filter(e => e.status === 'active');
    const incomplete = [];
    for (const emp of activeEmployeesForCheck) {
      const empLogs = allLogsForCheck.filter(l =>
        l.employee_id === emp.employee_id &&
        l.date >= startStr && l.date <= endStr &&
        (l.status === 'approved' || l.status === 'pending') &&
        !l.is_absent
      );
      for (const log of empLogs) {
        if (log.time_in && !log.time_out) {
          incomplete.push({ employeeName: `${emp.first_name} ${emp.last_name}`, date: log.date });
        }
      }
    }
    if (incomplete.length > 0) {
      setIncompleteLogsError(incomplete);
      setGenerating(false);
      return;
    }

    // Pre-check: block if any employee has pending attendance logs
    const pendingIssues = [];
    for (const emp of activeEmployeesForCheck) {
      const pendingLogs = allLogsForCheck.filter(l =>
        l.employee_id === emp.employee_id &&
        l.date >= startStr && l.date <= endStr &&
        l.status === 'pending'
      );
      if (pendingLogs.length > 0) {
        pendingIssues.push({ employeeName: `${emp.first_name} ${emp.last_name}`, count: pendingLogs.length });
      }
    }
    if (pendingIssues.length > 0) {
      setPendingAttendanceError(pendingIssues);
      setGenerating(false);
      return;
    }

    // Check if period already exists
    let period = periods.find(p => p.start_date === startStr && p.end_date === endStr);
    if (!period) {
      period = await appApi.entities.PayrollPeriod.create({
        period_name: periodName,
        start_date: startStr,
        end_date: endStr,
        status: 'processing',
        company_profile_id: activeCompanyId,
      });
    }

    const activeEmployees = employees.filter(e => e.status === 'active');
    const allLogs = await appApi.entities.AttendanceLog.list('-date', 1000);
    // Approved CAs that still have remaining deduction periods
    const approvedCA = cashAdvances.filter(ca =>
      ca.status === 'approved' && (ca.deduction_periods_remaining == null || ca.deduction_periods_remaining > 0)
    );

    // Block payroll if any approved CA is missing deduction setup
    const missingCASetup = [];
    for (const emp of activeEmployees) {
      const empCA = approvedCA.filter(ca => ca.employee_id === emp.employee_id);
      for (const ca of empCA) {
        if (!ca.deduction_payroll_periods || !ca.deduction_amount_per_payroll) {
          missingCASetup.push({ employeeName: `${emp.first_name} ${emp.last_name}`, caId: ca.id });
        }
      }
    }
    if (missingCASetup.length > 0) {
      setGenerating(false);
      setIncompleteLogsError(missingCASetup.map(m => ({ employeeName: m.employeeName, date: 'Cash advance missing deduction period/amount setup' })));
      return;
    }

    let totalGross = 0, totalDed = 0, totalNet = 0;

    for (const emp of activeEmployees) {
      const empLogs = allLogs.filter(l =>
        l.employee_id === emp.employee_id &&
        l.date >= startStr && l.date <= endStr &&
        (l.status === 'approved' || l.status === 'pending')
      );

      // Find all active CAs for this employee (can have multiple)
      const empCAs = approvedCA.filter(ca => ca.employee_id === emp.employee_id);
      // Sum up the per-payroll deduction amounts for this period
      const caDeductionThisPeriod = empCAs.reduce((sum, ca) => sum + (ca.deduction_amount_per_payroll || 0), 0);

      const periodHolidays = holidays.filter(h => h.date >= startStr && h.date <= endStr);
      const periodNoWorkDays = noWorkDays.filter(d => d.date >= startStr && d.date <= endStr);
      const computed = computeWeeklyPayroll(emp, empLogs, periodHolidays, caDeductionThisPeriod, periodNoWorkDays);

      // Upsert payroll record
      const existing = await appApi.entities.PayrollRecord.filter({ payroll_period_id: period.id, employee_id: emp.employee_id });
      const recordData = {
        payroll_period_id: period.id,
        period_name: periodName,
        employee_id: emp.employee_id,
        employee_name: `${emp.first_name} ${emp.last_name}`,
        department: emp.department,
        status: 'draft',
        company_profile_id: activeCompanyId,
        ...computed,
      };

      if (existing.length > 0) {
        await appApi.entities.PayrollRecord.update(existing[0].id, recordData);
      } else {
        await appApi.entities.PayrollRecord.create(recordData);
      }

      // Decrement remaining periods for each CA; mark as 'deducted' when exhausted
      for (const ca of empCAs) {
        const remaining = (ca.deduction_periods_remaining != null ? ca.deduction_periods_remaining : ca.deduction_payroll_periods) - 1;
        const newStatus = remaining <= 0 ? 'deducted' : 'approved';
        await appApi.entities.CashAdvance.update(ca.id, {
          deduction_periods_remaining: remaining,
          status: newStatus,
          payroll_period_id: remaining <= 0 ? period.id : ca.payroll_period_id,
        });
      }

      totalGross += computed.gross_pay;
      totalDed += computed.total_deductions;
      totalNet += computed.net_pay;
    }

    await appApi.entities.PayrollPeriod.update(period.id, {
      total_gross: parseFloat(totalGross.toFixed(2)),
      total_deductions: parseFloat(totalDed.toFixed(2)),
      total_net: parseFloat(totalNet.toFixed(2)),
      employee_count: activeEmployees.length,
    });

    qc.invalidateQueries({ queryKey: ['payrollPeriods'] });
    setSelectedPeriod({ ...period });
    setGenerating(false);
  };

  // Current week period
  const currentWeekPeriod = periods.find(p => p.start_date === startStr && p.end_date === endStr);
  // Previous periods (excluding current week)
  const previousPeriods = periods.filter(p => !(p.start_date === startStr && p.end_date === endStr))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setIncompleteLogsError(null); setShowHistory(true); }}>
            <History className="w-4 h-4" /> Previous Weeks
          </Button>
          <Button
            onClick={generatePayroll}
            disabled={generating || (!!currentWeekPeriod && currentWeekPeriod.status !== 'approved' && currentWeekPeriod.status !== 'released')}
            className="gap-2"
            title={currentWeekPeriod && currentWeekPeriod.status === 'processing' ? 'Approve the current payroll period before regenerating' : undefined}
          >
            <Play className="w-4 h-4" /> {generating ? 'Processing...' : 'Generate Payroll'}
          </Button>
        </div>
      </div>

      {/* Pending attendance error */}
      {pendingAttendanceError && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-700 font-semibold text-sm">⚠️ Cannot Generate Payroll — Attendance Pending Approval</span>
          </div>
          <p className="text-xs text-amber-700/80">The following employees have attendance logs that are still pending approval. Please approve or reject their attendance before generating payroll:</p>
          <ul className="text-xs text-amber-800 space-y-1 ml-3">
            {pendingAttendanceError.map((item, i) => (
              <li key={i} className="list-disc">{item.employeeName} — {item.count} pending log{item.count > 1 ? 's' : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Incomplete logs error */}
      {incompleteLogsError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-destructive font-semibold text-sm">⚠️ Cannot Generate Payroll — Missing Time-Out</span>
          </div>
          <p className="text-xs text-destructive/80">The following employees have a time-in but no time-out. Please complete their attendance logs before generating payroll:</p>
          <ul className="text-xs text-destructive space-y-1 ml-3">
            {incompleteLogsError.map((item, i) => (
              <li key={i} className="list-disc">{item.employeeName} — {item.date}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Current week period card */}
      {currentWeekPeriod && (
        <div
          className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedPeriod?.id === currentWeekPeriod.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}
          onClick={() => setSelectedPeriod(currentWeekPeriod)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">{currentWeekPeriod.period_name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {currentWeekPeriod.employee_count || 0} employees · Net ₱{(currentWeekPeriod.total_net || 0).toLocaleString()}
              </p>
            </div>
            <Badge variant="outline" className={`text-xs capitalize ${statusColors[currentWeekPeriod.status]}`}>{currentWeekPeriod.status}</Badge>
          </div>
        </div>
      )}

      {/* History Drawer */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-80 h-full bg-card shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <p className="font-semibold text-foreground">Previous Weeks</p>
              <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {previousPeriods.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No previous periods</p>}
              {previousPeriods.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPeriod(p); setShowHistory(false); }}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${selectedPeriod?.id === p.id ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/40'}`}
                >
                  <p className="text-sm font-medium text-foreground">{p.period_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Net ₱{(p.total_net || 0).toLocaleString()}</p>
                  <Badge variant="outline" className={`text-xs mt-1 capitalize ${statusColors[p.status]}`}>{p.status}</Badge>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Payroll Records */}
      <div>
          {selectedPeriod ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{selectedPeriod.period_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {records.length} employees · Gross ₱{(selectedPeriod.total_gross || 0).toLocaleString()} · Net ₱{(selectedPeriod.total_net || 0).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {selectedPeriod.status === 'processing' && (() => {
                    const hasPendingAny = periodAttendanceLogs.some(l => l.status === 'pending');
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approvePeriod.mutate({ id: selectedPeriod.id, status: 'approved' })}
                        className="gap-1"
                        disabled={hasPendingAny}
                        title={hasPendingAny ? 'Some employees still have pending attendance logs' : undefined}
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </Button>
                    );
                  })()}
                  {selectedPeriod.status === 'approved' && (
                    <Button size="sm" onClick={() => approvePeriod.mutate({ id: selectedPeriod.id, status: 'released' })} className="gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Release
                    </Button>
                  )}
                </div>
              </div>

              <Card className="border border-border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gross</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cash Advance</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Deductions</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                       <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No payroll records. Click "Generate Payroll" to compute.</td></tr>
                      ) : records.map(rec => {
                       const hasPending = periodAttendanceLogs.some(l => l.employee_id === rec.employee_id && l.status === 'pending');
                       return (
                       <tr key={rec.id} className={`border-b border-border last:border-0 hover:bg-muted/20 ${hasPending ? 'bg-amber-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <p className="font-medium text-foreground">{rec.employee_name}</p>
                           <p className="text-xs text-muted-foreground">{rec.department}</p>
                           {hasPending && (
                             <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 mt-1">
                               ⚠️ Attendance needs approval
                             </span>
                           )}
                         </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground">₱{(rec.gross_pay || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            {(rec.cash_advance_deduction || 0) > 0
                              ? <span className="text-destructive font-medium">-₱{(rec.cash_advance_deduction).toLocaleString()}</span>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right text-destructive">₱{(rec.total_deductions || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-bold text-foreground">₱{(rec.net_pay || 0).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs capitalize ${statusColors[rec.status]}`}>{rec.status}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {!hasPending && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" onClick={() => setReviewRecord(rec)}>
                                    <Search className="w-3 h-3" /> Review
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedRecord(rec)}>
                                    <Printer className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                        })}
                        </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Generate payroll for this week or select a previous period</p>
            </div>
          )}
      </div>

      {/* Payslip Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payslip</DialogTitle></DialogHeader>
          {selectedRecord && <PayslipView record={selectedRecord} />}
        </DialogContent>
      </Dialog>

      {/* Gross Breakdown Review Dialog */}
      <GrossBreakdownDialog
        record={reviewRecord}
        open={!!reviewRecord}
        onClose={() => setReviewRecord(null)}
      />
    </div>
  );
}