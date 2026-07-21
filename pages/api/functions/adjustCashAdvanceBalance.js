// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { prisma } from "@/server/prisma";
import { manilaDateString } from "@/lib/dateUtils";

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
  if (!["super_admin", "admin", "user"].includes(effectiveRole)) {
    return res.status(403).json({ error: "You are not allowed to adjust cash advances." });
  }

  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  const cashAdvanceId = String(req.body?.cash_advance_id || "").trim();
  const adjustmentType = String(req.body?.adjustment_type || "").trim();
  const amount = money(req.body?.amount);
  const weeklyDeduction = money(req.body?.weekly_deduction);
  const reason = String(req.body?.reason || "").trim();
  const hrPasscode = String(req.body?.hr_passcode || "").trim();
  const adminPasscode = String(req.body?.admin_passcode || "").trim();

  if (!companyProfileId || !cashAdvanceId) {
    return res.status(400).json({ error: "Company and cash advance are required." });
  }
  if (!["increase", "decrease"].includes(adjustmentType)) {
    return res.status(400).json({ error: "Choose whether to increase or decrease the balance." });
  }
  if (!(amount > 0)) {
    return res.status(400).json({ error: "Enter a valid adjustment amount." });
  }
  if (!(weeklyDeduction > 0)) {
    return res.status(400).json({ error: "Weekly deduction amount is required before saving the adjustment." });
  }
  if (reason.length < 3) {
    return res.status(400).json({ error: "Enter a reason for the cash advance adjustment." });
  }
  if (!hrPasscode || !adminPasscode) {
    return res.status(400).json({ error: "Both HR Officer and Admin passcodes are required." });
  }

  const passcodes = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyProfileId, date: manilaDateString() },
    limit: 10,
  });
  const todayPasscode = passcodes[0];
  if (!todayPasscode) {
    return res.status(400).json({ error: "No daily passcodes have been generated for today." });
  }
  if (String(todayPasscode.passcode || "") !== hrPasscode) {
    return res.status(403).json({ error: "Incorrect HR Officer passcode." });
  }
  if (String(todayPasscode.manager_passcode || "") !== adminPasscode) {
    return res.status(403).json({ error: "Incorrect Admin passcode." });
  }

  const [advance] = await listRecords("CashAdvance", {
    filter: { id: cashAdvanceId, company_profile_id: companyProfileId },
    limit: 1,
  });
  if (!advance) return res.status(404).json({ error: "Cash advance not found." });
  if (advance.advance_type !== "beginning_balance") {
    return res.status(400).json({ error: "Only the employee's beginning cash advance balance can be adjusted." });
  }
  if (!["approved", "deducted"].includes(advance.status)) {
    return res.status(400).json({ error: "Only approved or deducted cash advances can be adjusted." });
  }

  const balanceBefore = money(advance.remaining_balance ?? advance.amount_approved ?? advance.amount_requested ?? 0);
  if (adjustmentType === "decrease" && amount > balanceBefore) {
    return res.status(400).json({ error: "Decrease amount cannot be greater than the current balance." });
  }

  const balanceAfter = adjustmentType === "increase"
    ? money(balanceBefore + amount)
    : money(balanceBefore - amount);
  const adjustedAt = new Date().toISOString();
  const adjustedBy = authenticatedUser?.name || authenticatedUser?.email || session.user.name || session.user.email || "unknown";
  const nextStatus = balanceAfter > 0 ? "approved" : "deducted";
  const currentApproved = money(advance.amount_approved || advance.amount_requested || balanceBefore);
  const deductionRows = await listRecords("CashAdvanceLedger", {
    filter: { cash_advance_id: advance.id, transaction_type: "deduction" },
    limit: 1000,
  });
  const payrollDeductionsCompleted = deductionRows.filter(row => row.source !== "manual_adjustment").length;
  const remainingPayrollPeriods = balanceAfter > 0 ? Math.ceil(balanceAfter / weeklyDeduction) : 0;
  const totalPayrollPeriods = payrollDeductionsCompleted + remainingPayrollPeriods;

  const updatedAdvance = await updateRecord("CashAdvance", advance.id, {
    remaining_balance: balanceAfter,
    amount_approved: adjustmentType === "increase" ? money(currentApproved + amount) : currentApproved,
    status: nextStatus,
    deduction_amount_per_payroll: weeklyDeduction,
    deduction_payroll_periods: totalPayrollPeriods,
    deduction_periods_remaining: remainingPayrollPeriods,
    manual_adjustment_at: adjustedAt,
    manual_adjustment_by: adjustedBy,
    manual_adjustment_reason: reason,
  });

  const [employee] = await listRecords("Employee", {
    filter: { employee_id: advance.employee_id, company_profile_id: companyProfileId },
    limit: 1,
  });
  if (employee) {
    await updateRecord("Employee", employee.id, {
      cash_advance_beginning_balance: balanceAfter,
      cash_advance_weekly_deduction: weeklyDeduction,
    });
  }

  const transactionType = adjustmentType === "increase" ? "addition" : "deduction";
  const ledger = await createRecord("CashAdvanceLedger", {
    cash_advance_id: advance.id,
    employee_id: advance.employee_id,
    employee_name: advance.employee_name,
    company_profile_id: companyProfileId,
    transaction_date: manilaDateString(),
    transaction_type: transactionType,
    source: "manual_adjustment",
    description: `Manual CA balance ${adjustmentType}: ${reason}`,
    amount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    deduction_number: null,
    deduction_total: totalPayrollPeriods || null,
  });

  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyProfileId,
    source_entity: "CashAdvance",
    source_record_id: advance.id,
    action: "cash_advance_adjusted",
    occurred_at: adjustedAt,
    authorized_by: adjustedBy,
    reason,
    summary: `Beginning cash advance balance ${adjustmentType}d by ₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}. Balance: ₱${balanceBefore.toLocaleString("en-PH", { minimumFractionDigits: 2 })} to ₱${balanceAfter.toLocaleString("en-PH", { minimumFractionDigits: 2 })}; weekly deduction: ₱${weeklyDeduction.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    employee_id: advance.employee_id,
    employee_name: advance.employee_name,
    amount,
    record_date: manilaDateString(),
  });

  return res.status(200).json({ advance: updatedAdvance, ledger });
}
