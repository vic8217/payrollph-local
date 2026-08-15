// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listRecords, updateRecord, createRecord } from '@/server/entityStore';
import { manilaDateString } from '@/lib/dateUtils';

const actorName = user => user?.name || user?.email || 'unknown';
const clean = value => String(value || '').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: 'Authentication required' });

  const action = clean(req.body?.action);
  const logId = clean(req.body?.attendance_log_id);
  const [log] = await listRecords('AttendanceLog', { filter: { id: logId }, limit: 1 });
  if (!log) return res.status(404).json({ error: 'Attendance record not found' });
  const assignedCompanyIds = new Set([
    ...(Array.isArray(session.user.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session.user.company_profile_id || '').split(','),
  ].map(clean).filter(Boolean));
  if (session.user.role !== 'super_admin' && !assignedCompanyIds.has(clean(log.company_profile_id))) {
    return res.status(403).json({ error: 'You are not assigned to this company.' });
  }

  const now = new Date().toISOString();
  const reviewer = actorName(session.user);
  let updates;
  if (action === 'approve' || action === 'deny') {
    if (session.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the Super Admin can approve or deny this review.' });
    if (log.time_in_review_status !== 'pending') return res.status(409).json({ error: 'This item is no longer pending review.' });
    const decisionNote = clean(req.body?.decision_note);
    if (!decisionNote) return res.status(400).json({ error: 'A decision note is required.' });
    updates = {
      time_in_review_status: action === 'approve' ? 'approved' : 'denied',
      time_in_review_decision_note: decisionNote,
      time_in_review_decided_at: now,
      time_in_review_decided_by: reviewer,
    };
  } else if (action === 'adjust') {
    if (!['admin', 'user'].includes(session.user.role)) return res.status(403).json({ error: 'Only an HR Officer or Admin Manager can apply an approved adjustment.' });
    if (log.time_in_review_status !== 'approved') return res.status(409).json({ error: 'Super Admin approval is required before adjustment.' });
    const adjustedTime = clean(req.body?.adjusted_time);
    const adjustmentNote = clean(req.body?.adjustment_note);
    const passcode = clean(req.body?.passcode);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(adjustedTime)) return res.status(400).json({ error: 'A valid adjusted time is required.' });
    if (!adjustmentNote) return res.status(400).json({ error: 'An adjustment note is required.' });
    const codes = await listRecords('DailyPasscode', { filter: { company_profile_id: log.company_profile_id, date: manilaDateString() }, limit: 10 });
    const validPasscode = codes.some(item => clean(item.passcode) === passcode || clean(item.manager_passcode) === passcode);
    if (!validPasscode) return res.status(403).json({ error: 'Incorrect HR Officer or Admin Manager passcode.' });
    const originalValue = log.time_in_original_value || log.time_in_actual_punch_at || log.time_in;
    const punchDate = log.time_in ? manilaDateString(log.time_in) : log.date;
    const adjustedValue = new Date(`${punchDate}T${adjustedTime}:00+08:00`).toISOString();
    updates = {
      time_in_original_value: originalValue,
      time_in: adjustedValue,
      time_in_adjustment_note: adjustmentNote,
      time_in_adjusted_at: now,
      time_in_adjusted_by: reviewer,
      time_in_review_status: 'adjusted',
      status: 'pending',
      hours_worked: null,
      overtime_hours: 0,
      ot_actual_hours: 0,
      night_diff_hours: 0,
      late_minutes: 0,
    };
  } else {
    return res.status(400).json({ error: 'Unsupported review action' });
  }

  const updated = await updateRecord('AttendanceLog', log.id, updates);
  await createRecord('PasscodeAuditLog', {
    company_profile_id: log.company_profile_id,
    source_entity: 'AttendanceLog', source_record_id: log.id,
    action: `time_in_review_${action}`,
    occurred_at: now, authorized_by: reviewer,
    reason: action === 'adjust' ? updates.time_in_adjustment_note : updates.time_in_review_decision_note,
    summary: `Time In (1) review ${action} for ${log.employee_name || log.employee_id} on ${log.date}`,
    employee_record_id: log.employee_record_id, employee_id: log.employee_id,
    employee_name: log.employee_name, record_date: log.date,
    changes: action === 'adjust' ? [{ field: 'time_in', label: 'Time In(1)', before: log.time_in, after: updates.time_in }] : [],
  });
  return res.status(200).json({ log: updated });
}
