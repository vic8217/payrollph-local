import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { payrollPeriodId } = body;

    // Fetch payroll period details if provided
    let startDate, endDate, periodName = '';
    if (payrollPeriodId) {
      const periods = await base44.entities.PayrollPeriod.list();
      const selectedPeriod = periods.find(p => p.id === payrollPeriodId);
      if (selectedPeriod) {
        startDate = new Date(selectedPeriod.start_date);
        endDate = new Date(selectedPeriod.end_date);
        periodName = selectedPeriod.period_name;
      }
    }

    // Fetch all employees and attendance logs
    const employees = await base44.entities.Employee.filter({ status: 'active' });
    const allLogs = await base44.entities.AttendanceLog.list();
    
    // Filter logs by date range if period is provided
    const filteredLogs = startDate && endDate 
      ? allLogs.filter(log => {
          const logDate = new Date(log.date);
          return logDate >= startDate && logDate <= endDate;
        })
      : allLogs;

    // Build CSV content
    const headers = ['Date', 'Employee ID', 'Employee Name', 'Department', 'Shift', 'Time In(1)', 'Time Out(1)', 'Time In(2)', 'Time Out(2)', 'Hours Worked', 'OT Hours', 'ND Hours', 'Late (min)', 'Undertime (min)', 'Day Type', 'Status'];
    const rows = [headers.join(',')];

    const formatTime = (isoString) => {
      if (!isoString) return '';
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    for (const emp of employees) {
      const empLogs = filteredLogs.filter(l => l.employee_id === emp.employee_id);
      
      if (empLogs.length === 0) continue;

      for (const log of empLogs) {
        const shift = emp.work_schedule === 'night_shift' ? 'Night' : 'Day';
        const row = [
          log.date || '',
          emp.employee_id || '',
          `${emp.first_name} ${emp.last_name}` || '',
          emp.department || '',
          shift,
          formatTime(log.time_in),
          formatTime(log.break_time_out),
          formatTime(log.break_time_in),
          formatTime(log.time_out),
          log.hours_worked || '',
          log.overtime_hours || '',
          log.night_diff_hours || '',
          log.late_minutes || '',
          log.undertime_minutes || '',
          log.day_type || '',
          log.status || '',
        ];
        rows.push(row.map(cell => `"${cell}"`).join(','));
      }
    }

    const csv = rows.join('\n');
    const filename = periodName 
      ? `attendance-${periodName.replace(/\s+/g, '-').toLowerCase()}.csv`
      : `attendance-summary-${new Date().toISOString().split('T')[0]}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});