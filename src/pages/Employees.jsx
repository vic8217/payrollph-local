import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/lib/CompanyContext';
import { Plus, Search, Edit2, Trash2, CreditCard, UserCircle, FileText, Upload, Download } from 'lucide-react';
import EmployeeIdCard from '@/components/employees/EmployeeIdCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EmployeeForm from '@/components/employees/EmployeeForm';

import Employee201File from '@/components/employees/Employee201File';

export default function Employees() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null);
  const [idEmployee, setIdEmployee] = useState(null);
  const [file201Employee, setFile201Employee] = useState(null);
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();

  const downloadTemplate = () => {
    const headers = [
      'employee_id', 'first_name', 'last_name', 'middle_name', 'email', 'phone',
      'department', 'position', 'employment_type', 'agency_fee_percentage',
      'date_hired', 'daily_rate', 'monthly_rate', 'work_schedule',
      'sss_number', 'philhealth_number', 'pagibig_number', 'tin_number',
      'bank_account', 'max_cash_advance', 'status'
    ];
    const example = [
      'EMP001', 'Juan', 'Dela Cruz', 'Santos', 'juan@example.com', '09123456789',
      'Sales', 'Sales Manager', 'regular', '', '2024-01-15', '2500', '50000',
      'day_shift', '12-3456789-1', '11-123456789-1', '1234-1234-1234', '123-456-789-000',
      'ACC123456789', '10000', 'active'
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
            emp.max_cash_advance = emp.max_cash_advance ? parseFloat(emp.max_cash_advance) : undefined;
            emp.company_profile_id = activeCompanyId;

            await appApi.entities.Employee.create(emp);
          }
        }

        qc.invalidateQueries({ queryKey: ['employees'] });
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

  const deleteMutation = useMutation({
    mutationFn: (id) => appApi.entities.Employee.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  const filtered = employees.filter(e =>
    `${e.first_name} ${e.last_name} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = { active: 'bg-green-100 text-green-700', inactive: 'bg-gray-100 text-gray-600', terminated: 'bg-red-100 text-red-600' };

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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(emp => (
            <Card key={emp.id} className="border border-border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <UserCircle className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-foreground truncate">{emp.first_name} {emp.last_name}</p>
                      <Badge className={`text-xs capitalize px-1.5 py-0.5 ${statusColor[emp.status] || ''}`} variant="outline">
                        {emp.status}
                      </Badge>
                    </div>
                    {emp.position && <p className="text-xs text-primary font-medium">{emp.position}</p>}
                    <p className="text-xs text-muted-foreground">{emp.employee_id} · {emp.department}</p>
                    <p className="text-sm font-medium text-foreground mt-1">₱{(emp.daily_rate || 0).toLocaleString()}/day</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setFile201Employee(emp)}>
                     <FileText className="w-3.5 h-3.5" /> 201 File
                   </Button>

                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setIdEmployee(emp)}>
                     <CreditCard className="w-3.5 h-3.5" /> ID
                   </Button>
                   <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => { setEditEmployee(emp); setShowForm(true); }}>
                     <Edit2 className="w-3.5 h-3.5" /> Edit
                   </Button>
                   <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => { if (confirm('Delete this employee?')) deleteMutation.mutate(emp.id); }}>
                     <Trash2 className="w-3.5 h-3.5" />
                   </Button>
                 </div>
              </CardContent>
            </Card>
          ))}
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
            <DialogTitle>201 File — {file201Employee?.first_name} {file201Employee?.last_name}</DialogTitle>
          </DialogHeader>
          {file201Employee && <Employee201File employee={file201Employee} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}