import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PayslipView from '@/components/payroll/PayslipView';

const statusColors = {
  draft: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  released: 'bg-emerald-100 text-emerald-700',
};

function PeriodCard({ period, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const { data: records = [] } = useQuery({
    queryKey: ['payrollRecords', period.id],
    queryFn: () => appApi.entities.PayrollRecord.filter({ payroll_period_id: period.id }),
    enabled: open,
  });

  return (
    <Card className="border border-border shadow-sm">
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">{period.period_name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {period.employee_count || 0} employees · Gross ₱{(period.total_gross || 0).toLocaleString()} · Net ₱{(period.total_net || 0).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs capitalize ${statusColors[period.status]}`}>
              {period.status}
            </Badge>
            {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Employee</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Gross</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Deductions</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Net Pay</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-sm">No records found.</td></tr>
                ) : records.map(rec => (
                  <tr key={rec.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{rec.employee_name}</p>
                      <p className="text-xs text-muted-foreground">{rec.department}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-foreground">₱{(rec.gross_pay || 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-destructive">₱{(rec.total_deductions || 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-foreground">₱{(rec.net_pay || 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedRecord(rec)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}

      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payslip</DialogTitle></DialogHeader>
          {selectedRecord && <PayslipView record={selectedRecord} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function PayrollSummary() {
  const [showAll, setShowAll] = useState(false);
  const { activeCompanyId, activeCompany } = useCompany();

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-start_date', 50),
    enabled: !!activeCompanyId,
  });

  const currentPeriodConfig = getPayrollPeriodForDate(new Date(), activeCompany);
  const startStr = currentPeriodConfig.start_date;
  const endStr = currentPeriodConfig.end_date;

  const approvedPeriods = periods.filter(p => p.status === 'approved' || p.status === 'released');
  const currentPeriod = approvedPeriods.find(p => p.start_date === startStr && p.end_date === endStr);
  const previousApproved = approvedPeriods
    .filter(p => !(p.start_date === startStr && p.end_date === endStr))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  const visiblePrevious = showAll ? previousApproved : previousApproved.slice(0, 3);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Payroll Summary</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">Approved payroll periods overview</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Current Period */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Current Period</p>
            {currentPeriod ? (
              <PeriodCard period={currentPeriod} defaultOpen={true} />
            ) : (
              <Card className="border border-border shadow-sm">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No approved payroll for the current period yet.
                </CardContent>
              </Card>
            )}
          </div>

          {/* Previous Periods */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Previous Periods</p>
            {previousApproved.length === 0 ? (
              <Card className="border border-border shadow-sm">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No previous approved payroll periods.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {visiblePrevious.map(p => (
                  <PeriodCard key={p.id} period={p} defaultOpen={false} />
                ))}
                {previousApproved.length > 3 && (
                  <Button variant="outline" className="w-full" onClick={() => setShowAll(s => !s)}>
                    {showAll ? 'Show Less' : `View ${previousApproved.length - 3} More Periods`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
