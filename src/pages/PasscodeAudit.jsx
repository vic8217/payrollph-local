import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Activity, Search, ShieldCheck } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const entityLabels = {
  AttendanceLog: 'Attendance',
  PersonalLeave: 'Personal Leave',
  CashAdvance: 'Cash Advance',
  Employee: 'Employee Setup',
};

const actionLabels = {
  attendance_correction: 'Attendance Corrected',
  attendance_manual_edit: 'Attendance Edited',
  attendance_rejected: 'Attendance Rejected',
  overtime_approved: 'OT Approved',
  overtime_reduced: 'OT Reduced',
  overtime_denied: 'OT Denied',
  leave_approved: 'Leave Approved',
  leave_declined: 'Leave Declined',
  cash_advance_hr_approved: 'Cash Advance HR Approved',
  cash_advance_admin_approved: 'Cash Advance Admin Approved',
  cash_advance_rejected: 'Cash Advance Rejected',
  employee_incentives_updated: 'Incentives Updated',
  employee_number_changed: 'Employee Number Changed',
};

const actionStyles = {
  attendance_rejected: 'bg-red-100 text-red-700',
  overtime_denied: 'bg-red-100 text-red-700',
  leave_declined: 'bg-red-100 text-red-700',
  cash_advance_rejected: 'bg-red-100 text-red-700',
  overtime_reduced: 'bg-amber-100 text-amber-700',
  attendance_correction: 'bg-blue-100 text-blue-700',
  attendance_manual_edit: 'bg-blue-100 text-blue-700',
};

function subjectFor(entity, record) {
  if (record.employee_name || record.employee_id) {
    const employee = record.employee_name || record.employee_id;
    if (entity === 'AttendanceLog') return `${employee} · ${record.record_date || record.date || 'No date'}`;
    if (entity === 'PersonalLeave') return `${employee} · ${record.record_date || record.start_date || 'No date'}`;
    if (entity === 'CashAdvance') return `${employee} · ₱${Number(record.amount || record.amount_requested || record.amount_approved || 0).toLocaleString('en-PH')}`;
    if (entity === 'Employee') return employee;
  }
  if (entity === 'AttendanceLog') {
    return `${record.employee_name || record.employee_id || 'Employee'} · ${record.date || 'No date'}`;
  }
  if (entity === 'PersonalLeave') {
    return `${record.employee_name || record.employee_id || 'Employee'} · ${record.start_date || '?'} to ${record.end_date || '?'}`;
  }
  if (entity === 'CashAdvance') {
    return `${record.employee_name || record.employee_id || 'Employee'} · ₱${Number(record.amount_requested || record.amount_approved || 0).toLocaleString('en-PH')}`;
  }
  return record.first_name || record.last_name
    ? [record.first_name, record.middle_name, record.last_name].filter(Boolean).join(' ')
    : record.employee_id || 'Employee';
}

function legacyAttendanceEntry(record) {
  const notes = String(record.notes || '');
  if (!notes) return null;
  let action = null;
  if (/Attendance correction|Manual edit/i.test(notes)) action = 'attendance_correction';
  else if (/Attendance rejected by/i.test(notes)) action = 'attendance_rejected';
  else if (/OT .*passcodes/i.test(notes)) {
    action = /OT denied/i.test(notes)
      ? 'overtime_denied'
      : /OT reduced/i.test(notes)
        ? 'overtime_reduced'
        : 'overtime_approved';
  }
  if (!action) return null;
  return {
    action,
    at: record.passcode_audit_at || record.ot_reviewed_at || record.updated_date,
    by: record.passcode_audit_by || record.ot_reviewed_by || 'Recorded in notes',
    reason: record.passcode_audit_reason || record.ot_review_reason || '',
    summary: record.passcode_audit_summary || notes.split('\n').at(-1),
  };
}

export default function PasscodeAudit() {
  const { user } = useAuth();
  const { activeCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const canView = ['super_admin', 'admin'].includes(user?.role);

  const auditQuery = useQuery({
    queryKey: ['passcodeAudit', activeCompanyId],
    queryFn: async () => {
      const [auditLogs, attendanceLogs] = await Promise.all([
        appApi.entities.PasscodeAuditLog.filter({ company_profile_id: activeCompanyId }, '-occurred_at', 5000),
        appApi.entities.AttendanceLog.filter({ company_profile_id: activeCompanyId }, '-updated_date', 1000),
      ]);
      const structured = auditLogs.map(record => ({
        entity: record.source_entity,
        record,
        action: record.action,
        at: record.occurred_at || record.created_date,
        by: record.authorized_by || 'Unknown',
        reason: record.reason || '',
        summary: record.summary || '',
      }));
      const legacy = attendanceLogs
        .filter(record => !record.passcode_audit_action)
        .map(record => {
          const audit = legacyAttendanceEntry(record);
          return audit ? { entity: 'AttendanceLog', record, ...audit } : null;
        })
        .filter(Boolean);
      return [...structured, ...legacy].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    },
    enabled: canView && !!activeCompanyId,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (auditQuery.data || []).filter(entry => {
      if (entityFilter !== 'all' && entry.entity !== entityFilter) return false;
      if (!term) return true;
      return [
        subjectFor(entry.entity, entry.record),
        actionLabels[entry.action] || entry.action,
        entry.by,
        entry.reason,
        entry.summary,
      ].some(value => String(value || '').toLowerCase().includes(term));
    });
  }, [auditQuery.data, entityFilter, search]);

  if (!canView) {
    return (
      <div className="p-6 flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <ShieldCheck className="h-12 w-12 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">This page is restricted to administrators.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Passcode Audit Summary</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Passcode-authorized edits, approvals, reductions, denials, and setup changes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee, action, reviewer, or reason" className="pl-9" />
        </div>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Data Types</SelectItem>
            {Object.entries(entityLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Date / Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Data</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Authorized By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Reason / Details</th>
              </tr>
            </thead>
            <tbody>
              {auditQuery.isLoading ? (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">Loading audit records…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No passcode-authorized changes found.</td></tr>
              ) : filtered.map(entry => {
                const auditDate = entry.at ? new Date(entry.at) : null;
                return (
                  <tr key={`${entry.entity}-${entry.record.id}-${entry.action}`} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {auditDate && Number.isFinite(auditDate.getTime()) ? format(auditDate, 'MMM d, yyyy h:mm a') : '—'}
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{entityLabels[entry.entity]}</Badge></td>
                    <td className="px-4 py-3 font-medium">{subjectFor(entry.entity, entry.record)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={actionStyles[entry.action] || 'bg-green-100 text-green-700'}>
                        {actionLabels[entry.action] || entry.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">{entry.by}</td>
                    <td className="px-4 py-3 max-w-md">
                      <p className="text-xs text-foreground">{entry.reason || entry.summary || 'No reason supplied'}</p>
                      {entry.reason && entry.summary && <p className="mt-1 text-[11px] text-muted-foreground">{entry.summary}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        Showing {filtered.length} passcode-authorized change{filtered.length === 1 ? '' : 's'}.
      </div>
    </div>
  );
}
