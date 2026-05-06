import { useState } from 'react';
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

const TERMINATION_TYPES = [
  { value: 'resignation', label: 'Voluntary Resignation' },
  { value: 'termination', label: 'Termination Without Just Cause' },
  { value: 'retirement', label: 'Retirement' },
];

export default function SeparationPay() {
  const { activeCompanyId } = useCompany();
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [separationDate, setSeparationDate] = useState(new Date().toISOString().split('T')[0]);
  const [terminationType, setTerminationType] = useState('resignation');
  const [showComputeDialog, setShowComputeDialog] = useState(false);
  const [computation, setComputation] = useState(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Fetch employees
  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['employees-separation', activeCompanyId],
    queryFn: () =>
      appApi.entities.Employee.filter({
        company_profile_id: activeCompanyId,
      }),
  });

  // Fetch separation records
  const { data: separationRecords = [] } = useQuery({
    queryKey: ['separation-records', activeCompanyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/benefits/index?action=compute-separation&companyId=${activeCompanyId}`
      );
      const json = await response.json();
      return json.data || [];
    },
  });

  // Compute separation pay
  const computeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployee) return;

      const response = await fetch('/api/benefits/index?action=compute-separation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployee.employee_id,
          separationDate,
          terminationType,
          companyId: activeCompanyId,
        }),
      });
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data) => {
      setComputation(data);
      setShowComputeDialog(false);
    },
  });

  // Save separation pay record
  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/benefits/index?action=save-separation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          computation,
          companyId: activeCompanyId,
        }),
      });
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['separation-records'] });
      setShowSaveDialog(false);
      setComputation(null);
      setSelectedEmployee(null);
    },
  });

  const handleCompute = async () => {
    await computeMutation.mutateAsync();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Separation/Resignation Pay Computation</h1>
      </div>

      {/* Computation Card */}
      <Card>
        <CardHeader>
          <CardTitle>Compute Separation Pay</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Select Employee</label>
                <select
                  value={selectedEmployee?.employee_id || ''}
                  onChange={(e) => {
                    const emp = employees.find((e) => e.employee_id === e.target.value);
                    setSelectedEmployee(emp);
                  }}
                  className="w-full border rounded px-3 py-2"
                  disabled={employeesLoading}
                >
                  <option value="">-- Select Employee --</option>
                  {employees.map((emp) => (
                    <option key={emp.employee_id} value={emp.employee_id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Separation Date</label>
                <Input
                  type="date"
                  value={separationDate}
                  onChange={(e) => setSeparationDate(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Termination Type</label>
                <select
                  value={terminationType}
                  onChange={(e) => setTerminationType(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                >
                  {TERMINATION_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              onClick={handleCompute}
              disabled={!selectedEmployee || computeMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {computeMutation.isPending ? 'Computing...' : 'Compute Separation Pay'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Computation Result */}
      {computation && (
        <Card className="border-2 border-blue-500 bg-blue-50">
          <CardHeader>
            <CardTitle>Computation Result</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Employee Name</p>
                  <p className="text-lg font-semibold">{computation.employee_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Position</p>
                  <p className="text-lg font-semibold">{computation.position}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Department</p>
                  <p className="text-lg font-semibold">{computation.department}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Hire Date</p>
                  <p className="text-lg font-semibold">{computation.hire_date}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Separation Date</p>
                  <p className="text-lg font-semibold">{computation.separation_date}</p>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div className="bg-white p-4 rounded border">
                  <p className="text-sm text-gray-600">Years of Service</p>
                  <p className="text-2xl font-bold">{computation.years_of_service} years</p>
                  <p className="text-xs text-gray-500">
                    ({computation.months_of_service} months)
                  </p>
                </div>
                <div className="bg-white p-4 rounded border">
                  <p className="text-sm text-gray-600">Monthly Salary</p>
                  <p className="text-2xl font-bold">
                    ₱{computation.basic_salary_monthly?.toLocaleString('en-PH', {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Separation Pay Calculation */}
            <div className="mt-6 space-y-3 border-t pt-6">
              <div className="flex justify-between items-center text-lg">
                <span className="font-semibold">Separation Pay (Gross)</span>
                <span className="font-bold text-blue-600">
                  ₱
                  {computation.separation_pay_gross?.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center text-lg text-red-600">
                <span>Less: Cash Advance Deduction</span>
                <span className="font-bold">
                  ₱
                  {computation.cash_advance_deduction?.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center text-xl border-t pt-3">
                <span className="font-bold">Net Separation Pay</span>
                <span className="font-bold text-green-600 text-2xl">
                  ₱
                  {computation.net_pay?.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {/* Remarks */}
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <p className="font-semibold mb-2">Notes:</p>
              <ul className="list-disc list-inside space-y-1">
                {terminationType === 'resignation' && (
                  <li>Voluntary resignation: 1 month per year of service</li>
                )}
                {terminationType === 'termination' && (
                  <li>Termination without just cause: Higher of 1 month/year or pro-rata basis</li>
                )}
                {terminationType === 'retirement' && (
                  <li>Retirement: 1.5 months per year of service</li>
                )}
                <li>Amount is subject to tax and other statutory deductions</li>
                <li>Any outstanding cash advances will be deducted from final payment</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setComputation(null);
                  setSelectedEmployee(null);
                }}
              >
                Clear
              </Button>
              <Button
                onClick={() => setShowSaveDialog(true)}
                className="bg-green-600 hover:bg-green-700"
              >
                Save Record
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Separation Records Table */}
      {separationRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Separation Pay Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Hire Date</TableHead>
                    <TableHead>Separation Date</TableHead>
                    <TableHead>Years of Service</TableHead>
                    <TableHead className="text-right">Net Payout</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {separationRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.employee_name}</TableCell>
                      <TableCell>
                        {TERMINATION_TYPES.find((t) => t.value === record.termination_type)?.label ||
                          record.termination_type}
                      </TableCell>
                      <TableCell>{record.hire_date}</TableCell>
                      <TableCell>{record.separation_date}</TableCell>
                      <TableCell>{record.years_of_service} years</TableCell>
                      <TableCell className="text-right font-bold text-green-600">
                        ₱
                        {record.net_pay?.toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            record.status === 'released'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
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

      {/* Save Confirmation Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Separation Pay Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded">
              <div className="flex justify-between mb-2">
                <span>Employee:</span>
                <span className="font-semibold">{computation?.employee_name}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span>Net Payout:</span>
                <span className="font-bold text-green-600">
                  ₱
                  {computation?.net_pay?.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Type:</span>
                <span className="font-semibold">
                  {TERMINATION_TYPES.find((t) => t.value === computation?.termination_type)
                    ?.label}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              This record will be saved as draft. You can process it for payroll later.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {saveMutation.isPending ? 'Saving...' : 'Save Record'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
