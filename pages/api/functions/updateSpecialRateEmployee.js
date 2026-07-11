// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { prisma } from "@/server/prisma";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  const actor = await prisma.appUser.findFirst({
    where: session?.user?.id ? { id: session.user.id } : { email: String(session?.user?.email || "").toLowerCase() },
  });
  if (!actor || !["super_admin", "admin"].includes(actor.role)) {
    return res.status(403).json({ error: "Only an admin manager can manage confidential special rates." });
  }

  const employeeId = String(req.body?.employee_record_id || "").trim();
  const companyId = String(req.body?.company_profile_id || "").trim();
  const managerPasscode = String(req.body?.manager_passcode || "").trim();
  const enabled = Boolean(req.body?.enabled);
  const dailyFee = Number(req.body?.fixed_daily_fee);
  if (!employeeId || !companyId || (enabled && (!(dailyFee > 0) || !Number.isFinite(dailyFee)))) {
    return res.status(400).json({ error: "Employee and a fixed daily fee greater than zero are required." });
  }

  const [code] = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyId, date: manilaDateString() }, limit: 1,
  });
  if (!code) return res.status(400).json({ error: "No admin manager passcode has been generated for today." });
  if (String(code.manager_passcode || "").trim() !== managerPasscode) {
    return res.status(403).json({ error: "Incorrect admin manager passcode." });
  }

  const [employee] = await listRecords("Employee", { filter: { id: employeeId, company_profile_id: companyId }, limit: 1 });
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  const changedAt = new Date().toISOString();
  const changedBy = actor.name || actor.email;
  const updated = await updateRecord("Employee", employee.id, {
    special_rate_enabled: enabled,
    special_fixed_daily_fee: enabled ? Number(dailyFee.toFixed(2)) : 0,
    special_rate_confidential: true,
    special_rate_updated_at: changedAt,
    special_rate_updated_by: changedBy,
  });
  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyId,
    source_entity: "Employee",
    source_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    action: enabled ? "special_rate_tagged" : "special_rate_untagged",
    summary: enabled ? "Employee tagged for confidential fixed daily fee" : "Employee removed from special rates",
    occurred_at: changedAt,
    authorized_by: changedBy,
  });
  return res.status(200).json(updated);
}
