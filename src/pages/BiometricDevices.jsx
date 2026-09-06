import { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, Save, ShieldCheck, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';

const presenceClass = {
  online: 'bg-green-100 text-green-700',
  stale: 'bg-amber-100 text-amber-800',
  unknown: 'bg-slate-100 text-slate-600',
};

export default function BiometricDevices() {
  const [data, setData] = useState({ devices: [], companies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/biometric/devices');
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Unable to load biometric devices.');
      setData(body);
      const next = {};
      body.devices.forEach(d => { next[d.id] = d.company_id || ''; });
      setSelected(next);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function post(payload) {
    const r = await fetch('/api/biometric/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Operation failed.');
    return body;
  }

  async function approve(device) {
    setSaving(device.id); setError('');
    try { await post({ operation: 'approve', device_id: device.id }); await load(); }
    catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  async function saveCompany(device) {
    setSaving(device.id); setError('');
    try {
      await post({ operation: 'set_company', device_id: device.id, company_profile_id: selected[device.id] });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  return <div className="p-6 max-w-7xl mx-auto space-y-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2"><Fingerprint className="w-6 h-6"/>Biometric Devices</h1>
        <p className="text-sm text-muted-foreground mt-1">Detect terminals, approve them, and assign exactly one PayrollPH company. A company may own multiple devices.</p>
      </div>
      <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 mr-2"/>Refresh devices</Button>
    </div>

    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <div className="font-semibold flex items-center gap-2"><Wifi className="w-4 h-4"/>Automatic device detection</div>
      <p className="mt-1">When a new terminal contacts PayrollPH, its serial number is recorded as <b>Pending</b>. It cannot ingest punches until a super administrator approves it and assigns one company. Presence is inferred from recent authenticated activity: Online, Stale, or Unknown.</p>
    </div>

    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="text-sm text-muted-foreground">Loading devices…</div> : data.devices.length === 0 ? <div className="rounded-xl border p-8 text-center text-muted-foreground">No biometric terminal has been detected yet.</div> :
      <div className="space-y-4">{data.devices.map(device => <div key={device.id} className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
          <div>
            <div className="font-semibold text-lg">{device.product_name || device.terminal_type || 'Biometric terminal'}</div>
            <div className="text-sm text-muted-foreground mt-1">Serial: <span className="font-mono text-foreground">{device.device_serial}</span>{device.terminal_type ? ` · ${device.terminal_type}` : ''}</div>
            <div className="text-xs text-muted-foreground mt-1">Site: {device.site_name || device.site_code || 'Not set'} · Employee mappings: {device.mapping_count}</div>
            <div className="text-xs text-muted-foreground mt-1">Last seen: {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${presenceClass[device.connection_status] || presenceClass.unknown}`}>{device.connection_status || 'unknown'}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${device.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{device.status === 'active' ? 'Active' : device.status === 'disabled' ? 'Disabled' : 'Pending approval'}</span>
            {device.status !== 'active' && device.status !== 'disabled' && <Button onClick={() => approve(device)} disabled={saving === device.id}><ShieldCheck className="w-4 h-4 mr-2"/>Approve device</Button>}
          </div>
        </div>
        <div className="pt-4">
          <div className="font-medium text-sm">Assigned company</div>
          <p className="text-xs text-muted-foreground mt-1 mb-3">Phase 1 allows one company per physical terminal. Shared-device support is reserved for a later release.</p>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{data.companies.map(c => <label key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-muted"><input type="radio" name={`company-${device.id}`} checked={selected[device.id] === c.id} onChange={() => setSelected(prev => ({ ...prev, [device.id]: c.id }))} /><span>{c.company_name}</span></label>)}</div>
          <div className="mt-4 flex justify-end"><Button onClick={() => saveCompany(device)} disabled={saving === device.id || device.status !== 'active' || !selected[device.id]}><Save className="w-4 h-4 mr-2"/>Save company assignment</Button></div>
        </div>
      </div>)}</div>}
  </div>;
}
