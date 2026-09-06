import { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function BiometricEvents() {
  const { activeCompanyId } = useCompany();
  const [status, setStatus] = useState('unmapped_user');
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!activeCompanyId) return;
    setError('');
    const response = await fetch(`/api/biometric/events?company_profile_id=${encodeURIComponent(activeCompanyId)}&status=${encodeURIComponent(status)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Unable to load biometric events.');
    setEvents(body.events || []);
    setSelected({});
  }

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, [activeCompanyId, status]);

  async function reprocess(operation) {
    const eventIds = Object.keys(selected).filter(id => selected[id]);
    if (!eventIds.length) return setMessage('Select one or more held punches first.');
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
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Reprocess failed.');
      setMessage(`${body.updated} punch(es) moved to mapped_pending_attendance. ${body.skipped} skipped.`);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Fingerprint className="w-6 h-6"/>Biometric Events</h1>
          <p className="text-sm text-muted-foreground mt-1">Raw terminal punches held for mapping or quarantined for a company mismatch. These are not payroll Time In / Time Out records.</p>
        </div>
        <Button variant="outline" onClick={() => load().catch(err => setError(err.message))}><RefreshCw className="w-4 h-4 mr-2"/>Refresh</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['unmapped_user', 'Unmapped users'], ['company_not_authorized', 'Quarantined'], ['mapped_pending_attendance', 'Mapped, pending attendance']].map(([value, label]) => (
          <Button key={value} variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)}>{label}</Button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border bg-card p-3 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || status === 'mapped_pending_attendance'} onClick={() => reprocess('reprocess')}>Reprocess unmapped</Button>
        <Button variant="outline" disabled={busy || status !== 'company_not_authorized'} onClick={() => reprocess('reprocess_quarantine')}>Explicitly reprocess quarantine</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Log ID</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>User ID</TableHead>
            <TableHead>Local time</TableHead>
            <TableHead>AttendStat</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map(event => (
            <TableRow key={event.id}>
              <TableCell>
                <input type="checkbox" checked={Boolean(selected[event.id])} onChange={() => setSelected(current => ({ ...current, [event.id]: !current[event.id] }))} />
              </TableCell>
              <TableCell className="font-mono text-xs">{event.log_id}</TableCell>
              <TableCell className="font-mono text-xs">{event.device_serial}</TableCell>
              <TableCell className="font-mono text-xs">{event.device_user_id || '—'}</TableCell>
              <TableCell className="text-xs">{event.occurred_at_local || '—'}</TableCell>
              <TableCell>{event.attend_status || '—'}</TableCell>
              <TableCell>{event.verify_method_normalized || event.verify_method || '—'}</TableCell>
              <TableCell className="text-xs">{event.processing_status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!events.length && <p className="text-sm text-muted-foreground">No raw biometric events in this queue.</p>}
    </div>
  );
}
