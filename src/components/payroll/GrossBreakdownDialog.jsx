import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

function Row({ label, value, bold, negative, highlight }) {
  return (
    <div className={`flex justify-between items-center py-1.5 ${bold ? 'font-semibold' : ''} ${highlight ? 'bg-primary/5 rounded px-2 -mx-2' : ''}`}>
      <span className={`text-sm ${bold ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm font-mono ${negative ? 'text-destructive' : bold ? 'text-primary' : 'text-foreground'}`}>
        {negative && (value || 0) > 0 ? '-' : ''}₱{(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function GrossBreakdownDialog({ record, open, onClose }) {
  if (!record) return null;

  const dailyRate = record.daily_rate || (record.basic_pay && record.regular_days > 0
    ? (record.basic_pay / record.regular_days)
    : null);
  const cashAdvanceDetails = Array.isArray(record.cash_advance_deduction_details)
    ? record.cash_advance_deduction_details
    : [];
  const incentiveDetails = Array.isArray(record.incentive_details) ? record.incentive_details : [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gross Pay Breakdown</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{record.employee_name}</p>
          <p>{record.department} · {record.period_name}</p>
        </div>

        <Separator />

        {/* Attendance */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attendance Used</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Regular Days</span>
            <span className="text-right font-mono">{record.regular_days || 0} day(s)</span>
            {record.overtime_hours > 0 && <>
              <span className="text-muted-foreground">Overtime Hours</span>
              <span className="text-right font-mono">{record.overtime_hours}h</span>
            </>}
            {record.night_diff_hours > 0 && <>
              <span className="text-muted-foreground">Night Differential Hours</span>
              <span className="text-right font-mono">{record.night_diff_hours}h</span>
            </>}
            {record.rest_day_worked > 0 && <>
              <span className="text-muted-foreground">Rest Day Worked</span>
              <span className="text-right font-mono">{record.rest_day_worked} day(s)</span>
            </>}
            {record.regular_holiday_worked > 0 && <>
              <span className="text-muted-foreground">Regular Holidays</span>
              <span className="text-right font-mono">{record.regular_holiday_worked} day(s)</span>
            </>}
            {record.special_holiday_worked > 0 && <>
              <span className="text-muted-foreground">Special Holidays</span>
              <span className="text-right font-mono">{record.special_holiday_worked} day(s)</span>
            </>}
          </div>
        </div>

        <Separator />

        {/* Gross Computation */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Gross Computation</p>
          <Row label="Basic Pay" value={record.basic_pay} />
          {dailyRate && record.regular_days > 0 && (
            <p className="text-xs text-muted-foreground ml-2 mb-1">
              ₱{dailyRate.toLocaleString('en-PH', { minimumFractionDigits: 2 })}/day × {record.regular_days} day(s)
            </p>
          )}
          {record.overtime_pay > 0 && <Row label="Overtime Pay" value={record.overtime_pay} />}
          {record.night_diff_pay > 0 && <Row label="Night Differential Pay" value={record.night_diff_pay} />}
          {record.holiday_pay > 0 && <Row label="Holiday Pay" value={record.holiday_pay} />}
          {record.incentive_pay > 0 && <Row label="Incentives" value={record.incentive_pay} />}
          {incentiveDetails.length > 0 && (
            <div className="mt-1 space-y-2">
              {incentiveDetails.map((item, index) => (
                <div key={`${item.id || item.program_name || 'special'}-${index}`} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-foreground">{item.program_name || 'Incentive'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        ₱{Number(item.unit_amount ?? item.daily_amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}/{item.unit || 'day'} × {item.unit_count ?? item.present_days ?? 0} {item.unit || 'day'}(s)
                      </p>
                    </div>
                    <span className="text-xs font-mono text-emerald-700 whitespace-nowrap">
                      ₱{Number(item.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Separator className="my-1" />
          <Row label="Gross Pay" value={record.gross_pay} bold highlight />
        </div>

        <Separator />

        {/* Deduction Breakdown */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deductions Breakdown</p>
          {(record.statutory_base_pay || record.monthly_rate) > 0 && (
            <p className="mb-1 text-xs text-muted-foreground">
              Statutory basis: ₱{Number(record.statutory_base_pay || record.monthly_rate || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} employee base pay
            </p>
          )}
          <Row label="SSS Contribution" value={record.sss_contribution} negative />
          <Row label="PhilHealth" value={record.philhealth_contribution} negative />
          <Row label="Pag-IBIG (HDMF)" value={record.pagibig_contribution} negative />
          {record.withholding_tax > 0 && <Row label="Withholding Tax" value={record.withholding_tax} negative />}
          {record.late_deduction > 0 && <Row label="Late Deduction" value={record.late_deduction} negative />}
          {record.undertime_deduction > 0 && <Row label="Undertime Deduction" value={record.undertime_deduction} negative />}
          {record.absent_deduction > 0 && <Row label="Absent Deduction" value={record.absent_deduction} negative />}
          {record.cash_advance_deduction > 0 && (
            <>
              <Row label="Cash Advance (Vale)" value={record.cash_advance_deduction} negative />
              {cashAdvanceDetails.length > 0 && (
                <div className="mt-1 space-y-2">
                  {cashAdvanceDetails.map((detail, index) => (
                    <div key={`${detail.cash_advance_id || 'ca'}-${index}`} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {detail.description || 'Cash advance'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Advance: {formatDate(detail.request_date)} · Deducted: {formatDate(detail.deduction_date)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Deduction {detail.deduction_number || '?'} of {detail.deduction_total || '?'} · {detail.deductions_remaining || 0} left · Balance ₱{(detail.balance_after || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-destructive whitespace-nowrap">
                          -₱{(detail.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <Separator className="my-1" />
          <Row label="Total Deductions" value={record.total_deductions} bold negative />
        </div>

        <Separator />

        <div className="bg-primary/5 rounded-xl p-4 flex justify-between items-center">
          <span className="font-bold text-foreground">NET PAY</span>
          <span className="text-xl font-bold text-primary">
            ₱{(record.net_pay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
