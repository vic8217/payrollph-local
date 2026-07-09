// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { deleteRecord, listRecords, updateRecord } from "@/server/entityStore";
import { prisma } from "@/server/prisma";

const money = (value) => parseFloat((Number(value) || 0).toFixed(2));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id && !session?.user?.email) {
    return res.status(401).json({ error: "Your session could not be verified. Please sign in again." });
  }

  const authenticatedUser = await prisma.appUser.findFirst({
    where: session.user.id
      ? { id: session.user.id }
      : { email: String(session.user.email || "").toLowerCase() },
    select: { id: true, email: true, name: true, role: true },
  });
  const effectiveRole = authenticatedUser?.role || session.user.role;
  if (effectiveRole !== "super_admin") {
    return res.status(403).json({ error: "Only super admins can suspend cash advance deductions." });
  }

  const payrollRecordId = String(req.body?.payroll_record_id || "").trim();
  const payrollPeriodId = String(req.body?.payroll_period_id || "").trim();
  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  if (!payrollRecordId || !payrollPeriodId || !companyProfileId) {
    return res.status(400).json({ error: "Payroll record, payroll period, and company are required." });
  }

  const [period] = await listRecords("PayrollPeriod", {
    filter: { id: payrollPeriodId, company_profile_id: companyProfileId },
    limit: 1,
  });
  if (!period) return res.status(404).json({ error: "Payroll period not found." });
  if (period.status === "released") {
    return res.status(400).json({ error: "Released payroll periods can no longer be changed." });
  }

  const [record] = await listRecords("PayrollRecord", {
    filter: { id: payrollRecordId, payroll_period_id: payrollPeriodId, company_profile_id: companyProfileId },
    limit: 1,
  });
  if (!record) return res.status(404).json({ error: "Payroll record not found." });
  if (record.status === "released") {
    return res.status(400).json({ error: "Released payroll records can no longer be changed." });
  }
  if (record.cash_advance_deduction_suspended) {
    return res.status(400).json({ error: "Cash advance deduction is already suspended for this employee and period." });
  }

  const deductionAmount = money(record.cash_advance_deduction);
  const deductionDetails = Array.isArray(record.cash_advance_deduction_details)
    ? record.cash_advance_deduction_details
    : [];
  if (!(deductionAmount > 0) || deductionDetails.length === 0) {
    return res.status(400).json({ error: "This payroll record has no cash advance deduction to suspend." });
  }

  const advances = await listRecords("CashAdvance", {
    filter: { company_profile_id: companyProfileId },
    limit: 5000,
  });

  for (const detail of deductionDetails) {
    if (!detail.cash_advance_id) continue;
    const ledgerRows = await listRecords("CashAdvanceLedger", {
      filter: {
        company_profile_id: companyProfileId,
        payroll_period_id: payrollPeriodId,
        cash_advance_id: detail.cash_advance_id,
        transaction_type: "deduction",
      },
      limit: 100,
    });
    await Promise.all(ledgerRows.map(row => deleteRecord("CashAdvanceLedger", row.id)));

    const advance = advances.find(item => String(item.id) === String(detail.cash_advance_id));
    const balanceBefore = money(detail.balance_before);
    const total = Number(detail.deduction_total) || Number(advance?.deduction_payroll_periods) || 1;
    const deductionNo = Number(detail.deduction_number) || 1;
    const restoredRemaining = Math.max(1, total - deductionNo + 1);
    if (advance) {
      await updateRecord("CashAdvance", advance.id, {
        remaining_balance: balanceBefore,
        deduction_periods_remaining: restoredRemaining,
        status: balanceBefore > 0 ? "approved" : advance.status,
        payroll_period_id: String(advance.payroll_period_id || "") === payrollPeriodId ? null : advance.payroll_period_id,
      });
    }
  }

  const nextTotalDeductions = money((Number(record.total_deductions) || 0) - deductionAmount);
  const nextNetPay = money((Number(record.net_pay) || 0) + deductionAmount);
  const reviewer = authenticatedUser?.name || authenticatedUser?.email || session.user.email || "super_admin";
  const updatedRecord = await updateRecord("PayrollRecord", record.id, {
    cash_advance_deduction: 0,
    cash_advance_deduction_details: [],
    cash_advance_deduction_suspended: true,
    cash_advance_suspended_amount: deductionAmount,
    cash_advance_suspended_details: deductionDetails,
    cash_advance_suspended_at: new Date().toISOString(),
    cash_advance_suspended_by: reviewer,
    total_deductions: nextTotalDeductions,
    net_pay: nextNetPay,
  });

  const periodRecords = await listRecords("PayrollRecord", {
    filter: { payroll_period_id: payrollPeriodId, company_profile_id: companyProfileId },
    limit: 5000,
  });
  const adjustedRecords = periodRecords.map(item => String(item.id) === String(updatedRecord.id) ? updatedRecord : item);
  const updatedPeriod = await updateRecord("PayrollPeriod", period.id, {
    total_deductions: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.total_deductions) || 0), 0)),
    total_net: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.net_pay) || 0), 0)),
    total_gross: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.gross_pay) || 0), 0)),
  });

  return res.status(200).json({ record: updatedRecord, period: updatedPeriod });
}
