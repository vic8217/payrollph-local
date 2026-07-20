// @ts-nocheck
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const emptySet = { name: '', sss: '', philhealth: '', pagibig: '' };
const emptyApply = { periodId: '', target: 'all', employeeRecordId: '', hrPasscode: '', adminPasscode: '' };
const employeeName = employee => [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');
const peso = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MandatoryDeductions() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const qc = useQueryClient();
  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySet);
  const [applyingSet, setApplyingSet] = useState(null);
  const [applyForm, setApplyForm] = useState(emptyApply);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: sets = [], isLoading } = useQuery({ queryKey: ['mandatoryDeductionSets', companyId], queryFn: () => appApi.entities.MandatoryDeductionSet.filter({ company_profile_id: companyId }, '-updated_date', 500), enabled: !!companyId });
  const { data: employees = [] } = useQuery({ queryKey: ['employees', companyId], queryFn: () => appApi.entities.Employee.filter({ company_profile_id: companyId, status: 'active' }, 'first_name', 500), enabled: !!companyId });
  const { data: periods = [] } = useQuery({ queryKey: ['payrollPeriods', companyId], queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: companyId }, '-start_date', 100), enabled: !!companyId });
  const editablePeriods = periods.filter(period => period.status !== 'released');

  const closeSetDialog = () => { setSetDialogOpen(false); setEditing(null); setForm(emptySet); setError(''); };
  const openNew = () => { setEditing(null); setForm(emptySet); setSetDialogOpen(true); setError(''); };
  const openEdit = set => { setEditing(set); setForm({ name: set.name || '', sss: String(set.sss_contribution ?? ''), philhealth: String(set.philhealth_contribution ?? ''), pagibig: String(set.pagibig_contribution ?? '') }); setSetDialogOpen(true); setError(''); };
  const openApply = set => { setApplyingSet(set); setApplyForm(emptyApply); setError(''); setSuccess(''); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amounts = [form.sss, form.philhealth, form.pagibig].map(Number);
      if (!form.name.trim()) throw new Error('Enter a name for this deduction set.');
      if (amounts.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Enter valid non-negative deduction amounts.');
      const data = { company_profile_id: companyId, name: form.name.trim(), sss_contribution: amounts[0], philhealth_contribution: amounts[1], pagibig_contribution: amounts[2], is_active: true };
      return editing ? appApi.entities.MandatoryDeductionSet.update(editing.id, data) : appApi.entities.MandatoryDeductionSet.create(data);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['mandatoryDeductionSets'] }); closeSetDialog(); },
    onError: err => setError(err.message || 'Unable to save the deduction set.'),
  });
  const deleteMutation = useMutation({ mutationFn: set => appApi.entities.MandatoryDeductionSet.delete(set.id), onSuccess: () => qc.invalidateQueries({ queryKey: ['mandatoryDeductionSets'] }) });
  const applyMutation = useMutation({
    mutationFn: () => appApi.functions.invoke('applyMandatoryDeductionSet', {
      company_profile_id: companyId, deduction_set_id: applyingSet.id, payroll_period_id: applyForm.periodId,
      target: applyForm.target, employee_record_id: applyForm.employeeRecordId,
      hr_passcode: applyForm.hrPasscode, admin_passcode: applyForm.adminPasscode,
    }),
    onSuccess: async result => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['payrollPeriods'] }), qc.invalidateQueries({ queryKey: ['payrollRecords'] })]);
      setApplyingSet(null); setApplyForm(emptyApply); setError('');
      setSuccess(`Deduction set applied to ${result.updated_count} payroll record${result.updated_count === 1 ? '' : 's'}.`);
    },
    onError: err => setError(err.message || 'Unable to apply the deduction set.'),
  });
  const remove = set => { if (window.confirm(`Delete “${set.name}”? Existing payroll records will not be changed.`)) deleteMutation.mutate(set); };

  return <div className="p-6 max-w-6xl mx-auto space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"><div><h1 className="text-2xl font-bold">Mandatory Deduction Sets</h1><p className="text-sm text-muted-foreground mt-1">Maintain HR-computed SSS, PhilHealth, and Pag-IBIG amounts, then securely apply a set to a payroll period.</p></div><Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Create set</Button></div>
    <Card className="p-4 bg-muted/30"><div className="flex gap-3"><ShieldCheck className="w-5 h-5 text-primary mt-0.5" /><div><p className="font-medium text-sm">Dual-passcode approval required</p><p className="text-xs text-muted-foreground mt-1">A set does not affect payroll until a payroll period and target are selected and both the HR Officer and Admin Manager passcodes are verified.</p></div></div></Card>
    {success && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
    {isLoading ? <Card className="p-10 text-center text-muted-foreground">Loading deduction sets…</Card> : sets.length === 0 ? <Card className="p-12 text-center"><ListChecks className="w-10 h-10 mx-auto text-muted-foreground mb-3" /><p className="font-medium">No mandatory deduction sets yet</p><p className="text-sm text-muted-foreground mt-1">Create the first reusable set of manually computed amounts.</p></Card> : <div className="grid md:grid-cols-2 gap-4">{sets.map(set => <Card key={set.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{set.name}</h2><Badge variant="secondary" className="mt-2">Reusable template</Badge></div><div className="flex"><Button variant="ghost" size="icon" onClick={() => openEdit(set)} aria-label={`Edit ${set.name}`}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => remove(set)} aria-label={`Delete ${set.name}`}><Trash2 className="w-4 h-4" /></Button></div></div><div className="grid grid-cols-3 gap-2 my-5 text-center"><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">SSS</p><p className="font-semibold mt-1">{peso(set.sss_contribution)}</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">PhilHealth</p><p className="font-semibold mt-1">{peso(set.philhealth_contribution)}</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Pag-IBIG</p><p className="font-semibold mt-1">{peso(set.pagibig_contribution)}</p></div></div><Button className="w-full" onClick={() => openApply(set)}><ShieldCheck className="w-4 h-4 mr-2" />Apply to payroll period</Button></Card>)}</div>}

    <Dialog open={setDialogOpen} onOpenChange={open => !open && closeSetDialog()}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit deduction set' : 'Create deduction set'}</DialogTitle><DialogDescription>These amounts will remain a template until separately applied to a payroll period.</DialogDescription></DialogHeader><div className="space-y-4"><label className="block text-sm font-medium">Set name<Input className="mt-1" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder="Example: Regular employees" /></label><div className="grid sm:grid-cols-3 gap-3">{[['sss', 'SSS'], ['philhealth', 'PhilHealth'], ['pagibig', 'Pag-IBIG']].map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<Input className="mt-1" type="number" min="0" step="0.01" value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} placeholder="0.00" /></label>)}</div>{error && <p className="text-sm text-destructive">{error}</p>}</div><DialogFooter><Button variant="outline" onClick={closeSetDialog}>Cancel</Button><Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save set'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!applyingSet} onOpenChange={open => { if (!open) { setApplyingSet(null); setApplyForm(emptyApply); setError(''); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Apply {applyingSet?.name}</DialogTitle><DialogDescription>Select the exact payroll period and target. This changes payroll only after both passcodes are verified.</DialogDescription></DialogHeader><div className="space-y-4"><label className="block text-sm font-medium">Payroll period<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={applyForm.periodId} onChange={event => setApplyForm(previous => ({ ...previous, periodId: event.target.value }))}><option value="">Select generated period</option>{editablePeriods.map(period => <option key={period.id} value={period.id}>{period.period_name} ({period.start_date} – {period.end_date}) · {period.status}</option>)}</select></label><div><p className="text-sm font-medium mb-2">Apply to</p><div className="grid grid-cols-2 gap-2"><Button type="button" variant={applyForm.target === 'all' ? 'default' : 'outline'} onClick={() => setApplyForm(previous => ({ ...previous, target: 'all', employeeRecordId: '' }))}>All employees</Button><Button type="button" variant={applyForm.target === 'employee' ? 'default' : 'outline'} onClick={() => setApplyForm(previous => ({ ...previous, target: 'employee' }))}>Specific employee</Button></div></div>{applyForm.target === 'employee' && <label className="block text-sm font-medium">Employee<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={applyForm.employeeRecordId} onChange={event => setApplyForm(previous => ({ ...previous, employeeRecordId: event.target.value }))}><option value="">Select employee</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employeeName(employee)} · {employee.employee_id || 'No ID'}</option>)}</select></label>}<div className="grid sm:grid-cols-2 gap-3"><label className="text-sm font-medium">HR Officer passcode<Input className="mt-1" type="password" value={applyForm.hrPasscode} onChange={event => setApplyForm(previous => ({ ...previous, hrPasscode: event.target.value }))} /></label><label className="text-sm font-medium">Admin Manager passcode<Input className="mt-1" type="password" value={applyForm.adminPasscode} onChange={event => setApplyForm(previous => ({ ...previous, adminPasscode: event.target.value }))} /></label></div>{editablePeriods.length === 0 && <p className="text-sm text-amber-700">No editable payroll periods are available. Generate a payroll period first.</p>}{error && <p className="text-sm text-destructive">{error}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setApplyingSet(null)}>Cancel</Button><Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || !applyForm.periodId || (applyForm.target === 'employee' && !applyForm.employeeRecordId) || !applyForm.hrPasscode.trim() || !applyForm.adminPasscode.trim()}>{applyMutation.isPending ? 'Verifying…' : 'Verify and apply'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
