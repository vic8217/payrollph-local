import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { format, parseISO } from 'date-fns';
import { Clock, CheckCircle2, AlertCircle, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const dayTypeColors = {
  regular: 'bg-blue-50 text-blue-700',
  half_day: 'bg-amber-50 text-amber-700',
  rest_day: 'bg-purple-50 text-purple-700',
  regular_holiday: 'bg-red-50 text-red-700',
  special_holiday: 'bg-orange-50 text-orange-700',
  special_working_holiday: 'bg-blue-50 text-blue-700',
};

const dayTypeLabels = {
  regular: 'Regular',
  half_day: 'Half Day',
  rest_day: 'Rest Day',
  regular_holiday: 'Regular Holiday',
  special_holiday: 'Special Non-Working Holiday',
  special_working_holiday: 'Special Working Holiday',
};

export default function EmployeeAttendance({ employee }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['employee-attendance', employee?.employee_id, employee?.company_profile_id, month],
    queryFn: async () => {
      const records = await appApi.entities.AttendanceLog.filter({ employee_id: employee.employee_id });
      return records.filter(log => !log.company_profile_id || log.company_profile_id === employee.company_profile_id);
    },
    enabled: !!employee?.employee_id,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  if (!employee) {
    return <div className="p-6 text-center text-muted-foreground">No employee data.</div>;
  }

  // Filter by selected month
  const filteredLogs = logs
    .filter(log => log.date?.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalDays = filteredLogs.filter(l => !l.is_absent).length;
  const totalHours = filteredLogs.reduce((sum, l) => sum + (l.hours_worked || 0), 0);
  const totalOT = filteredLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);
  const absents = filteredLogs.filter(l => l.is_absent).length;

  const formatTime = (iso) => {
    if (!iso) return '—';
    try { return format(parseISO(iso), 'h:mm a'); } catch { return '—'; }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">My Attendance</h2>
        <p className="text-sm text-muted-foreground">View your daily time records</p>
      </div>

      {/* Month selector */}
      <input
        type="month"
        value={month}
        onChange={e => setMonth(e.target.value)}
        className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Days Present', value: totalDays, icon: CheckCircle2, color: 'text-green-600' },
          { label: 'Hours Worked', value: totalHours.toFixed(1), icon: Clock, color: 'text-blue-600' },
          { label: 'Overtime Hrs', value: totalOT.toFixed(1), icon: TrendingUp, color: 'text-purple-600' },
          { label: 'Absences', value: absents, icon: AlertCircle, color: 'text-red-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
            <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
            <p className="text-xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Logs table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No records for this month.</div>
        ) : (
          <div className="divide-y divide-border">
            {filteredLogs.map(log => (
              <div key={log.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="text-center w-10">
                    <p className="text-xs text-muted-foreground">{format(parseISO(log.date), 'EEE')}</p>
                    <p className="text-sm font-bold text-foreground">{format(parseISO(log.date), 'd')}</p>
                  </div>
                  <div>
                    {log.is_absent ? (
                      <p className="text-sm font-medium text-red-600">Absent</p>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm text-foreground">
                          <span className="text-green-700 font-medium">{formatTime(log.time_in)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-blue-700 font-medium">{formatTime(log.time_out)}</span>
                        </div>
                        {(log.break_time_out || log.break_time_in) && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="text-orange-500 font-medium">Break: {formatTime(log.break_time_out)}</span>
                            <span>→</span>
                            <span className="text-teal-600 font-medium">{formatTime(log.break_time_in)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {!log.is_absent && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {log.hours_worked ? `${log.hours_worked.toFixed(1)}h worked` : 'No time out yet'}
                        {log.overtime_hours > 0 && ` · +${log.overtime_hours.toFixed(1)}h OT`}
                        {log.night_diff_hours > 0 && ` · ${log.night_diff_hours.toFixed(1)}h ND`}
                        {log.late_minutes > 0 && ` · ${log.late_minutes}m late`}
                      </p>
                    )}
                  </div>
                </div>
                <Badge className={`text-xs ${dayTypeColors[log.day_type] || dayTypeColors.regular}`}>
                  {dayTypeLabels[log.day_type] || 'Regular'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
