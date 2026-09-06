import { useEffect, useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { CheckCircle2, Download, Fingerprint, Search, Upload, Users } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function csvRows(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const parseLine = line => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        values.push(value.trim()); value = '';
      } else value += char;
    }
    values.push(value.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    return Object.fromEntries([...headers.map((header, column) => [header, values[column] || '']), ['row_number', index + 2]]);
  });
}

const steps = [
  ['1', 'Select company', 'Use the company selector in the PayrollPH sidebar.'],
  ['2', 'Select device', 'Choose the biometric terminal authorized for this company.'],
  ['3', 'Map employees', 'Assign each PayrollPH employee to the User ID enrolled on the device.'],
  ['4', 'Review & save', 'Check for duplicates or missing employees before saving.'],
];

export default function BiometricMapping() {
  const { activeCompanyId, activeCompany } = useCompany();
  const [data, setData] = useState({ employees: [], devices: [], mappings: [] });
  const [deviceId, setDeviceId] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({});
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkErrors, setBulkErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    if (!activeCompanyId) return;
    setMessage('');
    const result = await api(`/api/biometric/mappings?company_profile_id=${encodeURIComponent(activeCompanyId)}`);
    setData(result);
    setDeviceId(current => result.devices.some(device => device.id === current) ? current : (result.devices[0]?.id || ''));
  };

  useEffect(() => { load().catch(error => setMessage(error.message)); }, [activeCompanyId]);

  const mappingByEmployee = useMemo(() => new Map(
    data.mappings.filter(mapping => mapping.device_id === deviceId && mapping.status === 'active')
      .map(mapping => [mapping.employee_record_id, mapping])
  ), [data.mappings, deviceId]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data.employees;
    return data.employees.filter(employee => [employee.employee_name, employee.employee_id, employee.department]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [data.employees, search]);

  const saveEmployee = async employee => {
    const deviceUserId = String(drafts[employee.id] ?? mappingByEmployee.get(employee.id)?.device_user_id ?? '').trim();
    if (!deviceId || !deviceUserId) return setMessage('Select a device and enter the biometric User ID first.');
    setBusy(true); setMessage('');
    try {
      await api('/api/biometric/mappings', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'upsert', company_profile_id: activeCompanyId, device_id: deviceId,
          employee_id: employee.employee_id, device_user_id: deviceUserId,
        }),
      });
      setMessage(`${employee.employee_name} mapped successfully.`);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  const downloadTemplate = async () => {
    if (!activeCompanyId) return;
    const response = await fetch(`/api/biometric/mapping-template?company_profile_id=${encodeURIComponent(activeCompanyId)}`);
    if (!response.ok) return setMessage((await response.json().catch(() => ({}))).error || 'Unable to download template.');
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'biometric-mapping-template.xlsx';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };

  const readBulkFile = async file => {
    setMessage(''); setBulkErrors([]); setBulkRows([]);
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.getWorksheet('Biometric Mapping') || workbook.worksheets[0];
        if (!sheet) throw new Error('The workbook has no worksheet.');
        const headers = [];
        sheet.getRow(1).eachCell((cell, column) => { headers[column] = normalizeHeader(cell.text); });
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const item = { row_number: rowNumber };
          headers.forEach((header, column) => { if (header) item[header] = row.getCell(column).text.trim(); });
          if (item.employee_id || item.device_user_id || item.device_serial) rows.push(item);
        });
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        rows = csvRows(await file.text());
      } else throw new Error('Use an .xlsx or .csv file.');

      const deviceBySerial = new Map(data.devices.map(device => [String(device.device_serial), device.id]));
      const prepared = rows.map(row => ({
        ...row,
        employee_id: String(row.employee_id || '').trim(),
        device_user_id: String(row.device_user_id || '').trim(),
        device_id: deviceBySerial.get(String(row.device_serial || '').trim()) || '',
      }));
      const localErrors = prepared.flatMap(row => {
        const errors = [];
        if (!row.employee_id) errors.push(`Row ${row.row_number}: employee_id is required.`);
        if (!row.device_user_id) errors.push(`Row ${row.row_number}: device_user_id is required.`);
        if (!row.device_id) errors.push(`Row ${row.row_number}: device_serial is not an authorized device for this company.`);
        return errors;
      });
      setBulkRows(prepared); setBulkErrors(localErrors);
    } catch (error) { setMessage(error.message || 'Unable to read mapping file.'); }
  };

  const saveBulk = async () => {
    if (!bulkRows.length || bulkErrors.length) return;
    setBusy(true); setMessage(''); setBulkErrors([]);
    try {
      const result = await api('/api/biometric/mappings', {
        method: 'POST',
        body: JSON.stringify({ operation: 'bulk_upsert', company_profile_id: activeCompanyId, rows: bulkRows }),
      });
      setMessage(`${result.saved_count} biometric employee mapping(s) saved.`);
      setBulkRows([]); if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (error) {
      const validation = error.payload?.validation || [];
      setBulkErrors(validation.filter(item => !item.ok).map(item => `Row ${item.row_number}: ${item.error}`));
      setMessage(error.message);
    } finally { setBusy(false); }
  };

  const mappedCount = data.mappings.filter(mapping => mapping.status === 'active').length;
  const selectedDevice = data.devices.find(device => device.id === deviceId);

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2"><Fingerprint className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">Biometric Employee Mapping</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">Link existing PayrollPH employees to the User IDs enrolled on your biometric devices. QR attendance remains available as fallback.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {steps.map(([number, title, description]) => <Card key={number} className="shadow-sm"><CardContent className="p-4"><div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{number}</div><p className="font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card>)}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Company</p><p className="mt-1 font-semibold">{activeCompany?.company_name || 'Select a company'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active employees</p><p className="mt-1 text-2xl font-bold">{data.employees.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active mappings</p><p className="mt-1 text-2xl font-bold">{mappedCount}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Manual mapping</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[320px_1fr]">
            <Select value={deviceId} onValueChange={setDeviceId}><SelectTrigger><SelectValue placeholder="Select biometric device" /></SelectTrigger><SelectContent>{data.devices.map(device => <SelectItem key={device.id} value={device.id}>{device.device_serial} · {device.terminal_type || device.product_name || 'Biometric'}</SelectItem>)}</SelectContent></Select>
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee name, number, or department" className="pl-9" /></div>
          </div>
          {!data.devices.length && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No active biometric device is authorized for this company.</p>}
          <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Department</TableHead><TableHead>Device</TableHead><TableHead className="w-48">Biometric User ID</TableHead><TableHead className="w-28">Status</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader><TableBody>
            {filteredEmployees.map(employee => { const mapping = mappingByEmployee.get(employee.id); return <TableRow key={employee.id}><TableCell><p className="font-medium">{employee.employee_name}</p><p className="font-mono text-xs text-muted-foreground">{employee.employee_id}</p></TableCell><TableCell>{employee.department || '—'}</TableCell><TableCell className="font-mono text-xs">{selectedDevice?.device_serial || '—'}</TableCell><TableCell><Input value={drafts[employee.id] ?? mapping?.device_user_id ?? ''} onChange={event => setDrafts(current => ({ ...current, [employee.id]: event.target.value }))} placeholder="e.g. 101" /></TableCell><TableCell>{mapping ? <Badge className="bg-emerald-600">Mapped</Badge> : <Badge variant="outline">Not mapped</Badge>}</TableCell><TableCell><Button size="sm" disabled={busy || !deviceId} onClick={() => saveEmployee(employee)}>{mapping ? 'Update' : 'Map'}</Button></TableCell></TableRow>; })}
          </TableBody></Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Bulk mapping — CSV/XLSX</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm"><p className="font-semibold">Bulk workflow</p><p className="mt-1 text-muted-foreground">Download the template → fill in employee_id, device_user_id and device_serial → upload → review validation → save. If any row has an error, nothing is saved.</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate}><Download className="mr-2 h-4 w-4" />Download XLSX template</Button><Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Choose CSV/XLSX</Button><input ref={fileRef} className="hidden" type="file" accept=".csv,.xlsx" onChange={event => event.target.files?.[0] && readBulkFile(event.target.files[0])} /></div>
          {bulkRows.length > 0 && <div className="rounded-lg border p-3"><div className="flex items-center justify-between"><p className="font-medium">{bulkRows.length} row(s) ready for review</p>{bulkErrors.length === 0 && <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Local validation passed</span>}</div>{bulkErrors.length > 0 && <div className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{bulkErrors.slice(0, 20).map(error => <p key={error}>{error}</p>)}</div>}<div className="mt-3 max-h-72 overflow-auto"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Employee ID</TableHead><TableHead>Device User ID</TableHead><TableHead>Device Serial</TableHead></TableRow></TableHeader><TableBody>{bulkRows.slice(0, 200).map(row => <TableRow key={`${row.row_number}-${row.employee_id}`}><TableCell>{row.row_number}</TableCell><TableCell className="font-mono">{row.employee_id}</TableCell><TableCell className="font-mono">{row.device_user_id}</TableCell><TableCell className="font-mono">{row.device_serial}</TableCell></TableRow>)}</TableBody></Table></div><div className="mt-3 flex justify-end"><Button disabled={busy || bulkErrors.length > 0} onClick={saveBulk}>{busy ? 'Saving...' : `Save ${bulkRows.length} mappings`}</Button></div></div>}
        </CardContent>
      </Card>

      {message && <div className="rounded-lg border bg-card p-3 text-sm">{message}</div>}
    </div>
  );
}
