import { useState, useRef, useEffect, useCallback } from 'react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { buildCashAdvanceAgreementTagalogText, buildCashAdvanceAgreementText, CASH_ADVANCE_PAYMENT_DAYS, MASTER_CASH_ADVANCE_AGREEMENT_VERSION } from '@/lib/cashAdvanceAgreement';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, AlertTriangle, Paperclip, ChevronDown, ChevronUp, HeartPulse, Camera, FileImage, Sparkles, X, HandCoins, CheckCircle2, Briefcase, Loader2, CalendarDays, Languages } from 'lucide-react';
import DeductionScheduleView from '@/components/cashadvance/DeductionScheduleView';
import ReceiveAdvanceDialog from './ReceiveAdvanceDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved_by_hr: 'bg-blue-100 text-blue-700',
  approved_by_manager: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  deducted: 'bg-gray-100 text-gray-600',
};

const statusLabels = {
  pending: 'Pending',
  approved_by_hr: 'HR Approved',
  approved_by_manager: 'Manager Approved',
  approved: 'Approved',
  rejected: 'Rejected',
  deducted: 'Deducted',
};

const EMERGENCY_REASONS = [
  { value: 'emergency_checkup', label: '🩺 Emergency Check-up' },
  { value: 'emergency_medicine', label: '💊 Medicine (Prescription Required)' },
  { value: 'emergency_hospital', label: '🏥 Hospital / Confinement' },
  { value: 'emergency_procedure', label: '🔬 Medical Procedure / Surgery' },
];

const EMERGENCY_REASON_LABELS = Object.fromEntries(EMERGENCY_REASONS.map(r => [r.value, r.label]));
const STATUS_RANK = {
  rejected: 0,
  pending: 1,
  approved_by_hr: 2,
  approved_by_manager: 2,
  approved: 3,
  deducted: 4,
};

