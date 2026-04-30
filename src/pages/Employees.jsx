import { useMemo, useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/lib/CompanyContext';
import { Plus, Search, Edit2, Archive, CreditCard, FileText, Upload, Download, UserMinus, RotateCcw } from 'lucide-react';
import EmployeeIdCard from '@/components/employees/EmployeeIdCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EmployeeForm from '@/components/employees/EmployeeForm';

import Employee201File from '@/components/employees/Employee201File';

const employeeFullName = (employee) =>
  [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');

const employeeInitials = (employee) =>
  [employee.first_name, employee.middle_name, employee.last_name]
    .filter(Boolean)
    .map(name => name.trim()[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();

const employeePhotoUrl = (employee) =>
  employee.photo_url || employee.photo || employee.image || employee.picture || '';

export default function Employees() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null);
  const [idEmployee, setIdEmployee] = useState(null);
  const [file201Employee, setFile201Employee] = useState(null);
  const [statusFilter, setStatusFilter] = useState('current');
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();

  const downloadTemplate = () => {
    const headers = [
      'employee_id', 'first_name', 'last_name', 'middle_name', 'email', 'phone',
      'department', 'position', 'employment_type', 'agency_fee_percentage',
      'date_hired', 'daily_rate', 'monthly_rate', 'work_schedule',
      'sss_number', 'philhealth_number', 'pagibig_number', 'tin_number',
      'bank_account', 'max_cash_advance', 'cash_advance_beginning_balance',
      'cash_advance_weekly_deduction', 'status'
    ];
    const example = [
      'EMP001', 'Juan', 'Dela Cruz', 'Santos', 'juan@example.com', '09123456789',
      'Sales', 'Sales Manager', 'regular', '', '2024-01-15', '2500', '50000',
      'day_shift', '12-3456789-1', '11-123456789-1', '1234-1234-1234', '123-456-789-000',
      'ACC123456789', '10000', '5000', '1000', 'active'
    ];

    const csv = [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result;
        const lines = csv.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim());

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const emp = {};
          headers.forEach((h, idx) => {
            emp[h] = values[idx] || undefined;
          });

          if (emp.employee_id) {
            emp.daily_rate = parseFloat(emp.daily_rate) || 0;
            emp.monthly_rate = parseFloat(emp.monthly_rate) || 0;
            emp.agency_fee_percentage = emp.agency_fee_percentage ? parseFloat(emp.agency_fee_percentage) : undefined;
            if (emp.max_cash_advance === undefined || emp.max_cash_advance === '') {
              throw new Error(`Row ${i + 1}: max_cash_advance is required.`);
            }
            emp.max_cash_advance = parseFloat(emp.max_cash_advance);
            if (!Number.isFinite(emp.max_cash_advance) || emp.max_cash_advance < 0) {
              throw new Error(`Row ${i + 1}: max_cash_advance must be a valid amount.`);
            }
            const beginningBalance = parseFloat(emp.cash_advance_beginning_balance) || 0;
            const weeklyDeduction = parseFloat(emp.cash_advance_weekly_deduction) || 0;
            emp.cash_advance_beginning_balance = beginningBalance || undefined;
            emp.cash_advance_weekly_deduction = weeklyDeduction || undefined;
            emp.company_profile_id = activeCompanyId;

            await appApi.entities.Employee.create(emp);

            if (beginningBalance > 0 && weeklyDeduction > 0) {
              await appApi.entities.CashAdvance.create({
                employee_id: emp.employee_id,
                employee_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
                department: emp.department,
                amount_requested: beginningBalance,
                amount_approved: beginningBalance,
                beginning_balance: beginningBalance,
                remaining_balance: beginningBalance,
                deduction_payroll_periods: Math.ceil(beginningBalance / weeklyDeduction),
                deduction_amount_per_payroll: weeklyDeduction,
                deduction_periods_remaining: Math.ceil(beginningBalance / weeklyDeduction),
                reason: 'Beginning balance from previous cash advance',
                advance_type: 'beginning_balance',
                request_date: emp.date_hired || new Date().toISOString().slice(0, 10),
                status: 'approved',
                company_profile_id: activeCompanyId,
              });
            }
          }
        }

        qc.invalidateQueries({ queryKey: ['employees'] });
        qc.invalidateQueries({ queryKey: ['cashAdvances'] });
        alert(`Successfully imported ${lines.length - 1} employee(s)`);
      } catch (err) {
        alert(`Error importing employees: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: activeCompanyId }, '-created_date', 200),
    enabled: !!activeCompanyId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => appApi.entities.Employee.update(id, {
      status,
      ...(status === 'resigned' ? { resigned_date: new Date().toISOString().slice(0, 10) } : {}),
      ...(status === 'archived' ? { archived_date: new Date().toISOString().slice(0, 10) } : {}),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  const statusCounts = employees.reduce((counts, employee) => {
    const status = employee.status || 'active';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const currentCount = employees.filter(e => e.status !== 'archived').length;

  const filtered = employees.filter(e =>
    (statusFilter === 'all' ||
      (statusFilter === 'current' ? e.status !== 'archived' : e.status === statusFilter)) &&
    `${employeeFullName(e)} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase())
  );

  /** Keep 201 File in sync after employee record updates (e.g. cash advance agreement) while dialog stays open. */
  const file201EmployeeLive = useMemo(() => {
    if (!file201Employee) return null;
    return employees.find(e => e.id === file201Employee.id) ?? file201Employee;
  }, [employees, file201Employee]);

  const statusColor = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-600',
    resigned: 'bg-amber-100 text-amber-700',
    terminated: 'bg-red-100 text-red-600',
    archived: 'bg-slate-100 text-slate-600',
  };

  const filters = [
    { id: 'current', label: 'Current', count: currentCount },
    { id: 'active', label: 'Active', count: statusCounts.active || 0 },
    { id: 'resigned', label: 'Resigned', count: statusCounts.resigned || 0 },
    { id: 'archived', label: 'Archived', count: statusCounts.archived || 0 },
    { id: 'all', label: 'All', count: employees.length },
  ];

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{employees.length} total employees</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={downloadTemplate} variant="outline" className="gap-2">
            <Download className="w-4 h-4" /> Template
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept=".csv" onChange={handleImport} className="hidden" />
            <Button asChild variant="outline" className="gap-2">
              <span><Upload className="w-4 h-4" /> Import</span>
            </Button>
          </label>
          <Button onClick={() => { setEditEmployee(null); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Add Employee
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, ID, or department..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map(filter => (
          <Button
            key={filter.id}
            size="sm"
            variant={statusFilter === filter.id ? 'default' : 'outline'}
            onClick={() => setStatusFilter(filter.id)}
            className="gap-2"
          >
            {filter.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusFilter === filter.id ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'}`}>
              {filter.count}
            </span>
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(emp => {
            const fullName = employeeFullName(emp);
            const initials = employeeInitials(emp) || '?';
            const photoUrl = employeePhotoUrl(emp);

            return (
            <Card key={emp.id} className="border border-border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 relative">
                <div className="absolute right-4 top-4">
                  {emp.status === 'archived' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-primary hover:bg-primary/5"
                      disabled={updateStatusMutation.isPending}
                      onClick={() => { if (confirm('Restore this archived employee as resigned?')) updateStatusMutation.mutate({ id: emp.id, status: 'resigned' }); }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 text-muted-foreground hover:bg-muted"
                      disabled={emp.status !== 'resigned' || updateStatusMutation.isPending}
                      title={emp.status === 'resigned' ? 'Archive resigned employee' : 'Tag employee as resigned before archiving'}
                      onClick={() => { if (confirm('Archive this resigned employee?')) updateStatusMutation.mutate({ id: emp.id, status: 'archived' }); }}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={fullName || 'Employee'}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <span className="text-sm font-bold leading-none text-primary">{initials}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-foreground truncate">{fullName}</p>
                      <Badge className={`text-xs capitalize px-1.5 py-0.5 ${statusColor[emp.status] || ''}`} variant="outline">
                        {emp.status}
                      </Badge>
                    </div>
                    {emp.position && <p className="text-xs text-primary font-medium">{emp.position}</p>}
                    <p className="text-xs text-muted-foreground">{emp.employee_id} · {emp.department}</p>
                    <p className="text-sm font-medium text-foreground mt-1">₱{(emp.daily_rate || 0).toLocaleString()}/day</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setFile201Employee(emp)}>
                     <FileText className="w-3.5 h-3.5" /> 201 File
                   </Button>

                   {emp.status !== 'archived' && (
                     <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setIdEmployee(emp)}>
                       <CreditCard className="w-3.5 h-3.5" /> ID
                     </Button>
                   )}
                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => { setEditEmployee(emp); setShowForm(true); }}>
                     <Edit2 className="w-3.5 h-3.5" /> Edit
                   </Button>
                   {emp.status !== 'archived' && emp.status !== 'resigned' && (
                     <Button
                       size="sm"
                       variant="outline"
                       className="gap-1 text-amber-700 hover:bg-amber-50"
                       disabled={updateStatusMutation.isPending}
                       onClick={() => { if (confirm('Tag this employee as resigned?')) updateStatusMutation.mutate({ id: emp.id, status: 'resigned' }); }}
                     >
                       <UserMinus className="w-3.5 h-3.5" /> Resign
                     </Button>
                   )}
                 </div>
              </CardContent>
            </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-muted-foreground text-sm">No employees found.</div>
          )}
        </div>
      )}

      {/* Employee Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEmployee ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>
          <EmployeeForm
            key={editEmployee?.id || 'new'}
            employee={editEmployee}
            onUpdated={() => qc.invalidateQueries({ queryKey: ['employees'] })}
            onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['employees'] }); }}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ID Card Dialog */}
      <Dialog open={!!idEmployee} onOpenChange={() => setIdEmployee(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Employee ID Card</DialogTitle>
          </DialogHeader>
          {idEmployee && <EmployeeIdCard employee={idEmployee} />}
        </DialogContent>
      </Dialog>

      {/* 201 File Dialog */}
      <Dialog open={!!file201Employee} onOpenChange={() => setFile201Employee(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>201 File — {file201EmployeeLive?.first_name} {file201EmployeeLive?.last_name}</DialogTitle>
          </DialogHeader>
          {file201EmployeeLive && <Employee201File employee={file201EmployeeLive} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
