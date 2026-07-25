// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { prisma } from "@/server/prisma";

const VALID_STATUSES = new Set(["present", "half_day", "absent"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const actor = await prisma.appUser.findFirst({
    where: session?.user?.id ? { id: session.user.id } : { email: String(session?.user?.email || "").toLowerCase() },
  });
  if (!actor || !["super_admin", "admin"].includes(actor.role)) {
    return res.status(403).json({ error: "Only administrators can manage special-rate attendance." });
  }

  const companyId = String(req.body?.company_profile_id || "").trim();
  const date = String(req.body?.date || "").slice(0, 10);
  const managerPasscode = String(req.body?.manager_passcode || "").trim();
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!companyId || !date || entries.length === 0 || !managerPasscode) {
    return res.status(400).json({ error: "Company, date, attendance entries, and Admin Manager passcode are required." });
  }

  const [code] = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyId, date: manilaDateString() },
    limit: 1,
  });
  if (!code) return res.status(400).json({ error: "No Admin Manager passcode has been generated for today." });
  if (String(code.manager_passcode || "") !== managerPasscode) {
    return res.status(403).json({ error: "Incorrect Admin Manager passcode." });
  }

  const employees = await listRecords("Employee", { filter: { company_profile_id: companyId } });
  const tagged = new Map(employees.filter(employee => employee.special_rate_enabled).map(employee => [String(employee.id), employee]));
  const existing = await listRecords("SpecialRateAttendance", {
    filter: { company_profile_id: companyId, date },
  });
  const savedAt = new Date().toISOString();
  const savedBy = actor.name || actor.email;
  const saved = [];

  for (const entry of entries) {
    const employee = tagged.get(String(entry.employee_record_id || ""));
    const status = String(entry.status || "");
    if (!employee || !VALID_STATUSES.has(status)) continue;
    const payload = {
      company_profile_id: companyId,
      employee_record_id: employee.id,
      employee_id: employee.employee_id,
      employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "),
      date,
      status,
      credited_days: status === "present" ? 1 : status === "half_day" ? 0.5 : 0,
      fixed_daily_fee: Number(employee.special_fixed_daily_fee) || 0,
      saved_at: savedAt,
      saved_by: savedBy,
    };
    const row = existing.find(item => String(item.employee_record_id) === String(employee.id));
    saved.push(row
      ? await updateRecord("SpecialRateAttendance", row.id, payload)
      : await createRecord("SpecialRateAttendance", payload));
  }

  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyId,
    source_entity: "SpecialRateAttendance",
    action: "special_rate_attendance_saved",
    occurred_at: savedAt,
    authorized_by: savedBy,
    reason: `Confidential special-rate attendance saved for ${date}`,
    summary: `${saved.length} special-rate attendance entr${saved.length === 1 ? "y" : "ies"} saved`,
    record_date: date,
  });

  return res.status(200).json({ records: saved });
}
