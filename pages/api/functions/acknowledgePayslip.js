// @ts-nocheck
import { createRecord, listRecords, updateRecord } from '@/server/entityStore';
import { verifyPasskey } from '@/server/employeePasskey';
import { prisma } from '@/server/prisma';

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

  const {
    payroll_record_id: payrollRecordId,
    employee_record_id: employeeRecordId,
    qr_code: qrCode,
    passkey,
    photo_url: photoUrl,
    face_verification_log_id: faceVerificationLogId,
    face_verification_result: faceVerificationResult,
    face_verification_confidence: faceVerificationConfidence,
  } = req.body || {};
  if (!payrollRecordId || !employeeRecordId || !photoUrl) {
    return res.status(400).json({ error: 'Payslip, employee, and employee photo are required.' });
  }

  const employees = await listRecords('Employee', { limit: 5000 });
  const employee = employees.find(item => String(item.id) === String(employeeRecordId));
  if (!employee) return res.status(404).json({ error: 'Employee was not found.' });

  let receiptMethod = 'qr_passkey_photo';
  let faceLog = null;
  const hasFaceVerification = faceVerificationLogId || faceVerificationResult === 'verified';

  if (hasFaceVerification) {
    if (!faceVerificationLogId) {
      return res.status(400).json({ error: 'Face verification log is required for face acknowledgement.' });
    }
    faceLog = await prisma.employeeFaceVerificationLog.findUnique({
      where: { id: String(faceVerificationLogId) },
    });
    const logAgeMs = faceLog ? Date.now() - new Date(faceLog.createdAt).getTime() : Infinity;
    const isRecent = Number.isFinite(logAgeMs) && logAgeMs <= 10 * 60 * 1000;
    const logMatchesEmployee =
      faceLog &&
      faceLog.result === 'verified' &&
      String(faceLog.employeeRecordId || '') === String(employee.id || '') &&
      String(faceLog.employeeId || '').toLowerCase() === String(employee.employee_id || '').toLowerCase() &&
      String(faceLog.companyProfileId || '') === String(employee.company_profile_id || '') &&
      isRecent;
    if (!logMatchesEmployee) {
      return res.status(403).json({ error: 'Recent verified face acknowledgement was not found for this employee.' });
    }
    receiptMethod = 'face_recognition';
  } else {
    if (!qrCode || !passkey) {
      return res.status(400).json({ error: 'QR code and passkey are required for fallback acknowledgement.' });
    }
    const scanned = normalizeCode(qrCode);
    const employeeCodes = [employee.employee_id, employee.qr_code, employee.id].map(normalizeCode);
    if (!employeeCodes.includes(scanned)) {
      return res.status(403).json({ error: 'Scanned QR code does not match this employee.' });
    }

    const passkeys = await listRecords('EmployeePasskey', {
      filter: { employee_record_id: employee.id },
      limit: 10,
    });
    if (!passkeys[0] || !(await verifyPasskey(String(passkey), passkeys[0].passkey_hash))) {
      return res.status(403).json({ error: 'Incorrect employee passkey.' });
    }
  }

  const payrollRecords = await listRecords('PayrollRecord', { limit: 10000 });
  const payrollRecord = payrollRecords.find(item => String(item.id) === String(payrollRecordId));
  if (!payrollRecord || String(payrollRecord.employee_id) !== String(employee.employee_id)) {
    return res.status(404).json({ error: 'Payslip does not belong to this employee.' });
  }
  const periods = await listRecords('PayrollPeriod', { limit: 5000 });
  const period = periods.find(item => String(item.id) === String(payrollRecord.payroll_period_id));
  if (payrollRecord.status !== 'released' && period?.status !== 'released') {
    return res.status(409).json({ error: 'Payslip must be released before it can be acknowledged.' });
  }
  if (payrollRecord.payslip_acknowledged_at) {
    return res.status(409).json({ error: 'This payslip has already been acknowledged.' });
  }

  const acknowledgedAt = new Date().toISOString();
  const updated = await updateRecord('PayrollRecord', payrollRecord.id, {
    payslip_acknowledged: true,
    payslip_acknowledged_at: acknowledgedAt,
    payslip_acknowledged_by_employee_record_id: employee.id,
    payslip_acknowledgement_photo_url: photoUrl,
    payslip_acknowledgement_qr_verified: receiptMethod === 'qr_passkey_photo',
    payslip_acknowledgement_method: receiptMethod,
    payslip_acknowledgement_face_verified: receiptMethod === 'face_recognition',
    payslip_acknowledgement_face_verification_log_id: faceLog?.id || null,
    payslip_acknowledgement_face_confidence: faceVerificationConfidence ?? faceLog?.confidenceScore ?? null,
    payslip_acknowledgement_user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  });
  await createRecord('PasscodeAuditLog', {
    company_profile_id: employee.company_profile_id,
    source_entity: 'PayrollRecord',
    source_record_id: payrollRecord.id,
    action: 'payslip_acknowledged',
    occurred_at: acknowledgedAt,
    authorized_by: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    reason: receiptMethod === 'face_recognition'
      ? 'Employee face recognition and liveness verified'
      : 'Employee QR code, passkey, and identity photo verified',
    summary: `Payslip acknowledged for ${payrollRecord.period_name || 'payroll period'}`,
    employee_id: employee.employee_id,
    employee_name: payrollRecord.employee_name,
    record_date: acknowledgedAt.slice(0, 10),
  });

  return res.status(200).json({ record: updated });
}
