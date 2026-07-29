// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { createRecord, listRecords, updateRecord } from '@/server/entityStore';
import { manilaDateString } from '@/lib/dateUtils';
import {
  SHIFT_VERSION_BASE_DATE,
  nextBusinessDate,
  shiftVersionSnapshot,
} from '@/lib/shiftSettings';

const AUDITED_SHIFT_FIELDS = {
  setting_name: 'Shift name',
  shift_start_time: 'Shift start',
  shift_end_time: 'Shift end',
  overtime_start_time: 'Overtime start',
  grace_period_minutes: 'Grace period',
  time_in_allowance_minutes: 'Time In (1) allowance',
  paid_break_time: 'Paid breaktime',
  paid_breaktime_approval_document_name: 'Approval document',
  is_default: 'Default shift',
  is_active: 'Active',
};

function versionsWithBaseline(shift) {
  if (Array.isArray(shift.effective_versions) && shift.effective_versions.length > 0) {
    return [...shift.effective_versions];
  }
  return [{
    effective_date: SHIFT_VERSION_BASE_DATE,
    ...shiftVersionSnapshot(shift),
  }];
}

function shiftSnapshotAt(shift, effectiveDate) {
  const version = versionsWithBaseline(shift)
    .filter(item => String(item.effective_date || '') <= effectiveDate)
    .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)))
    .at(-1);
  return shiftVersionSnapshot(shift, version || {});
}

function shiftChanges(before, after) {
  return Object.entries(AUDITED_SHIFT_FIELDS)
    .filter(([field]) => (before?.[field] ?? null) !== (after?.[field] ?? null))
    .map(([field, label]) => ({
      field,
      label,
      before: before?.[field] ?? null,
      after: after?.[field] ?? null,
    }));
}

