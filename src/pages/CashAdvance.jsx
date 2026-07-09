// @ts-nocheck
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, CreditCard, CheckCircle2, XCircle, ChevronDown, ChevronUp, AlertTriangle, CalendarDays, Search, SlidersHorizontal } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { ensureCashAdvanceAdditionLedger, ensureCashAdvanceBeginningLedger, ensureCashAdvanceDeductionBackfill } from '@/lib/cashAdvanceLedger';
import DeductionScheduleView from '@/components/cashadvance/DeductionScheduleView';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';

const statusColors = {
  pending: 'bg-amber-100 text-amber-700',
  approved_by_hr: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  deducted: 'bg-gray-100 text-gray-600',
};

const getCashAdvanceBalance = (ca) => ca.remaining_balance != null
  ? ca.remaining_balance
  : (ca.amount_approved || ca.amount_requested || 0);

const isActiveCashAdvance = (ca) => ['pending', 'approved_by_hr', 'approved'].includes(ca.status);
const isOutstandingCashAdvance = (ca) => ca.status === 'approved';
const countsAgainstRegularLimit = (ca) =>
  isActiveCashAdvance(ca) && ca.advance_type !== 'emergency' && ca.advance_type !== 'beginning_balance';

const ledgerTypeLabels = {
  beginning: 'Beginning Advance',
  addition: 'Advance Availed',
  deduction: 'Payroll Deduction',
};

function ledgerTypeLabel(row) {
  if (row.source === 'manual_adjustment') return 'Manual Adjustment';
  return ledgerTypeLabels[row.transaction_type] || row.transaction_type;
}

const ledgerSortKey = (row) => `${row.transaction_date || ''}${row.created_date || ''}${row.id || ''}`;

function withEmployeeRunningBalances(rows) {
  let runningBalance = 0;
  const chronologicalRows = [...rows].sort((a, b) => ledgerSortKey(a).localeCompare(ledgerSortKey(b)));

  return chronologicalRows
    .map(row => {
      const amount = Number(row.amount) || 0;
      runningBalance += row.transaction_type === 'deduction' ? -amount : amount;
      return {
        ...row,
        employee_running_balance: parseFloat(Math.max(runningBalance, 0).toFixed(2)),
      };
    })
    .reverse();
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }

  return data;
}

function entityUrl(entity, params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, key === 'filter' ? JSON.stringify(value) : String(value));
    }
  });

  const query = search.toString();
  return `/api/entities/${encodeURIComponent(entity)}${query ? `?${query}` : ''}`;
}

