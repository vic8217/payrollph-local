import { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { readApiJson } from '@/lib/apiResponse';
import {
  formatDeviceDateTime,
  formatDeviceDateTimeParts,
  formatPayrollDateTime,
  formatPayrollDateTimeParts,
  formatUtcDebug,
} from '@/lib/payrollDateTime';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_FILTERS = [
  ['unmapped_user', 'Unmapped'],
  ['company_not_authorized', 'Quarantined'],
  ['mapped_pending_attendance', 'Pending'],
  ['interpreted', 'Interpreted'],
  ['needs_review', 'Needs review'],
  ['ignored_duplicate', 'Ignored duplicate'],
  ['processing', 'Processing'],
  ['failed_retryable', 'Failed'],
  ['failed_terminal', 'Failed terminal'],
];

function TwoLineTime({ date, time, raw, title }) {
  if (!date && !time) {
    return (
      <div title={title || raw || ''}>
        <p className="text-xs text-muted-foreground">{raw || '—'}</p>
      </div>
    );
  }
  return (
    <div title={title || raw || ''}>
      <p className="text-xs font-medium leading-tight">{date}</p>
      <p className="text-xs leading-tight">{time}</p>
      {raw ? <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{raw}</p> : null}
    </div>
  );
}

export default function BiometricEvents() {
  const { activeCompanyId } = useCompany();
  const [status, setStatus] = useState('mapped_pending_attendance');
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState({});
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!activeCompanyId) return;
    setError('');
    const response = await fetch(`/api/biometric/events?company_profile_id=${encodeURIComponent(activeCompanyId)}&status=${encodeURIComponent(status)}`);
    const body = await readApiJson(response);
    setEvents(body.events || []);
    setSelected({});
    setPreviews([]);
  }

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, [activeCompanyId, status]);

  async function post(operation) {
    const eventIds = Object.keys(selected).filter(id => selected[id]);
    if (!eventIds.length) return setMessage('Select one or more events first.');
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/biometric/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_profile_id: activeCompanyId,
          operation,
          event_ids: eventIds,
        }),
      });
      const body = await readApiJson(response);
      if (operation === 'preview') {
        setPreviews(body.results || []);
        setMessage(`Previewed ${body.results?.length || 0} event(s). Attendance was not written.`);
      } else if (operation === 'interpret') {
        setMessage(`Interpreted ${body.interpreted || 0}. Review ${body.needs_review || 0}. Ignored ${body.ignored || 0}. Failed ${body.failed || 0}.`);
        await load();
      } else if (operation === 'requeue') {
        const ok = (body.results || []).filter(item => item.ok).length;
        setMessage(`Requeued ${ok} failed event(s) to mapped_pending_attendance. Interpretation was not run.`);
        await load();
      } else if (operation === 'reprocess' || operation === 'reprocess_quarantine') {
        setMessage(`${body.updated} punch(es) moved to mapped_pending_attendance. ${body.skipped} skipped.`);
        await load();
      } else {
        setMessage('Update saved.');
        await load();
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Fingerprint className="w-6 h-6"/>Biometric Events</h1>
          <p className="text-sm text-muted-foreground mt-1">Phase 1 stores raw punches. Phase 2 interpretation is explicit only — it does not run automatically after ingest. Preview is read-only.</p>
        </div>
        <Button variant="outline" onClick={() => load().catch(err => setError(err.message))}><RefreshCw className="w-4 h-4 mr-2"/>Refresh</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(([value, label]) => (
          <Button key={value} variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)}>{label}</Button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border bg-card p-3 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => post('preview')}>Preview selected</Button>
        <Button disabled={busy || !['mapped_pending_attendance', 'failed_retryable', 'processing'].includes(status)} onClick={() => post('interpret')}>Interpret selected</Button>
        <Button variant="outline" disabled={busy || !['failed_terminal', 'failed_retryable'].includes(status)} onClick={() => post('requeue')}>Requeue failed</Button>
        <Button variant="outline" disabled={busy || status !== 'needs_review'} onClick={() => post('apply_review')}>Apply review</Button>
        <Button variant="outline" disabled={busy || status !== 'needs_review'} onClick={() => post('dismiss_review')}>Dismiss review</Button>
        <Button variant="outline" disabled={busy || status !== 'interpreted'} onClick={() => post('rollback')}>Rollback</Button>
        <Button variant="outline" disabled={busy || !['unmapped_user'].includes(status)} onClick={() => post('reprocess')}>Reprocess unmapped</Button>
        <Button variant="outline" disabled={busy || status !== 'company_not_authorized'} onClick={() => post('reprocess_quarantine')}>Explicitly reprocess quarantine</Button>
      </div>

      {previews.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <p className="font-semibold text-sm">Read-only interpretation preview</p>
          {previews.map(row => (
            <div key={row.id} className="rounded-md border bg-background p-3 text-xs grid gap-1 md:grid-cols-2">
              <p><span className="text-muted-foreground">Employee</span> {row.employee_name || '—'} · {row.employee_id || '—'}</p>
              <p><span className="text-muted-foreground">Device serial</span> {row.device_serial || '—'}</p>
              <p><span className="text-muted-foreground">Device LogID</span> {row.log_id || '—'}</p>
              <p><span className="text-muted-foreground">User ID</span> {row.device_user_id || '—'}</p>
              <div>
                <p><span className="text-muted-foreground">Device time</span> {formatDeviceDateTime(row.occurred_at_local) || row.occurred_at_local || '—'}</p>
                {row.occurred_at_local ? <p className="font-mono text-[10px] text-muted-foreground">{row.occurred_at_local}</p> : null}
              </div>
              <div>
                <p><span className="text-muted-foreground">Attendance time</span> {formatPayrollDateTime(row.occurred_at) ? `${formatPayrollDateTime(row.occurred_at)} (Manila)` : '—'}</p>
                {formatUtcDebug(row.occurred_at) ? <p className="font-mono text-[10px] text-muted-foreground">UTC: {formatUtcDebug(row.occurred_at)}</p> : null}
              </div>
              <p><span className="text-muted-foreground">AttendStat</span> {row.attend_status || '—'}</p>
              <p><span className="text-muted-foreground">Verification</span> {row.verify_method_normalized || '—'}</p>
              <p><span className="text-muted-foreground">processingStatus</span> {row.processing_status || '—'}</p>
              <p><span className="text-muted-foreground">Expected next slot</span> {row.preview?.expected_label || row.preview?.expected_slot || row.preview?.code || '—'}</p>
              <p className="md:col-span-2"><span className="text-muted-foreground">Preview note</span> {row.preview?.message || '—'}</p>
            </div>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Log ID</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>User ID</TableHead>
            <TableHead>Device Time</TableHead>
            <TableHead>PayrollPH Time</TableHead>
            <TableHead>AttendStat</TableHead>
            <TableHead>Verify</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Slot / reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map(event => (
            <TableRow key={event.id}>
              <TableCell>
                <input type="checkbox" checked={Boolean(selected[event.id])} onChange={() => setSelected(current => ({ ...current, [event.id]: !current[event.id] }))} />
              </TableCell>
              <TableCell className="font-mono text-xs">{event.log_id}</TableCell>
              <TableCell className="text-xs">{event.employee_name || event.employee_id || '—'}</TableCell>
              <TableCell className="font-mono text-xs">{event.device_serial}</TableCell>
              <TableCell className="font-mono text-xs">{event.device_user_id || '—'}</TableCell>
              <TableCell>
                <TwoLineTime
                  {...formatDeviceDateTimeParts(event.occurred_at_local)}
                  raw={event.occurred_at_local || ''}
                  title={event.occurred_at_local || ''}
                />
              </TableCell>
              <TableCell>
                <TwoLineTime
                  {...formatPayrollDateTimeParts(event.occurred_at)}
                  raw={formatUtcDebug(event.occurred_at) ? `UTC: ${formatUtcDebug(event.occurred_at)}` : ''}
                  title={formatUtcDebug(event.occurred_at)}
                />
              </TableCell>
              <TableCell>{event.attend_status || '—'}</TableCell>
              <TableCell className="text-xs">{event.verify_method_normalized || event.verify_method || '—'}</TableCell>
              <TableCell className="text-xs">{event.processing_status}</TableCell>
              <TableCell className="text-xs">{event.mapped_slot || event.review_reason || event.interpretation_code || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!events.length && <p className="text-sm text-muted-foreground">No biometric events in this queue.</p>}
    </div>
  );
}
