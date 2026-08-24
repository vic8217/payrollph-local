import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '@/server/prisma';
import { listRecords } from '@/server/entityStore';

const allowedRoles = new Set(['super_admin', 'admin', 'hr_staff', 'user']);
const companiesFor = user => user.role === 'super_admin' ? null : (user.company_profile_ids || (user.company_profile_id ? [user.company_profile_id] : []));
const hasCompany = (user, companyId) => user.role === 'super_admin' || companiesFor(user).includes(companyId);

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  const user = session?.user;
  const input = req.method === 'GET' ? req.query : req.body || {};
  if (!user) return res.status(401).json({ error: 'Authentication is required.' });
  if (!allowedRoles.has(user.role)) return res.status(403).json({ error: 'You are not authorized to manage daily variance notes.' });
  const companyProfileId = String(input.companyProfileId || '');
  const payrollPeriodId = String(input.payrollPeriodId || '');
  const employeeId = String(input.employeeId || '');
  if (!companyProfileId || !payrollPeriodId || !hasCompany(user, companyProfileId)) return res.status(403).json({ error: 'Invalid company scope.' });
  try {
    const [period, employee] = await Promise.all([
      listRecords('PayrollPeriod', { filter: { id: payrollPeriodId, company_profile_id: companyProfileId }, limit: 1 }),
      employeeId ? listRecords('Employee', { filter: { employee_id: employeeId, company_profile_id: companyProfileId }, limit: 1 }) : Promise.resolve([{}]),
    ]);
    if (!period[0] || !employee[0]) return res.status(400).json({ error: 'Invalid payroll-period or employee scope.' });
    if (req.method === 'GET') {
      return res.status(200).json(await prisma.payrollReconciliationDailyVarianceNote.findMany({ where: { companyProfileId, payrollPeriodId, ...(employeeId ? { employeeId } : {}) }, orderBy: { attendanceDate: 'asc' } }));
    }
    if (!employeeId) return res.status(400).json({ error: 'Employee scope is required to save a daily note.' });
    const attendanceDate = new Date(`${String(input.attendanceDate || '')}T00:00:00.000Z`);
    const note = String(input.note || '').trim();
    if (Number.isNaN(attendanceDate.getTime()) || !note) return res.status(400).json({ error: 'Attendance date and note are required.' });
    const start = String(period[0].start_date); const end = String(period[0].end_date); const date = attendanceDate.toISOString().slice(0, 10);
    if (date < start || date > end) return res.status(400).json({ error: 'Attendance date is outside this payroll period.' });
    const where = { companyProfileId_payrollPeriodId_employeeId_attendanceDate: { companyProfileId, payrollPeriodId, employeeId, attendanceDate } };
    const record = await prisma.payrollReconciliationDailyVarianceNote.upsert({ where, create: { companyProfileId, payrollPeriodId, employeeId, attendanceDate, note, createdByUserId: user.id }, update: { note, updatedByUserId: user.id } });
    return res.status(200).json(record);
  } catch (error) {
    // Notes supplement the reconciliation screen. A missing local migration or
    // an unavailable notes store must not make the primary reconciliation view
    // retry/fail in a loop. Reads degrade to an empty note list; writes remain
    // explicit failures so no note is silently lost.
    if (req.method === 'GET') return res.status(200).json([]);
    return res.status(500).json({ error: 'Unable to save daily variance note.' });
  }
}