const entities = {
  filter(entity, filter = {}, sort, limit) {
    return requestJson(entityUrl(entity, { filter, sort, limit }));
  },
  create(entity, data) {
    return requestJson(entityUrl(entity), {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
  update(entity, id, data) {
    return requestJson(entityUrl(entity), {
      method: 'PATCH',
      body: JSON.stringify({ id, data }),
    });
  },
};

export default function CashAdvance() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount_requested: '', reason: '', needed_date: '' });
  const [filterStatus, setFilterStatus] = useState('all');
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'schedule' | 'ledger'
  const [notesDialog, setNotesDialog] = useState(null); // { id, type, amount_approved }
  const [notesText, setNotesText] = useState('');
  const [deductionPeriods, setDeductionPeriods] = useState('1');
  const [amountApproved, setAmountApproved] = useState('');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [expandedEmployee, setExpandedEmployee] = useState(null);
  const [employeeSearchInput, setEmployeeSearchInput] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedLedgerEmployeeId, setSelectedLedgerEmployeeId] = useState(null);
  const [adjustmentDialog, setAdjustmentDialog] = useState(null); // { cashAdvance, employee }
  const [adjustmentType, setAdjustmentType] = useState('decrease');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentHrPasscode, setAdjustmentHrPasscode] = useState('');
  const [adjustmentAdminPasscode, setAdjustmentAdminPasscode] = useState('');
  const [adjustmentError, setAdjustmentError] = useState('');
  const { user } = useAuth();
  const qc = useQueryClient();

  const { activeCompanyId } = useCompany();

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', activeCompanyId],
    queryFn: () => entities.filter('Employee', { company_profile_id: activeCompanyId }, '-created_date', 200),
    enabled: !!activeCompanyId,
  });

  const { data: cashAdvances = [], isLoading } = useQuery({
    queryKey: ['cashAdvances', activeCompanyId, employees.map(e => e.employee_id).join('|')],
    queryFn: async () => {
      const all = await entities.filter('CashAdvance', {}, '-created_date', 500);
      const employeeIds = new Set(employees.map(e => e.employee_id));
      const visible = all.filter(ca =>
        ca.company_profile_id === activeCompanyId ||
        (!ca.company_profile_id && employeeIds.has(ca.employee_id))
      );
      await Promise.all(
        visible
          .filter(ca => !ca.company_profile_id)
          .map(ca => entities.update('CashAdvance', ca.id, { company_profile_id: activeCompanyId }))
      );
      return visible.map(ca => ca.company_profile_id ? ca : { ...ca, company_profile_id: activeCompanyId });
    },
    enabled: !!activeCompanyId && employees.length > 0,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const { data: cashAdvanceLedger = [] } = useQuery({
    queryKey: ['cashAdvanceLedger', activeCompanyId, employees.map(e => e.employee_id).join('|')],
    queryFn: async () => {
      const all = await entities.filter('CashAdvanceLedger', {}, '-transaction_date', 2000);
      const employeeIds = new Set(employees.map(e => e.employee_id));
      return all.filter(row =>
        row.company_profile_id === activeCompanyId ||
        (!row.company_profile_id && employeeIds.has(row.employee_id))
      );
    },
    enabled: !!activeCompanyId && employees.length > 0,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  useEffect(() => {
    if (!cashAdvances.length) return;
    const approved = cashAdvances.filter(ca => ['approved', 'deducted'].includes(ca.status));
    if (!approved.length) return;

    Promise.all(
      approved.map(async (ca) => {
        if (ca.advance_type === 'beginning_balance') {
          await ensureCashAdvanceBeginningLedger(ca);
        } else {
          await ensureCashAdvanceAdditionLedger(ca);
        }
        await ensureCashAdvanceDeductionBackfill(ca);
      })
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
    }).catch(() => {});
  }, [cashAdvances, qc]);

  const { data: dailyPasscodes = [] } = useQuery({
    queryKey: ['dailyPasscodes', activeCompanyId],
    queryFn: () => entities.filter('DailyPasscode', { company_profile_id: activeCompanyId }, '-date', 1),
    enabled: !!activeCompanyId,
  });
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayPasscode = dailyPasscodes.find(p => p.date === todayStr);

  const currentEmployee = employees.find(e => e.user_email === user?.email);

  const createMutation = useMutation({
    mutationFn: (data) => entities.create('CashAdvance', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cashAdvances'] }); setShowForm(false); setForm({ amount_requested: '', reason: '', needed_date: '' }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, createAdditionLedger = false }) => {
      const updated = await entities.update('CashAdvance', id, data);
      if (data.passcode_audit_action) {
        await entities.create('PasscodeAuditLog', {
          company_profile_id: activeCompanyId,
          source_entity: 'CashAdvance',
          source_record_id: id,
          action: data.passcode_audit_action,
          occurred_at: data.passcode_audit_at,
          authorized_by: data.passcode_audit_by,
          reason: data.passcode_audit_reason,
          summary: data.passcode_audit_summary,
          employee_id: updated.employee_id,
          employee_name: updated.employee_name,
          amount: updated.amount_approved || updated.amount_requested,
          record_date: updated.request_date,
        });
      }
      if (createAdditionLedger) await ensureCashAdvanceAdditionLedger(updated);
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashAdvances'] });
      qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
      setNotesDialog(null);
    },
  });

  const adjustmentMutation = useMutation({
    mutationFn: (data) => requestJson('/api/functions/adjustCashAdvanceBalance', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashAdvances'] });
      qc.invalidateQueries({ queryKey: ['cashAdvanceLedger'] });
      qc.invalidateQueries({ queryKey: ['passcodeAudit'] });
      setAdjustmentDialog(null);
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setAdjustmentHrPasscode('');
      setAdjustmentAdminPasscode('');
      setAdjustmentError('');
    },
    onError: (error) => {
      setAdjustmentError(error?.message || 'Unable to adjust cash advance balance.');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!currentEmployee) return alert('Your profile is not linked to an employee record. Ask HR to set your user email.');
    const max = currentEmployee.max_cash_advance || 0;
    const requestedAmount = parseFloat(form.amount_requested);
    const currentRegularLimitBalance = cashAdvances
      .filter(ca => ca.employee_id === currentEmployee.employee_id && countsAgainstRegularLimit(ca))
      .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
    const available = Math.max(0, max - currentRegularLimitBalance);

    if (max > 0 && requestedAmount > available) {
      return alert(`Amount exceeds your available regular cash advance limit of ₱${available.toLocaleString()}`);
    }
    createMutation.mutate({
      employee_id: currentEmployee.employee_id,
      employee_name: `${currentEmployee.first_name} ${currentEmployee.last_name}`,
      department: currentEmployee.department,
      amount_requested: requestedAmount,
      reason: form.reason,
      needed_date: form.needed_date,
      request_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'pending',
      company_profile_id: activeCompanyId,
    });
  };

  const verifyPasscode = (type) => {
    if (!todayPasscode) {
      setPasscodeError('No passcode generated for today. Ask admin to generate one first.');
      return false;
    }
    const expected = type === 'manager' ? todayPasscode.manager_passcode : todayPasscode.passcode;
    if (passcodeInput !== expected) {
      setPasscodeError('Incorrect passcode. Please try again.');
      return false;
    }
    setPasscodeError('');
    return true;
  };

  const approve = (id, type) => {
    if (!verifyPasscode(type)) return;
    const auditBase = {
      passcode_audit_at: new Date().toISOString(),
      passcode_audit_by: user?.full_name || user?.email || 'unknown',
      passcode_audit_reason: notesText || null,
    };
    if (type === 'hr') {
      updateMutation.mutate({ id, data: {
        status: 'approved_by_hr',
        ...auditBase,
        passcode_audit_action: 'cash_advance_hr_approved',
        passcode_audit_summary: 'Cash advance approved by HR',
        ...(notesText ? { hr_notes: notesText } : {}),
      } });
    } else if (type === 'manager') {
      const periods = parseInt(deductionPeriods) || 1;
      const approved = parseFloat(amountApproved) || 0;
      if (!approved || approved <= 0) return alert('Please enter the approved amount.');
      if (periods < 1) return alert('Please enter the number of payroll periods for deduction.');
      const perPayroll = parseFloat((approved / periods).toFixed(2));
      updateMutation.mutate({
        id,
        createAdditionLedger: true,
        data: {
          status: 'approved',
          amount_approved: approved,
          approved_date: todayStr,
          remaining_balance: approved,
          deduction_payroll_periods: periods,
          deduction_amount_per_payroll: perPayroll,
          deduction_periods_remaining: periods,
          ...auditBase,
          passcode_audit_action: 'cash_advance_admin_approved',
          passcode_audit_summary: `Cash advance approved for ₱${approved.toFixed(2)}`,
          ...(notesText ? { manager_notes: notesText } : {}),
        },
      });
    }
  };

  const reject = (id) => {
    if (!verifyPasscode('hr')) return;
    updateMutation.mutate({ id, data: {
      status: 'rejected',
      passcode_audit_action: 'cash_advance_rejected',
      passcode_audit_at: new Date().toISOString(),
      passcode_audit_by: user?.full_name || user?.email || 'unknown',
      passcode_audit_reason: notesText || null,
      passcode_audit_summary: 'Cash advance rejected',
      ...(notesText ? { hr_notes: notesText } : {}),
    } });
  };

  const openAdjustmentDialog = (cashAdvance, employee) => {
    setAdjustmentDialog({ cashAdvance, employee });
    setAdjustmentType('decrease');
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setAdjustmentHrPasscode('');
    setAdjustmentAdminPasscode('');
    setAdjustmentError('');
  };

  const submitAdjustment = () => {
    const amount = parseFloat(adjustmentAmount);
    if (!(amount > 0)) {
      setAdjustmentError('Enter a valid adjustment amount.');
      return;
    }
    if (adjustmentReason.trim().length < 3) {
      setAdjustmentError('Enter a reason for the adjustment.');
      return;
    }
    if (!adjustmentHrPasscode.trim() || !adjustmentAdminPasscode.trim()) {
      setAdjustmentError('Both HR Officer and Admin passcodes are required.');
      return;
    }

    adjustmentMutation.mutate({
      company_profile_id: activeCompanyId,
      cash_advance_id: adjustmentDialog.cashAdvance.id,
      adjustment_type: adjustmentType,
      amount,
      reason: adjustmentReason.trim(),
      hr_passcode: adjustmentHrPasscode.trim(),
      admin_passcode: adjustmentAdminPasscode.trim(),
    });
  };

  const filtered = (filterStatus === 'all' ? cashAdvances : cashAdvances.filter(ca => ca.status === filterStatus))
    .sort((a, b) => (a.status === 'pending' || a.status === 'approved_by_hr' ? -1 : 1));

  // Build per-employee summary
  const employeeSummary = employees
    .filter(e => e.status === 'active')
    .map(e => {
	      const empAdvances = cashAdvances.filter(ca => ca.employee_id === e.employee_id);
	      const activeBalance = empAdvances
	        .filter(isOutstandingCashAdvance)
	        .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
      const regularLimitBalance = empAdvances
        .filter(countsAgainstRegularLimit)
        .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
      return { ...e, empAdvances, activeBalance, regularLimitBalance };
    })
    .filter(e => e.empAdvances.length > 0 || e.max_cash_advance > 0);
  const normalizedEmployeeSearch = employeeSearch.trim().toLowerCase();
  const visibleEmployeeSummary = normalizedEmployeeSearch
    ? employeeSummary.filter(e => [
        e.employee_id,
        e.first_name,
        e.middle_name,
        e.last_name,
        `${e.first_name || ''} ${e.middle_name || ''} ${e.last_name || ''}`,
        e.department,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedEmployeeSearch))
    : employeeSummary;

  const sortedLedger = [...cashAdvanceLedger]
    .sort((a, b) => ledgerSortKey(b).localeCompare(ledgerSortKey(a)));
  const selectedLedgerEmployee = employees.find(e => e.employee_id === selectedLedgerEmployeeId);
  const visibleLedgerRows = selectedLedgerEmployeeId
    ? sortedLedger.filter(row => row.employee_id === selectedLedgerEmployeeId)
    : sortedLedger;
  const ledgerByEmployee = visibleLedgerRows.reduce((groups, row) => {
    const key = row.employee_id || row.employee_name || 'unknown';
    if (!groups[key]) {
      groups[key] = {
        employeeName: row.employee_name || row.employee_id || 'Unknown Employee',
        employeeId: row.employee_id,
        rows: [],
      };
    }
    groups[key].rows.push(row);
    return groups;
  }, {});
  const employeeLedgerGroups = Object.values(ledgerByEmployee)
    .map(group => ({
      ...group,
      rows: withEmployeeRunningBalances(group.rows),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cash Advance (Vale)</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Request and manage employee vale</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'requests' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >Requests</button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'schedule' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            ><CalendarDays className="w-3.5 h-3.5" />Deduction Schedule</button>
            <button
              onClick={() => { setSelectedLedgerEmployeeId(null); setActiveTab('ledger'); }}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'ledger' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            ><CreditCard className="w-3.5 h-3.5" />Ledger</button>
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved_by_hr">HR Approved</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="deducted">Deducted</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Request Vale
          </Button>
        </div>
      </div>

      {/* Current employee limit display */}
      {currentEmployee && (
        <Card className="border border-primary/20 bg-primary/5 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Your Cash Advance Limit</p>
              <p className="text-lg font-bold text-primary">₱{(currentEmployee.max_cash_advance || 0).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Employee Summary Table */}
      {employeeSummary.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee Summary</p>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setEmployeeSearch(employeeSearchInput);
              }}
            >
              <Input
                value={employeeSearchInput}
                onChange={(e) => setEmployeeSearchInput(e.target.value)}
                placeholder="Search employee"
                className="h-8 w-56 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="h-8 gap-1.5">
                <Search className="w-3.5 h-3.5" /> Search
              </Button>
            </form>
          </div>
          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employee</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Department</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Limit</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Active Balance</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Remaining</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Ledger</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployeeSummary.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No employees match your search.</td>
                    </tr>
                  )}
                  {visibleEmployeeSummary.map(e => {
                    const limit = e.max_cash_advance || 0;
                    const remaining = Math.max(0, limit - e.regularLimitBalance);
                    const isExpanded = expandedEmployee === e.employee_id;
                    const hasLedger = cashAdvanceLedger.some(row => row.employee_id === e.employee_id);
                    return (
                      <>
                        <tr key={e.employee_id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setExpandedEmployee(isExpanded ? null : e.employee_id)}>
                          <td className="px-4 py-3 font-medium text-foreground">{e.first_name} {e.last_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.department || '—'}</td>
                          <td className="px-4 py-3 text-right">₱{limit.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-medium text-amber-600">₱{e.activeBalance.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-medium text-green-600">₱{remaining.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5"
                              disabled={!hasLedger}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedLedgerEmployeeId(e.employee_id);
                                setActiveTab('ledger');
                              }}
                            >
                              <CreditCard className="w-3.5 h-3.5" /> View Ledger
                            </Button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground inline" /> : <ChevronDown className="w-4 h-4 text-muted-foreground inline" />}
                          </td>
                        </tr>
                        {isExpanded && e.empAdvances.length > 0 && e.empAdvances.map(ca => (
                          <tr key={ca.id} className="bg-muted/30 border-b border-border last:border-0">
                            <td className="px-6 py-2 text-xs text-muted-foreground" colSpan={2}>{ca.reason}</td>
                            <td className="px-4 py-2 text-xs text-right text-foreground">₱{(ca.amount_requested || 0).toLocaleString()}</td>
                            <td className="px-4 py-2 text-xs text-right" colSpan={2}>
                              <Badge variant="outline" className={`text-xs ${statusColors[ca.status]}`}>{ca.status?.replace(/_/g, ' ')}</Badge>
                            </td>
                            <td className="px-4 py-2 text-xs text-right">
                              {['approved', 'deducted'].includes(ca.status) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1.5 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openAdjustmentDialog(ca, e);
                                  }}
                                >
                                  <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
                                </Button>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-right text-muted-foreground">{ca.request_date}</td>
                          </tr>
                        ))}
                        {isExpanded && e.empAdvances.length === 0 && (
                          <tr className="bg-muted/30">
                            <td colSpan={7} className="px-6 py-2 text-xs text-muted-foreground">No requests yet.</td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Deduction Schedule Tab */}
      {activeTab === 'schedule' && <DeductionScheduleView cashAdvances={cashAdvances} />}

      {/* Ledger Tab */}
      {activeTab === 'ledger' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cash Advance Transaction Ledger</p>
              {selectedLedgerEmployeeId && (
                <p className="text-sm font-medium text-foreground mt-1">
                  {selectedLedgerEmployee
                    ? `${selectedLedgerEmployee.first_name} ${selectedLedgerEmployee.last_name}`
                    : selectedLedgerEmployeeId}
                </p>
              )}
            </div>
            {selectedLedgerEmployeeId && (
              <Button size="sm" variant="outline" onClick={() => setSelectedLedgerEmployeeId(null)}>
                View All Employees
              </Button>
            )}
          </div>
          {employeeLedgerGroups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg">
              No cash advance ledger entries yet.
            </div>
          ) : (
            <div className="space-y-4">
              {employeeLedgerGroups.map(group => {
                const latestBalance = group.rows[0]?.employee_running_balance || 0;
                return (
                  <Card key={group.employeeId || group.employeeName} className="border border-border shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground text-sm">{group.employeeName}</p>
                        {group.employeeId && <p className="text-xs text-muted-foreground">{group.employeeId}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Current balance</p>
                        <p className="font-bold text-amber-600 text-sm">₱{latestBalance.toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Transaction</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Particulars</th>
                            <th className="text-center px-3 py-2 font-medium text-muted-foreground">Deduction</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Addition</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Deduction</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map(row => {
                            const isDeduction = row.transaction_type === 'deduction';
                            return (
                              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.transaction_date || '—'}</td>
                                <td className="px-3 py-2 text-foreground whitespace-nowrap">{ledgerTypeLabel(row)}</td>
                                <td className="px-3 py-2 text-muted-foreground min-w-56">
                                  {row.period_name ? `${row.period_name} — ` : ''}{row.description || '—'}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {isDeduction && row.deduction_number && row.deduction_total
                                    ? `${row.deduction_number} of ${row.deduction_total}`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-green-700 whitespace-nowrap">
                                  {!isDeduction ? `₱${(row.amount || 0).toLocaleString()}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-destructive whitespace-nowrap">
                                  {isDeduction ? `₱${(row.amount || 0).toLocaleString()}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-foreground whitespace-nowrap">
                                  ₱{(row.employee_running_balance || 0).toLocaleString()}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'requests' && isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : activeTab === 'requests' && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">No cash advance requests found.</div>
          )}
          {filtered.map(ca => (
            <Card key={ca.id} className="border border-border shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground">{ca.employee_name}</p>
                      <Badge variant="outline" className={`text-xs ${statusColors[ca.status]}`}>{ca.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{ca.department}</p>
                    <p className="text-sm text-foreground mt-1">{ca.reason}</p>
                    {ca.needed_date && <p className="text-xs text-muted-foreground mt-0.5">Needed by: {ca.needed_date}</p>}
                    {ca.hr_notes && <p className="text-xs text-muted-foreground mt-0.5">HR: {ca.hr_notes}</p>}
                    {ca.manager_notes && <p className="text-xs text-muted-foreground mt-0.5">Manager: {ca.manager_notes}</p>}
                    {ca.deduction_amount_per_payroll > 0 && (
                      <p className="text-xs text-primary mt-0.5">
                        ₱{ca.deduction_amount_per_payroll.toLocaleString()} / payroll × {ca.deduction_payroll_periods} periods
                        {ca.deduction_periods_remaining > 0 && ca.status !== 'deducted' && (
                          <span className="ml-1 text-amber-600">({ca.deduction_periods_remaining} remaining)</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-foreground">₱{(ca.amount_requested || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{ca.request_date}</p>
                  </div>
                </div>
                {(ca.status === 'pending' || ca.status === 'approved_by_hr') && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {ca.status === 'pending' && (
                      <Button size="sm" variant="outline" className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={() => { setNotesDialog({ id: ca.id, type: 'hr' }); setNotesText(''); setPasscodeInput(''); setPasscodeError(''); }}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> HR Approve
                      </Button>
                    )}
                    {ca.status === 'approved_by_hr' && (
                      <Button size="sm" className="gap-1"
                        onClick={() => {
                          setNotesDialog({ id: ca.id, type: 'manager', amount_requested: ca.amount_requested, deduction_payroll_periods: ca.deduction_payroll_periods });
                          setNotesText('');
                          setAmountApproved(String(ca.amount_requested || ''));
                          setDeductionPeriods(String(ca.deduction_payroll_periods || 1));
                          setPasscodeInput(''); setPasscodeError('');
                        }}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Manager Final Approve
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setNotesDialog({ id: ca.id, type: 'reject' }); setNotesText(''); setPasscodeInput(''); setPasscodeError(''); }}>
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Request Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Cash Advance (Vale)</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {currentEmployee && (
              <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                Maximum allowable: <strong>₱{(currentEmployee.max_cash_advance || 0).toLocaleString()}</strong>
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Amount Requested (₱) *</Label>
              <Input type="number" min="1" step="0.01" value={form.amount_requested} onChange={e => setForm(p => ({ ...p, amount_requested: e.target.value }))} required className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason *</Label>
              <Textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} required className="text-sm min-h-[80px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date Needed</Label>
              <Input type="date" value={form.needed_date} onChange={e => setForm(p => ({ ...p, needed_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" size="sm">Submit Request</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cash Advance Adjustment Dialog */}
      <Dialog open={!!adjustmentDialog} onOpenChange={() => {
        setAdjustmentDialog(null);
        setAdjustmentError('');
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Adjust Cash Advance Balance</DialogTitle></DialogHeader>
          {adjustmentDialog && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-semibold text-foreground">
                  {adjustmentDialog.employee.first_name} {adjustmentDialog.employee.last_name}
                </p>
                <p className="text-xs text-muted-foreground">{adjustmentDialog.cashAdvance.reason || 'Cash advance'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current balance: <span className="font-semibold text-foreground">₱{Number(getCashAdvanceBalance(adjustmentDialog.cashAdvance) || 0).toLocaleString()}</span>
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Adjustment Type *</Label>
                <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="decrease">Decrease balance</SelectItem>
                    <SelectItem value="increase">Increase balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount (₱) *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={event => {
                    setAdjustmentAmount(event.target.value);
                    setAdjustmentError('');
                  }}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason *</Label>
                <Textarea
                  value={adjustmentReason}
                  onChange={event => {
                    setAdjustmentReason(event.target.value);
                    setAdjustmentError('');
                  }}
                  className="text-sm min-h-[70px]"
                  placeholder="Explain why this CA balance is being adjusted"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">HR Officer Passcode *</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={adjustmentHrPasscode}
                    onChange={event => {
                      setAdjustmentHrPasscode(event.target.value);
                      setAdjustmentError('');
                    }}
                    className="h-8 text-center font-mono tracking-widest"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Admin Passcode *</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={adjustmentAdminPasscode}
                    onChange={event => {
                      setAdjustmentAdminPasscode(event.target.value);
                      setAdjustmentError('');
                    }}
                    className="h-8 text-center font-mono tracking-widest"
                  />
                </div>
              </div>
              {adjustmentError && <p className="text-xs text-destructive">{adjustmentError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setAdjustmentDialog(null)}>Cancel</Button>
                <Button type="button" size="sm" onClick={submitAdjustment} disabled={adjustmentMutation.isPending}>
                  {adjustmentMutation.isPending ? 'Saving...' : 'Save Adjustment'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approval Notes Dialog */}
      <Dialog open={!!notesDialog} onOpenChange={() => { setNotesDialog(null); setPasscodeInput(''); setPasscodeError(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {notesDialog?.type === 'reject' ? 'Reject Request' : notesDialog?.type === 'manager' ? 'Manager Final Approval' : 'HR Approve'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {notesDialog?.type === 'manager' && (
              <>
                {/* Show what employee requested */}
                {(() => {
                  const requestedPeriods = notesDialog?.deduction_payroll_periods;
                  return requestedPeriods ? (
                    <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-600" />
                      Employee requested <strong>{requestedPeriods} payroll week(s)</strong> for deduction (₱{(notesDialog.amount_requested / requestedPeriods).toFixed(2)}/week). You may adjust below.
                    </div>
                  ) : null;
                })()}
                <div className="space-y-1">
                  <Label className="text-xs">Amount Approved (₱) *</Label>
                  <Input
                    type="number" min="1" step="0.01"
                    value={amountApproved}
                    onChange={e => setAmountApproved(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Number of Payroll Weeks to Deduct *</Label>
                  <Input
                    type="number" min="1" step="1"
                    value={deductionPeriods}
                    onChange={e => setDeductionPeriods(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="e.g. 4 = deduct over 4 payroll weeks"
                  />
                </div>
                {amountApproved && deductionPeriods && (
                  <p className="text-xs text-primary bg-primary/5 rounded p-2">
                    ₱{(parseFloat(amountApproved) / parseInt(deductionPeriods)).toFixed(2)} will be deducted per payroll week × {deductionPeriods} week(s)
                  </p>
                )}
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">
                {notesDialog?.type === 'manager' ? 'Manager Passcode *' : 'HR Officer Passcode *'}
              </Label>
              <Input
                type="password"
                value={passcodeInput}
                onChange={e => { setPasscodeInput(e.target.value); setPasscodeError(''); }}
                className="h-8 text-sm font-mono tracking-widest"
                placeholder={notesDialog?.type === 'manager' ? "Enter manager's passcode" : "Enter HR officer's passcode"}
                maxLength={6}
              />
              {passcodeError && <p className="text-xs text-destructive">{passcodeError}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notesText} onChange={e => setNotesText(e.target.value)} className="text-sm min-h-[60px]" placeholder="Add a note..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setNotesDialog(null)}>Cancel</Button>
              {notesDialog?.type === 'reject' ? (
                <Button size="sm" variant="destructive" onClick={() => reject(notesDialog.id)}>Reject</Button>
              ) : (
                <Button size="sm" onClick={() => approve(notesDialog.id, notesDialog.type)}>Approve</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
