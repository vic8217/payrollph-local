import { useEffect, useState, useRef } from 'react';
import { appApi } from '@/lib/appApi';
import { ensureCashAdvanceBeginningLedger } from '@/lib/cashAdvanceLedger';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Upload, X, SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const field = (label, key, type = 'text', required = false) => ({ label, key, type, required });

const FIELDS = [
  field('First Name', 'first_name', 'text', true),
  field('Middle Name', 'middle_name'),
  field('Last Name', 'last_name', 'text', true),
  field('Email', 'email', 'email'),
  field('Phone', 'phone'),
  field('Department', 'department'),
  field('Position', 'position'),
  field('Date of Birth', 'date_of_birth', 'date'),
  field('Date Hired', 'date_hired', 'date'),
  field('Daily Rate (₱)', 'daily_rate', 'number', true),
  field('Monthly Rate (₱)', 'monthly_rate', 'number'),
  field('Max Cash Advance (₱)', 'max_cash_advance', 'number', true),
  field('Beginning Cash Advance Balance (₱)', 'cash_advance_beginning_balance', 'number'),
  field('Cash Advance Deduction Every Payroll Week (₱)', 'cash_advance_weekly_deduction', 'number'),
  field('SSS Number', 'sss_number'),
  field('PhilHealth Number', 'philhealth_number'),
  field('Pag-IBIG Number', 'pagibig_number'),
  field('TIN Number', 'tin_number'),
  field('Bank Account', 'bank_account'),
  field('User Email (app login)', 'user_email', 'email'),
  field('Employee ID', 'employee_id', 'text', true),
];

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg']);
const PHOTO_EXTENSIONS = /\.(png|jpe?g)$/i;

