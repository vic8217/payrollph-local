import { useRef, useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { buildCashAdvanceAgreementTagalogText, buildCashAdvanceAgreementText, CASH_ADVANCE_PAYMENT_DAYS, MASTER_CASH_ADVANCE_AGREEMENT_VERSION } from '@/lib/cashAdvanceAgreement';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Download, FilePenLine, Languages, Paperclip, Printer, Send, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const getCashAdvanceBalance = (advance) => advance.remaining_balance != null
  ? advance.remaining_balance
  : (advance.amount_approved || advance.amount_requested || 0);

const DOCUMENT_TABS = {
  memos: {
    entity: 'EmployeeMemo',
    queryKey: 'employeeMemos',
    empty: 'No memos issued.',
    filename: 'memo-template.csv',
    headers: ['employee_id', 'title', 'issue_date', 'category', 'body', 'requires_signature', 'signed'],
    example: ['EMP001', 'Notice to Explain', '2026-04-29', 'Attendance', 'Please explain the attendance incident.', 'yes', 'no'],
  },
  suspension: {
    entity: 'EmployeeSuspension',
    queryKey: 'employeeSuspensions',
    empty: 'No suspension documents.',
    filename: 'suspension-template.csv',
    headers: ['employee_id', 'title', 'notice_date', 'start_date', 'end_date', 'reason', 'body', 'requires_signature', 'signed'],
    example: ['EMP001', 'Suspension Notice', '2026-04-29', '2026-05-01', '2026-05-03', 'Policy violation', 'Suspension details and conditions.', 'yes', 'no'],
  },
  termination: {
    entity: 'EmployeeTermination',
    queryKey: 'employeeTerminations',
    empty: 'No termination documents.',
    filename: 'termination-template.csv',
    headers: ['employee_id', 'title', 'notice_date', 'effective_date', 'reason', 'body'],
    example: ['EMP001', 'Termination Notice', '2026-04-29', '2026-05-15', 'Authorized cause', 'Termination details and clearance instructions.'],
  },
  promissory: {
    entity: 'EmployeePromissoryNote',
    queryKey: 'employeePromissoryNotes',
    empty: 'No promissory notes.',
    filename: 'promissory-note-template.csv',
    headers: ['employee_id', 'title', 'note_date', 'amount', 'due_date', 'terms', 'requires_signature', 'signed'],
    example: ['EMP001', 'Promissory Note', '2026-04-29', '5000', '2026-05-29', 'Employee promises to pay through payroll deduction.', 'yes', 'no'],
  },
};

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const parseBool = (value) => ['yes', 'true', '1', 'signed'].includes(String(value || '').trim().toLowerCase());
const today = () => new Date().toISOString().slice(0, 10);
const RESPONSE_ACCEPT = '.png,.jpg,.jpeg,.pdf,.doc,.docx,.txt';
const translateReason = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'policy violation') return 'Paglabag sa patakaran';
  if (normalized === 'employment separation') return 'Pagwawakas ng empleyo';
  return value || '';
};

const translateCategory = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'attendance') return 'Pagpasok';
  return value || '';
};
const documentDateValue = (record) => {
  const value = record.issue_date ||
    record.notice_date ||
    record.note_date ||
    record.effective_date ||
    record.start_date ||
    record.due_date ||
    record.processed_date ||
    record.updated_date ||
    record.created_date;

  return value ? Date.parse(value) || 0 : 0;
};
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
};

