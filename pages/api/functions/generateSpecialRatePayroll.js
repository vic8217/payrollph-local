// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, deleteRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { prisma } from "@/server/prisma";

const money = value => Number((Number(value) || 0).toFixed(2));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const actor = await prisma.appUser.findFirst({
    where: session?.user?.id ? { id: session.user.id } : { email: String(session?.user?.email || "").toLowerCase() },
  });
  if (!actor || !["super_admin", "admin"].includes(actor.role)) {
    return res.status(403).json({ error: "Only administrators can generate special-rate payroll." });
  }

  const companyId = String(req.body?.company_profile_id || "").trim();
  const startDate = String(req.body?.start_date || "").slice(0, 10);
  const endDate = String(req.body?.end_date || "").slice(0, 10);
  const managerPasscode = String(req.body?.manager_passcode || "").trim();
  if (!companyId || !startDate || !endDate || startDate > endDate || !managerPasscode) {
    return res.status(400).json({ error: "Company, valid payroll dates, and Admin Manager passcode are required." });
  }

  const [code] = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyId, date: manilaDateString() },
    limit: 1,
  });
  if (!code) return res.status(400).json({ error: "No Admin Manager passcode has been generated for today." });
  if (String(code.manager_passcode || "") !== managerPasscode) {
    return res.status(403).json({ error: "Incorrect Admin Manager passcode." });
  }

  const employees = (await listRecords("Employee", { filter: { company_profile_id: companyId } }))
    .filter(employee => employee.status === "active" && employee.special_rate_enabled);
  if (employees.length === 0) return res.status(400).json({ error: "No active special-rate employees were found." });

  const attendance = (await listRecords("SpecialRateAttendance", { filter: { company_profile_id: companyId } }))
    .filter(row => row.date >= startDate && row.date <= endDate);
  const periodName = `${startDate} to ${endDate}`;
  const [existingPeriod] = await listRecords("SpecialRatePayrollPeriod", {
    filter: { company_profile_id: companyId, start_date: startDate, end_date: endDate },
    limit: 1,
  });
  const generatedAt = new Date().toISOString();
  const generatedBy = actor.name || actor.email;
  const periodPayload = {
    company_profile_id: companyId,
    period_name: periodName,
    start_date: startDate,
    end_date: endDate,
    status: "computed",
    generated_at: generatedAt,
    generated_by: generatedBy,
  };
  const period = existingPeriod
    ? await updateRecord("SpecialRatePayrollPeriod", existingPeriod.id, periodPayload)
    : await createRecord("SpecialRatePayrollPeriod", periodPayload);
  const existingRecords = await listRecords("SpecialRatePayrollRecord", {
    filter: { company_profile_id: companyId, payroll_period_id: period.id },
  });
  const currentEmployeeIds = new Set(employees.map(employee => String(employee.id)));
  await Promise.all(existingRecords
    .filter(record => !currentEmployeeIds.has(String(record.employee_record_id)))
    .map(record => deleteRecord("SpecialRatePayrollRecord", record.id)));

  const records = [];
  for (const employee of employees) {
    const rows = attendance.filter(row => String(row.employee_record_id) === String(employee.id));
    const creditedDays = Number(rows.reduce((sum, row) => sum + (Number(row.credited_days) || 0), 0).toFixed(2));
    const presentDays = rows.filter(row => row.status === "present").length;
    const halfDays = rows.filter(row => row.status === "half_day").length;
    const absentDays = rows.filter(row => row.status === "absent").length;
    const fixedDailyFee = money(employee.special_fixed_daily_fee);
    const grossPay = money(fixedDailyFee * creditedDays);
    const payload = {
      company_profile_id: companyId,
      payroll_period_id: period.id,
      period_name: periodName,
      start_date: startDate,
      end_date: endDate,
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "),
      fixed_daily_fee: fixedDailyFee,
      present_days: presentDays,
      half_days: halfDays,
      absent_days: absentDays,
      credited_days: creditedDays,
      gross_pay: grossPay,
      total_deductions: 0,
      net_pay: grossPay,
      status: "computed",
      computed_at: generatedAt,
      computed_by: generatedBy,
    };
    const existing = existingRecords.find(record => String(record.employee_record_id) === String(employee.id));
    records.push(existing
      ? await updateRecord("SpecialRatePayrollRecord", existing.id, payload)
      : await createRecord("SpecialRatePayrollRecord", payload));
  }

  const totals = {
    employee_count: records.length,
    total_credited_days: Number(records.reduce((sum, record) => sum + (Number(record.credited_days) || 0), 0).toFixed(2)),
    total_gross: money(records.reduce((sum, record) => sum + (Number(record.gross_pay) || 0), 0)),
    total_net: money(records.reduce((sum, record) => sum + (Number(record.net_pay) || 0), 0)),
  };
  const updatedPeriod = await updateRecord("SpecialRatePayrollPeriod", period.id, totals);

  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyId,
    source_entity: "SpecialRatePayrollPeriod",
    source_record_id: period.id,
    action: "special_rate_payroll_generated",
    occurred_at: generatedAt,
    authorized_by: generatedBy,
    reason: `Confidential special-rate payroll generated for ${periodName}`,
    summary: `${records.length} employee record(s); total net ₱${totals.total_net.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    record_date: endDate,
  });

  return res.status(200).json({ period: updatedPeriod, records });
}
