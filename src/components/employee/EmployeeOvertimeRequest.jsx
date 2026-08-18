import { useMemo, useState } from 'react';
import { appApi } from '@/lib/appApi';
import { manilaDateString } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Clock, Send } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

function employeeName(employee) {
  return [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ');
}

const statusStyles = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  denied: 'bg-red-100 text-red-700 border-red-200',
};

function previousManilaDate(date) {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function isOvernightAttendance(log = {}) {
  const start = String(log.shift_start_time || '').slice(0, 5);
  const end = String(log.shift_end_time || '').slice(0, 5);
  return Boolean(start && end && end <= start);
}

export default function EmployeeOvertimeRequest({ employee }) {
  const [date, setDate] = useState(manilaDateString());
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: requests = [] } = useQuery({
    queryKey: ['overtimeRequests', employee?.id],
    queryFn: () => appApi.entities.OvertimeRequest.filter({
      company_profile_id: employee.company_profile_id,
      employee_record_id: employee.id,
    }, '-date', 20),
    enabled: !!employee?.id,
  });

  const existingForDate = useMemo(() =>
    requests.find(request => request.date === date && ['pending', 'approved'].includes(String(request.status || '').toLowerCase())),
    [requests, date],
  );

  const submitRequest = async (event) => {
    event.preventDefault();
    const requestedHours = Number(hours);
    if (!date) {
      setError('Select the OT date.');
      return;
    }
    if (!Number.isFinite(requestedHours) || requestedHours <= 0 || requestedHours > 24) {
      setError('Enter OT hours greater than 0 and not more than 24.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter the reason for overtime.');
      return;
    }
    if (existingForDate) {
      setError('You already have an open OT request for this date.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const attendanceLogs = await appApi.entities.AttendanceLog.filter({
        company_profile_id: employee.company_profile_id,
        date,
      });
      const employeeRecordId = String(employee.id || '').trim().toLowerCase();
      const employeeId = String(employee.employee_id || '').trim().toLowerCase();
      const matchingTimeIn = attendanceLogs.find(log => {
        const sameEmployee =
          (employeeRecordId && String(log.employee_record_id || '').trim().toLowerCase() === employeeRecordId) ||
          (employeeId && String(log.employee_id || '').trim().toLowerCase() === employeeId);
        return sameEmployee && log.status !== 'rejected' && Boolean(String(log.time_in || '').trim());
      });
      let requestDate = matchingTimeIn ? date : null;
      if (!requestDate && date === manilaDateString()) {
        const previousDate = previousManilaDate(date);
        const previousLogs = await appApi.entities.AttendanceLog.filter({
          company_profile_id: employee.company_profile_id,
          date: previousDate,
        });
        const overnightTimeIn = previousLogs.find(log => {
          const sameEmployee =
            (employeeRecordId && String(log.employee_record_id || '').trim().toLowerCase() === employeeRecordId) ||
            (employeeId && String(log.employee_id || '').trim().toLowerCase() === employeeId);
          return sameEmployee && log.status !== 'rejected' && isOvernightAttendance(log) && Boolean(String(log.time_in || '').trim());
        });
        if (overnightTimeIn) requestDate = previousDate;
      }
      if (!requestDate) {
        setError('You can only file an OT request after recording Time In for the selected date.');
        return;
      }
      const existingRequest = requests.find(request =>
        request.date === requestDate && ['pending', 'approved'].includes(String(request.status || '').toLowerCase()));
      if (existingRequest) {
        setDate(requestDate);
        setError(String(existingRequest.status || '').toLowerCase() === 'approved'
          ? `You already have an approved OT request for ${requestDate}.`
          : `You already have an open OT request for ${requestDate}.`);
        return;
      }

      await appApi.entities.OvertimeRequest.create({
        company_profile_id: employee.company_profile_id,
        employee_record_id: employee.id,
        employee_id: employee.employee_id,
        employee_name: employeeName(employee),
        department: employee.department || '',
        date: requestDate,
        requested_hours: Number(requestedHours.toFixed(2)),
        reason: reason.trim(),
        status: 'pending',
        submitted_at: new Date().toISOString(),
      });
      setHours('');
      setReason('');
      setDate(requestDate);
      await qc.invalidateQueries({ queryKey: ['overtimeRequests', employee?.id] });
      setSuccess(`OT request for ${requestDate} was submitted successfully and is pending approval.`);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to submit OT request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Overtime Request</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{employeeName(employee)} · {employee?.employee_id}</p>
      </div>

      <form onSubmit={submitRequest} className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-foreground">Date</label>
            <Input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Requested Hours</label>
            <Input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={hours}
              onChange={event => setHours(event.target.value)}
              className="mt-1"
              placeholder="e.g. 2"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">Reason</label>
          <Textarea
            value={reason}
            onChange={event => setReason(event.target.value)}
            className="mt-1 min-h-28"
            placeholder="Describe the task or business reason for overtime"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {success && <p className="text-xs font-medium text-emerald-700">{success}</p>}
        {existingForDate && <p className="text-xs text-amber-700">
          {String(existingForDate.status || '').toLowerCase() === 'approved'
            ? 'An approved request already exists for this date.'
            : 'An open request already exists for this date.'}
        </p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !!existingForDate} className="gap-2">
            <Send className="w-4 h-4" /> {saving ? 'Submitting...' : 'Submit Request'}
          </Button>
        </div>
      </form>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <p className="font-semibold text-sm text-foreground">Recent OT Requests</p>
        </div>
        {requests.length === 0 ? (
          <p className="px-4 py-8 text-sm text-center text-muted-foreground">No OT requests yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {requests.slice(0, 8).map(request => (
              <div key={request.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{request.date} · {Number(request.requested_hours || 0).toFixed(2)}h</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{request.reason}</p>
                  {request.review_reason && <p className="text-xs text-muted-foreground mt-1">Review: {request.review_reason}</p>}
                </div>
                <Badge variant="outline" className={`text-xs capitalize ${statusStyles[request.status] || ''}`}>
                  {request.status || 'pending'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
