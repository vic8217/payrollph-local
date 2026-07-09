// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, deleteRecord, listRecords, updateRecord } from "@/server/entityStore";
import { prisma } from "@/server/prisma";

const money = (value) => parseFloat((Number(value) || 0).toFixed(2));

async function currentUser(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id && !session?.user?.email) return { session, user: null };

  const user = await prisma.appUser.findFirst({
    where: session.user.id
      ? { id: session.user.id }
      : { email: String(session.user.email || "").toLowerCase() },
    select: { id: true, email: true, name: true, role: true },
  });

  return { session, user };
}

function reviewerName(session, user) {
  return user?.name || user?.email || session?.user?.email || "super_admin";
}

async function restoreRecordCashAdvance({ record, period, companyProfileId, advances, reviewer, timestamp }) {
  const deductionAmount = money(record.cash_advance_deduction);
  const deductionDetails = Array.isArray(record.cash_advance_deduction_details)
    ? record.cash_advance_deduction_details
    : [];

  if (deductionAmount > 0 && deductionDetails.length > 0) {
    for (const detail of deductionDetails) {
      if (!detail.cash_advance_id) continue;
      const ledgerRows = await listRecords("CashAdvanceLedger", {
        filter: {
          company_profile_id: companyProfileId,
          payroll_period_id: period.id,
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
          payroll_period_id: String(advance.payroll_period_id || "") === String(period.id) ? null : advance.payroll_period_id,
        });
      }
    }
  }

  return updateRecord("PayrollRecord", record.id, {
    cash_advance_deduction: 0,
    cash_advance_deduction_details: [],
    cash_advance_deduction_suspended: true,
    cash_advance_suspended_amount: money((Number(record.cash_advance_suspended_amount) || 0) + deductionAmount),
    cash_advance_suspended_details: [
      ...(Array.isArray(record.cash_advance_suspended_details) ? record.cash_advance_suspended_details : []),
      ...deductionDetails,
    ],
    cash_advance_suspended_at: record.cash_advance_suspended_at || timestamp,
    cash_advance_suspended_by: record.cash_advance_suspended_by || reviewer,
    total_deductions: money((Number(record.total_deductions) || 0) - deductionAmount),
    net_pay: money((Number(record.net_pay) || 0) + deductionAmount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { session, user } = await currentUser(req, res);
  if (!session?.user?.id && !session?.user?.email) {
    return res.status(401).json({ error: "Your session could not be verified. Please sign in again." });
  }

  const effectiveRole = user?.role || session.user.role;
  if (effectiveRole !== "super_admin") {
    return res.status(403).json({ error: "Only super admins can suspend cash advance deductions." });
  }

  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  const payrollPeriodId = String(req.body?.payroll_period_id || "").trim();
  const periodName = String(req.body?.period_name || "").trim();
  const startDate = String(req.body?.start_date || "").slice(0, 10);
  const endDate = String(req.body?.end_date || "").slice(0, 10);

  if (!companyProfileId || (!payrollPeriodId && (!periodName || !startDate || !endDate))) {
    return res.status(400).json({ error: "Company and payroll period details are required." });
  }

  let period;
  if (payrollPeriodId) {
    [period] = await listRecords("PayrollPeriod", {
      filter: { id: payrollPeriodId, company_profile_id: companyProfileId },
      limit: 1,
    });
  } else {
    [period] = await listRecords("PayrollPeriod", {
      filter: { start_date: startDate, end_date: endDate, company_profile_id: companyProfileId },
      limit: 1,
    });
  }

  if (period?.status === "released") {
    return res.status(400).json({ error: "Released payroll periods can no longer be changed." });
  }

  const timestamp = new Date().toISOString();
  const reviewer = reviewerName(session, user);
  if (!period) {
    period = await createRecord("PayrollPeriod", {
      period_name: periodName,
      start_date: startDate,
      end_date: endDate,
      status: "processing",
      company_profile_id: companyProfileId,
    });
  }

  const records = await listRecords("PayrollRecord", {
    filter: { payroll_period_id: period.id, company_profile_id: companyProfileId },
    limit: 5000,
  });
  const advances = await listRecords("CashAdvance", {
    filter: { company_profile_id: companyProfileId },
    limit: 5000,
  });

  const updatedRecords = [];
  for (const record of records) {
    if (record.status === "released") continue;
    updatedRecords.push(await restoreRecordCashAdvance({
      record,
      period,
      companyProfileId,
      advances,
      reviewer,
      timestamp,
    }));
  }

  const adjustedRecords = records.map(record =>
    updatedRecords.find(updated => String(updated.id) === String(record.id)) || record
  );
  const updatedPeriod = await updateRecord("PayrollPeriod", period.id, {
    cash_advance_deduction_suspended: true,
    cash_advance_suspended_scope: "all_employees",
    cash_advance_suspended_at: period.cash_advance_suspended_at || timestamp,
    cash_advance_suspended_by: period.cash_advance_suspended_by || reviewer,
    ...(adjustedRecords.length > 0 ? {
      total_deductions: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.total_deductions) || 0), 0)),
      total_net: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.net_pay) || 0), 0)),
      total_gross: money(adjustedRecords.reduce((sum, item) => sum + (Number(item.gross_pay) || 0), 0)),
    } : {}),
  });

  return res.status(200).json({ period: updatedPeriod, records: updatedRecords });
}
