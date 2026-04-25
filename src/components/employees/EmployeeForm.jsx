import { useState, useRef } from 'react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Upload, X } from 'lucide-react';

const field = (label, key, type = 'text', required = false) => ({ label, key, type, required });

const FIELDS = [
  field('First Name', 'first_name', 'text', true),
  field('Middle Name', 'middle_name'),
  field('Last Name', 'last_name', 'text', true),
  field('Email', 'email', 'email'),
  field('Phone', 'phone'),
  field('Department', 'department'),
  field('Position', 'position'),
  field('Date Hired', 'date_hired', 'date'),
  field('Daily Rate (₱)', 'daily_rate', 'number', true),
  field('Monthly Rate (₱)', 'monthly_rate', 'number'),
  field('Max Cash Advance (₱)', 'max_cash_advance', 'number'),
  field('SSS Number', 'sss_number'),
  field('PhilHealth Number', 'philhealth_number'),
  field('Pag-IBIG Number', 'pagibig_number'),
  field('TIN Number', 'tin_number'),
  field('Bank Account', 'bank_account'),
  field('User Email (app login)', 'user_email', 'email'),
  field('Employee ID', 'employee_id', 'text', true),
];

export default function EmployeeForm({ employee, onSaved, onCancel }) {
  const { activeCompanyId } = useCompany();
  const isEditing = !!employee?.id;
  const [form, setForm] = useState(employee || {
    status: 'active', employment_type: 'regular'
  });
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const buildEmployeeId = (data) => {
    const f = (data.first_name?.[0] || '').toUpperCase();
    const m = (data.middle_name?.[0] || '').toUpperCase();
    const l = (data.last_name?.[0] || '').toUpperCase();
    const p = (data.position?.[0] || '').toUpperCase();
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const time = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}${String(now.getMilliseconds()).padStart(3,'0')}`;
    return `${f}${m}${l}${p}-${date}-${time}`;
  };

  const generateEmployeeId = () => {
    set('employee_id', buildEmployeeId(form));
  };

  const startCamera = async () => {
    setShowCamera(true);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      setUploadingPhoto(true);
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      const { file_url } = await appApi.integrations.Core.UploadFile({ file });
      set('photo_url', file_url);
      setUploadingPhoto(false);
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPhoto(true);
    const { file_url } = await appApi.integrations.Core.UploadFile({ file });
    set('photo_url', file_url);
    setUploadingPhoto(false);
  };

  const generateQR = async () => {
    let tradeName = '';
    const companies = await appApi.entities.CompanyProfile.list();
    if (companies?.length > 0) tradeName = companies[0].trade_name || companies[0].company_name || '';
    const suffix = tradeName ? `-${tradeName.replace(/\s+/g, '')}` : '';
    const qr = `${form.employee_id || Date.now()}${suffix}`;
    set('qr_code', qr);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = { ...form };
    if (data.daily_rate) data.daily_rate = parseFloat(data.daily_rate);
    if (data.monthly_rate) data.monthly_rate = parseFloat(data.monthly_rate);
    if (data.max_cash_advance) data.max_cash_advance = parseFloat(data.max_cash_advance);
    if (employee?.id) {
      await appApi.entities.Employee.update(employee.id, data);
    } else {
      if (!data.qr_code) data.qr_code = data.employee_id;
      if (!data.company_profile_id) data.company_profile_id = activeCompanyId;
      await appApi.entities.Employee.create(data);
    }
    setSaving(false);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Photo Section */}
      <div className="flex flex-col items-center gap-3 p-4 bg-muted/40 rounded-lg border border-border">
        <p className="text-xs font-medium text-foreground self-start">Employee Photo <span className="text-muted-foreground">(2×2 ID size)</span></p>

        {showCamera ? (
          <div className="w-full space-y-2">
            {/* Guide overlay */}
            <div className="relative flex justify-center">
              <video ref={videoRef} autoPlay playsInline className="rounded border object-cover w-full" style={{ height: 380 }} />
              {/* Portrait ID guide overlay */}
              <div className="absolute inset-0 flex flex-col items-center pointer-events-none">
                {/* Head oval guide */}
                <div className="absolute border-2 border-dashed border-yellow-300 rounded-full" style={{ width: 160, height: 200, top: 30 }} />
                {/* Shoulder line */}
                <div className="absolute border-t-2 border-dashed border-yellow-300" style={{ width: '70%', top: 310 }} />
                {/* Labels */}
                <p className="absolute text-yellow-300 text-xs font-medium drop-shadow" style={{ top: 8 }}>↕ Keep head inside oval</p>
                <p className="absolute text-yellow-300 text-xs drop-shadow" style={{ top: 318 }}>Shoulders here</p>
                <p className="absolute bottom-2 text-white text-xs drop-shadow bg-black/50 px-2 py-0.5 rounded">Look straight · Plain background</p>
              </div>
            </div>
            <div className="flex gap-2 justify-center">
              <Button type="button" size="sm" onClick={capturePhoto} disabled={uploadingPhoto} className="gap-1">
                <Camera className="w-3.5 h-3.5" /> {uploadingPhoto ? 'Saving...' : 'Capture'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={stopCamera}>
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* 2x2 preview box — 2in x 2in ≈ 192px x 192px at 96dpi */}
            <div className="relative rounded-md overflow-hidden bg-gray-100 border-2 border-dashed border-border flex items-center justify-center" style={{ width: 154, height: 192 }}>
              {form.photo_url ? (
                <img src={form.photo_url} alt="Employee" className="w-full h-full object-cover object-top" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Camera className="w-8 h-8" />
                  <span className="text-xs text-center">2×2 ID Photo<br/><span className="text-[10px]">Head &amp; shoulders</span></span>
                </div>
              )}
              <div className="absolute bottom-1 right-1 bg-black/40 text-white text-[9px] px-1 rounded">2×2</div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={startCamera}>
                <Camera className="w-3.5 h-3.5" /> Camera
              </Button>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" /> {uploadingPhoto ? 'Uploading...' : 'Upload'}
              </Button>
              {form.photo_url && (
                <Button type="button" size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => set('photo_url', '')}>
                  <X className="w-3.5 h-3.5" /> Remove
                </Button>
              )}
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs font-medium">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            {f.key === 'employee_id' ? (
              <div className="flex gap-2">
                <Input
                  type={f.type}
                  value={form[f.key] || ''}
                  readOnly
                  required={f.required}
                  className="h-8 text-sm flex-1 bg-muted cursor-default"
                />
                {!isEditing && (
                  <Button type="button" variant="outline" size="sm" onClick={generateEmployeeId}>Auto</Button>
                )}
              </div>
            ) : (
              <Input
                type={f.type}
                value={form[f.key] || ''}
                onChange={e => set(f.key, e.target.value)}
                required={f.required}
                className="h-8 text-sm"
                step={f.type === 'number' ? '0.01' : undefined}
              />
            )}
          </div>
        ))}

        <div className="space-y-1">
          <Label className="text-xs font-medium">Employment Type</Label>
          <Select value={form.employment_type || 'regular'} onValueChange={v => set('employment_type', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['regular', 'probationary', 'contractual', 'part_time', 'agency'].map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium">Status</Label>
          <Select value={form.status || 'active'} onValueChange={v => set('status', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['active', 'inactive', 'terminated'].map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.employment_type === 'agency' && (
          <div className="space-y-1">
            <Label className="text-xs font-medium">Agency Fee Percentage (%)</Label>
            <Input
              type="number"
              value={form.agency_fee_percentage || ''}
              onChange={e => set('agency_fee_percentage', e.target.value ? parseFloat(e.target.value) : '')}
              className="h-8 text-sm"
              step="0.01"
              placeholder="e.g., 5"
            />
          </div>
        )}

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs font-medium">QR Code Value</Label>
          <div className="flex gap-2">
            <Input value={form.qr_code || ''} readOnly className="h-8 text-sm flex-1 bg-muted cursor-default" placeholder="Auto-generated" />
            {!isEditing && (
              <Button type="button" variant="outline" size="sm" onClick={generateQR}>Generate</Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving...' : (employee ? 'Update' : 'Create')}</Button>
      </div>
    </form>
  );
}