function appendVersion(shift, effectiveDate, values, audit) {
  const versions = versionsWithBaseline(shift)
    .filter(version => version.effective_date !== effectiveDate);
  versions.push({
    effective_date: effectiveDate,
    ...shiftVersionSnapshot(shift, values),
    ...audit,
  });
  return versions.sort((a, b) => a.effective_date.localeCompare(b.effective_date));
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function overtimeStartValidationMessage(shiftStartTime, shiftEndTime, overtimeStartTime) {
  const start = timeToMinutes(shiftStartTime);
  const end = timeToMinutes(shiftEndTime);
  const overtime = timeToMinutes(overtimeStartTime);
  if (start == null || end == null || overtime == null) return 'Enter valid shift and overtime times.';
  if (start === end) return 'Shift start and end time cannot be the same.';

  const shiftDurationMinutes = start < end
    ? end - start
    : (24 * 60 - start) + end;
  const overtimeOffsetMinutes = overtime >= start
    ? overtime - start
    : (24 * 60 - start) + overtime;
  const isExtendedShift = shiftDurationMinutes >= 12 * 60;
  if (isExtendedShift && overtimeOffsetMinutes >= 8 * 60 && overtimeOffsetMinutes < shiftDurationMinutes) {
    return '';
  }

  const isWithinShift = start < end
    ? overtime >= start && overtime < end
    : overtime >= start || overtime < end;

  if (isWithinShift) {
    return 'Overtime start must be outside regular shift hours. Use the shift end time or later.';
  }

  return '';
}

function normalizeShiftData(data = {}) {
  const normalized = { ...data };
  const shiftTimeError = overtimeStartValidationMessage(
    normalized.shift_start_time,
    normalized.shift_end_time,
    normalized.overtime_start_time,
  );
  if (shiftTimeError) {
    throw new Error(shiftTimeError);
  }

  if (normalized.paid_break_time) {
    if (!normalized.paid_breaktime_approval_document_url) {
      throw new Error('Director approval document is required for paid breaktime.');
    }
    normalized.paid_breaktime_approval_document_name = normalized.paid_breaktime_approval_document_name || 'Director approval document';
    normalized.paid_breaktime_approval_uploaded_at = normalized.paid_breaktime_approval_uploaded_at || new Date().toISOString();
  } else {
    normalized.paid_breaktime_approval_document_url = null;
    normalized.paid_breaktime_approval_document_name = null;
    normalized.paid_breaktime_approval_uploaded_at = null;
  }
  return normalized;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    operation,
    shift_id: shiftId,
    data = {},
    hr_passcode: hrPasscode,
    admin_passcode: adminPasscode,
    reason,
    company_profile_id: companyProfileId,
  } = req.body || {};

  if (!companyProfileId || !operation || !reason?.trim()) {
    return res.status(400).json({ error: 'Company, operation, and reason are required.' });
  }
  if (!hrPasscode?.trim() || !adminPasscode?.trim()) {
    return res.status(400).json({ error: 'Both HR Officer and Admin passcodes are required.' });
  }

  const today = manilaDateString();
  const passcodes = await listRecords('DailyPasscode', {
    filter: { company_profile_id: companyProfileId, date: today },
    limit: 10,
  });
  const todayCode = passcodes[0];
  if (!todayCode) return res.status(403).json({ error: 'No daily HR/Admin passcodes exist for today.' });
  if (String(todayCode.passcode || '') !== hrPasscode.trim()) {
    return res.status(403).json({ error: 'Incorrect HR Officer passcode.' });
  }
  if (String(todayCode.manager_passcode || '') !== adminPasscode.trim()) {
    return res.status(403).json({ error: 'Incorrect Admin passcode.' });
  }

  const shifts = await listRecords('Settings', {
    filter: { company_profile_id: companyProfileId },
    limit: 500,
  });
  const shift = shifts.find(item => String(item.id) === String(shiftId));
  if (operation !== 'create' && !shift) {
    return res.status(404).json({ error: 'Shift setting not found.' });
  }

  const effectiveDate = nextBusinessDate(today);
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
  }
  const changedAt = new Date().toISOString();
  const changedBy = session?.user?.name || session?.user?.email || 'unknown';
  const audit = {
    changed_at: changedAt,
    changed_by: changedBy,
    change_reason: reason.trim(),
  };

  let changedShift;
  let beforeSnapshot = null;
  let afterSnapshot;
  if (operation === 'create') {
    let shiftData;
    try {
      shiftData = normalizeShiftData(data);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    const created = await createRecord('Settings', {
      ...shiftData,
      company_profile_id: companyProfileId,
      effective_versions: [
        {
          effective_date: SHIFT_VERSION_BASE_DATE,
          ...shiftVersionSnapshot(shiftData, { is_active: false, is_default: false }),
        },
        {
          effective_date: effectiveDate,
          ...shiftVersionSnapshot(shiftData, { is_active: true }),
          ...audit,
        },
      ],
    });
    changedShift = created;
    afterSnapshot = shiftVersionSnapshot(shiftData, { is_active: true });
  } else {
    beforeSnapshot = shiftSnapshotAt(shift, effectiveDate);
    let nextValues = operation === 'delete'
      ? { is_active: false, is_default: false }
      : operation === 'set_default'
        ? { is_default: true }
        : data;
    if (operation === 'update') {
      try {
        nextValues = normalizeShiftData(nextValues);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }
    changedShift = await updateRecord('Settings', shift.id, {
      ...nextValues,
      effective_versions: appendVersion(shift, effectiveDate, nextValues, audit),
    });
    afterSnapshot = shiftVersionSnapshot(beforeSnapshot, nextValues);
  }

  if ((operation === 'create' && data.is_default) || operation === 'set_default' || data.is_default) {
    await Promise.all(shifts
      .filter(item => item.id !== changedShift.id)
      .map(item => updateRecord('Settings', item.id, {
        effective_versions: appendVersion(item, effectiveDate, { is_default: false }, audit),
      })));
  }

  const shiftName = afterSnapshot?.setting_name || beforeSnapshot?.setting_name || 'Unnamed shift';
  const changes = shiftChanges(beforeSnapshot, afterSnapshot);
  await createRecord('PasscodeAuditLog', {
    company_profile_id: companyProfileId,
    source_entity: 'Settings',
    source_record_id: changedShift.id,
    action: `shift_setting_${operation}`,
    occurred_at: changedAt,
    authorized_by: changedBy,
    reason: reason.trim(),
    subject_name: shiftName,
    effective_date: effectiveDate,
    operation,
    changes,
    summary: `${shiftName}: shift setting ${operation} scheduled for ${effectiveDate}`,
    record_date: effectiveDate,
  });

  return res.status(200).json({ shift: changedShift, effective_date: effectiveDate });
}
