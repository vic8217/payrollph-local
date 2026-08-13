// @ts-nocheck
import { createRecord, listRecords } from '@/server/entityStore';
import { manilaDateString } from '@/lib/dateUtils';

function truncate(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function nextPunchAction(log) {
  if (!log?.time_in) return 'time_in';
  if (!log.break_time_out) return 'break_time_out';
  if (!log.break_time_in) return 'break_time_in';
  if (!log.time_out) return 'time_out';
  return 'attendance_complete';
}

const punchLabels = {
  time_in: 'Time In (1)',
  break_time_out: 'Time Out (1)',
  break_time_in: 'Time In (2)',
  time_out: 'Time Out (2)',
  attendance_complete: 'Additional attendance punch',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const employeeId = truncate(req.body?.employee_id, 100);
  const employeeRecordId = truncate(req.body?.employee_record_id, 100);
  const companyProfileId = truncate(req.body?.company_profile_id, 100);
  if (!employeeId || !companyProfileId) {
    return res.status(400).json({ error: 'Employee and company are required.' });
  }

  const employees = await listRecords('Employee', {
    filter: { employee_id: employeeId, company_profile_id: companyProfileId },
    limit: 20,
  });
  const employee = employees.find(item => String(item.id) === employeeRecordId) || employees[0];
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });

  const recordDate = manilaDateString();
  const attendanceLogs = await listRecords('AttendanceLog', {
    filter: { company_profile_id: companyProfileId, employee_id: employee.employee_id, date: recordDate },
    sort: '-created_date',
    limit: 10,
  });
  const log = attendanceLogs[0] || null;
  const punchAction = nextPunchAction(log);
  const occurredAt = new Date().toISOString();
  const employeeName = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');
  const receipt = await createRecord('PasscodeAuditLog', {
    company_profile_id: companyProfileId,
    source_entity: 'AttendanceLog',
    source_record_id: log?.id || null,
    action: 'attendance_punch_attempted',
    punch_action: punchAction,
    failure_stage: 'punch_flow_started',
    occurred_at: occurredAt,
    authorized_by: 'Employee Portal',
    reason: `${punchLabels[punchAction]} attempt started`,
    summary: `Employee QR recognized; ${punchLabels[punchAction]} photo verification started at ${occurredAt}`,
    employee_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: employeeName,
    record_date: recordDate,
    attempted_at: occurredAt,
  });

  return res.status(201).json({ receipt, punch_action: punchAction });
}
