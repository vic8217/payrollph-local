import { useMemo, useState } from 'react';
import { Landmark, ShieldCheck, HeartPulse, Home, Calculator, Clock3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DAY_PAY_MULTIPLIERS, OVERTIME_MULTIPLIERS, computePagIbig, computePhilHealth, computeSSS } from '@/lib/payrollUtils';

const formatPeso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sampleSalaries = [5000, 10000, 15000, 17000, 18000, 19000, 20000, 30000, 35000];

const payRateRows = [
  { key: 'regular', label: 'Ordinary working day' },
  { key: 'special_working_holiday', label: 'Special working holiday' },
  { key: 'rest_day', label: 'Rest day' },
  { key: 'special_holiday', label: 'Special non-working holiday' },
  { key: 'special_holiday_rest_day', label: 'Special non-working holiday + rest day' },
  { key: 'double_special_holiday', label: 'Double special non-working holiday' },
  { key: 'double_special_holiday_rest_day', label: 'Double special non-working holiday + rest day' },
  { key: 'regular_holiday', label: 'Regular holiday' },
  { key: 'regular_holiday_rest_day', label: 'Regular holiday + rest day' },
  { key: 'double_holiday', label: 'Double regular holiday' },
  { key: 'double_holiday_rest_day', label: 'Double regular holiday + rest day' },
];

function RateCard({ icon: Icon, title, children }) {
  return (
    <Card className="border border-border p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">
        {children}
      </div>
    </Card>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span>{label}</span>
      <span className={`font-mono text-right ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function formatPercent(value) {
  return `${Number(value * 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`;
}

export default function StatutoryRates() {
  const [monthlySalary, setMonthlySalary] = useState('20000');
  const salary = Number(monthlySalary) || 0;

  const preview = useMemo(() => {
    const sss = computeSSS(salary);
    const philHealth = computePhilHealth(salary);
    const pagIbig = computePagIbig(salary);
    return {
      sss,
      philHealth,
      pagIbig,
      employeeMonthly: sss.employee + philHealth.employee + pagIbig.employee,
      employerMonthly: sss.employer + sss.ec + philHealth.employer + pagIbig.employer,
      employeeWeekly: (sss.employee + philHealth.employee + pagIbig.employee) / 4.33,
    };
  }, [salary]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Statutory Rates</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Review the contribution and DOLE pay-rate rules used by payroll.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RateCard icon={ShieldCheck} title="SSS">
          <Row label="Method" value="MSC bracket table" />
          <Row label="MSC range" value="₱5,000 - ₱35,000" />
          <Row label="Employee share" value="5%" />
          <Row label="Employer share" value="10% + EC" />
          <Row label="Employee at ₱20,000 MSC" value={formatPeso(computeSSS(20000).employee)} />
          <Row label="Employer at ₱20,000 MSC" value={formatPeso(computeSSS(20000).employer)} />
        </RateCard>

        <RateCard icon={HeartPulse} title="PhilHealth">
          <Row label="Contribution rate" value="5% monthly salary credit" />
          <Row label="Employee share" value="50%" />
          <Row label="Employer share" value="50%" />
          <Row label="Salary credit range" value="₱10,000 - ₱100,000" />
          <Row label="Minimum share" value={`${formatPeso(computePhilHealth(10000).employee)} each`} />
        </RateCard>

        <RateCard icon={Home} title="Pag-IBIG">
          <Row label="Employee rate" value="1% up to ₱1,500, else 2%" />
          <Row label="Employer rate" value="2%" />
          <Row label="Fund salary ceiling" value="₱10,000" />
          <Row label="Employee max" value={formatPeso(computePagIbig(10000).employee)} />
          <Row label="Employer max" value={formatPeso(computePagIbig(10000).employer)} />
        </RateCard>
      </div>

      <Card className="border border-border p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Contribution Preview</h2>
              <p className="text-xs text-muted-foreground">Payroll stores weekly employee deductions by dividing monthly employee share by 4.33.</p>
            </div>
          </div>
          <div className="w-full md:w-64">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={monthlySalary}
              onChange={e => setMonthlySalary(e.target.value)}
              placeholder="Monthly salary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SSS</p>
            <Row label="MSC" value={formatPeso(preview.sss.monthly_salary_credit)} />
            <Row label="Employee" value={formatPeso(preview.sss.employee)} />
            <Row label="Employer" value={formatPeso(preview.sss.employer)} />
            <Row label="EC" value={formatPeso(preview.sss.ec)} />
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">PhilHealth</p>
            <Row label="Salary credit" value={formatPeso(preview.philHealth.salary_credit)} />
            <Row label="Employee" value={formatPeso(preview.philHealth.employee)} />
            <Row label="Employer" value={formatPeso(preview.philHealth.employer)} />
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pag-IBIG</p>
            <Row label="Fund salary" value={formatPeso(preview.pagIbig.fund_salary)} />
            <Row label="Employee" value={formatPeso(preview.pagIbig.employee)} />
            <Row label="Employer" value={formatPeso(preview.pagIbig.employer)} />
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-muted/50 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <Row label="Monthly employee total" value={formatPeso(preview.employeeMonthly)} strong />
          <Row label="Weekly employee deduction" value={formatPeso(preview.employeeWeekly)} strong />
          <Row label="Monthly employer total" value={formatPeso(preview.employerMonthly)} strong />
        </div>
      </Card>

      <Card className="border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Clock3 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">DOLE Pay Rate Multipliers</h2>
            <p className="text-xs text-muted-foreground">These percentages are used for first 8 hours, overtime, and night differential computations.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Work Day Type</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">First 8 Hours</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Overtime Hour</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Night Differential Add-on</th>
              </tr>
            </thead>
            <tbody>
              {payRateRows.map(row => {
                const dayRate = DAY_PAY_MULTIPLIERS[row.key];
                const overtimeRate = OVERTIME_MULTIPLIERS[row.key];
                return (
                  <tr key={row.key} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{row.label}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPercent(dayRate)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPercent(overtimeRate)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPercent(dayRate * 0.10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Sample Employee Shares</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Monthly Salary</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">SSS</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">PhilHealth</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pag-IBIG</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">SSS EC</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Monthly Total</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Weekly Deduction</th>
              </tr>
            </thead>
            <tbody>
              {sampleSalaries.map(amount => {
                const sssInfo = computeSSS(amount);
                const sss = sssInfo.employee;
                const philHealth = computePhilHealth(amount).employee;
                const pagIbig = computePagIbig(amount).employee;
                const total = sss + philHealth + pagIbig;
                return (
                  <tr key={amount} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{formatPeso(amount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPeso(sss)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPeso(philHealth)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatPeso(pagIbig)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatPeso(sssInfo.ec)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{formatPeso(total)}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{formatPeso(total / 4.33)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Landmark className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>These values reflect the formulas currently configured in the app. Review them whenever government contribution tables change.</p>
      </div>
    </div>
  );
}
