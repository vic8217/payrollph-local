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

export default function GrossBreakdownDialog({ record, open, onClose }) {
  if (!record) return null;

  const dailyRate = record.basic_pay && record.regular_days > 0
    ? (record.basic_pay / record.regular_days)
    : null;

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
          {record.holiday_pay > 0 && <Row label="Holiday Pay" value={record.holiday_pay} />}
          <Separator className="my-1" />
          <Row label="Gross Pay" value={record.gross_pay} bold highlight />
        </div>

        <Separator />

        {/* Deduction Breakdown */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deductions Breakdown</p>
          <Row label="SSS Contribution" value={record.sss_contribution} negative />
          <Row label="PhilHealth" value={record.philhealth_contribution} negative />
          <Row label="Pag-IBIG (HDMF)" value={record.pagibig_contribution} negative />
          {record.withholding_tax > 0 && <Row label="Withholding Tax" value={record.withholding_tax} negative />}
          {record.late_deduction > 0 && <Row label="Late Deduction" value={record.late_deduction} negative />}
          {record.undertime_deduction > 0 && <Row label="Undertime Deduction" value={record.undertime_deduction} negative />}
          {record.absent_deduction > 0 && <Row label="Absent Deduction" value={record.absent_deduction} negative />}
          {record.cash_advance_deduction > 0 && <Row label="Cash Advance (Vale)" value={record.cash_advance_deduction} negative />}
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