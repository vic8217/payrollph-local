// @ts-nocheck
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Building2, Save, Plus, Upload } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ImageWithFallback from '@/components/ImageWithFallback';
import { useCompany } from '@/lib/CompanyContext';
import { PAYROLL_WEEKDAY_OPTIONS, DEFAULT_PAYROLL_LENGTH_DAYS, DEFAULT_PAYROLL_START_DAY, getPayrollPeriodSummary } from '@/lib/payrollPeriod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  list(entity, sort, limit) {
    return requestJson(entityUrl(entity, { sort, limit }));
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

async function uploadFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return requestJson('/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      name: file?.name,
      dataUrl,
    }),
  });
}

export default function CompanyProfile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { refreshCompanies } = useCompany();
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [showForm, setShowForm] = useState(false);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['company-profiles'],
    queryFn: () => entities.list('CompanyProfile'),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingId) {
        return entities.update('CompanyProfile', editingId, data);
      }
      return entities.create('CompanyProfile', data);
    },
    onSuccess: async (company) => {
      queryClient.invalidateQueries({ queryKey: ['company-profiles'] });
      await refreshCompanies(editingId ? undefined : { selectCompanyId: company?.id });
      setShowForm(false);
      setEditingId(null);
      setForm({});
      toast({ title: editingId ? 'Company updated' : 'Company created' });
    },
  });

  const handleEdit = (company) => {
    setForm({ ...company });
    setEditingId(company.id);
    setShowForm(true);
  };

  const handleNew = () => {
    setForm({});
    setEditingId(null);
    setShowForm(true);
  };

  const handleSave = () => {
    saveMutation.mutate({
      ...form,
      payroll_period_start_day: Number(form.payroll_period_start_day ?? DEFAULT_PAYROLL_START_DAY),
      payroll_period_length_days: Number(form.payroll_period_length_days ?? DEFAULT_PAYROLL_LENGTH_DAYS),
    });
  };

  const fields = [
    { key: 'company_name', label: 'Company Name', required: true },
    { key: 'trade_name', label: 'Trade Name / DBA' },
    { key: 'subdomain', label: 'Subdomain (e.g. company1)', hint: 'Used to access this company\'s portal' },
    { key: 'tin_number', label: 'TIN Number' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'sss_employer_number', label: 'SSS Employer Number' },
    { key: 'philhealth_employer_number', label: 'PhilHealth Employer Number' },
    { key: 'pagibig_employer_number', label: 'Pag-IBIG Employer Number' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Company Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage company information for payroll records</p>
        </div>
        <Button onClick={handleNew} className="gap-2">
          <Plus className="w-4 h-4" /> Add Company
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingId ? 'Edit Company' : 'New Company'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map(({ key, label, required, hint }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key}>
                    {label} {required && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={key}
                    value={form[key] || ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={label}
                  />
                  {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={form.address || ''}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Complete business address"
                rows={3}
              />
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Payroll Period</p>
                <p className="text-xs text-muted-foreground mt-0.5">Controls the period used when HR generates payroll for this company.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Period Start Day</Label>
                  <Select
                    value={String(form.payroll_period_start_day ?? DEFAULT_PAYROLL_START_DAY)}
                    onValueChange={(value) => setForm({ ...form, payroll_period_start_day: Number(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYROLL_WEEKDAY_OPTIONS.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payroll_period_length_days">Period Length (Days)</Label>
                  <Input
                    id="payroll_period_length_days"
                    type="number"
                    min="1"
                    max="31"
                    value={form.payroll_period_length_days ?? DEFAULT_PAYROLL_LENGTH_DAYS}
                    onChange={(e) => setForm({ ...form, payroll_period_length_days: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Logo</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.logo_url || ''}
                  onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  placeholder="https://... or upload below"
                  className="flex-1"
                />
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const { file_url } = await uploadFile(file);
                      setForm((prev) => ({ ...prev, logo_url: file_url }));
                    }}
                  />
                  <div className="h-9 px-3 flex items-center gap-1.5 border border-input rounded-md bg-background text-sm hover:bg-accent cursor-pointer whitespace-nowrap">
                    <Upload className="w-4 h-4" /> Upload
                  </div>
                </label>
              </div>
              {form.logo_url && (
                <ImageWithFallback
                  src={form.logo_url}
                  alt="Logo preview"
                  className="mt-2 h-16 rounded-lg border object-contain"
                  fallback={
                    <div className="mt-2 h-16 rounded-lg border border-dashed bg-muted/40 px-4 flex items-center text-xs text-muted-foreground">
                      Logo file is unavailable. Upload the logo again or enter a valid image URL.
                    </div>
                  }
                />
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowForm(false); setForm({}); setEditingId(null); }}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!form.company_name || saveMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" /> {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Loading...</div>
      ) : companies.length === 0 && !showForm ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No companies added yet.</p>
          <Button variant="outline" className="mt-4" onClick={handleNew}>Add your first company</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {companies.map((company) => (
            <Card key={company.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {company.logo_url ? (
                      <ImageWithFallback
                        src={company.logo_url}
                        alt={`${company.company_name} logo`}
                        className="w-12 h-12 rounded-lg object-cover border"
                        fallback={
                          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="w-6 h-6 text-primary" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-primary" />
                      </div>
                    )}
                    <div>
                      <h2 className="font-semibold text-foreground">{company.company_name}</h2>
                      {company.trade_name && <p className="text-sm text-muted-foreground">{company.trade_name}</p>}
                      {company.subdomain && (
                        <p className="text-xs text-primary font-mono mt-0.5">
                          🌐 {company.subdomain}.abaccuz.com
                        </p>
                      )}
                      {company.address && <p className="text-xs text-muted-foreground mt-1">{company.address}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleEdit(company)}>Edit</Button>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {company.sss_employer_number && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">SSS Employer No.</p>
                      <p className="font-mono font-semibold mt-0.5">{company.sss_employer_number}</p>
                    </div>
                  )}
                  {company.philhealth_employer_number && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">PhilHealth Employer No.</p>
                      <p className="font-mono font-semibold mt-0.5">{company.philhealth_employer_number}</p>
                    </div>
                  )}
                  {company.pagibig_employer_number && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">Pag-IBIG Employer No.</p>
                      <p className="font-mono font-semibold mt-0.5">{company.pagibig_employer_number}</p>
                    </div>
                  )}
                  {company.tin_number && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">TIN</p>
                      <p className="font-mono font-semibold mt-0.5">{company.tin_number}</p>
                    </div>
                  )}
                  {company.phone && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">Phone</p>
                      <p className="font-semibold mt-0.5">{company.phone}</p>
                    </div>
                  )}
                  {company.email && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">Email</p>
                      <p className="font-semibold mt-0.5">{company.email}</p>
                    </div>
                  )}
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground font-medium">Payroll Period</p>
                    <p className="font-semibold mt-0.5">{getPayrollPeriodSummary(company)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
