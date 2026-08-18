// @ts-nocheck
import { createRecord, listRecords } from '@/server/entityStore';
import { manilaDateString } from '@/lib/dateUtils';
import { resolveEffectiveEmployeeShift, scheduleDateTimes, timeInWindowStatus } from '@/lib/shiftSettings';

const MAX_AUTO_SYNC_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function responseFromAudit(audit) {
  return {
    code: 'OFFLINE_ATTENDANCE_SYNCHRONIZED',
    clientRequestId: audit.client_request_id,
    attemptedAt: audit.attempted_at,
    syncedAt: audit.synced_at,
    attendanceResult: audit.attendance_result,
    officialAttendanceCreated: audit.official_attendance_created === true,
    officialAttendanceId: audit.official_attendance_id || null,
    officialTimeIn: audit.official_time_in || null,
    scheduledStart: audit.scheduled_start || null,
    earliestAllowedTimeIn: audit.earliest_allowed_time_in || null,
    idempotentReplay: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const event = req.body || {};
  const clientRequestId = String(event.clientRequestId || '').trim().slice(0, 100);
  const companyId = String(event.companyProfileId || '').trim();
  const employeeRecordId = String(event.employeeRecordId || '').trim();
  const employeeId = String(event.employeeId || '').trim();
  if (!clientRequestId || !companyId || !employeeRecordId || !employeeId) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'Offline event identity is incomplete.' });

  const prior = await listRecords('PasscodeAuditLog', { filter: { company_profile_id: companyId, client_request_id: clientRequestId }, limit: 2 });
  if (prior[0]) return res.status(200).json(responseFromAudit(prior[0]));

  const [employee] = await listRecords('Employee', { filter: { id: employeeRecordId, employee_id: employeeId, company_profile_id: companyId }, limit: 1 });
  if (!employee) return res.status(403).json({ code: 'REJECTED_AUTHORIZATION', error: 'The employee and company identity could not be verified.' });

  const attemptedAt = new Date(event.attemptedAt);
  const syncedAt = new Date();
  if (!Number.isFinite(attemptedAt.getTime()) || attemptedAt.getTime() > syncedAt.getTime() + MAX_FUTURE_DRIFT_MS) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'The original attempt time is invalid.' });
  const ageMs = syncedAt.getTime() - attemptedAt.getTime();
  const settings = await listRecords('Settings', { filter: { company_profile_id: companyId }, limit: 1000 });
  let workDate = manilaDateString(attemptedAt);
  let shift = resolveEffectiveEmployeeShift(employee, settings, workDate);
  let times = scheduleDateTimes(workDate, shift);
  const previousDate = addDays(workDate, -1);
  const previousShift = resolveEffectiveEmployeeShift(employee, settings, previousDate);
  const previousTimes = scheduleDateTimes(previousDate, previousShift);
  if (previousTimes?.isOvernight && attemptedAt >= previousTimes.earliestTimeIn && attemptedAt <= previousTimes.end) {
    workDate = previousDate;
    shift = previousShift;
    times = previousTimes;
  }

  let attendanceResult = 'SYNCED_AUDIT_ONLY';
  let official = null;
  const requestedAction = String(event.attemptedAction || 'AUTO_SEQUENCE');
  const snapshotMismatch = Boolean(
    event.shiftIdAtAttempt && String(event.shiftIdAtAttempt) !== String(shift?.id || '') ||
    event.scheduledStartAtAttempt && times?.start && new Date(event.scheduledStartAtAttempt).getTime() !== times.start.getTime()
  );
  const logs = await listRecords('AttendanceLog', { filter: { company_profile_id: companyId, employee_record_id: employee.id, date: workDate }, sort: '-created_date', limit: 20 });
  const existing = logs.find(log => log.status !== 'rejected');

  if (!times) attendanceResult = 'INVALID_SCHEDULE';
  else if (ageMs > MAX_AUTO_SYNC_AGE_MS || snapshotMismatch) attendanceResult = 'CONFLICT_REQUIRES_HR_REVIEW';
  else if (!['TIME_IN_1', 'AUTO_SEQUENCE'].includes(requestedAction)) attendanceResult = 'CONFLICT_REQUIRES_HR_REVIEW';
  else if (timeInWindowStatus(attemptedAt, times).isEarlyAttempt) attendanceResult = 'EARLY_ATTEMPT_ONLY';
  else if (existing?.time_in) attendanceResult = 'CONFLICT_REQUIRES_HR_REVIEW';
  else if (attemptedAt >= times.end) attendanceResult = 'CONFLICT_REQUIRES_HR_REVIEW';
  else {
    official = await createRecord('AttendanceLog', {
      company_profile_id: companyId,
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
      date: workDate,
      time_in: attemptedAt.toISOString(),
      time_in_actual_punch_at: attemptedAt.toISOString(),
      work_schedule: shift.id,
      shift_start_time: shift.shift_start_time,
      shift_end_time: shift.shift_end_time,
      shift_overtime_start_time: shift.overtime_start_time || null,
      shift_break_start_time: shift.break_start_time || employee.break_time || null,
      shift_break_end_time: shift.break_end_time || null,
      shift_break_duration_minutes: Number(shift.break_duration_minutes || employee.break_duration_minutes) || 60,
      shift_grace_period_minutes: Number(shift.grace_period_minutes) || 0,
      shift_time_in_allowance_minutes: Number(shift.time_in_allowance_minutes) || 0,
      shift_paid_break_time: Boolean(shift.paid_break_time),
      record_source: 'OFFLINE_SYSTEM_DOWN_SYNC',
      offline_client_request_id: clientRequestId,
      synchronized_at: syncedAt.toISOString(),
      status: 'pending',
      day_type: 'regular',
    });
    attendanceResult = 'OFFICIAL_ATTENDANCE_CREATED';
  }

  const audit = await createRecord('PasscodeAuditLog', {
    company_profile_id: companyId,
    source_entity: 'AttendanceLog',
    source_record_id: official?.id || null,
    action: 'offline_attendance_synchronized',
    event_type: attendanceResult === 'EARLY_ATTEMPT_ONLY' ? 'EARLY_TIME_IN_ATTEMPT' : 'OFFLINE_ATTENDANCE_SYNC',
    employee_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
    record_date: workDate,
    client_request_id: clientRequestId,
    attempted_action: requestedAction,
    attempted_at: attemptedAt.toISOString(),
    synced_at: syncedAt.toISOString(),
    occurred_at: syncedAt.toISOString(),
    source: 'CLIENT_QUEUED',
    sync_status: 'SYNCHRONIZED',
    attendance_result: attendanceResult,
    scheduled_start: times?.start?.toISOString() || null,
    earliest_allowed_time_in: times?.earliestTimeIn?.toISOString() || null,
    shift_id_at_attempt: event.shiftIdAtAttempt || null,
    scheduled_start_at_attempt: event.scheduledStartAtAttempt || null,
    shift_id_at_sync: shift?.id || null,
    official_attendance_created: Boolean(official),
    official_attendance_id: official?.id || null,
    official_time_in: official?.time_in || null,
    location: event.location || null,
    summary: `Client-queued attendance synchronized: ${attendanceResult}`,
    reason: attendanceResult,
    authorized_by: 'Offline Attendance Synchronization',
  });
  return res.status(200).json({ ...responseFromAudit(audit), idempotentReplay: false });
}
