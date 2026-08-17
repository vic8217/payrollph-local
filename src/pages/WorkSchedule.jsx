import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/lib/CompanyContext';
import { manilaDateString } from '@/lib/dateUtils';
import { getPayrollPeriodForDate } from '@/lib/payrollPeriod';
import {
  effectiveShiftSetting,
  nextEmployeeShiftAssignment,
  resolveEffectiveEmployeeShift,
  resolveEmployeeWorkSchedule,
  sortedShiftAssignments,
} from '@/lib/shiftSettings';
import { Search, Sun, Moon, UserCircle, CheckCircle2, Clock, CalendarDays, XCircle, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const shiftConfig = {
  day_shift:   { label: 'Day Shift',   icon: Sun,  className: 'bg-amber-100 text-amber-700 border-amber-200' },
  night_shift: { label: 'Night Shift', icon: Moon, className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
};


function formatShiftTime(value) {
  if (!value) return '';
  const [hours, minutes] = value.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function isNightShift(shift) {
  if (!shift) return false;
  if (shift.value === 'night_shift') return true;
  const [startHour] = (shift.shift_start_time || '').split(':').map(Number);
  const [endHour] = (shift.shift_end_time || '').split(':').map(Number);
  return Number.isFinite(startHour) && Number.isFinite(endHour) && (startHour >= 18 || endHour <= startHour);
}

function getShiftStyle(shift) {
  if (!shift) return shiftConfig.day_shift;
  if (shift.value === 'day_shift' || shift.value === 'night_shift') return shiftConfig[shift.value];
  return isNightShift(shift)
    ? { label: shift.label, icon: Moon, className: 'bg-indigo-100 text-indigo-700 border-indigo-200' }
    : { label: shift.label, icon: Clock, className: 'bg-sky-100 text-sky-700 border-sky-200' };
}

function getSummaryClass(shift) {
  if (isNightShift(shift)) return 'bg-indigo-50 border-indigo-200 text-indigo-700';
  if (shift?.value === 'day_shift') return 'bg-amber-50 border-amber-200 text-amber-700';
  return 'bg-sky-50 border-sky-200 text-sky-700';
}

function ShiftBadge({ shift }) {
  const cfg = getShiftStyle(shift);
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </Badge>
  );
}

function defaultEffectiveDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return manilaDateString(tomorrow);
}

function formatScheduleChangeDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  }).format(date);
}

