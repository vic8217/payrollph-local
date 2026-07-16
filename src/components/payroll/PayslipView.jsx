import { Building2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

function Row({ label, value, bold, negative }) {
  return (
    <div className={`flex justify-between items-center py-1.5 ${bold ? 'font-semibold' : ''}`}>
      <span className={`text-sm ${bold ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm font-mono ${negative ? 'text-destructive' : bold ? 'text-foreground' : 'text-foreground'}`}>
        {negative && value > 0 ? '-' : ''}₱{(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

export default function PayslipView({ record }) {
  const handlePrint = () => window.print();
  const incentiveDetails = Array.isArray(record.incentive_details) ? record.incentive_details : [];
  const cashAdvanceReleaseDetails = Array.isArray(record.cash_advance_release_details) ? record.cash_advance_release_details : [];
  const cashAdvanceDeductionDetails = Array.isArray(record.cash_advance_deduction_details) ? record.cash_advance_deduction_details : [];

  return (
    <div className="space-y-4" id="payslip-content">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">PayrollPH</p>
            <p className="text-xs text-muted-foreground">Payslip</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1">
          <Printer className="w-3.5 h-3.5" /> Print
        </Button>
      </div>

      <div className="bg-muted/40 rounded-xl p-4 space-y-1">
        <p className="font-semibold text-foreground">{record.employee_name}</p>
        <p className="text-sm text-muted-foreground">{record.department}</p>
        <p className="text-xs text-muted-foreground font-medium">{record.period_name}</p>
      </div>

      {/* Attendance Summary */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attendance</p>
        <div className="grid grid-cols-2 gap-1 text-sm">
          <span className="text-muted-foreground">Regular Days</span><span className="text-right font-mono">{record.regular_days || 0}</span>
          {record.overtime_hours > 0 && <><span className="text-muted-foreground">Overtime Hours</span><span className="text-right font-mono">{record.overtime_hours}h</span></>}
          {record.regular_holiday_worked > 0 && <><span className="text-muted-foreground">Regular Holidays</span><span className="text-right font-mono">{record.regular_holiday_worked}</span></>}
          {record.special_holiday_worked > 0 && <><span className="text-muted-foreground">Special Holidays</span><span className="text-right font-mono">{record.special_holiday_worked}</span></>}
        </div>
      </div>

      <Separator />

      {/* Earnings */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Earnings</p>
        <Row label="Basic Pay" value={record.basic_pay} />
        {record.overtime_pay > 0 && <Row label="Overtime Pay" value={record.overtime_pay} />}
        {record.holiday_pay > 0 && <Row label="Holiday Pay" value={record.holiday_pay} />}
        {record.incentive_pay > 0 && <Row label="Incentives" value={record.incentive_pay} />}
        {incentiveDetails.length > 0 && (
          <div className="mt-1 space-y-1 rounded-md bg-muted/30 px-3 py-2">
            {incentiveDetails.map((item, index) => (
              <div key={`${item.id || item.program_name || 'special'}-${index}`} className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{item.program_name || 'Special incentive'}</span>
                <span className="font-mono text-foreground">
                  ₱{Number(item.unit_amount ?? item.daily_amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} × {item.unit_count ?? item.present_days ?? 0} {item.unit || 'day'}(s)
                </span>
              </div>
            ))}
          </div>
        )}
        <Separator className="my-1" />
        <Row label="Gross Pay" value={record.gross_pay} bold />
        {record.cash_advance_received > 0 && (
          <>
            <Row label="Cash Advance Released" value={record.cash_advance_received} />
            {cashAdvanceReleaseDetails.map((item, index) => (
              <p key={`${item.cash_advance_id || 'advance'}-${index}`} className="flex justify-between gap-3 px-2 text-xs text-muted-foreground">
                <span>{item.description || 'Approved cash advance'} · {item.approved_date}</span>
                <span className="font-mono">₱{Number(item.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
              </p>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">Cash advances are non-wage additions and are not included in gross pay.</p>
          </>
        )}
      </div>

      {/* Deductions */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Deductions</p>
        {(record.statutory_base_pay || record.monthly_rate) > 0 && (
          <p className="mb-1 text-xs text-muted-foreground">
            Statutory basis: ₱{Number(record.statutory_base_pay || record.monthly_rate || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} employee base pay
          </p>
        )}
        <Row label="SSS Contribution" value={record.sss_contribution} negative />
        <Row label="PhilHealth Contribution" value={record.philhealth_contribution} negative />
        <Row label="Pag-IBIG (HDMF)" value={record.pagibig_contribution} negative />
        {record.withholding_tax > 0 && <Row label="Withholding Tax" value={record.withholding_tax} negative />}
        {record.late_deduction > 0 && <Row label="Late Deduction" value={record.late_deduction} negative />}
        {record.undertime_deduction > 0 && <Row label="Undertime Deduction" value={record.undertime_deduction} negative />}
        {record.absent_deduction > 0 && <Row label="Absent Deduction" value={record.absent_deduction} negative />}
        {record.cash_advance_deduction > 0 && <Row label="Cash Advance (Vale)" value={record.cash_advance_deduction} negative />}
        {cashAdvanceDeductionDetails.map((item, index) => (
          <p key={`${item.cash_advance_id || 'deduction'}-${index}`} className="flex justify-between gap-3 px-2 text-xs text-muted-foreground">
            <span>{item.description || 'Cash advance'} · installment {item.deduction_number || '—'} of {item.deduction_total || '—'}</span>
            <span className="font-mono">-₱{Number(item.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </p>
        ))}
        {record.cash_advance_deduction_suspended && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Cash advance deduction suspended for this payroll period.
          </p>
        )}
        <Separator className="my-1" />
        <Row label="Total Deductions" value={record.total_deductions} bold negative />
      </div>

      <Separator />

      {/* Net Pay */}
      <div className="bg-primary/5 rounded-xl p-4 flex justify-between items-center">
        <span className="font-bold text-foreground">NET PAY</span>
        <span className="text-2xl font-bold text-primary">
          ₱{(record.net_pay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
