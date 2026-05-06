import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { queryClientInstance as qc } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

export default function ThirteenthMonthPay() {
  const { activeCompanyId } = useCompany();
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showPayoutDialog, setShowPayoutDialog] = useState(false);
  const [payoutMonth, setPayoutMonth] = useState('12');

  // Fetch payroll data for the year
  const { data: payrollData = [], isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll', year, activeCompanyId],
    queryFn: async () => {
      const periods = await appApi.entities.PayrollPeriod.filter({
        company_profile_id: activeCompanyId,
      });
      return periods.filter((p) => p.period_name.includes(year.toString()));
    },
  });

  // Fetch employees
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () =>
      appApi.entities.Employee.filter({
        company_profile_id: activeCompanyId,
        is_active: true,
      }),
  });

  // Compute 13th month pay
  const { data: computations = [], isLoading: computationLoading } = useQuery({
    queryKey: ['13th-month-compute', year, activeCompanyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/benefits/index?action=compute-13th-month&companyId=${activeCompanyId}&year=${year}`
      );
      const json = await response.json();
      return json.data || [];
    },
    enabled: payrollData.length > 0,
  });

  // Fetch existing 13th month records
  const { data: existingRecords = [] } = useQuery({
    queryKey: ['13th-month-records', activeCompanyId],
    queryFn: () =>
      appApi.entities.ThirteenthMonthPay.filter({
        company_profile_id: activeCompanyId,
      }),
  });

  // Save 13th month pay records
  const saveMutation = useMutation({
    mutationFn: async () => {
      const selectedComputations = computations.filter((_, i) =>
        selectedRows.has(i)
      );
      const response = await fetch('/api/benefits/index?action=compute-13th-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          computations: selectedComputations,
          companyId: activeCompanyId,
          payout_month: payoutMonth,
        }),
      });
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['13th-month-records'] });
      setShowPayoutDialog(false);
      setSelectedRows(new Set());
    },
  });

  const totalEligibleEarnings = useMemo(() => {
    return computations.reduce((sum, c) => sum + (c.eligible_earnings_yearly || 0), 0);
  }, [computations]);

  const totalNetPay = useMemo(() => {
    return computations.reduce((sum, c) => sum + (c.net_pay || 0), 0);
  }, [computations]);

  const handleSelectAll = () => {
    if (selectedRows.size === computations.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(computations.map((_, i) => i)));
    }
  };

  const toggleRow = (index) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedRows(newSet);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">13th Month Pay Computation</h1>
        <div className="flex gap-4">
          <Input
            type="number"
            min="2020"
            max={new Date().getFullYear()}
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="w-32"
            placeholder="Year"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{computations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Eligible Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₱{totalEligibleEarnings.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total 13th Month Pay</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₱
              {computations
                .reduce((sum, c) => sum + (c.thirteenth_month_gross || 0), 0)
                .toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Net Payout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ₱{totalNetPay.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => setShowPayoutDialog(true)}
          disabled={selectedRows.size === 0}
          className="bg-green-600 hover:bg-green-700"
        >
          Process Selected ({selectedRows.size})
        </Button>
      </div>

      {/* Computations Table */}
      <Card>
        <CardHeader>
          <CardTitle>13th Month Pay Computations for {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {computationLoading ? (
            <div className="text-center py-8">Loading computations...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          computations.length > 0 &&
                          selectedRows.size === computations.length
                        }
                        onChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Employee Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Days Worked</TableHead>
                    <TableHead className="text-right">Hours Worked</TableHead>
                    <TableHead className="text-right">Eligible Earnings</TableHead>
                    <TableHead className="text-right">13th Month Gross</TableHead>
                    <TableHead className="text-right">CA Deduction</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computations.map((comp, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Checkbox
                          checked={selectedRows.has(idx)}
                          onChange={() => toggleRow(idx)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{comp.employee_name}</TableCell>
                      <TableCell>{comp.department}</TableCell>
                      <TableCell className="text-right">{comp.days_worked_yearly}</TableCell>
                      <TableCell className="text-right">
                        {comp.hours_worked_yearly?.toLocaleString('en-PH', { maximumFractionDigits: 2 }) || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        ₱{comp.eligible_earnings_yearly?.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ₱
                        {comp.thirteenth_month_gross?.toLocaleString('en-PH', {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        ₱{comp.cash_advance_deduction?.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-bold text-green-600">
                        ₱{comp.net_pay?.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing Records */}
      {existingRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Processed 13th Month Pay Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee Name</TableHead>
                    <TableHead className="text-right">Days Worked</TableHead>
                    <TableHead className="text-right">Hours Worked</TableHead>
                    <TableHead>Payout Month</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.employee_name}</TableCell>
                      <TableCell className="text-right">{record.days_worked_yearly || 0}</TableCell>
                      <TableCell className="text-right">
                        {record.hours_worked_yearly?.toLocaleString('en-PH', { maximumFractionDigits: 2 }) || 0}
                      </TableCell>
                      <TableCell>
                        {record.payout_month === '12' ? 'December' : `Month ${record.payout_month}`}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ₱{record.net_pay?.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          record.status === 'released' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {record.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payout Dialog */}
      <Dialog open={showPayoutDialog} onOpenChange={setShowPayoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process 13th Month Pay</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Payout Month</label>
              <select
                value={payoutMonth}
                onChange={(e) => setPayoutMonth(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="12">December (Regular)</option>
                <option value="11">November (Early)</option>
                <option value="06">June (Mid-year)</option>
              </select>
            </div>
            <p className="text-sm text-gray-600">
              You are about to process 13th month pay for {selectedRows.size} employee(s).
              This action will create payroll records.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowPayoutDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {saveMutation.isPending ? 'Processing...' : 'Process'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
