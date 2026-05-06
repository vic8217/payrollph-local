import { appApi } from '@/lib/appApi';
import { computeThirteenthMonthPay, computeSeparationPay } from '@/lib/benefitsComputation';

export default async function handler(req, res) {
  const { method, body, query } = req;
  const { action, companyId, employeeId, year } = query;

  if (method !== 'POST' && method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (action === 'compute-13th-month') {
      // GET: /api/benefits/compute-13th-month?companyId=xxx&year=2026
      if (method === 'GET') {
        const payrollYear = parseInt(year || new Date().getFullYear());
        const startDate = `${payrollYear}-01-01`;
        const endDate = `${payrollYear}-12-31`;

        const employees = await appApi.entities.Employee.filter({
          company_profile_id: companyId,
          is_active: true,
        });

        const result = [];

        for (const emp of employees) {
          // Get all payroll records for this employee in the year
          const payrollRecords = await appApi.entities.PayrollRecord.filter({
            employee_id: emp.employee_id,
            company_profile_id: companyId,
          });

          const yearPayroll = payrollRecords.filter(
            (p) => p.start_date >= startDate && p.start_date <= endDate
          );

          // Get active cash advances
          const cashAdvances = await appApi.entities.CashAdvance.filter({
            employee_id: emp.employee_id,
            company_profile_id: companyId,
          });

          const computation = computeThirteenthMonthPay(emp, yearPayroll, cashAdvances);
          result.push(computation);
        }

        return res.status(200).json({ success: true, data: result });
      }

      // POST: Save 13th month pay record
      if (method === 'POST') {
        const { computations, payout_month } = body;
        const records = [];

        for (const computation of computations) {
          const record = await appApi.entities.ThirteenthMonthPay.create({
            ...computation,
            company_profile_id: companyId,
            payout_month: payout_month || '12', // December by default
            status: 'draft',
          });
          records.push(record);
        }

        return res.status(200).json({ success: true, data: records });
      }
    }

    if (action === 'compute-separation') {
      // POST: /api/benefits/compute-separation
      // Body: { employeeId, separationDate, terminationType, companyId }
      if (method === 'POST') {
        const { employeeId: empId, separationDate, terminationType } = body;

        const employee = await appApi.entities.Employee.findOne({
          employee_id: empId,
        });

        if (!employee) {
          return res.status(404).json({ error: 'Employee not found' });
        }

        const cashAdvances = await appApi.entities.CashAdvance.filter({
          employee_id: empId,
          company_profile_id: companyId,
        });

        const computation = computeSeparationPay(
          employee,
          separationDate,
          terminationType,
          cashAdvances
        );

        return res.status(200).json({ success: true, data: computation });
      }

      // GET: Retrieve separation pay records
      if (method === 'GET') {
        const records = await appApi.entities.SeparationPay.filter({
          company_profile_id: companyId,
          ...(employeeId && { employee_id: employeeId }),
        });

        return res.status(200).json({ success: true, data: records });
      }
    }

    if (action === 'save-separation') {
      // POST: Save separation pay record
      if (method === 'POST') {
        const { computation } = body;

        const record = await appApi.entities.SeparationPay.create({
          ...computation,
          company_profile_id: companyId,
          status: 'draft',
          created_at: new Date().toISOString(),
        });

        return res.status(200).json({ success: true, data: record });
      }
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error('Benefits API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
