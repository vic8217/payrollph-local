// @ts-nocheck
import { createRecord, listRecords, updateRecord } from '@/server/entityStore';
import {
  protectPasskey,
  revealProtectedPasskey,
} from '@/server/employeePasskey';

function validPasskey(value) {
  return /^\d{4}$/.test(String(value || ''));
}

const normalizeCode = value => String(value || '')
  .trim()
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/-PayrollPH$/i, '')
  .toLowerCase();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { operation, employee_record_id: employeeRecordId, identity_code: identityCode, passkey } = req.body || {};
  if (!employeeRecordId || !identityCode) {
    return res.status(400).json({ error: 'Employee record and scanned identity are required.' });
  }

  const employees = await listRecords('Employee', { limit: 5000 });
  const employee = employees.find(item => String(item.id) === String(employeeRecordId));
  if (!employee || employee.status === 'inactive') {
    return res.status(404).json({ error: 'Active employee was not found.' });
  }
  const normalizedIdentity = normalizeCode(identityCode);
  const allowedCodes = [employee.id, employee.employee_id, employee.qr_code].map(normalizeCode);
  if (!allowedCodes.includes(normalizedIdentity)) {
    return res.status(403).json({ error: 'Employee identity does not match the scanned profile.' });
  }

  const records = await listRecords('EmployeePasskey', {
    filter: { employee_record_id: employee.id },
    limit: 10,
  });
  const stored = records[0];

  if (operation === 'reveal') {
    if (!stored?.passkey_ciphertext) return res.status(404).json({ error: 'No passkey has been set.' });
    return res.status(200).json({ passkey: revealProtectedPasskey(stored.passkey_ciphertext) });
  }

  if (operation !== 'setup' || !validPasskey(passkey)) {
    return res.status(400).json({ error: 'A 4-digit numeric passkey is required.' });
  }

  const protectedPasskey = await protectPasskey(String(passkey));
  const changedAt = new Date().toISOString();
  if (stored) {
    await updateRecord('EmployeePasskey', stored.id, {
      ...protectedPasskey,
      updated_at: changedAt,
    });
  } else {
    await createRecord('EmployeePasskey', {
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
      ...protectedPasskey,
      created_at: changedAt,
      updated_at: changedAt,
    });
  }
  await updateRecord('Employee', employee.id, {
    payslip_passkey_set_at: changedAt,
  });

  return res.status(200).json({ ok: true, set_at: changedAt });
}