export default function Employee201File({ employee, onEditProfile }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [templateTab, setTemplateTab] = useState(null);
  const [templateForm, setTemplateForm] = useState({});
  const [uploadingResponseId, setUploadingResponseId] = useState(null);
  const [agreementLanguage, setAgreementLanguage] = useState('english');
  const [uploadingSignedAgreement, setUploadingSignedAgreement] = useState(false);
  const fileInputRef = useRef(null);
  const responseInputRef = useRef(null);
  const agreementSignedInputRef = useRef(null);
  const importTabRef = useRef(null);
  const responseTargetRef = useRef(null);
  const qc = useQueryClient();
  const { activeCompany } = useCompany();

  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['cashAdvances', employee.employee_id],
    queryFn: () => appApi.entities.CashAdvance.filter({ employee_id: employee.employee_id }),
  });

  const { data: memos = [] } = useQuery({
    queryKey: ['employeeMemos', employee.employee_id],
    queryFn: () => appApi.entities.EmployeeMemo.filter({ employee_id: employee.employee_id }),
  });

  const { data: suspensions = [] } = useQuery({
    queryKey: ['employeeSuspensions', employee.employee_id],
    queryFn: () => appApi.entities.EmployeeSuspension.filter({ employee_id: employee.employee_id }),
  });

  const { data: terminations = [] } = useQuery({
    queryKey: ['employeeTerminations', employee.employee_id],
    queryFn: () => appApi.entities.EmployeeTermination.filter({ employee_id: employee.employee_id }),
  });

  const { data: promissoryNotes = [] } = useQuery({
    queryKey: ['employeePromissoryNotes', employee.employee_id],
    queryFn: () => appApi.entities.EmployeePromissoryNote.filter({ employee_id: employee.employee_id }),
  });

  const documentRecords = {
    memos,
    suspension: suspensions,
    termination: terminations,
    promissory: promissoryNotes,
  };

  const employeeName = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ').trim();
  const agreementCompanyName = activeCompany?.company_name || activeCompany?.trade_name || 'Employer';
  const agreementParams = {
    companyName: agreementCompanyName,
    employeeName: employeeName || 'Employee',
    employeeId: employee.employee_id || '—',
    paymentDays: employee.cash_advance_payment_days || CASH_ADVANCE_PAYMENT_DAYS,
  };
  const englishAgreementText = buildCashAdvanceAgreementText(agreementParams);
  const tagalogAgreementText = buildCashAdvanceAgreementTagalogText(agreementParams);
  const agreementText = agreementLanguage === 'tagalog' ? tagalogAgreementText : englishAgreementText;
  const acceptedAgreementVersion = employee.cash_advance_agreement_version || employee.agreement_version;
  const agreementAcceptedAt = employee.cash_advance_agreement_accepted_at || employee.accepted_at;
  const agreementIpAddress = employee.cash_advance_agreement_ip_address || employee.ip_address;
  const agreementDeviceInfo = employee.cash_advance_agreement_device_info || employee.device_info;
  const agreementAccepted = acceptedAgreementVersion === MASTER_CASH_ADVANCE_AGREEMENT_VERSION;
  const signedAgreementUrl = employee.cash_advance_agreement_signed_file_url || employee.cash_advance_agreement_signed_url;
  const signedAgreementName = employee.cash_advance_agreement_signed_file_name || 'Signed cash advance agreement';
  const agreementAcceptancePhotoUrl = employee.cash_advance_agreement_acceptance_photo_url;
  const agreementAcceptancePhotoAt = employee.cash_advance_agreement_acceptance_photo_uploaded_at;
  const agreementAcceptancePhotoAtLabel = agreementAcceptancePhotoAt
    ? (Number.isFinite(Date.parse(agreementAcceptancePhotoAt))
        ? new Date(agreementAcceptancePhotoAt).toLocaleString()
        : agreementAcceptancePhotoAt)
    : null;
  const beginningCashAdvanceBalance = parseFloat(employee.cash_advance_beginning_balance) || 0;
  const beginningCashAdvanceDeduction = parseFloat(employee.cash_advance_weekly_deduction) || 0;
  const hasBeginningCashAdvanceRecord = cashAdvances.some(advance => advance.advance_type === 'beginning_balance');
  const displayedCashAdvances = beginningCashAdvanceBalance > 0 && !hasBeginningCashAdvanceRecord
    ? [
        {
          id: 'employee-beginning-cash-advance',
          amount_requested: beginningCashAdvanceBalance,
          amount_approved: beginningCashAdvanceBalance,
          beginning_balance: beginningCashAdvanceBalance,
          remaining_balance: beginningCashAdvanceBalance,
          deduction_amount_per_payroll: beginningCashAdvanceDeduction,
          deduction_payroll_periods: beginningCashAdvanceDeduction > 0
            ? Math.ceil(beginningCashAdvanceBalance / beginningCashAdvanceDeduction)
            : 0,
          reason: 'Beginning balance from employee profile',
          request_date: employee.date_hired || employee.created_date,
          status: 'approved',
          advance_type: 'beginning_balance',
        },
        ...cashAdvances,
      ]
    : cashAdvances;

  const printAgreement = () => {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return;
    const printedAt = new Date().toLocaleDateString();
    win.document.write(`<!DOCTYPE html>
      <html>
        <head>
          <title>Cash Advance Master Agreement</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; line-height: 1.5; }
            h1 { font-size: 22px; margin: 0 0 6px; text-align: center; }
            .subtitle { text-align: center; font-size: 12px; color: #4b5563; margin-bottom: 28px; }
            .agreement { white-space: pre-wrap; font-size: 13px; }
            .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; margin-top: 64px; page-break-inside: avoid; }
            .signature-block { min-height: 96px; }
            .line { border-top: 1px solid #111827; padding-top: 8px; text-align: center; font-size: 12px; }
            .meta { text-align: center; font-size: 11px; color: #4b5563; margin-top: 4px; }
            .notary { margin-top: 56px; page-break-inside: avoid; border-top: 2px solid #111827; padding-top: 20px; font-size: 12px; }
            .notary h2 { font-size: 15px; margin: 0 0 14px; text-align: center; letter-spacing: 0.08em; }
            .notary p { margin: 10px 0; }
            .notary-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 42px; margin-top: 28px; }
            .notary-field { border-top: 1px solid #111827; padding-top: 6px; min-height: 18px; }
            @page { margin: 24mm 18mm 24mm 18mm; }
          </style>
        </head>
        <body>
          <h1>Master Cash Advance Agreement</h1>
          <div class="subtitle">Version ${escapeHtml(MASTER_CASH_ADVANCE_AGREEMENT_VERSION)} | Printed ${escapeHtml(printedAt)}</div>
          <div class="agreement">${escapeHtml(agreementText)}</div>

          <div class="signature-grid">
            <div class="signature-block">
              <div class="line">${escapeHtml(employeeName || 'Employee')}</div>
              <div class="meta">Employee Signature over Printed Name</div>
              <div class="meta">Employee ID: ${escapeHtml(employee.employee_id || '')}</div>
              <div class="meta">Date: ____________________</div>
            </div>
            <div class="signature-block">
              <div class="line">${escapeHtml(agreementCompanyName)}</div>
              <div class="meta">Employer / Authorized Representative</div>
              <div class="meta">Name and Position: ____________________</div>
              <div class="meta">Date: ____________________</div>
            </div>
          </div>

          <div class="notary">
            <h2>ACKNOWLEDGMENT / NOTARIZATION</h2>
            <p>REPUBLIC OF THE PHILIPPINES )</p>
            <p>____________________________ ) S.S.</p>
            <p>
              BEFORE ME, a Notary Public for and in the above jurisdiction, personally appeared the following persons,
              who presented competent evidence of identity and represented that they voluntarily signed this Master Cash
              Advance Agreement and acknowledged that the same is their free and voluntary act and deed.
            </p>
            <div class="notary-lines">
              <div class="notary-field">Employee ID / Government ID</div>
              <div class="notary-field">Employer Representative ID</div>
              <div class="notary-field">Doc. No.</div>
              <div class="notary-field">Page No.</div>
              <div class="notary-field">Book No.</div>
              <div class="notary-field">Series of</div>
            </div>
            <div style="margin-top:64px; width:48%; margin-left:auto;">
              <div class="line">Notary Public</div>
              <div class="meta">Until: ____________________</div>
              <div class="meta">PTR No.: ____________________</div>
              <div class="meta">IBP No.: ____________________</div>
            </div>
          </div>
        </body>
      </html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  const uploadSignedAgreement = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !employee.id) return;

    setUploadingSignedAgreement(true);
    try {
      const { file_url } = await appApi.integrations.Core.UploadFile({ file });
      await appApi.entities.Employee.update(employee.id, {
        cash_advance_agreement_signed_file_url: file_url,
        cash_advance_agreement_signed_file_name: file.name,
        cash_advance_agreement_signed_uploaded_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch (err) {
      alert(`Signed agreement upload failed: ${err.message}`);
    } finally {
      setUploadingSignedAgreement(false);
      e.target.value = '';
    }
  };

  const handleDownload = () => {
    const data = {
      'Employee ID': employee.employee_id,
      'Full Name': `${employee.first_name} ${employee.last_name}`,
      'Department': employee.department || '—',
      'Position': employee.position || '—',
      'Employment Type': (employee.employment_type || '—').replace('_', ' '),
      'Status': employee.status,
      'Daily Rate': employee.daily_rate || 0,
      'Date of Birth': employee.date_of_birth || '—',
      'Date Hired': employee.date_hired || '—',
      'Email': employee.email || '—',
      'Phone': employee.phone || '—',
      'SSS Number': employee.sss_number || '—',
      'PhilHealth Number': employee.philhealth_number || '—',
      'Pag-IBIG Number': employee.pagibig_number || '—',
      'TIN Number': employee.tin_number || '—',
    };

    const csv = Object.keys(data).map(key => `"${key}","${data[key]}"`).join('\n');
    const header = Object.keys(data).map(k => `"${k}"`).join(',');
    const fullCsv = header + '\n' + csv;

    const blob = new Blob([fullCsv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `201-file-${employee.employee_id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const downloadDocumentTemplate = (tabId) => {
    const config = DOCUMENT_TABS[tabId];
    const example = [...config.example];
    example[0] = employee.employee_id;
    const csv = [
      config.headers.map(csvEscape).join(','),
      example.map(csvEscape).join(','),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = config.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const startImport = (tabId) => {
    importTabRef.current = tabId;
    fileInputRef.current?.click();
  };

  const startResponseImport = (tabId, record) => {
    responseTargetRef.current = { tabId, record };
    responseInputRef.current?.click();
  };

  const defaultTemplateForm = (tabId) => {
    const base = {
      employee_id: employee.employee_id,
      employee_name: employeeName,
      department: employee.department || '',
      requires_signature: tabId !== 'termination',
      signed: false,
    };

    if (tabId === 'memos') {
      return {
        ...base,
        title: 'Notice to Explain',
        issue_date: today(),
        category: 'Attendance',
        body: `Dear ${employeeName || 'Employee'},\n\nPlease submit your written explanation regarding the incident described below.\n\nIncident details:\n\nExpected response date:\n\nThis notice is issued for your acknowledgment and response.`,
      };
    }

    if (tabId === 'suspension') {
      return {
        ...base,
        title: 'Suspension Notice',
        notice_date: today(),
        start_date: today(),
        end_date: today(),
        reason: 'Policy violation',
        body: `Dear ${employeeName || 'Employee'},\n\nThis serves as formal notice of suspension based on the following matter:\n\nReason:\n\nSuspension period:\n\nPlease coordinate with HR for your return-to-work instructions.`,
      };
    }

    if (tabId === 'termination') {
      return {
        ...base,
        title: 'Termination Notice',
        notice_date: today(),
        effective_date: today(),
        reason: 'Employment separation',
        body: `Dear ${employeeName || 'Employee'},\n\nThis serves as formal notice of termination of employment.\n\nReason:\n\nEffective date:\n\nPlease coordinate with HR for clearance and final pay processing.`,
      };
    }

    return {
      ...base,
      title: 'Promissory Note',
      note_date: today(),
      amount: '',
      due_date: today(),
      terms: `I, ${employeeName || 'Employee'}, acknowledge this obligation and promise to settle the amount stated in this promissory note according to the agreed terms.\n\nTerms:\n\nPayroll deduction schedule:\n\nEmployee acknowledgment:`,
    };
  };

  const openTemplate = (tabId) => {
    setTemplateTab(tabId);
    setTemplateForm(defaultTemplateForm(tabId));
  };

  const setTemplateValue = (key, value) => {
    setTemplateForm(prev => ({ ...prev, [key]: value }));
  };

  const getTemplateBody = () => templateForm.body || templateForm.terms || '';

  const getTemplateDate = () => (
    templateForm.issue_date ||
    templateForm.notice_date ||
    templateForm.note_date ||
    templateForm.effective_date ||
    today()
  );

  const translateTemplateToTagalog = () => {
    if (!templateTab) return;
    const name = employeeName || 'Empleyado';

    if (templateTab === 'memos') {
      setTemplateForm(prev => ({
        ...prev,
        title: 'Paunawa para Magpaliwanag',
        category: translateCategory(prev.category),
        body: `Mahal na ${name},\n\nPakisumite ang inyong nakasulat na paliwanag tungkol sa insidenteng nakasaad sa ibaba.\n\nMga detalye ng insidente:\n\nInaasahang petsa ng tugon:\n\nAng paunawang ito ay ibinibigay para sa inyong pagkilala at pagtugon.`,
      }));
      return;
    }

    if (templateTab === 'suspension') {
      setTemplateForm(prev => ({
        ...prev,
        title: 'Paunawa ng Suspensyon',
        reason: translateReason(prev.reason),
        body: `Mahal na ${name},\n\nIto ay pormal na paunawa ng suspensyon batay sa sumusunod na usapin:\n\nDahilan:\n\nPanahon ng suspensyon:\n\nMakipag-ugnayan sa HR para sa inyong mga tagubilin sa pagbabalik-trabaho.`,
      }));
      return;
    }

    if (templateTab === 'termination') {
      setTemplateForm(prev => ({
        ...prev,
        title: 'Paunawa ng Pagwawakas ng Empleyo',
        reason: translateReason(prev.reason),
        body: `Mahal na ${name},\n\nIto ay pormal na paunawa ng pagwawakas ng inyong empleyo.\n\nDahilan:\n\nPetsa ng bisa:\n\nMakipag-ugnayan sa HR para sa clearance at pagproseso ng huling sahod.`,
      }));
      return;
    }

    if (templateTab === 'promissory') {
      setTemplateForm(prev => ({
        ...prev,
        title: 'Kasulatang Pangako sa Pagbabayad',
        terms: `Ako, si ${name}, ay kinikilala ang obligasyong ito at nangangakong babayaran ang halagang nakasaad sa kasulatang ito ayon sa napagkasunduang mga tuntunin.\n\nMga tuntunin:\n\nIskedyul ng kaltas sa payroll:\n\nPagkilala ng empleyado:`,
      }));
    }
  };

  const buildPrintHtml = () => {
    const title = templateForm.title || 'Employee Document';
    const amountLine = templateForm.amount ? `<p><strong>Amount:</strong> PHP ${escapeHtml(Number(templateForm.amount || 0).toLocaleString())}</p>` : '';
    const periodLine = templateForm.start_date || templateForm.end_date
      ? `<p><strong>Period:</strong> ${escapeHtml(templateForm.start_date || '')} to ${escapeHtml(templateForm.end_date || '')}</p>`
      : '';
    const dueLine = templateForm.due_date ? `<p><strong>Due Date:</strong> ${escapeHtml(templateForm.due_date)}</p>` : '';
    const reasonLine = templateForm.reason ? `<p><strong>Reason:</strong> ${escapeHtml(templateForm.reason)}</p>` : '';

    return `<!DOCTYPE html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 40px; line-height: 1.5; }
            .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 24px; }
            h1 { font-size: 22px; margin: 0 0 6px; }
            p { margin: 4px 0; }
            .meta { font-size: 13px; color: #374151; margin-bottom: 22px; }
            .body { white-space: pre-wrap; font-size: 14px; margin-top: 22px; }
            .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; margin-top: 72px; }
            .line { border-top: 1px solid #111827; padding-top: 8px; text-align: center; font-size: 12px; }
            @page { margin: 18mm; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${escapeHtml(title)}</h1>
            <p class="meta">Date: ${escapeHtml(getTemplateDate())}</p>
          </div>
          <div class="meta">
            <p><strong>Employee:</strong> ${escapeHtml(employeeName)}</p>
            <p><strong>Employee ID:</strong> ${escapeHtml(employee.employee_id)}</p>
            <p><strong>Department:</strong> ${escapeHtml(employee.department || '')}</p>
            ${amountLine}
            ${periodLine}
            ${dueLine}
            ${reasonLine}
          </div>
          <div class="body">${escapeHtml(getTemplateBody())}</div>
          <div class="signature">
            <div class="line">Employee Signature / Date</div>
            <div class="line">HR / Authorized Representative</div>
          </div>
        </body>
      </html>`;
  };

  const printTemplate = () => {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return;
    win.document.write(buildPrintHtml());
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  const processTemplate = async () => {
    if (!templateTab) return;
    const config = DOCUMENT_TABS[templateTab];
    const record = {
      ...templateForm,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      department: employee.department,
      company_profile_id: employee.company_profile_id,
      signed: false,
      processed_date: today(),
    };

    if ('amount' in record) record.amount = parseFloat(record.amount) || 0;

    await appApi.entities[config.entity].create(record);
    qc.invalidateQueries({ queryKey: [config.queryKey, employee.employee_id] });
    setTemplateTab(null);
    setTemplateForm({});
    alert('Document processed and sent to employee portal.');
  };

  const handleDocumentImport = async (e) => {
    const file = e.target.files?.[0];
    const tabId = importTabRef.current;
    if (!file || !tabId) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      const headers = parseCsvLine(lines[0]).map(h => h.trim());
      const config = DOCUMENT_TABS[tabId];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index] || undefined;
        });

        record.employee_id = employee.employee_id;
        record.employee_name = `${employee.first_name} ${employee.last_name}`;
        record.department = employee.department;
        record.company_profile_id = employee.company_profile_id;

        if ('requires_signature' in record) record.requires_signature = record.requires_signature === undefined ? true : parseBool(record.requires_signature);
        if ('signed' in record) record.signed = parseBool(record.signed);
        if ('amount' in record) record.amount = parseFloat(record.amount) || 0;

        await appApi.entities[config.entity].create(record);
      }

      qc.invalidateQueries({ queryKey: [config.queryKey, employee.employee_id] });
      alert(`Imported ${lines.length - 1} record(s).`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
      importTabRef.current = null;
    }
  };

  const handleResponseImport = async (e) => {
    const file = e.target.files?.[0];
    const target = responseTargetRef.current;
    if (!file || !target) return;

    const config = DOCUMENT_TABS[target.tabId];
    setUploadingResponseId(target.record.id);

    try {
      const { file_url } = await appApi.integrations.Core.UploadFile({ file });
      await appApi.entities[config.entity].update(target.record.id, {
        response_file_url: file_url,
        response_file_name: file.name,
        response_uploaded_date: today(),
      });
      qc.invalidateQueries({ queryKey: [config.queryKey, employee.employee_id] });
    } catch (err) {
      alert(`Response upload failed: ${err.message}`);
    } finally {
      setUploadingResponseId(null);
      e.target.value = '';
      responseTargetRef.current = null;
    }
  };

  const renderDocumentList = (tabId) => {
    const config = DOCUMENT_TABS[tabId];
    const canImportResponse = ['memos', 'suspension', 'promissory'].includes(tabId);
    const records = [...(documentRecords[tabId] || [])].sort((a, b) => {
      const dateDiff = documentDateValue(b) - documentDateValue(a);
      if (dateDiff !== 0) return dateDiff;
      return String(b.created_date || '').localeCompare(String(a.created_date || ''));
    });

    return (
      <div className="space-y-3">
        <div className="flex justify-end gap-2">
          <Button size="sm" className="gap-2" onClick={() => openTemplate(tabId)}>
            <FilePenLine className="w-4 h-4" /> Open Template
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => downloadDocumentTemplate(tabId)}>
            <Download className="w-4 h-4" /> CSV Template
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => startImport(tabId)}>
            <Upload className="w-4 h-4" /> Import
          </Button>
        </div>
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">{config.empty}</p>
          </div>
        ) : records.map(record => (
          <Card key={record.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-foreground">{record.title || record.reason || 'Untitled document'}</p>
                  {record.requires_signature !== false && (
                    <Badge className={`text-xs ${record.signed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {record.signed ? 'Signed' : 'Unsigned'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {record.issue_date || record.notice_date || record.note_date || record.effective_date || 'No date'}
                  {record.category ? ` · ${record.category}` : ''}
                  {record.amount ? ` · ₱${record.amount.toLocaleString()}` : ''}
                </p>
                {(record.start_date || record.end_date || record.due_date) && (
                  <p className="text-xs text-muted-foreground">
                    {record.start_date && record.end_date ? `Period: ${record.start_date} to ${record.end_date}` : ''}
                    {record.due_date ? `Due: ${record.due_date}` : ''}
                  </p>
                )}
                {record.signed && record.signed_date && (
                  <p className="text-xs font-medium text-green-700 mt-1">
                    Acknowledged by employee on {record.signed_date}
                  </p>
                )}
                {record.response_file_url && (
                  <a
                    href={record.response_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    {record.response_file_name || 'Employee response'}
                  </a>
                )}
                <p className="text-xs text-foreground mt-2 whitespace-pre-wrap">{record.body || record.reason || record.terms || 'No details provided.'}</p>
              </div>
              {canImportResponse && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 flex-shrink-0"
                  disabled={uploadingResponseId === record.id}
                  onClick={() => startResponseImport(tabId, record)}
                >
                  <Upload className="w-4 h-4" />
                  {uploadingResponseId === record.id ? 'Uploading...' : 'Import Response'}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    );
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'cash-advances', label: 'Cash Advances', icon: '💰' },
    { id: 'cash-advance-agreement', label: 'CA Agreement', icon: '📝' },
    { id: 'memos', label: 'Memos', icon: '📋' },
    { id: 'suspension', label: 'Suspension', icon: '⛔' },
    { id: 'termination', label: 'Termination', icon: '📄' },
    { id: 'promissory', label: 'Promissory Notes', icon: '✍️' },
  ];

  return (
    <div className="space-y-4">
      {/* Download Button */}
      <div className="flex justify-end gap-2">
        {onEditProfile && (
          <Button onClick={onEditProfile} variant="outline" size="sm" className="gap-2">
            <FilePenLine className="w-4 h-4" />
            Edit Profile
          </Button>
        )}
        <Button onClick={handleDownload} variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" />
          Download CSV
        </Button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleDocumentImport} className="hidden" />
        <input ref={responseInputRef} type="file" accept={RESPONSE_ACCEPT} onChange={handleResponseImport} className="hidden" />
        <input ref={agreementSignedInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={uploadSignedAgreement} className="hidden" />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Employee ID</p>
                <p className="text-sm font-medium text-foreground">{employee.employee_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Status</p>
                <Badge className="mt-1 capitalize">{employee.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Full Name</p>
                <p className="text-sm font-medium text-foreground">{employee.first_name} {employee.last_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Department</p>
                <p className="text-sm font-medium text-foreground">{employee.department || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Position</p>
                <p className="text-sm font-medium text-foreground">{employee.position || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Employment Type</p>
                <p className="text-sm font-medium text-foreground capitalize">{(employee.employment_type || '—').replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Daily Rate</p>
                <p className="text-sm font-medium text-foreground">₱{(employee.daily_rate || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Date of Birth</p>
                <p className="text-sm font-medium text-foreground">{employee.date_of_birth || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Date Hired</p>
                <p className="text-sm font-medium text-foreground">{employee.date_hired || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Email</p>
                <p className="text-sm font-medium text-foreground">{employee.email || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Phone</p>
                <p className="text-sm font-medium text-foreground">{employee.phone || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">SSS Number</p>
                <p className="text-sm font-medium text-foreground">{employee.sss_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">PhilHealth Number</p>
                <p className="text-sm font-medium text-foreground">{employee.philhealth_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Pag-IBIG Number</p>
                <p className="text-sm font-medium text-foreground">{employee.pagibig_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">TIN Number</p>
                <p className="text-sm font-medium text-foreground">{employee.tin_number || '—'}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cash-advances' && (
          <div className="space-y-3">
            {displayedCashAdvances.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8">No cash advances recorded.</p>
            ) : (
              displayedCashAdvances.map(advance => (
                <Card key={advance.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                         <p className="font-medium text-sm text-foreground">₱{(advance.amount_approved || advance.amount_requested || 0).toLocaleString()}</p>
                         <Badge className="text-xs capitalize">{advance.status}</Badge>
                       </div>
                      <p className="text-xs text-muted-foreground mt-1">{advance.reason}</p>
                      <p className="text-xs text-muted-foreground">Requested: {advance.request_date}</p>
                      {(advance.beginning_balance != null || advance.remaining_balance != null || advance.deduction_amount_per_payroll > 0) && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
                          {advance.beginning_balance != null && (
                            <div>
                              <p className="text-muted-foreground">Beginning Balance</p>
                              <p className="font-semibold text-foreground">₱{advance.beginning_balance.toLocaleString()}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-muted-foreground">Remaining Balance</p>
                            <p className="font-semibold text-foreground">₱{getCashAdvanceBalance(advance).toLocaleString()}</p>
                          </div>
                          {advance.deduction_amount_per_payroll > 0 && (
                            <div>
                              <p className="text-muted-foreground">Weekly Deduction</p>
                              <p className="font-semibold text-foreground">₱{advance.deduction_amount_per_payroll.toLocaleString()}</p>
                            </div>
                          )}
                          {advance.deduction_amount_per_payroll > 0 && (
                            <div>
                              <p className="text-muted-foreground">Weeks to Zero</p>
                              <p className="font-semibold text-foreground">
                                {Math.ceil(getCashAdvanceBalance(advance) / advance.deduction_amount_per_payroll)}
                                {advance.deduction_payroll_periods ? ` of ${advance.deduction_payroll_periods}` : ''} week(s)
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {activeTab === 'cash-advance-agreement' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-foreground">Cash Advance Master Agreement</p>
                <p className="text-xs text-muted-foreground">Version {MASTER_CASH_ADVANCE_AGREEMENT_VERSION} · {agreementLanguage === 'tagalog' ? 'Tagalog' : 'English'}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setAgreementLanguage(prev => prev === 'english' ? 'tagalog' : 'english')}
                >
                  <Languages className="w-4 h-4" />
                  {agreementLanguage === 'english' ? 'Translate to Tagalog' : 'Translate to English'}
                </Button>
                {agreementAccepted && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={uploadingSignedAgreement}
                    onClick={() => agreementSignedInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" />
                    {uploadingSignedAgreement ? 'Uploading...' : 'Upload Signed Document'}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-2" onClick={printAgreement}>
                  <Printer className="w-4 h-4" /> Print Agreement
                </Button>
              </div>
            </div>

            <Card className="p-4 border border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <p className="text-xs text-muted-foreground">Agreement Status</p>
                  <Badge className={acceptedAgreementVersion === MASTER_CASH_ADVANCE_AGREEMENT_VERSION ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                    {acceptedAgreementVersion === MASTER_CASH_ADVANCE_AGREEMENT_VERSION ? 'Accepted' : 'Pending acceptance'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Accepted At</p>
                  <p className="font-medium text-foreground">{agreementAcceptedAt || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IP Address</p>
                  <p className="font-medium text-foreground">{agreementIpAddress || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Device Info</p>
                  <p className="font-medium text-foreground break-words">{agreementDeviceInfo || '—'}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Uploaded Signed Document</p>
                  {signedAgreementUrl ? (
                    <a
                      href={signedAgreementUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <Paperclip className="w-4 h-4" />
                      {signedAgreementName}
                    </a>
                  ) : (
                    <p className="font-medium text-foreground">—</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Acceptance verification photo</p>
                  {agreementAcceptancePhotoUrl ? (
                    <div className="mt-2 flex flex-col sm:flex-row gap-3 sm:items-start">
                      <a href={agreementAcceptancePhotoUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-border overflow-hidden max-w-[200px]">
                        <img src={agreementAcceptancePhotoUrl} alt="Employee at agreement acceptance" className="w-full h-auto object-cover aspect-[4/3]" />
                      </a>
                      <div className="text-sm">
                        <a
                          href={agreementAcceptancePhotoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          Open full size
                        </a>
                        {agreementAcceptancePhotoAtLabel && (
                          <p className="text-xs text-muted-foreground mt-1">Captured {agreementAcceptancePhotoAtLabel}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="font-medium text-foreground">—</p>
                  )}
                </div>
              </div>
              <pre className="whitespace-pre-wrap text-xs leading-6 text-foreground bg-muted/30 rounded-lg p-4 border border-border overflow-auto max-h-[520px]">{agreementText}</pre>
            </Card>
          </div>
        )}

        {activeTab === 'memos' && renderDocumentList('memos')}
        {activeTab === 'suspension' && renderDocumentList('suspension')}
        {activeTab === 'termination' && renderDocumentList('termination')}
        {activeTab === 'promissory' && renderDocumentList('promissory')}
      </div>

      <Dialog open={!!templateTab} onOpenChange={(open) => { if (!open) setTemplateTab(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{templateForm.title || 'Document Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input value={templateForm.title || ''} onChange={e => setTemplateValue('title', e.target.value)} />
              </div>
              {templateTab === 'memos' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Issue Date</Label>
                    <Input type="date" value={templateForm.issue_date || ''} onChange={e => setTemplateValue('issue_date', e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Category</Label>
                    <Input value={templateForm.category || ''} onChange={e => setTemplateValue('category', e.target.value)} />
                  </div>
                </>
              )}
              {templateTab === 'suspension' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Notice Date</Label>
                    <Input type="date" value={templateForm.notice_date || ''} onChange={e => setTemplateValue('notice_date', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Start Date</Label>
                    <Input type="date" value={templateForm.start_date || ''} onChange={e => setTemplateValue('start_date', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End Date</Label>
                    <Input type="date" value={templateForm.end_date || ''} onChange={e => setTemplateValue('end_date', e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Reason</Label>
                    <Input value={templateForm.reason || ''} onChange={e => setTemplateValue('reason', e.target.value)} />
                  </div>
                </>
              )}
              {templateTab === 'termination' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Notice Date</Label>
                    <Input type="date" value={templateForm.notice_date || ''} onChange={e => setTemplateValue('notice_date', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Effective Date</Label>
                    <Input type="date" value={templateForm.effective_date || ''} onChange={e => setTemplateValue('effective_date', e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Reason</Label>
                    <Input value={templateForm.reason || ''} onChange={e => setTemplateValue('reason', e.target.value)} />
                  </div>
                </>
              )}
              {templateTab === 'promissory' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Note Date</Label>
                    <Input type="date" value={templateForm.note_date || ''} onChange={e => setTemplateValue('note_date', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <Input type="number" min="0" step="0.01" value={templateForm.amount || ''} onChange={e => setTemplateValue('amount', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Due Date</Label>
                    <Input type="date" value={templateForm.due_date || ''} onChange={e => setTemplateValue('due_date', e.target.value)} />
                  </div>
                </>
              )}
            </div>

            {templateTab !== 'termination' && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={templateForm.requires_signature !== false}
                  onChange={e => setTemplateValue('requires_signature', e.target.checked)}
                />
                Requires employee signature
              </label>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{templateTab === 'promissory' ? 'Terms' : 'Body'}</Label>
              <Textarea
                value={getTemplateBody()}
                onChange={e => setTemplateValue(templateTab === 'promissory' ? 'terms' : 'body', e.target.value)}
                className="min-h-[260px]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="gap-2" onClick={translateTemplateToTagalog}>
                <Languages className="w-4 h-4" /> Translate to Tagalog
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={printTemplate}>
                <Printer className="w-4 h-4" /> Print
              </Button>
              <Button size="sm" className="gap-2" onClick={processTemplate}>
                <Send className="w-4 h-4" /> Process
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