export default function EmployeeForm({ employee, onSaved, onCancel, onUpdated }) {
  const { activeCompanyId, activeCompany } = useCompany();
  const isEditing = !!employee?.id;
  const [form, setForm] = useState(employee || {
    status: 'active', employment_type: 'regular', payroll_disbursement_method: 'UNASSIGNED', is_agency_employee: false
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editAuthorization, setEditAuthorization] = useState({ hrPasscode: '', adminPasscode: '', reason: '' });
  const [showCamera, setShowCamera] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [beginningAdjustment, setBeginningAdjustment] = useState(null);
  const [adjustmentForm, setAdjustmentForm] = useState({ type: 'decrease', amount: '', weeklyDeduction: '', reason: '', hrPasscode: '', adminPasscode: '' });
  const [adjustmentError, setAdjustmentError] = useState('');
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!employee?.id) return;
    setForm(prev => {
      if (prev?.id !== employee.id) return employee;

      const updates = {};
      if (!(parseFloat(prev.cash_advance_beginning_balance) > 0) && parseFloat(employee.cash_advance_beginning_balance) > 0) {
        updates.cash_advance_beginning_balance = employee.cash_advance_beginning_balance;
      }
      if (
        (prev.cash_advance_weekly_deduction == null || prev.cash_advance_weekly_deduction === '') &&
        employee.cash_advance_weekly_deduction != null
      ) {
        updates.cash_advance_weekly_deduction = employee.cash_advance_weekly_deduction;
      }

      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
    });
  }, [employee?.id, employee?.cash_advance_beginning_balance, employee?.cash_advance_weekly_deduction]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openBeginningAdjustment = async () => {
    setAdjustmentError('');
    try {
      const advances = await appApi.entities.CashAdvance.filter({
        employee_id: employee.employee_id,
        company_profile_id: employee.company_profile_id || activeCompanyId,
      });
      const advance = advances.find(item => item.advance_type === 'beginning_balance');
      if (!advance) {
        setAdjustmentError('No beginning balance record was found for this employee.');
        return;
      }
      setBeginningAdjustment(advance);
      setAdjustmentForm({
        type: 'decrease',
        amount: '',
        weeklyDeduction: String(advance.deduction_amount_per_payroll || employee.cash_advance_weekly_deduction || ''),
        reason: '',
        hrPasscode: '',
        adminPasscode: '',
      });
    } catch (error) {
      setAdjustmentError(error?.message || 'Unable to load the beginning balance.');
    }
  };

  const saveBeginningAdjustment = async () => {
    const amount = parseFloat(adjustmentForm.amount);
    const weeklyDeduction = parseFloat(adjustmentForm.weeklyDeduction);
    if (!(amount > 0)) return setAdjustmentError('Enter a valid adjustment amount.');
    if (!(weeklyDeduction > 0)) return setAdjustmentError('Weekly deduction amount is required before saving the adjustment.');
    if (adjustmentForm.reason.trim().length < 3) return setAdjustmentError('Enter a reason for the adjustment.');
    if (!adjustmentForm.hrPasscode.trim() || !adjustmentForm.adminPasscode.trim()) return setAdjustmentError('Both HR Officer and Admin Manager passcodes are required.');

    setAdjustmentSaving(true);
    setAdjustmentError('');
    try {
      const result = await appApi.functions.invoke('adjustCashAdvanceBalance', {
        company_profile_id: employee.company_profile_id || activeCompanyId,
        cash_advance_id: beginningAdjustment.id,
        adjustment_type: adjustmentForm.type,
        amount,
        weekly_deduction: weeklyDeduction,
        reason: adjustmentForm.reason.trim(),
        hr_passcode: adjustmentForm.hrPasscode.trim(),
        admin_passcode: adjustmentForm.adminPasscode.trim(),
      });
      setForm(previous => ({
        ...previous,
        cash_advance_beginning_balance: result.advance.remaining_balance,
        cash_advance_weekly_deduction: result.advance.deduction_amount_per_payroll,
      }));
      setBeginningAdjustment(null);
      onUpdated?.();
    } catch (error) {
      setAdjustmentError(error?.message || 'Unable to adjust the beginning balance.');
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const savePhotoUrl = async (fileUrl) => {
    setPhotoError('');
    set('photo_url', fileUrl);
  };

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
      try {
        const { file_url } = await appApi.integrations.Core.UploadFile({ file });
        await savePhotoUrl(file_url);
        stopCamera();
      } catch (error) {
        setPhotoError(error.message || 'Unable to save photo');
      } finally {
        setUploadingPhoto(false);
      }
    }, 'image/jpeg', 0.9);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type) || !PHOTO_EXTENSIONS.test(file.name)) {
      setPhotoError('Upload a PNG, JPG, or JPEG photo.');
      e.target.value = '';
      return;
    }

    setPhotoError('');
    setUploadingPhoto(true);
    try {
      const { file_url } = await appApi.integrations.Core.UploadFile({ file });
      await savePhotoUrl(file_url);
    } catch (error) {
      setPhotoError(error.message || 'Unable to upload photo');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const removePhoto = async () => {
    try {
      await savePhotoUrl('');
    } catch (error) {
      setPhotoError(error.message || 'Unable to remove photo');
    }
  };

  const generateQR = () => {
    set('qr_code', form.employee_id || String(Date.now()));
  };

  const syncBeginningCashAdvance = async (employeeData) => {
    const beginningBalance = parseFloat(employeeData.cash_advance_beginning_balance) || 0;
    const weeklyDeduction = parseFloat(employeeData.cash_advance_weekly_deduction) || 0;
    if (beginningBalance <= 0 || !employeeData.employee_id) return;

    const payrollWeeks = weeklyDeduction > 0 ? Math.ceil(beginningBalance / weeklyDeduction) : 0;
    const payload = {
      employee_id: employeeData.employee_id,
      employee_name: [employeeData.first_name, employeeData.middle_name, employeeData.last_name].filter(Boolean).join(' '),
      department: employeeData.department,
      amount_requested: beginningBalance,
      amount_approved: beginningBalance,
      beginning_balance: beginningBalance,
      remaining_balance: beginningBalance,
      deduction_payroll_periods: payrollWeeks,
      deduction_amount_per_payroll: weeklyDeduction,
      deduction_periods_remaining: payrollWeeks,
      reason: 'Beginning balance from previous cash advance',
      advance_type: 'beginning_balance',
      request_date: employeeData.date_hired || new Date().toISOString().slice(0, 10),
      status: 'approved',
      company_profile_id: employeeData.company_profile_id || activeCompanyId,
    };

    const existing = await appApi.entities.CashAdvance.filter({
      employee_id: employeeData.employee_id,
      company_profile_id: employeeData.company_profile_id || activeCompanyId,
    });
    const beginningAdvance = existing.find(ca => ca.advance_type === 'beginning_balance');

    let syncedAdvance;
    if (beginningAdvance?.id) {
      syncedAdvance = await appApi.entities.CashAdvance.update(beginningAdvance.id, payload);
    } else {
      syncedAdvance = await appApi.entities.CashAdvance.create(payload);
    }
    await ensureCashAdvanceBeginningLedger(syncedAdvance);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!String(form.employee_id || '').trim()) {
      const message = 'Employee ID is required. The profile cannot be saved without an Employee ID.';
      setSaveError(message);
      window.alert(message);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const data = { ...form };
      // Remove the retired employee-level percentage. Agency fees are defined
      // only by the fixed company-level configuration.
      delete data.agency_fee_percentage;
      data.employee_id = String(data.employee_id).trim();
      if (data.daily_rate) data.daily_rate = parseFloat(data.daily_rate);
      if (data.monthly_rate) data.monthly_rate = parseFloat(data.monthly_rate);
      if (data.max_cash_advance) data.max_cash_advance = parseFloat(data.max_cash_advance);
      if (data.cash_advance_beginning_balance) data.cash_advance_beginning_balance = parseFloat(data.cash_advance_beginning_balance);
      if (data.cash_advance_weekly_deduction) data.cash_advance_weekly_deduction = parseFloat(data.cash_advance_weekly_deduction);
      if (!data.company_profile_id) data.company_profile_id = activeCompanyId;
      if (!isEditing && Number(data.cash_advance_beginning_balance) > 0 && !(Number(data.cash_advance_weekly_deduction) > 0)) {
        throw new Error('Weekly deduction amount is required when setting a beginning cash advance balance.');
      }
      if (isEditing && (
        !editAuthorization.hrPasscode.trim() ||
        !editAuthorization.adminPasscode.trim() ||
        editAuthorization.reason.trim().length < 3
      )) {
        throw new Error('Both daily passcodes and a reason are required to edit an employee profile.');
      }

      let savedEmployee;
      if (employee?.id) {
        const result = await appApi.functions.invoke('updateEmployeeProfile', {
          employee_record_id: employee.id,
          company_profile_id: employee.company_profile_id || activeCompanyId,
          data,
          hr_passcode: editAuthorization.hrPasscode.trim(),
          admin_passcode: editAuthorization.adminPasscode.trim(),
          reason: editAuthorization.reason.trim(),
        });
        savedEmployee = result.employee;
      } else {
        if (!data.qr_code) data.qr_code = data.employee_id;
        savedEmployee = await appApi.entities.Employee.create(data);
      }

      if (!isEditing) await syncBeginningCashAdvance(savedEmployee || data);
      onSaved();
    } catch (error) {
      setSaveError(error?.message || 'Unable to save the employee profile.');
    } finally {
      setSaving(false);
    }
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
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={startCamera} disabled={uploadingPhoto}>
                <Camera className="w-3.5 h-3.5" /> Camera
              </Button>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}>
                <Upload className="w-3.5 h-3.5" /> {uploadingPhoto ? 'Uploading...' : 'Upload'}
              </Button>
              {form.photo_url && (
                <Button type="button" size="sm" variant="ghost" className="gap-1 text-destructive" onClick={removePhoto}>
                  <X className="w-3.5 h-3.5" /> Remove
                </Button>
              )}
            </div>
            {photoError && <p className="text-xs text-destructive text-center">{photoError}</p>}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {isEditing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Beginning Cash Advance Balance</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">₱{Number(form.cash_advance_beginning_balance || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                Weekly deduction: {Number(form.cash_advance_weekly_deduction) > 0 ? `₱${Number(form.cash_advance_weekly_deduction).toLocaleString()}` : 'Not set'}
              </p>
            </div>
            <Button type="button" variant="outline" className="gap-1.5" onClick={openBeginningAdjustment}>
              <SlidersHorizontal className="h-4 w-4" /> Adjust Beginning Balance
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Only this beginning balance can be adjusted. Today&apos;s HR Officer and Admin Manager passcodes are required.</p>
          {adjustmentError && !beginningAdjustment && <p className="mt-2 text-xs text-destructive">{adjustmentError}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.filter(f => !isEditing || !['cash_advance_beginning_balance', 'cash_advance_weekly_deduction'].includes(f.key)).map(f => (
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
          <Label className="text-xs font-medium">Payroll Payment Method</Label>
          <Select value={form.payroll_disbursement_method || 'UNASSIGNED'} onValueChange={v => set('payroll_disbursement_method', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              <SelectItem value="ATM">ATM</SelectItem>
              <SelectItem value="NON_ATM">Non-ATM</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {activeCompany?.uses_employee_agency === true && (
          <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 h-8 text-xs font-medium">
            <input type="checkbox" checked={form.is_agency_employee === true} onChange={e => set('is_agency_employee', e.target.checked)} />
            Agency Employee
          </label>
        )}

        <div className="space-y-1">
          <Label className="text-xs font-medium">Status</Label>
          <Select value={form.status || 'active'} onValueChange={v => set('status', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['active', 'inactive', 'resigned', 'terminated', 'archived'].map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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

      {isEditing && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Authorize Profile Changes</p>
            <p className="text-xs text-muted-foreground">Today&apos;s HR Officer and Admin passcodes are required. The reason and changed fields will appear in the Passcode Audit Summary.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">HR Officer passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={editAuthorization.hrPasscode}
                onChange={event => setEditAuthorization(previous => ({ ...previous, hrPasscode: event.target.value }))}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
            <div>
              <Label className="text-xs">Admin passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={editAuthorization.adminPasscode}
                onChange={event => setEditAuthorization(previous => ({ ...previous, adminPasscode: event.target.value }))}
                className="mt-1 text-center font-mono tracking-widest"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Reason for profile changes</Label>
            <Textarea
              value={editAuthorization.reason}
              onChange={event => setEditAuthorization(previous => ({ ...previous, reason: event.target.value }))}
              placeholder="Why is this employee profile being updated?"
              className="mt-1"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {saveError && <p className="mr-auto self-center text-xs text-destructive">{saveError}</p>}
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving...' : (employee ? 'Update' : 'Create')}</Button>
      </div>

      <Dialog open={!!beginningAdjustment} onOpenChange={open => !open && setBeginningAdjustment(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adjust Beginning Balance</DialogTitle></DialogHeader>
          {beginningAdjustment && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-3 text-sm">
                Current balance: <strong>₱{Number(beginningAdjustment.remaining_balance ?? beginningAdjustment.amount_approved ?? 0).toLocaleString()}</strong>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Adjustment Type *</Label>
                <Select value={adjustmentForm.type} onValueChange={value => setAdjustmentForm(previous => ({ ...previous, type: value }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="decrease">Decrease balance</SelectItem><SelectItem value="increase">Increase balance</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Adjustment Amount (₱) *</Label><Input type="number" min="0.01" step="0.01" value={adjustmentForm.amount} onChange={event => setAdjustmentForm(previous => ({ ...previous, amount: event.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">Weekly Deduction (₱) *</Label><Input type="number" min="0.01" step="0.01" value={adjustmentForm.weeklyDeduction} onChange={event => setAdjustmentForm(previous => ({ ...previous, weeklyDeduction: event.target.value }))} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Reason *</Label><Textarea value={adjustmentForm.reason} onChange={event => setAdjustmentForm(previous => ({ ...previous, reason: event.target.value }))} placeholder="Why is the beginning balance being adjusted?" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">HR Officer Passcode *</Label><Input type="password" inputMode="numeric" maxLength={6} value={adjustmentForm.hrPasscode} onChange={event => setAdjustmentForm(previous => ({ ...previous, hrPasscode: event.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">Admin Manager Passcode *</Label><Input type="password" inputMode="numeric" maxLength={6} value={adjustmentForm.adminPasscode} onChange={event => setAdjustmentForm(previous => ({ ...previous, adminPasscode: event.target.value }))} /></div>
              </div>
              {adjustmentError && <p className="text-xs text-destructive">{adjustmentError}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setBeginningAdjustment(null)} disabled={adjustmentSaving}>Cancel</Button><Button type="button" onClick={saveBeginningAdjustment} disabled={adjustmentSaving}>{adjustmentSaving ? 'Saving...' : 'Authorize Adjustment'}</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </form>
  );
}
