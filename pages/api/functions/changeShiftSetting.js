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

function versionsWithBaseline(shift) {
  if (Array.isArray(shift.effective_versions) && shift.effective_versions.length > 0) {
    return [...shift.effective_versions];
  }
  return [{
    effective_date: SHIFT_VERSION_BASE_DATE,
    ...shiftVersionSnapshot(shift),
  }];
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
  const changedAt = new Date().toISOString();
  const changedBy = session?.user?.name || session?.user?.email || 'unknown';
  const audit = {
    changed_at: changedAt,
    changed_by: changedBy,
    change_reason: reason.trim(),
  };

  let changedShift;
  if (operation === 'create') {
    const created = await createRecord('Settings', {
      ...data,
      company_profile_id: companyProfileId,
      effective_versions: [
        {
          effective_date: SHIFT_VERSION_BASE_DATE,
          ...shiftVersionSnapshot(data, { is_active: false, is_default: false }),
        },
        {
          effective_date: effectiveDate,
          ...shiftVersionSnapshot(data, { is_active: true }),
          ...audit,
        },
      ],
    });
    changedShift = created;
  } else {
    const nextValues = operation === 'delete'
      ? { is_active: false, is_default: false }
      : operation === 'set_default'
        ? { is_default: true }
        : data;
    changedShift = await updateRecord('Settings', shift.id, {
      ...nextValues,
      effective_versions: appendVersion(shift, effectiveDate, nextValues, audit),
    });
  }

  if ((operation === 'create' && data.is_default) || operation === 'set_default' || data.is_default) {
    await Promise.all(shifts
      .filter(item => item.id !== changedShift.id)
      .map(item => updateRecord('Settings', item.id, {
        effective_versions: appendVersion(item, effectiveDate, { is_default: false }, audit),
      })));
  }

  await createRecord('PasscodeAuditLog', {
    company_profile_id: companyProfileId,
    source_entity: 'Settings',
    source_record_id: changedShift.id,
    action: `shift_setting_${operation}`,
    occurred_at: changedAt,
    authorized_by: changedBy,
    reason: reason.trim(),
    summary: `Shift setting ${operation} scheduled for ${effectiveDate}`,
    record_date: effectiveDate,
  });

  return res.status(200).json({ shift: changedShift, effective_date: effectiveDate });
}