export default function EmployeeCashAdvance({ employee }) {
  const [showForm, setShowForm] = useState(false);
  const [showEmergencyMenu, setShowEmergencyMenu] = useState(false);
  const [advanceType, setAdvanceType] = useState('regular');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [emergencyReason, setEmergencyReason] = useState('');
  const [neededDate, setNeededDate] = useState('');
  const [payrollWeeks, setPayrollWeeks] = useState('1');
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [rxSummary, setRxSummary] = useState('');
  const [analyzingRx, setAnalyzingRx] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const [receiveAdvance, setReceiveAdvance] = useState(null);
  const [showWorkedDayReminder, setShowWorkedDayReminder] = useState(false);
  const [workedDaysInput, setWorkedDaysInput] = useState('');
  const [activeTab, setActiveTab] = useState('requests');
  const [showAgreementDialog, setShowAgreementDialog] = useState(false);
  const [agreementDialogLanguage, setAgreementDialogLanguage] = useState('english');
  const [agreementReadChecked, setAgreementReadChecked] = useState(false);
  const [agreementAuthorizeChecked, setAgreementAuthorizeChecked] = useState(false);
  const [agreementAcceptedVersion, setAgreementAcceptedVersion] = useState(employee?.cash_advance_agreement_version || employee?.agreement_version || '');
  const [acceptingAgreement, setAcceptingAgreement] = useState(false);
  /** terms → live camera → preview before submit */
  const [agreementAcceptStep, setAgreementAcceptStep] = useState('terms');
  const [agreementPhotoDataUrl, setAgreementPhotoDataUrl] = useState(null);
  const agreementPhotoVideoRef = useRef(null);
  const agreementPhotoStreamRef = useRef(null);
  const qc = useQueryClient();
  const { activeCompany } = useCompany();

  const { data: rawAdvances = [], isLoading } = useQuery({
    queryKey: ['myCashAdvances', employee?.employee_id],
    queryFn: () => appApi.entities.CashAdvance.filter({ employee_id: employee.employee_id }),
    enabled: !!employee,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const advances = Object.values(rawAdvances.reduce((byRequest, ca) => {
    const key = [
      ca.employee_id,
      ca.request_date || '',
      ca.advance_type || 'regular',
      ca.amount_requested || 0,
      ca.reason || '',
    ].join('|');
    const current = byRequest[key];
    const currentRank = STATUS_RANK[current?.status] ?? -1;
    const nextRank = STATUS_RANK[ca.status] ?? -1;
    if (!current || nextRank > currentRank || (nextRank === currentRank && String(ca.updated_date || '').localeCompare(String(current.updated_date || '')) > 0)) {
      byRequest[key] = ca;
    }
    return byRequest;
  }, {}));

  // Current payroll period follows the employee's active company settings.
  const today = new Date();
  const currentPayrollPeriod = getPayrollPeriodForDate(today, activeCompany);
  const periodStart = currentPayrollPeriod.start_date;
  const periodEnd = currentPayrollPeriod.end_date;

  const { data: periodAttendance = [], isLoading: loadingAttendance } = useQuery({
    queryKey: ['workedDayAttendance', employee?.employee_id, periodStart],
    queryFn: async () => {
      const logs = await appApi.entities.AttendanceLog.filter({ employee_id: employee.employee_id });
      return logs.filter(log => log.date >= periodStart && log.date <= periodEnd && !log.is_absent);
    },
    enabled: !!employee,
  });

  // Auto-compute worked days and max amount from attendance
  const autoWorkedDays = periodAttendance.length;
  const dailyRate = employee?.daily_rate || 0;
  const autoMaxAmount = parseFloat(((autoWorkedDays * dailyRate) * 0.40).toFixed(2));

  const createMutation = useMutation({
    mutationFn: (data) => appApi.entities.CashAdvance.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myCashAdvances'] });
      resetForm();
    },
  });

  const resetForm = () => {
    stopCamera();
    setShowForm(false);
    setAdvanceType('regular');
    setAmount('');
    setReason('');
    setEmergencyReason('');
    setNeededDate('');
    setPayrollWeeks('1');
    setPrescriptionFile(null);
    setPrescriptionPreview(null);
    setRxSummary('');
    setShowCamera(false);
    setShowEmergencyMenu(false);
    setWorkedDaysInput('');
  };

  const openWorkedDayAdvance = () => {
    setShowWorkedDayReminder(true);
  };

  const confirmWorkedDayAdvance = () => {
    const days = autoWorkedDays;
    const computed = autoMaxAmount;
    setAdvanceType('worked_day');
    setAmount(String(computed));
    setReason(`Worked Day Advance (40% of ${days} worked days pay)`);
    setPayrollWeeks('1');
    setWorkedDaysInput(String(days));
    setShowWorkedDayReminder(false);
    setShowForm(true);
  };

  const startCamera = async () => {
    setShowCamera(true);
    setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch { setShowCamera(false); }
    }, 100);
  };

  const stopCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    canvas.toBlob(blob => {
      const file = new File([blob], 'prescription.jpg', { type: 'image/jpeg' });
      setPrescriptionFile(file);
      setPrescriptionPreview(canvas.toDataURL('image/jpeg'));
      stopCamera();
      analyzeRx(canvas.toDataURL('image/jpeg'));
    }, 'image/jpeg', 0.9);
  };

  const handleRxFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPrescriptionFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPrescriptionPreview(ev.target.result);
      analyzeRx(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const analyzeRx = async (dataUrl) => {
    setAnalyzingRx(true);
    setRxSummary('');
    try {
      const result = await appApi.integrations.Core.InvokeLLM({
        prompt: 'This is a prescription image. Please provide a brief, clear summary: list the medicines prescribed, dosage, and any special instructions. Keep it concise (3-5 bullet points max). If this is not a prescription, say so.',
        file_urls: [dataUrl],
      });
      setRxSummary(result);
    } catch { setRxSummary('Could not analyze image. Please describe your prescription in the Reason field.'); }
    setAnalyzingRx(false);
  };

  const openEmergency = (reasonValue) => {
    setEmergencyReason(reasonValue);
    setAdvanceType('emergency');
    setShowEmergencyMenu(false);
    setShowForm(true);
  };

  const sorted = [...advances].sort((a, b) => (b.request_date || '').localeCompare(a.request_date || ''));

  const getCashAdvanceBalance = (ca) => ca.remaining_balance != null
    ? ca.remaining_balance
    : (ca.amount_approved || ca.amount_requested || 0);

  // Active balance — beginning balances are payable but do not consume the new regular CA limit.
  const activeAdvances = advances.filter(ca => ['pending', 'approved_by_hr', 'approved_by_manager', 'approved'].includes(ca.status));
  const beginningBalance = activeAdvances
    .filter(ca => ca.advance_type === 'beginning_balance')
    .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
  const regularLimitBalance = activeAdvances
    .filter(ca => ca.advance_type !== 'emergency' && ca.advance_type !== 'beginning_balance')
    .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
  const emergencyBalance = activeAdvances
    .filter(ca => ca.advance_type === 'emergency')
    .reduce((sum, ca) => sum + getCashAdvanceBalance(ca), 0);
  const activeBalance = beginningBalance + regularLimitBalance + emergencyBalance;
  const scheduledAdvances = activeAdvances.filter(ca =>
    ca.status === 'approved' && (ca.deduction_amount_per_payroll || 0) > 0
  );
  const weeklyDeduction = scheduledAdvances.reduce((sum, ca) => {
    const balance = getCashAdvanceBalance(ca);
    return sum + Math.min(ca.deduction_amount_per_payroll || 0, Math.max(balance, 0));
  }, 0);
  const estimatedWeeklyPay = autoWorkedDays * dailyRate;
  const estimatedPayrollBeforeGovtDeductions = Math.max(0, estimatedWeeklyPay - weeklyDeduction);
  const weeksToZero = scheduledAdvances.reduce((max, ca) => {
    const balance = getCashAdvanceBalance(ca);
    const weekly = ca.deduction_amount_per_payroll || 0;
    return weekly > 0 ? Math.max(max, Math.ceil(balance / weekly)) : max;
  }, 0);

  const maxAllowed = employee?.max_cash_advance || 0;
  const available = Math.max(0, maxAllowed - regularLimitBalance);
  const isOverLimit = maxAllowed > 0 && regularLimitBalance >= maxAllowed;

  const canRequestRegular = !isOverLimit;
  const canRequestEmergency = true; // always allowed
  const currentAgreementVersion = agreementAcceptedVersion || employee?.cash_advance_agreement_version || employee?.agreement_version;
  const cashAdvanceAgreementAccepted = currentAgreementVersion === MASTER_CASH_ADVANCE_AGREEMENT_VERSION;
  const employeeName = [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ').trim();
  const agreementParams = {
    companyName: activeCompany?.company_name || activeCompany?.trade_name || 'Employer',
    employeeName: employeeName || 'Employee',
    employeeId: employee?.employee_id || '',
    paymentDays: employee?.cash_advance_payment_days || CASH_ADVANCE_PAYMENT_DAYS,
  };
  const englishAgreementText = buildCashAdvanceAgreementText(agreementParams);
  const tagalogAgreementText = buildCashAdvanceAgreementTagalogText(agreementParams);
  const agreementDialogBodyText = agreementDialogLanguage === 'tagalog' ? tagalogAgreementText : englishAgreementText;

  // Only one worked day advance per payroll period
  const hasWorkedDayThisPeriod = advances.some(ca =>
    ca.advance_type === 'worked_day' &&
    ca.request_date >= periodStart &&
    ca.request_date <= periodEnd &&
    ca.status !== 'rejected'
  );

  const submitCashAdvance = async (consentTimestamp) => {
    const amt = parseFloat(amount);

    let prescriptionUrl = null;
    if (prescriptionFile) {
      try {
        setUploading(true);
        const res = await appApi.integrations.Core.UploadFile({ file: prescriptionFile });
        prescriptionUrl = res.file_url;
      } finally {
        setUploading(false);
      }
    }

    const weeks = parseInt(payrollWeeks) || 1;
    await createMutation.mutateAsync({
      employee_id: employee.employee_id,
      employee_name: employeeName || `${employee.first_name} ${employee.last_name}`,
      department: employee.department,
      amount_requested: amt,
      reason,
      advance_type: advanceType,
      emergency_reason: advanceType === 'emergency' ? emergencyReason : undefined,
      prescription_url: prescriptionUrl || undefined,
      needed_date: neededDate || undefined,
      deduction_payroll_periods: weeks,
      deduction_amount_per_payroll: parseFloat((amt / weeks).toFixed(2)),
      deduction_periods_remaining: weeks,
      worked_days_at_request: advanceType === 'worked_day' ? parseFloat(workedDaysInput) || 0 : undefined,
      daily_rate_at_request: advanceType === 'worked_day' ? (employee?.daily_rate || 0) : undefined,
      request_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'pending',
      company_profile_id: employee.company_profile_id,
      agreement_version_used: MASTER_CASH_ADVANCE_AGREEMENT_VERSION,
      consent_timestamp: consentTimestamp || employee.cash_advance_agreement_accepted_at || employee.accepted_at || new Date().toISOString(),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || !reason) return;
    if (advanceType === 'regular' && isOverLimit) return;
    // Cap regular requests to available balance
    if (advanceType === 'regular' && maxAllowed > 0 && amt > available) {
      alert(`Amount exceeds your available limit of ₱${available.toLocaleString()}`);
      return;
    }
    if (advanceType === 'emergency' && !emergencyReason) return;
    if (advanceType === 'emergency' && emergencyReason === 'emergency_medicine' && !prescriptionFile) return;

    if (!cashAdvanceAgreementAccepted) {
      setShowAgreementDialog(true);
      return;
    }

    await submitCashAdvance(employee.cash_advance_agreement_accepted_at || employee.accepted_at || new Date().toISOString());
  };

  const stopAgreementPhotoCamera = useCallback(() => {
    if (agreementPhotoStreamRef.current) {
      agreementPhotoStreamRef.current.getTracks().forEach(t => t.stop());
      agreementPhotoStreamRef.current = null;
    }
    if (agreementPhotoVideoRef.current) agreementPhotoVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!showAgreementDialog || agreementAcceptStep !== 'photo') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        agreementPhotoStreamRef.current = stream;
        if (agreementPhotoVideoRef.current) agreementPhotoVideoRef.current.srcObject = stream;
      } catch {
        alert('Could not access the camera. Allow camera permission, or use Upload photo below.');
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopAgreementPhotoCamera();
    };
  }, [showAgreementDialog, agreementAcceptStep, stopAgreementPhotoCamera]);

  const resetAgreementDialog = () => {
    stopAgreementPhotoCamera();
    setAgreementDialogLanguage('english');
    setAgreementReadChecked(false);
    setAgreementAuthorizeChecked(false);
    setAgreementAcceptStep('terms');
    setAgreementPhotoDataUrl(null);
  };

  const proceedToAgreementPhoto = () => {
    if (!agreementReadChecked || !agreementAuthorizeChecked) return;
    setAgreementAcceptStep('photo');
    setAgreementPhotoDataUrl(null);
  };

  const captureAgreementPhoto = () => {
    const video = agreementPhotoVideoRef.current;
    if (!video?.videoWidth) return;
    // Capture from the live frame first — clearing srcObject before drawImage yields a blank/broken image.
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopAgreementPhotoCamera();
    setAgreementPhotoDataUrl(dataUrl);
    setAgreementAcceptStep('preview');
  };

  const retakeAgreementPhoto = () => {
    setAgreementPhotoDataUrl(null);
    setAgreementAcceptStep('photo');
  };

  const handleAgreementPhotoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      stopAgreementPhotoCamera();
      setAgreementPhotoDataUrl(reader.result);
      setAgreementAcceptStep('preview');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const acceptAgreementAndSubmit = async () => {
    if (!agreementPhotoDataUrl || !employee?.id) return;
    const acceptedAt = new Date().toISOString();
    const deviceInfo = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown device';

    setAcceptingAgreement(true);
    try {
      const res = await fetch(agreementPhotoDataUrl);
      const blob = await res.blob();
      const file = new File([blob], `ca-agreement-selfie-${employee.employee_id}.jpg`, { type: 'image/jpeg' });
      const { file_url: photoUrl } = await appApi.integrations.Core.UploadFile({ file });

      await appApi.entities.Employee.update(employee.id, {
        agreement_version: MASTER_CASH_ADVANCE_AGREEMENT_VERSION,
        accepted_at: acceptedAt,
        ip_address: 'Recorded by browser session',
        device_info: deviceInfo,
        cash_advance_agreement_version: MASTER_CASH_ADVANCE_AGREEMENT_VERSION,
        cash_advance_agreement_accepted_at: acceptedAt,
        cash_advance_agreement_ip_address: 'Recorded by browser session',
        cash_advance_agreement_device_info: deviceInfo,
        cash_advance_agreement_acceptance_photo_url: photoUrl,
        cash_advance_agreement_acceptance_photo_uploaded_at: acceptedAt,
      });
      setAgreementAcceptedVersion(MASTER_CASH_ADVANCE_AGREEMENT_VERSION);
      setShowAgreementDialog(false);
      qc.invalidateQueries({ queryKey: ['employee', employee.employee_id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      await submitCashAdvance(acceptedAt);
    } catch (err) {
      alert(`Agreement acceptance failed: ${err.message}`);
    } finally {
      setAcceptingAgreement(false);
    }
  };

  if (!employee) return (
    <div className="p-6 text-center text-muted-foreground text-sm">
      <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p>Scan your QR code first to access this section.</p>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Cash Advance</h2>
        <div className="flex items-center gap-2">
          {/* Regular Request */}
          <Button
            size="sm"
            onClick={() => { setAdvanceType('regular'); setShowForm(true); }}
            className="gap-1"
            disabled={isOverLimit}
            title={isOverLimit ? 'You have reached your maximum cash advance limit' : ''}
            variant="outline"
          >
            <Plus className="w-4 h-4" /> {isOverLimit ? 'Limit Reached' : 'Request'}
          </Button>

          {/* Worked Day Advance */}
          <Button
            size="sm"
            onClick={openWorkedDayAdvance}
            className="gap-1 bg-purple-600 hover:bg-purple-700 text-white"
            disabled={hasWorkedDayThisPeriod}
            title={hasWorkedDayThisPeriod ? 'You have already requested a Worked Day Advance this payroll period' : ''}
          >
            <Briefcase className="w-4 h-4" /> {hasWorkedDayThisPeriod ? 'Already Requested' : 'Worked Day'}
          </Button>

          {/* Emergency Request — always active */}
          <div className="relative">
            <Button
              size="sm"
              onClick={() => setShowEmergencyMenu(v => !v)}
              className="gap-1 bg-red-500 hover:bg-red-600 text-white"
            >
              <HeartPulse className="w-4 h-4" /> Emergency
              <ChevronDown className="w-3 h-3" />
            </Button>
            {showEmergencyMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowEmergencyMenu(false)} />
                <div className="absolute right-0 top-10 z-50 w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Select Emergency Type</p>
                {EMERGENCY_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => openEmergency(r.value)}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-red-50 hover:text-red-700 transition-colors border-b border-border last:border-0"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              </>
            )}
          </div>
        </div>
      </div>
      {isOverLimit && (
        <p className="text-xs text-red-600 text-right -mt-3">Regular limit reached — use Emergency for qualifying medical needs.</p>
      )}

      {/* Balance Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className="border border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Cash Advance Balance</p>
            <p className="text-2xl font-bold text-primary">₱{activeBalance.toLocaleString()}</p>
            {beginningBalance > 0 && (
              <p className="text-xs text-muted-foreground mt-1">Beginning balance: ₱{beginningBalance.toLocaleString()}</p>
            )}
            {regularLimitBalance > 0 && (
              <p className="text-xs text-muted-foreground mt-1">Regular: ₱{regularLimitBalance.toLocaleString()}</p>
            )}
            {emergencyBalance > 0 && (
              <p className="text-xs text-orange-600 mt-1 font-medium">+ ₱{emergencyBalance.toLocaleString()} emergency</p>
            )}
          </CardContent>
        </Card>
        <Card className="border border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Weekly Deduction</p>
            <p className="text-2xl font-bold text-amber-700">₱{weeklyDeduction.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {weeksToZero > 0 ? `${weeksToZero} week${weeksToZero === 1 ? '' : 's'} to zero balance` : 'No approved deduction schedule'}
            </p>
          </CardContent>
        </Card>
        <Card className={`border ${isOverLimit ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Regular Available</p>
            <p className={`text-2xl font-bold ${isOverLimit ? 'text-red-600' : 'text-green-600'}`}>
              {maxAllowed > 0 ? `₱${available.toLocaleString()}` : 'No limit set'}
            </p>
            {maxAllowed > 0 && <p className="text-xs text-muted-foreground mt-0.5">of ₱{maxAllowed.toLocaleString()} max</p>}
          </CardContent>
        </Card>
        <Card className="border border-sky-200 bg-sky-50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Estimated Payroll for the Week Before Govt Deductions</p>
            <p className="text-2xl font-bold text-sky-700">₱{estimatedPayrollBeforeGovtDeductions.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ₱{estimatedWeeklyPay.toLocaleString()} pay - ₱{weeklyDeduction.toLocaleString()} CA deduction
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Limit bar */}
      {maxAllowed > 0 && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Regular limit used</span><span>{Math.round((regularLimitBalance / maxAllowed) * 100)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${isOverLimit ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, (regularLimitBalance / maxAllowed) * 100)}%` }} />
          </div>
        </div>
      )}

      {isOverLimit && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800">Regular cash advance limit reached</p>
            <p className="text-xs text-amber-700 mt-0.5">You can still submit an <strong>Emergency Cash Advance</strong> for qualifying emergencies.</p>
          </div>
        </div>
      )}

      <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`flex-1 px-3 py-2 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'requests' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <CreditCard className="w-4 h-4" /> Requests
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('deductions')}
          className={`flex-1 px-3 py-2 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'deductions' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <CalendarDays className="w-4 h-4" /> Deductions
        </button>
      </div>

      {/* Deduction Schedule */}
      {activeTab === 'deductions' && (
        <DeductionScheduleView cashAdvances={advances} employeeMode={true} />
      )}

      {/* History */}
      {activeTab === 'requests' && <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Request History</p>
        {isLoading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No cash advance requests yet.</div>
        ) : sorted.map(ca => (
          <Card key={ca.id} className={`border ${ca.advance_type === 'emergency' ? 'border-orange-200' : 'border-border'}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="bg-primary/10 rounded-lg px-3 py-1 inline-block">
                      <p className="font-bold text-lg text-primary">₱{(ca.amount_requested || 0).toLocaleString()}</p>
                    </div>
                    {ca.advance_type === 'emergency' && (
                      <Badge className="bg-orange-100 text-orange-700 text-xs border-0">Emergency</Badge>
                    )}
                    {ca.advance_type === 'worked_day' && (
                      <Badge className="bg-purple-100 text-purple-700 text-xs border-0">Worked Day</Badge>
                    )}
                    <Badge variant="outline" className={`text-xs ${statusColors[ca.status]}`}>{statusLabels[ca.status]}</Badge>
                    {ca.advance_type === 'emergency' && ca.received && (
                      <Badge className="bg-green-100 text-green-700 text-xs border-0 gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Received
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 truncate">{ca.reason}</p>
                  {ca.emergency_reason && (
                    <p className="text-xs text-orange-600 mt-0.5">{EMERGENCY_REASON_LABELS[ca.emergency_reason]}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{ca.request_date}</p>
                  {/* Receive button — only for approved emergency advances not yet received */}
                  {ca.advance_type === 'emergency' && ca.status === 'approved' && !ca.received && (
                    <Button
                      size="sm"
                      className="mt-2 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={(e) => { e.stopPropagation(); setReceiveAdvance(ca); }}
                    >
                      <HandCoins className="w-3.5 h-3.5" /> Receive Cash
                    </Button>
                  )}
                </div>
                <button onClick={() => setExpandedId(expandedId === ca.id ? null : ca.id)} className="ml-2 text-muted-foreground hover:text-foreground">
                  {expandedId === ca.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {expandedId === ca.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
                  {ca.amount_approved && <p><span className="text-muted-foreground">Approved amount:</span> <span className="font-medium">₱{ca.amount_approved.toLocaleString()}</span></p>}
                  {ca.remaining_balance != null && <p><span className="text-muted-foreground">Remaining balance:</span> <span className="font-medium">₱{ca.remaining_balance.toLocaleString()}</span></p>}
                  {ca.deduction_amount_per_payroll > 0 && <p><span className="text-muted-foreground">Weekly deduction:</span> <span className="font-medium">₱{ca.deduction_amount_per_payroll.toLocaleString()}</span></p>}
                  {ca.deduction_amount_per_payroll > 0 && <p><span className="text-muted-foreground">Weeks to zero:</span> <span className="font-medium">{Math.ceil(getCashAdvanceBalance(ca) / ca.deduction_amount_per_payroll)} week(s)</span></p>}
                  {ca.needed_date && <p><span className="text-muted-foreground">Needed by:</span> <span className="font-medium">{ca.needed_date}</span></p>}
                  {ca.deduction_payroll_periods && <p><span className="text-muted-foreground">Deducted in:</span> <span className="font-medium">{ca.deduction_payroll_periods} week(s)</span></p>}
                  {ca.manager_notes && <p><span className="text-muted-foreground">Manager note:</span> <span className="italic">{ca.manager_notes}</span></p>}
                  {ca.hr_notes && <p><span className="text-muted-foreground">HR note:</span> <span className="italic">{ca.hr_notes}</span></p>}
                  {ca.received_date && <p><span className="text-muted-foreground">Received on:</span> <span className="font-medium">{ca.received_date}</span></p>}
                  {ca.prescription_url && (
                    <a href={ca.prescription_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                      <Paperclip className="w-3 h-3" /> View Prescription
                    </a>
                  )}
                  {ca.received_photo_url && (
                    <a href={ca.received_photo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                      <Camera className="w-3 h-3" /> View Receipt Photo
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>}

      {/* Receive Dialog */}
      <ReceiveAdvanceDialog
        advance={receiveAdvance}
        employee={employee}
        open={!!receiveAdvance}
        onClose={() => setReceiveAdvance(null)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['myCashAdvances'] }); setReceiveAdvance(null); }}
      />

      {/* Worked Day Advance — Reminder & Confirmation Dialog */}
      <Dialog open={showWorkedDayReminder} onOpenChange={(open) => { if (!open) { setShowWorkedDayReminder(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-purple-600" /> Worked Day Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">

            {/* Auto-computed summary */}
            {loadingAttendance ? (
              <div className="flex items-center justify-center gap-2 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking your attendance records...
              </div>
            ) : (
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
                <p className="text-sm font-semibold text-purple-800">Your Computed Advance for This Period</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <p className="text-2xl font-bold text-purple-700">{autoWorkedDays}</p>
                    <p className="text-xs text-muted-foreground">Days Worked</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <p className="text-sm font-bold text-purple-700">₱{dailyRate.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Daily Rate</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <p className="text-sm font-bold text-green-600">40%</p>
                    <p className="text-xs text-muted-foreground">Advance Rate</p>
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 border border-purple-200 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Maximum Advance Amount</p>
                  <p className="text-3xl font-bold text-purple-700">₱{autoMaxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-xs text-muted-foreground mt-1">{autoWorkedDays} days × ₱{dailyRate.toLocaleString()} × 40%</p>
                </div>
                {autoWorkedDays === 0 && (
                  <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    No approved attendance records found for this payroll period ({periodStart} to {periodEnd}). You cannot request a worked day advance.
                  </div>
                )}
              </div>
            )}

            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5">
              <p className="text-xs font-bold text-red-800 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Mandatory na Bawas — Pakibasa</p>
              <ul className="text-xs text-red-700 space-y-1 list-disc ml-4">
                <li>Ang advance na ito ay <strong>mandatory na ibabawas</strong> sa parehong payroll period.</li>
                <li>Kung ikaw ay <strong>absent</strong> sa payroll period at hindi nakuha ang bawas, ang <strong>hindi nabawas na halaga ay ilipat</strong> at idadagdag sa susunod mong payroll deduction kasama ang bawas ng bagong period.</li>
                <li>Sa pag-proceed, sumasang-ayon ka sa mga mandatory na tuntunin ng bawas na ito.</li>
              </ul>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowWorkedDayReminder(false)}>Kanselahin</Button>
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={loadingAttendance || autoWorkedDays === 0 || autoMaxAmount <= 0}
                onClick={confirmWorkedDayAdvance}
              >
                Naiintindihan Ko — Magpatuloy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); else setShowForm(true); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Request Cash Advance</DialogTitle></DialogHeader>

          {/* Type indicator */}
          {advanceType === 'emergency' && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div>
                <p className="font-medium">Emergency Cash Advance</p>
                <p className="text-xs opacity-80">{EMERGENCY_REASON_LABELS[emergencyReason]}</p>
              </div>
            </div>
          )}
          {advanceType === 'worked_day' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
                <Briefcase className="w-4 h-4 flex-shrink-0" />
                <div>
                  <p className="font-medium">Worked Day Advance — 40% of Worked Days Pay</p>
                  <p className="text-xs opacity-80">Based on {workedDaysInput} days × ₱{(employee?.daily_rate || 0).toLocaleString()} daily rate</p>
                </div>
              </div>
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5">
                <p className="text-xs font-bold text-red-800 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Paunawa sa Mandatory na Bawas</p>
                <ul className="text-xs text-red-700 space-y-1 list-disc ml-4">
                  <li>Ang advance na ito ay <strong>dapat na bawasan nang buo</strong> sa payroll period na ito na aaprubahan.</li>
                  <li>Kung ikaw ay <strong>absent</strong> sa payroll period at hindi makuha ang bawas, ang <strong>hindi nabawas na halaga ay ilipat</strong> at idadagdag sa susunod mong payroll deduction.</li>
                  <li>Kinikilala mo na ang bawas na ito ay mandatory at hindi maaaring ipawalang-bisa.</li>
                </ul>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">

            {advanceType === 'emergency' && (
              <div>
                <label className="text-sm font-medium text-foreground">Emergency Reason *</label>
                <select
                  value={emergencyReason}
                  onChange={e => setEmergencyReason(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                >
                  <option value="">Select emergency reason...</option>
                  {EMERGENCY_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-foreground">Amount (₱) *</label>
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1"
                required
                disabled={advanceType === 'regular' && isOverLimit}
              />
              {advanceType === 'regular' && maxAllowed > 0 && !isOverLimit && (
                <p className="text-xs text-muted-foreground mt-1">Available: ₱{available.toLocaleString()}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Reason / Details *</label>
              <Input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Describe your reason..."
                className="mt-1"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Needed By (optional)</label>
              <Input type="date" value={neededDate} onChange={e => setNeededDate(e.target.value)} className="mt-1" />
            </div>

            {advanceType !== 'worked_day' && (
              <div>
                <label className="text-sm font-medium text-foreground">Number of Payroll Weeks for Deduction *</label>
                <Input
                  type="number"
                  min="1"
                  max="26"
                  step="1"
                  value={payrollWeeks}
                  onChange={e => setPayrollWeeks(e.target.value)}
                  placeholder="e.g. 4"
                  className="mt-1"
                  required
                />
                {amount && payrollWeeks && parseInt(payrollWeeks) > 0 && (
                  <p className="text-xs text-primary mt-1 bg-primary/5 rounded p-2">
                    ₱{(parseFloat(amount) / parseInt(payrollWeeks)).toFixed(2)} will be deducted per payroll week × {payrollWeeks} week(s)
                  </p>
                )}
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  The number of payroll weeks you request may affect whether your advance is approved or rejected by HR and management.
                </p>
              </div>
            )}

            {advanceType === 'emergency' && emergencyReason === 'emergency_medicine' && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  <Paperclip className="w-4 h-4" /> Prescription Attachment *
                </label>

                {/* Camera view */}
                {showCamera && (
                  <div className="relative rounded-lg overflow-hidden bg-black">
                    <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-3">
                      <Button type="button" size="sm" onClick={capturePhoto} className="bg-white text-black hover:bg-gray-100">
                        <Camera className="w-4 h-4 mr-1" /> Capture
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={stopCamera} className="bg-white/80">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Preview + summary */}
                {prescriptionPreview && !showCamera && (
                  <div className="space-y-2">
                    <div className="relative">
                      <img src={prescriptionPreview} alt="Prescription" className="w-full rounded-lg border border-border object-contain max-h-48" />
                      <button type="button" onClick={() => { setPrescriptionFile(null); setPrescriptionPreview(null); setRxSummary(''); }} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {analyzingRx && (
                      <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
                        <Sparkles className="w-4 h-4 animate-pulse flex-shrink-0" />
                        Analyzing prescription with AI...
                      </div>
                    )}

                    {rxSummary && !analyzingRx && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs font-semibold text-blue-800 flex items-center gap-1 mb-1.5">
                          <Sparkles className="w-3.5 h-3.5" /> AI Prescription Summary
                        </p>
                        <p className="text-xs text-blue-900 whitespace-pre-line">{rxSummary}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Buttons to add prescription */}
                {!prescriptionPreview && !showCamera && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={startCamera} className="flex-1 gap-1">
                      <Camera className="w-4 h-4" /> Take Photo
                    </Button>
                    <label className="flex-1">
                      <div className="flex items-center justify-center gap-1 h-8 px-3 rounded-md border border-input bg-transparent text-sm cursor-pointer hover:bg-accent transition-colors">
                        <FileImage className="w-4 h-4" /> Upload File
                      </div>
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleRxFileChange} />
                    </label>
                  </div>
                )}

                {prescriptionPreview && !showCamera && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={startCamera} className="gap-1 text-xs">
                      <Camera className="w-3.5 h-3.5" /> Retake
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => analyzeRx(prescriptionPreview)} disabled={analyzingRx} className="gap-1 text-xs">
                      <Sparkles className="w-3.5 h-3.5" /> Re-analyze
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || uploading || (advanceType === 'regular' && isOverLimit) || (advanceType === 'emergency' && !emergencyReason) || (advanceType === 'emergency' && emergencyReason === 'emergency_medicine' && !prescriptionFile)}
                className={advanceType === 'emergency' ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}
              >
                {uploading ? 'Uploading...' : createMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showAgreementDialog} onOpenChange={(open) => {
        setShowAgreementDialog(open);
        if (!open) resetAgreementDialog();
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <DialogTitle>
                  {agreementAcceptStep === 'terms' && 'Cash Advance Master Agreement'}
                  {agreementAcceptStep === 'photo' && 'Verification photo'}
                  {agreementAcceptStep === 'preview' && 'Confirm your photo'}
                </DialogTitle>
                <p className="text-xs text-muted-foreground font-normal">
                  {agreementAcceptStep === 'terms' ? (
                    <>Version {MASTER_CASH_ADVANCE_AGREEMENT_VERSION} · {agreementDialogLanguage === 'tagalog' ? 'Tagalog' : 'English'}</>
                  ) : (
                    <>A clear photo of your face is kept on file when you accept this agreement.</>
                  )}
                </p>
              </div>
              {agreementAcceptStep === 'terms' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2 shrink-0 self-start"
                  onClick={() => {
                    setAgreementDialogLanguage(prev => (prev === 'english' ? 'tagalog' : 'english'));
                    setAgreementReadChecked(false);
                    setAgreementAuthorizeChecked(false);
                  }}
                >
                  <Languages className="w-4 h-4" />
                  {agreementDialogLanguage === 'english' ? 'Translate to Tagalog' : 'Translate to English'}
                </Button>
              )}
            </div>
          </DialogHeader>

          {agreementAcceptStep === 'terms' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                Version {MASTER_CASH_ADVANCE_AGREEMENT_VERSION}. This agreement is required before the first cash advance request and whenever PayrollPH updates the agreement version.
              </div>

              <pre className="whitespace-pre-wrap text-xs leading-6 text-foreground bg-muted/30 rounded-lg p-4 border border-border max-h-[430px] overflow-auto">
                {agreementDialogBodyText}
              </pre>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agreementReadChecked}
                    onChange={e => setAgreementReadChecked(e.target.checked)}
                  />
                  <span>I have read and understood the Master Cash Advance Agreement.</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agreementAuthorizeChecked}
                    onChange={e => setAgreementAuthorizeChecked(e.target.checked)}
                  />
                  <span>I voluntarily authorize payroll deductions and final pay offset for any unpaid balance.</span>
                </label>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowAgreementDialog(false)} disabled={acceptingAgreement}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={proceedToAgreementPhoto}
                  disabled={!agreementReadChecked || !agreementAuthorizeChecked || acceptingAgreement || !employee?.id}
                >
                  Continue to photo
                </Button>
              </div>
            </div>
          )}

          {agreementAcceptStep === 'photo' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Position your face in the frame. This photo is stored with your agreement acceptance for HR review.
              </p>
              <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3] max-h-[360px]">
                <video ref={agreementPhotoVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium cursor-pointer hover:bg-accent">
                  <FileImage className="w-4 h-4" /> Upload photo instead
                  <input type="file" accept="image/*" className="sr-only" onChange={handleAgreementPhotoFile} />
                </label>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    stopAgreementPhotoCamera();
                    setAgreementAcceptStep('terms');
                  }}
                >
                  Back
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAgreementDialog(false)}>Cancel</Button>
                <Button type="button" className="gap-2" onClick={captureAgreementPhoto}>
                  <Camera className="w-4 h-4" /> Capture
                </Button>
              </div>
            </div>
          )}

          {agreementAcceptStep === 'preview' && agreementPhotoDataUrl && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                If this photo is clear, submit to finish accepting the agreement and send your cash advance request.
              </p>
              <img src={agreementPhotoDataUrl} alt="Agreement verification" className="w-full rounded-lg border border-border object-cover aspect-[4/3] max-h-[360px]" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={retakeAgreementPhoto} disabled={acceptingAgreement}>
                  Retake
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAgreementDialog(false)} disabled={acceptingAgreement}>Cancel</Button>
                <Button
                  type="button"
                  onClick={acceptAgreementAndSubmit}
                  disabled={acceptingAgreement || !employee?.id}
                >
                  {acceptingAgreement ? 'Saving...' : 'Accept agreement & submit request'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
