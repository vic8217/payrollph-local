// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listRecords } from '@/server/entityStore';
import { payrollAllocation } from '@/lib/agencyPayroll';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || !['super_admin', 'admin', 'user'].includes(session.user.role)) return res.status(403).json({ error: 'HR or administrator access is required.' });
  const companyId = String(req.body?.company_profile_id || '');
  const periodId = String(req.body?.payroll_period_id || '');
  const assigned = session.user.company_profile_ids || (session.user.company_profile_id ? [session.user.company_profile_id] : []);
  if (session.user.role !== 'super_admin' && !assigned.includes(companyId)) return res.status(403).json({ error: 'You cannot view payroll allocation for this company.' });
  if (!companyId || !periodId) return res.status(400).json({ error: 'Company and payroll period are required.' });
  const [period] = await listRecords('PayrollPeriod', { filter: { id: periodId, company_profile_id: companyId }, limit: 1 });
  if (!period) return res.status(404).json({ error: 'Payroll period not found.' });
  const records = await listRecords('PayrollRecord', { filter: { company_profile_id: companyId, payroll_period_id: periodId }, limit: 5000 });
  return res.status(200).json({ periodId, status: period.status, ...payrollAllocation(records) });
}
