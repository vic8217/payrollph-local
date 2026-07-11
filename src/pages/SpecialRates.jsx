// @ts-nocheck
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const nameOf = employee => [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');

export default function SpecialRates() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [fee, setFee] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', companyId],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: companyId }, 'first_name', 500),
    enabled: !!companyId,
  });
  const regularEmployees = useMemo(() => employees.filter(employee => employee.status === 'active' && !employee.special_rate_enabled), [employees]);
  const taggedEmployees = useMemo(() => employees.filter(employee => employee.special_rate_enabled), [employees]);
  const mutation = useMutation({
    mutationFn: data => appApi.functions.invoke('updateSpecialRateEmployee', data),
    onSuccess: async () => {
      setEmployeeId(''); setFee(''); setPasscode(''); setError('');
      await qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: err => setError(err.message || 'Unable to update special rate.'),
  });
  const save = event => {
    event.preventDefault(); setError('');
    mutation.mutate({ company_profile_id: companyId, employee_record_id: employeeId, fixed_daily_fee: fee, enabled: true, manager_passcode: passcode });
  };
  const remove = employee => {
    const managerPasscode = window.prompt(`Enter admin manager passcode to remove ${nameOf(employee)} from Special Rates:`);
    if (!managerPasscode) return;
    mutation.mutate({ company_profile_id: companyId, employee_record_id: employee.id, fixed_daily_fee: 0, enabled: false, manager_passcode: managerPasscode });
  };

  return <div className="p-6 max-w-5xl mx-auto space-y-5">
    <div><h1 className="text-2xl font-bold">Special Rates</h1><p className="text-sm text-muted-foreground">Confidential fixed daily fees, separate from attendance and regular payroll.</p></div>
    <Card className="p-5">
      <form onSubmit={save} className="grid md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2"><label className="text-sm font-medium">Employee</label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={employeeId} onChange={e => setEmployeeId(e.target.value)} required><option value="">Select employee</option>{regularEmployees.map(employee => <option key={employee.id} value={employee.id}>{nameOf(employee)} · {employee.employee_id}</option>)}</select></div>
        <div><label className="text-sm font-medium">Fixed fee per day</label><Input className="mt-1" type="number" min="0.01" step="0.01" value={fee} onChange={e => setFee(e.target.value)} required /></div>
        <div><label className="text-sm font-medium">Admin manager passcode</label><Input className="mt-1" type="password" value={passcode} onChange={e => setPasscode(e.target.value)} required /></div>
        <Button className="md:col-span-4 gap-2" disabled={mutation.isPending}><ShieldCheck className="w-4 h-4" />Confirm confidential tagging</Button>
      </form>{error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Card>
    <Card className="overflow-hidden"><div className="px-5 py-4 border-b font-semibold">Tagged employees</div>{taggedEmployees.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No employees tagged.</p> : taggedEmployees.map(employee => <div key={employee.id} className="flex items-center justify-between gap-4 px-5 py-4 border-b last:border-0"><div><p className="font-medium">{nameOf(employee)}</p><p className="text-xs text-muted-foreground">{employee.employee_id} · Excluded from Attendance and Payroll</p></div><div className="flex items-center gap-4"><span className="font-semibold">₱{Number(employee.special_fixed_daily_fee || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}/day</span><Button variant="outline" size="sm" onClick={() => remove(employee)}>Remove</Button></div></div>)}</Card>
  </div>;
}
