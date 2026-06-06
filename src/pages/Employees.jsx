import { useMemo, useState } from 'react';
import { appApi } from '@/lib/appApi';
import { ensureCashAdvanceBeginningLedger } from '@/lib/cashAdvanceLedger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/lib/CompanyContext';
import { Plus, Search, Edit2, Archive, CreditCard, FileText, Upload, Download, UserMinus, RotateCcw, Gift, Trash2 } from 'lucide-react';
import EmployeeIdCard from '@/components/employees/EmployeeIdCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const normalizeEmployeeId = (value) => String(value || '').trim().toLowerCase();
const normalizeEmployeeStatus = (value) => String(value || 'active').trim().toLowerCase() || 'active';
const employeeStatusLabel = (value) => {
  const status = normalizeEmployeeStatus(value);
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const defaultIncentiveSettings = {
  attendance: {
    enabled: false,
    amount: '',
  },
  special_programs: [],
};

const formatPeso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function todayManilaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeIncentiveSettings(employee) {
  const settings = employee?.incentive_settings || {};
  return {
    attendance: {
      enabled: Boolean(settings.attendance?.enabled),
      amount: settings.attendance?.amount ?? '',
    },
    special_programs: Array.isArray(settings.special_programs)
      ? settings.special_programs.map(program => ({
          ...program,
          id: program.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
          amount: Number(program.amount) || 0,
        }))
      : [],
  };
}

export default function Employees() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null);
  const [idEmployee, setIdEmployee] = useState(null);
  const [file201Employee, setFile201Employee] = useState(null);
  const [incentiveEmployee, setIncentiveEmployee] = useState(null);
  const [incentiveSettings, setIncentiveSettings] = useState(defaultIncentiveSettings);
  const [specialDraft, setSpecialDraft] = useState({ program_name: '', amount: '', reason: '' });
  const [editingSpecialId, setEditingSpecialId] = useState(null);
  const [editingAttendance, setEditingAttendance] = useState(false);
  const [incentivePasscodes, setIncentivePasscodes] = useState({ hr: '', manager: '' });
  const [incentiveError, setIncentiveError] = useState('');
  const [statusFilter, setStatusFilter] = useState('current');
  const qc = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();

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

        const existingEmployeeIds = new Set(employees.map(emp => normalizeEmployeeId(emp.employee_id)).filter(Boolean));
        const uploadedEmployeeIds = new Map();
        const rowsToImport = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const emp = {};
          headers.forEach((h, idx) => {
            emp[h] = values[idx] || undefined;
          });

          if (emp.employee_id) {
            const normalizedEmployeeId = normalizeEmployeeId(emp.employee_id);
            if (existingEmployeeIds.has(normalizedEmployeeId)) {
              throw new Error(`Row ${i + 1}: employee_id "${emp.employee_id}" already exists.`);
            }
            if (uploadedEmployeeIds.has(normalizedEmployeeId)) {
              throw new Error(`Row ${i + 1}: employee_id "${emp.employee_id}" is repeated in the upload. First found on row ${uploadedEmployeeIds.get(normalizedEmployeeId)}.`);
            }
            uploadedEmployeeIds.set(normalizedEmployeeId, i + 1);

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

            rowsToImport.push({ emp, beginningBalance, weeklyDeduction });
          }
        }

        for (const { emp, beginningBalance, weeklyDeduction } of rowsToImport) {
            await appApi.entities.Employee.create(emp);

            if (beginningBalance > 0) {
              const payrollWeeks = weeklyDeduction > 0 ? Math.ceil(beginningBalance / weeklyDeduction) : 0;
              const beginningAdvance = await appApi.entities.CashAdvance.create({
                employee_id: emp.employee_id,
                employee_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
                department: emp.department,
                amount_requested: beginningBalance,
                amount_approved: beginningBalance,
                beginning_balance: beginningBalance,
                remaining_balance: beginningBalance,
                deduction_payroll_periods: payrollWeeks,
                deduction_amount_per_payroll: weeklyDeduction,
                deduction_periods_remaining: payrollWeeks,
                reason: 'Beginning balance from previous cash advance',
                advance_type: 'beginning_balance',
                request_date: emp.date_hired || new Date().toISOString().slice(0, 10),
                status: 'approved',
                company_profile_id: activeCompanyId,
              });
              await ensureCashAdvanceBeginningLedger(beginningAdvance);
            }
        }

        qc.invalidateQueries({ queryKey: ['employees'] });
        qc.invalidateQueries({ queryKey: ['cashAdvances'] });
        alert(`Successfully imported ${rowsToImport.length} employee(s)`);
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

  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['cashAdvances', activeCompanyId],
    queryFn: () => appApi.entities.CashAdvance.filter({ company_profile_id: activeCompanyId }, '-created_date', 500),
    enabled: !!activeCompanyId,
  });

  const { data: dailyPasscodes = [] } = useQuery({
    queryKey: ['dailyPasscodes', activeCompanyId],
    queryFn: () => appApi.entities.DailyPasscode.filter({ company_profile_id: activeCompanyId }, '-date', 7),
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

  const saveIncentivesMutation = useMutation({
    mutationFn: ({ id, settings }) => appApi.entities.Employee.update(id, { incentive_settings: settings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setIncentiveEmployee(null);
    },
  });

  const statusCounts = employees.reduce((counts, employee) => {
    const status = normalizeEmployeeStatus(employee.status);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const currentCount = employees.filter(e => normalizeEmployeeStatus(e.status) !== 'archived').length;

  const filtered = employees.filter(e =>
    (statusFilter === 'all' ||
      (statusFilter === 'current' ? normalizeEmployeeStatus(e.status) !== 'archived' : normalizeEmployeeStatus(e.status) === statusFilter)) &&
    `${employeeFullName(e)} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase())
  );

  /** Keep 201 File in sync after employee record updates (e.g. cash advance agreement) while dialog stays open. */
  const employeesWithCashAdvanceBalances = useMemo(() => {
    return employees.map(employee => {
      if (parseFloat(employee.cash_advance_beginning_balance) > 0) return employee;

      const beginningAdvance = cashAdvances.find(ca =>
        ca.employee_id === employee.employee_id &&
        ca.advance_type === 'beginning_balance'
      );
      if (!beginningAdvance) return employee;

      const beginningBalance = beginningAdvance.beginning_balance
        ?? beginningAdvance.amount_approved
        ?? beginningAdvance.amount_requested
        ?? beginningAdvance.remaining_balance;
      if (!(parseFloat(beginningBalance) > 0)) return employee;

      return {
        ...employee,
        cash_advance_beginning_balance: beginningBalance,
        cash_advance_weekly_deduction: employee.cash_advance_weekly_deduction
          ?? beginningAdvance.deduction_amount_per_payroll
          ?? '',
      };
    });
  }, [employees, cashAdvances]);

  const editEmployeeLive = useMemo(() => {
    if (!editEmployee) return null;
    return employeesWithCashAdvanceBalances.find(e => e.id === editEmployee.id) ?? editEmployee;
  }, [employeesWithCashAdvanceBalances, editEmployee]);

  const file201EmployeeLive = useMemo(() => {
    if (!file201Employee) return null;
    return employeesWithCashAdvanceBalances.find(e => e.id === file201Employee.id) ?? file201Employee;
  }, [employeesWithCashAdvanceBalances, file201Employee]);

  const openIncentiveDialog = (employee) => {
    setIncentiveEmployee(employee);
    setIncentiveSettings(normalizeIncentiveSettings(employee));
    setSpecialDraft({ program_name: '', amount: '', reason: '' });
    setEditingSpecialId(null);
    setEditingAttendance(false);
    setIncentivePasscodes({ hr: '', manager: '' });
    setIncentiveError('');
  };

  const addSpecialProgram = () => {
    const amount = parseFloat(specialDraft.amount);
    if (!specialDraft.program_name.trim() || !(amount > 0)) return;
    setIncentiveSettings(prev => ({
      ...prev,
      special_programs: editingSpecialId
        ? prev.special_programs.map(program => program.id === editingSpecialId
          ? {
              ...program,
              program_name: specialDraft.program_name.trim(),
              amount,
              reason: specialDraft.reason.trim(),
            }
          : program)
        : [
            ...prev.special_programs,
            {
              id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
              program_name: specialDraft.program_name.trim(),
              amount,
              reason: specialDraft.reason.trim(),
            },
          ],
    }));
    setSpecialDraft({ program_name: '', amount: '', reason: '' });
    setEditingSpecialId(null);
  };

  const editSpecialProgram = (program) => {
    setEditingSpecialId(program.id);
    setSpecialDraft({
      program_name: program.program_name || '',
      amount: String(program.amount || ''),
      reason: program.reason || '',
    });
  };

  const deleteSpecialProgram = (program) => {
    if (!verifyIncentivePasscodes()) return;
    if (!confirm(`Delete ${program.program_name || 'this special incentive'}?`)) return;
    setIncentiveSettings(prev => ({
      ...prev,
      special_programs: prev.special_programs.filter(item => item.id !== program.id),
    }));
    if (editingSpecialId === program.id) {
      setEditingSpecialId(null);
      setSpecialDraft({ program_name: '', amount: '', reason: '' });
    }
  };

  const verifyIncentivePasscodes = () => {
    const todayPasscode = dailyPasscodes.find(passcode => passcode.date === todayManilaDate());
    if (!todayPasscode) {
      setIncentiveError('No Daily Passcode found for today. Generate one first.');
      return false;
    }
    if (incentivePasscodes.hr.trim() !== String(todayPasscode.passcode || '')) {
      setIncentiveError('Incorrect HR officer passcode.');
      return false;
    }
    if (incentivePasscodes.manager.trim() !== String(todayPasscode.manager_passcode || '')) {
      setIncentiveError('Incorrect manager passcode.');
      return false;
    }
    setIncentiveError('');
    return true;
  };

  const saveIncentives = () => {
    if (!incentiveEmployee || !verifyIncentivePasscodes()) return;
    saveIncentivesMutation.mutate({
      id: incentiveEmployee.id,
      settings: {
        attendance: {
          enabled: incentiveSettings.attendance.enabled,
          amount: parseFloat(incentiveSettings.attendance.amount) || 0,
        },
        special_programs: incentiveSettings.special_programs,
      },
    });
  };

  const specialProgramsCount = incentiveSettings.special_programs.length;
  const specialProgramsDailyTotal = incentiveSettings.special_programs.reduce(
    (sum, program) => sum + (Number(program.amount) || 0),
    0
  );

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
            const status = normalizeEmployeeStatus(emp.status);

            return (
            <Card key={emp.id} className="border border-border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 relative">
                <div className="absolute right-4 top-4">
                  {status === 'archived' ? (
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
                      disabled={status !== 'resigned' || updateStatusMutation.isPending}
                      title={status === 'resigned' ? 'Archive resigned employee' : 'Tag employee as resigned before archiving'}
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
                      <Badge className={`shrink-0 text-[11px] font-medium px-2 py-0.5 leading-none ${statusColor[status] || statusColor.active}`} variant="outline">
                        {employeeStatusLabel(status)}
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

                   {status !== 'archived' && (
                     <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setIdEmployee(emp)}>
                       <CreditCard className="w-3.5 h-3.5" /> ID
                     </Button>
                   )}
                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => { setEditEmployee(emp); setShowForm(true); }}>
                     <Edit2 className="w-3.5 h-3.5" /> Edit
                   </Button>
                   {status !== 'archived' && (
                     <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => openIncentiveDialog(emp)}>
                       <Gift className="w-3.5 h-3.5" /> Incentives
                     </Button>
                   )}
                   {status !== 'archived' && status !== 'resigned' && (
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
            <DialogTitle>{editEmployeeLive ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>
          <EmployeeForm
            key={editEmployeeLive?.id || 'new'}
            employee={editEmployeeLive}
            onUpdated={() => qc.invalidateQueries({ queryKey: ['employees'] })}
            onSaved={() => {
              setShowForm(false);
              qc.invalidateQueries({ queryKey: ['employees'] });
              qc.invalidateQueries({ queryKey: ['cashAdvances'] });
            }}
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
          {idEmployee && <EmployeeIdCard employee={idEmployee} company={activeCompany} />}
        </DialogContent>
      </Dialog>

      {/* Incentives Dialog */}
      <Dialog open={!!incentiveEmployee} onOpenChange={(open) => !open && setIncentiveEmployee(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Employee Incentives — {incentiveEmployee ? employeeFullName(incentiveEmployee) : ''}</DialogTitle>
          </DialogHeader>
          {incentiveEmployee && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">No absence / no late incentive</p>
                    <p className="text-xs text-muted-foreground">
                      Weekly amount granted when the employee completes the full work week — all expected work days (holidays and rest days excluded) with no absence, no late, and at least 8 hours per day.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={incentiveSettings.attendance.enabled}
                        disabled={!editingAttendance}
                        onChange={(event) => setIncentiveSettings(prev => ({
                          ...prev,
                          attendance: { ...prev.attendance, enabled: event.target.checked },
                        }))}
                      />
                      Enabled
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => setEditingAttendance(prev => !prev)}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {editingAttendance ? 'Done' : 'Edit'}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Default amount per completed work week</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={incentiveSettings.attendance.amount}
                    disabled={!editingAttendance}
                    onChange={(event) => setIncentiveSettings(prev => ({
                      ...prev,
                      attendance: { ...prev.attendance, amount: event.target.value },
                    }))}
                    placeholder="0.00"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Special incentive programs</p>
                  <p className="text-xs text-muted-foreground">
                    Amounts are treated as per-day rates and multiplied by each approved day the employee is present.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase text-muted-foreground">Programs in place</p>
                    <p className="text-sm font-semibold text-foreground">{specialProgramsCount}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase text-muted-foreground">Total per present day</p>
                    <p className="text-sm font-semibold text-emerald-700">{formatPeso(specialProgramsDailyTotal)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase text-muted-foreground">Payroll calculation</p>
                    <p className="text-sm font-semibold text-foreground">Rate × present days</p>
                  </div>
                </div>

                {incentiveSettings.special_programs.length > 0 && (
                  <div className="space-y-2">
                    {incentiveSettings.special_programs.map(program => (
                      <div key={program.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">{program.program_name}</p>
                          <p className="text-xs text-muted-foreground">{program.reason || 'No reason set'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-emerald-700">{formatPeso(program.amount)}/day</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-muted-foreground hover:bg-muted"
                            onClick={() => editSpecialProgram(program)}
                            title="Edit special incentive"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => deleteSpecialProgram(program)}
                            title="Delete special incentive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Program name</Label>
                    <Input
                      value={specialDraft.program_name}
                      onChange={(event) => setSpecialDraft(prev => ({ ...prev, program_name: event.target.value }))}
                      placeholder="e.g. Sales target bonus"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Default amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialDraft.amount}
                      onChange={(event) => setSpecialDraft(prev => ({ ...prev, amount: event.target.value }))}
                      placeholder="0.00"
                      className="h-9"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Default reason</Label>
                  <Textarea
                    value={specialDraft.reason}
                    onChange={(event) => setSpecialDraft(prev => ({ ...prev, reason: event.target.value }))}
                    placeholder="Reason or criteria for this incentive"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSpecialProgram}>
                  <Plus className="w-3.5 h-3.5" /> {editingSpecialId ? 'Update Special Program' : 'Add Special Program'}
                </Button>
                {editingSpecialId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingSpecialId(null);
                      setSpecialDraft({ program_name: '', amount: '', reason: '' });
                    }}
                  >
                    Cancel edit
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Approval passcodes</p>
                  <p className="text-xs text-muted-foreground">
                    Saving, changing, or removing incentive setup requires today&apos;s HR and manager passcodes.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">HR officer passcode</Label>
                    <Input
                      type="password"
                      value={incentivePasscodes.hr}
                      onChange={(event) => setIncentivePasscodes(prev => ({ ...prev, hr: event.target.value }))}
                      placeholder="Enter HR passcode"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Manager passcode</Label>
                    <Input
                      type="password"
                      value={incentivePasscodes.manager}
                      onChange={(event) => setIncentivePasscodes(prev => ({ ...prev, manager: event.target.value }))}
                      placeholder="Enter manager passcode"
                      className="h-9"
                    />
                  </div>
                </div>
                {incentiveError && <p className="text-xs text-destructive">{incentiveError}</p>}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIncentiveEmployee(null)}>Cancel</Button>
                <Button
                  onClick={saveIncentives}
                  disabled={saveIncentivesMutation.isPending}
                >
                  {saveIncentivesMutation.isPending ? 'Saving...' : 'Save Approved Incentives'}
                </Button>
              </div>
            </div>
          )}
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
