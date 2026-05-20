import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/lib/CompanyContext';
import { Search, Sun, Moon, UserCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { employeesMissingBreakTime } from '@/lib/breakTimeRequirements';

const shiftConfig = {
  day_shift:   { label: 'Day Shift',   icon: Sun,  className: 'bg-amber-100 text-amber-700 border-amber-200' },
  night_shift: { label: 'Night Shift', icon: Moon, className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
};

const breakTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? '00' : '30';
  return `${String(hours).padStart(2, '0')}:${minutes}`;
});
const BREAK_DURATION_MINUTES = 60;

function formatTime(value) {
  if (!value) return 'No break';
  const [hours, minutes] = value.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function addBreakDuration(value) {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutes + BREAK_DURATION_MINUTES) % (24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

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

export default function WorkSchedule() {
  const [search, setSearch] = useState('');
  const [filterShift, setFilterShift] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activeCompanyId } = useCompany();

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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appApi.entities.Employee.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['employees', activeCompanyId] });
      qc.invalidateQueries({ queryKey: ['employees', activeCompanyId, 'work-schedule'] });
      setSavingId(null);
      toast({ title: 'Work schedule updated', description: 'Schedule settings saved successfully.' });
    },
  });

  const handleShiftChange = (emp, value) => {
    setSavingId(emp.id);
    updateMutation.mutate({ id: emp.id, data: { work_schedule: value } });
  };

  const handleBreakTimeChange = (emp, value) => {
    if (value === 'none') return;
    setSavingId(emp.id);
    updateMutation.mutate({ id: emp.id, data: { break_time: value } });
  };

  const sortedShiftSettings = [...shiftSettings].sort((a, b) => {
    const startCompare = (a.shift_start_time || '').localeCompare(b.shift_start_time || '');
    return startCompare || (a.setting_name || '').localeCompare(b.setting_name || '');
  });

  const settingOptions = sortedShiftSettings.map(shift => ({
    ...shift,
    value: shift.id,
    label: shift.setting_name || 'Unnamed Shift',
  }));

  const usedLegacyShiftValues = new Set(
    employees.map(e => e.work_schedule).filter(value => value === 'day_shift' || value === 'night_shift')
  );

  const shiftOptions = [
    ...settingOptions,
    ...Object.entries(shiftConfig)
      .filter(([value]) => usedLegacyShiftValues.has(value) || settingOptions.length === 0)
      .map(([value, config]) => ({ value, label: config.label })),
  ];

  const defaultShiftValue = settingOptions.find(shift => shift.is_default)?.value || settingOptions[0]?.value || 'day_shift';
  const getCurrentShiftValue = (emp) => emp.work_schedule || defaultShiftValue;

  const getShiftOption = (value) => {
    const resolvedValue = value || defaultShiftValue;
    return shiftOptions.find(option => option.value === resolvedValue)
      || shiftOptions.find(option => option.value === 'day_shift')
      || { value: resolvedValue, label: shiftConfig[resolvedValue]?.label || 'Unassigned Shift' };
  };

  const filtered = employees
    .filter(e => `${e.first_name} ${e.last_name} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase()))
    .filter(e => filterShift === 'all' || getCurrentShiftValue(e) === filterShift);

  const summaryShifts = shiftOptions.length > 0 ? shiftOptions : Object.entries(shiftConfig).map(([value, config]) => ({ value, label: config.label }));
  const summaryCounts = summaryShifts.map(shift => ({
    ...shift,
    count: employees.filter(e => getCurrentShiftValue(e) === shift.value).length,
  }));
  const unassignedCount = employees.filter(e => e.work_schedule && !shiftOptions.some(option => option.value === e.work_schedule)).length;
  const missingBreakTimeCount = employeesMissingBreakTime(employees).length;
  const loading = isLoading || isLoadingShifts;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Work Schedule</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Assign a configured shift and required lunch break to each employee</p>
      </div>

      {missingBreakTimeCount > 0 && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Break time setup required</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {missingBreakTimeCount} active employee{missingBreakTimeCount === 1 ? ' has' : 's have'} no lunch break schedule. Set a break time before payroll and attendance review.
            </p>
          </div>
        </div>
      )}

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
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
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
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Current Shift</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Break Time</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Assign Shift</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">No employees found.</td></tr>
              ) : (
                filtered.map(emp => (
	                  <tr key={emp.id} className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${!emp.break_time ? 'bg-destructive/5' : ''}`}>
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
                      <ShiftBadge shift={getShiftOption(emp.work_schedule)} />
                    </td>
	                    <td className="px-4 py-3 text-xs text-muted-foreground">
	                      {emp.break_time ? (
                          `${formatTime(emp.break_time)} - ${formatTime(addBreakDuration(emp.break_time))}`
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertTriangle className="w-3 h-3" /> Required
                          </Badge>
                        )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Select
                          value={getCurrentShiftValue(emp)}
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
                        <Select
                          value={emp.break_time || 'none'}
                          onValueChange={v => handleBreakTimeChange(emp, v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-40">
	                            <SelectValue placeholder="Set break time..." />
	                          </SelectTrigger>
	                          <SelectContent>
	                            <SelectItem value="none" disabled>Break time required</SelectItem>
	                            {breakTimeOptions.map(time => (
                              <SelectItem key={time} value={time}>
                                {formatTime(time)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {savingId === emp.id && (
                          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        )}
                        {savingId !== emp.id && emp.work_schedule && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 opacity-60" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