export default function WorkSchedule() {
  const [search, setSearch] = useState('');
  const [filterShift, setFilterShift] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveDate);
  const [summaryDate, setSummaryDate] = useState(manilaDateString);
  const [pendingShiftChange, setPendingShiftChange] = useState(null);
  const [hrPasscode, setHrPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activeCompanyId, activeCompany } = useCompany();

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees', activeCompanyId, 'work-schedule'],
    queryFn: () => appApi.entities.Employee.filter({ status: 'active', company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const { data: shiftSettings = [], isLoading: isLoadingShifts } = useQuery({
    queryKey: ['settings', activeCompanyId, 'work-schedule'],
    queryFn: () => appApi.entities.Settings.filter({ company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });

  const { data: scheduleAuditLogs = [] } = useQuery({
    queryKey: ['passcodeAudit', activeCompanyId, 'work-schedule-latest'],
    queryFn: () => appApi.entities.PasscodeAuditLog.filter(
      { company_profile_id: activeCompanyId },
      '-occurred_at',
    ),
    enabled: !!activeCompanyId,
  });

  const updateMutation = useMutation({
    mutationFn: data => appApi.functions.invoke('changeEmployeeWorkSchedule', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees', activeCompanyId] });
      qc.invalidateQueries({ queryKey: ['employees', activeCompanyId, 'work-schedule'] });
      qc.invalidateQueries({ queryKey: ['passcodeAudit'] });
      setSavingId(null);
      setPendingShiftChange(null);
      setHrPasscode('');
      setAdminPasscode('');
      toast({ title: 'Work schedule updated', description: 'Schedule settings saved successfully.' });
    },
    onError: (error) => {
      setSavingId(null);
      setPasscodeError(error?.message || 'Unable to verify passcodes.');
      toast({
        title: 'Unable to save schedule',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleShiftChange = (emp, value) => {
    setPendingShiftChange({ type: 'change', employee: emp, shiftValue: value, effectiveDate });
    setHrPasscode('');
    setAdminPasscode('');
    setPasscodeError('');
  };

  const handleCancelScheduledShift = (emp, assignment) => {
    setPendingShiftChange({ type: 'cancel', employee: emp, assignment, effectiveDate: assignment.effective_date });
    setHrPasscode('');
    setAdminPasscode('');
    setPasscodeError('');
  };

  const closeShiftPasscodeDialog = () => {
    if (savingId) return;
    setPendingShiftChange(null);
    setHrPasscode('');
    setAdminPasscode('');
    setPasscodeError('');
  };

  const confirmShiftChange = async () => {
    if (!pendingShiftChange) return;
    if (!hrPasscode.trim() || !adminPasscode.trim()) {
      setPasscodeError('Both the HR Officer and Admin passcodes are required.');
      return;
    }

    const {
      employee,
      shiftValue,
      effectiveDate: changeEffectiveDate,
      type,
    } = pendingShiftChange;

    setPasscodeError('');
    setSavingId(employee.id);
    updateMutation.mutate({
      operation: type === 'change' ? 'assign_shift' : 'cancel_shift',
      company_profile_id: activeCompanyId,
      employee_record_id: employee.id,
      effective_date: changeEffectiveDate,
      shift_value: shiftValue,
      hr_passcode: hrPasscode.trim(),
      admin_passcode: adminPasscode.trim(),
    });
  };


  const effectiveShiftSettings = shiftSettings
    .map(shift => effectiveShiftSetting(shift, summaryDate))
    .filter(shift => shift?.is_active !== false);
  const sortedShiftSettings = [...effectiveShiftSettings].sort((a, b) => {
    const startCompare = (a.shift_start_time || '').localeCompare(b.shift_start_time || '');
    return startCompare || (a.setting_name || '').localeCompare(b.setting_name || '');
  });

  const settingOptions = sortedShiftSettings.map(shift => ({
    ...shift,
    value: shift.id,
    label: shift.setting_name || 'Unnamed Shift',
  }));

  const usedLegacyShiftValues = new Set(
    employees
      .flatMap(e => [e.work_schedule, ...sortedShiftAssignments(e).map(assignment => assignment.work_schedule)])
      .filter(value => value === 'day_shift' || value === 'night_shift')
  );

  const shiftOptions = [
    ...settingOptions,
    ...Object.entries(shiftConfig)
      .filter(([value]) => usedLegacyShiftValues.has(value) || settingOptions.length === 0)
      .map(([value, config]) => ({ value, label: config.label })),
  ];

  const defaultShiftValue = settingOptions.find(shift => shift.is_default)?.value || settingOptions[0]?.value || 'day_shift';
  const getCurrentShiftValue = (emp, date = manilaDateString()) => resolveEmployeeWorkSchedule(emp, date, defaultShiftValue);
  const getSummaryShift = emp => resolveEffectiveEmployeeShift(emp, shiftSettings, summaryDate);
  const nextPayrollPeriod = getPayrollPeriodForDate(new Date(), activeCompany, 1);

  const getShiftOption = (value) => {
    const resolvedValue = value || defaultShiftValue;
    return shiftOptions.find(option => option.value === resolvedValue)
      || shiftOptions.find(option => option.value === 'day_shift')
      || { value: resolvedValue, label: shiftConfig[resolvedValue]?.label || 'Unassigned Shift' };
  };

  const filtered = employees
    .filter(e => {
      const shift = getSummaryShift(e);
      return `${e.first_name} ${e.middle_name || ''} ${e.last_name} ${e.employee_id} ${e.department || ''} ${shift?.setting_name || ''}`
        .toLowerCase().includes(search.trim().toLowerCase());
    })
    .filter(e => filterShift === 'all' || getSummaryShift(e)?.id === filterShift);

  const summaryShifts = shiftOptions.length > 0 ? shiftOptions : Object.entries(shiftConfig).map(([value, config]) => ({ value, label: config.label }));
  const summaryCounts = summaryShifts.map(shift => ({
    ...shift,
    count: employees.filter(e => getSummaryShift(e)?.id === shift.value).length,
  }));
  const unassignedCount = employees.filter(e => e.work_schedule && !shiftOptions.some(option => option.value === e.work_schedule)).length;
  const loading = isLoading || isLoadingShifts;
  const latestScheduleChange = scheduleAuditLogs.find(log =>
    ['employee_work_schedule_assign_shift', 'employee_work_schedule_cancel_shift'].includes(log.action)
  );
  const latestScheduleChangeDate = formatScheduleChangeDate(latestScheduleChange?.occurred_at);
  const latestShiftTransition = latestScheduleChange?.previous_shift_label && latestScheduleChange?.new_shift_label
    ? `Previous shift: ${latestScheduleChange.previous_shift_label} • New shift: ${latestScheduleChange.new_shift_label}`
    : null;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Work Schedule</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Assign configured shifts to employees</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {latestScheduleChangeDate
            ? `Most recent work schedule change: ${latestScheduleChangeDate}${latestShiftTransition ? ` • ${latestShiftTransition}` : ''}`
            : 'No work schedule changes recorded yet.'}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summaryCounts.map(shift => {
          const style = getShiftStyle(shift);
          const Icon = style.icon;
          return (
            <div key={shift.value} className={`border rounded-xl p-4 flex items-center gap-3 ${getSummaryClass(shift)}`}>
              <Icon className="w-5 h-5" />
              <div>
                <p className="text-xl font-bold">{shift.count}</p>
                <p className="text-xs">{shift.label}</p>
              </div>
            </div>
          );
        })}
        <div className="bg-muted border border-border rounded-xl p-4 flex items-center gap-3">
          <UserCircle className="w-5 h-5 text-muted-foreground" />
          <div>
            <p className="text-xl font-bold text-foreground">{unassignedCount}</p>
            <p className="text-xs text-muted-foreground">Unassigned</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Shift Schedule Summary</h2>
          <p className="text-xs text-muted-foreground">Effective employee assignments for the selected work date</p>
        </div>
        <div className="flex items-center gap-2 border border-border rounded-md px-2 h-9 bg-background">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <Input type="date" aria-label="Summary work date" value={summaryDate} onChange={e => setSummaryDate(e.target.value || manilaDateString())} className="h-7 w-36 border-0 p-0 text-xs focus-visible:ring-0" />
        </div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search employee, department, employee no., or shift..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2 border border-border rounded-md px-2 h-9 bg-background">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value || defaultEffectiveDate())}
            className="h-7 w-36 border-0 p-0 text-xs focus-visible:ring-0"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={() => setEffectiveDate(nextPayrollPeriod.start_date)}
        >
          Next Payroll Period
        </Button>
        <Select value={filterShift} onValueChange={setFilterShift}>
          <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All Shifts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shifts</SelectItem>
            {shiftOptions.map(shift => (
              <SelectItem key={shift.value} value={shift.value}>{shift.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <Card className="border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Department</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Shift</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Work Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time In</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time Out</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Rest Day</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Assign Shift</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">No employees found.</td></tr>
              ) : (
                filtered.map(emp => {
                  const summaryShift = getSummaryShift(emp);
                  const assignmentShiftValue = getCurrentShiftValue(emp, effectiveDate);
                  const pendingAssignment = nextEmployeeShiftAssignment(emp);
                  const pendingShift = pendingAssignment ? getShiftOption(pendingAssignment.work_schedule) : null;
                  return (
	                  <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {emp.photo_url
                            ? <img src={emp.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                            : <UserCircle className="w-4 h-4 text-primary" />}
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">{emp.first_name} {emp.last_name}</p>
                          <p className="text-xs text-muted-foreground">{emp.employee_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{emp.department || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {summaryShift ? <ShiftBadge shift={{ ...summaryShift, value: summaryShift.id, label: summaryShift.setting_name || 'Work Shift' }} /> : <Badge variant="outline">No schedule</Badge>}
                        {pendingAssignment && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[10px] text-muted-foreground">
                              {pendingShift?.label} starts {pendingAssignment.effective_date}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive"
                              onClick={() => handleCancelScheduledShift(emp, pendingAssignment)}
                            >
                              <XCircle className="h-3 w-3" />
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{summaryDate}</td>
                    <td className="px-4 py-3 text-xs hidden lg:table-cell">{summaryShift?.is_rest_day ? '—' : formatShiftTime(summaryShift?.shift_start_time) || '—'}</td>
                    <td className="px-4 py-3 text-xs hidden lg:table-cell">{summaryShift?.is_rest_day ? '—' : formatShiftTime(summaryShift?.shift_end_time) || '—'}</td>
                    <td className="px-4 py-3 text-xs hidden md:table-cell">{summaryShift?.is_rest_day ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Select
                          value={assignmentShiftValue}
                          onValueChange={v => handleShiftChange(emp, v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-36">
                            <SelectValue placeholder="Select shift..." />
                          </SelectTrigger>
                          <SelectContent>
                            {shiftOptions.map(shift => {
                              const style = getShiftStyle(shift);
                              const Icon = style.icon;
                              return (
                                <SelectItem key={shift.value} value={shift.value}>
                                  <span className="flex items-center gap-1.5">
                                    <Icon className="w-3.5 h-3.5" /> {shift.label}
                                    {shift.shift_start_time && shift.shift_end_time && (
                                      <span className="text-muted-foreground">
                                        {formatShiftTime(shift.shift_start_time)} - {formatShiftTime(shift.shift_end_time)}
                                      </span>
                                    )}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {savingId === emp.id && (
                          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        )}
                        {savingId !== emp.id && sortedShiftAssignments(emp).length > 0 && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 opacity-60" />
                        )}
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!pendingShiftChange} onOpenChange={(open) => { if (!open) closeShiftPasscodeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingShiftChange?.type === 'cancel'
                ? 'Cancel Scheduled Shift Change'
                : 'Authorize Shift Change'}
            </DialogTitle>
            <DialogDescription>
              All work-schedule changes require today&apos;s HR Officer and Admin Manager passcodes.
            </DialogDescription>
          </DialogHeader>

          {pendingShiftChange && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-foreground">
                  {pendingShiftChange.employee.first_name} {pendingShiftChange.employee.last_name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingShiftChange.type === 'cancel'
                    ? `Cancel ${getShiftOption(pendingShiftChange.assignment?.work_schedule).label}`
                    : `${getShiftOption(getCurrentShiftValue(pendingShiftChange.employee, pendingShiftChange.effectiveDate)).label} to ${getShiftOption(pendingShiftChange.shiftValue).label}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Effective {pendingShiftChange.effectiveDate}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">HR Officer Passcode</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={hrPasscode}
                    onChange={event => {
                      setHrPasscode(event.target.value);
                      setPasscodeError('');
                    }}
                    placeholder="Enter HR passcode"
                    className="text-center font-mono tracking-widest"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Admin Passcode</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={adminPasscode}
                    onChange={event => {
                      setAdminPasscode(event.target.value);
                      setPasscodeError('');
                    }}
                    placeholder="Enter admin passcode"
                    className="text-center font-mono tracking-widest"
                  />
                </div>
              </div>

              {passcodeError && (
                <p className="text-xs text-destructive">{passcodeError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeShiftPasscodeDialog} disabled={!!savingId}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmShiftChange}
              disabled={!!savingId || !hrPasscode.trim() || !adminPasscode.trim()}
            >
              {savingId
                ? 'Saving...'
                : pendingShiftChange?.type === 'cancel'
                  ? 'Authorize Cancellation'
                  : 'Authorize Change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
