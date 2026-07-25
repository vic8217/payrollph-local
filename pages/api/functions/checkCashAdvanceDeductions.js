// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords } from "@/server/entityStore";

const money = (value) => Number((Number(value) || 0).toFixed(2));
const normalizedId = (value) => String(value ?? "").trim().toLowerCase();
const dateOnly = (value) => String(value || "").slice(0, 10);

function advanceAvailableDate(advance) {
  if (advance.advance_type === "beginning_balance") {
    return dateOnly(advance.created_date || advance.approved_date || advance.request_date);
  }
  return dateOnly(advance.approved_date || advance.created_date || advance.request_date);
}

function advanceBalance(advance, ledgerRows) {
  if (advance.remaining_balance != null) return money(advance.remaining_balance);
  const principal = money(advance.amount_approved || advance.amount_requested || advance.beginning_balance);
  const deducted = money(ledgerRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  return money(Math.max(principal - deducted, 0));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id && !session?.user?.email) {
    return res.status(401).json({ error: "Your session could not be verified. Please sign in again." });
  }
  if (!["super_admin", "admin", "user"].includes(session.user.role)) {
    return res.status(403).json({ error: "You are not allowed to check cash advance deductions." });
  }

  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  if (!companyProfileId) {
    return res.status(400).json({ error: "Company is required." });
  }

  const [advances, periods, payrollRecords, ledger] = await Promise.all([
    listRecords("CashAdvance", { filter: { company_profile_id: companyProfileId } }),
    listRecords("PayrollPeriod", { filter: { company_profile_id: companyProfileId }, sort: "start_date" }),
    listRecords("PayrollRecord", { filter: { company_profile_id: companyProfileId } }),
    listRecords("CashAdvanceLedger", {
      filter: { company_profile_id: companyProfileId, transaction_type: "deduction" },
    }),
  ]);

  const periodById = new Map(periods.map(period => [normalizedId(period.id), period]));
  const recordsByEmployee = new Map();
  payrollRecords.forEach(record => {
    const key = normalizedId(record.employee_id);
    if (!recordsByEmployee.has(key)) recordsByEmployee.set(key, []);
    recordsByEmployee.get(key).push(record);
  });

  const checks = advances
    .filter(advance => ["approved", "deducted"].includes(advance.status))
    .map(advance => {
      const advanceId = normalizedId(advance.id);
      const employeeId = normalizedId(advance.employee_id);
      const advanceLedger = ledger.filter(row => normalizedId(row.cash_advance_id) === advanceId);
      const balance = advanceBalance(advance, advanceLedger);
      const weeklyDeduction = money(advance.deduction_amount_per_payroll);
      const availableDate = advanceAvailableDate(advance);
      const employeeRecords = recordsByEmployee.get(employeeId) || [];
      const eligible = employeeRecords
        .map(record => ({ record, period: periodById.get(normalizedId(record.payroll_period_id)) }))
        .filter(({ record, period }) =>
          period &&
          !period.cash_advance_deduction_suspended &&
          !record.cash_advance_deduction_suspended &&
          (!availableDate || dateOnly(period.start_date) > availableDate)
        )
        .sort((a, b) => dateOnly(a.period.start_date).localeCompare(dateOnly(b.period.start_date)));

      const missingPeriods = [];
      let deductedPeriods = 0;
      eligible.forEach(({ record, period }) => {
        const detail = (Array.isArray(record.cash_advance_deduction_details)
          ? record.cash_advance_deduction_details
          : []).find(item => normalizedId(item.cash_advance_id) === advanceId && Number(item.amount) > 0);
        const ledgerRow = advanceLedger.find(row =>
          normalizedId(row.payroll_period_id) === normalizedId(period.id) &&
          Number(row.amount) > 0 &&
          row.source !== "manual_adjustment"
        );
        if (detail || ledgerRow) {
          deductedPeriods += 1;
        } else if (balance > 0) {
          missingPeriods.push({
            payroll_period_id: period.id,
            period_name: period.period_name,
            start_date: period.start_date,
            end_date: period.end_date,
            payroll_record_id: record.id,
          });
        }
      });

      let status = "verified";
      if (balance > 0 && !(weeklyDeduction > 0)) status = "missing_setup";
      else if (missingPeriods.length > 0) status = "missing_deduction";
      else if (balance > 0 && eligible.length === 0) status = "awaiting_payroll";

      return {
        cash_advance_id: advance.id,
        employee_id: advance.employee_id,
        employee_name: advance.employee_name || advance.employee_id,
        advance_type: advance.advance_type,
        request_date: advance.request_date || advance.approved_date || availableDate,
        balance,
        weekly_deduction: weeklyDeduction,
        status,
        eligible_payroll_periods: eligible.length,
        deducted_payroll_periods: deductedPeriods,
        missing_periods: missingPeriods,
      };
    })
    .filter(check => check.balance > 0 || check.eligible_payroll_periods > 0)
    .sort((a, b) => String(a.employee_name).localeCompare(String(b.employee_name)));

  return res.status(200).json({
    checked_at: new Date().toISOString(),
    summary: {
      advances_checked: checks.length,
      properly_deducted: checks.filter(check => check.status === "verified").length,
      missing_deductions: checks.filter(check => check.status === "missing_deduction").length,
      missing_setup: checks.filter(check => check.status === "missing_setup").length,
      awaiting_payroll: checks.filter(check => check.status === "awaiting_payroll").length,
    },
    checks,
  });
}
