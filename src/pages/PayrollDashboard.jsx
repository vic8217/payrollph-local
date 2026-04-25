import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { DollarSign, TrendingDown, Users, Wallet } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

const DEDUCTION_COLORS = {
  sss: '#ef4444',
  philhealth: '#f97316',
  pagibig: '#eab308',
  withholding_tax: '#6366f1',
  cash_advance: '#ec4899',
  agency_fee: '#8b5cf6',
  other: '#6b7280',
};

export default function PayrollDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const { activeCompanyId } = useCompany();

  const { data: periods = [] } = useQuery({
    queryKey: ['payrollPeriods', activeCompanyId],
    queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-created_date', 50),
    enabled: !!activeCompanyId,
  });

  const { data: records = [] } = useQuery({
    queryKey: ['payrollRecords', selectedPeriod?.id],
    queryFn: () => selectedPeriod
      ? appApi.entities.PayrollRecord.filter({ payroll_period_id: selectedPeriod.id, company_profile_id: activeCompanyId })
      : [],
    enabled: !!selectedPeriod && !!activeCompanyId,
  });

  // Summary stats
  const totalGross = records.reduce((sum, r) => sum + (r.gross_pay || 0), 0);
  const totalSSS = records.reduce((sum, r) => sum + (r.sss_contribution || 0), 0);
  const totalPhilHealth = records.reduce((sum, r) => sum + (r.philhealth_contribution || 0), 0);
  const totalPagIBIG = records.reduce((sum, r) => sum + (r.pagibig_contribution || 0), 0);
  const totalWithholding = records.reduce((sum, r) => sum + (r.withholding_tax || 0), 0);
  const totalCashAdvance = records.reduce((sum, r) => sum + (r.cash_advance_deduction || 0), 0);
  const totalAgencyFee = records.reduce((sum, r) => sum + (r.agency_fee || 0), 0);
  const totalDeductions = records.reduce((sum, r) => sum + (r.total_deductions || 0), 0);
  const totalNetPay = records.reduce((sum, r) => sum + (r.net_pay || 0), 0);

  // Chart data
  const deductionBreakdown = [
    { name: 'SSS', value: totalSSS },
    { name: 'PhilHealth', value: totalPhilHealth },
    { name: 'Pag-IBIG', value: totalPagIBIG },
    { name: 'Withholding Tax', value: totalWithholding },
    { name: 'Cash Advance', value: totalCashAdvance },
    { name: 'Agency Fee', value: totalAgencyFee },
  ].filter(d => d.value > 0);

  const payComparisonData = records.map(r => ({
    employee: r.employee_name.split(' ')[0],
    gross: r.gross_pay,
    deductions: r.total_deductions,
    net: r.net_pay,
  }));

  const statCards = [
    { label: 'Total Gross', value: totalGross, icon: DollarSign, color: 'text-green-600' },
    { label: 'Total Deductions', value: totalDeductions, icon: TrendingDown, color: 'text-red-600' },
    { label: 'Total Net Pay', value: totalNetPay, icon: Wallet, color: 'text-blue-600' },
    { label: 'Total Employees', value: records.length, icon: Users, color: 'text-purple-600' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payroll Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Overview of net pay calculations and deductions</p>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">Select Period:</span>
        <Select value={selectedPeriod?.id || ''} onValueChange={(id) => {
          const period = periods.find(p => p.id === id);
          setSelectedPeriod(period);
        }}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Choose a payroll period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.period_name} — Net ₱{(p.total_net || 0).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPeriod ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <Card key={idx} className="p-4 border border-border">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                      <p className="text-lg font-bold text-foreground mt-1">
                        {typeof stat.value === 'number' && stat.value > 100
                          ? `₱${stat.value.toLocaleString()}`
                          : stat.value}
                      </p>
                    </div>
                    <Icon className={`w-5 h-5 ${stat.color} opacity-60`} />
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Deduction Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <Card className="p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-4">Deduction Breakdown</h3>
              {deductionBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={deductionBreakdown}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ₱${value.toLocaleString()}`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {deductionBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={Object.values(DEDUCTION_COLORS)[index % Object.values(DEDUCTION_COLORS).length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `₱${value.toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-20">No deductions recorded</p>
              )}
            </Card>

            {/* Deduction Details Table */}
            <Card className="p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-4">Deduction Details</h3>
              <div className="space-y-3">
                {[
                  { label: 'SSS', value: totalSSS, color: 'text-red-600' },
                  { label: 'PhilHealth', value: totalPhilHealth, color: 'text-orange-600' },
                  { label: 'Pag-IBIG', value: totalPagIBIG, color: 'text-yellow-600' },
                  { label: 'Withholding Tax', value: totalWithholding, color: 'text-indigo-600' },
                  { label: 'Cash Advance', value: totalCashAdvance, color: 'text-pink-600' },
                  { label: 'Agency Fee', value: totalAgencyFee, color: 'text-purple-600' },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>
                      -₱{item.value.toLocaleString()}
                    </span>
                  </div>
                ))}
                <div className="border-t border-border pt-3 mt-3 flex items-center justify-between">
                  <span className="font-semibold text-foreground">Total Deductions</span>
                  <span className="font-bold text-destructive">
                    -₱{totalDeductions.toLocaleString()}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* Pay Comparison Chart */}
          <Card className="p-6 border border-border">
            <h3 className="font-semibold text-foreground mb-4">Gross vs Deductions vs Net Pay by Employee</h3>
            {payComparisonData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={payComparisonData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="employee" />
                  <YAxis />
                  <Tooltip formatter={(value) => `₱${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="gross" fill="#10b981" name="Gross Pay" />
                  <Bar dataKey="deductions" fill="#ef4444" name="Total Deductions" />
                  <Bar dataKey="net" fill="#3b82f6" name="Net Pay" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-20">No employee data</p>
            )}
          </Card>

          {/* Employee Details Table */}
          <Card className="border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gross</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">SSS</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">PhilHealth</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pag-IBIG</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tax</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cash Adv.</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total Ded.</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(rec => (
                    <tr key={rec.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{rec.employee_name}</p>
                        <p className="text-xs text-muted-foreground">{rec.department}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground font-medium">₱{(rec.gross_pay || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-destructive">-₱{(rec.sss_contribution || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-destructive">-₱{(rec.philhealth_contribution || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-destructive">-₱{(rec.pagibig_contribution || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-destructive">-₱{(rec.withholding_tax || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-destructive">-₱{(rec.cash_advance_deduction || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-medium text-destructive">-₱{(rec.total_deductions || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">₱{(rec.net_pay || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Wallet className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">Select a payroll period to view the dashboard</p>
        </div>
      )}
    </div>
  );
}