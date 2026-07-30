// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";

const EDITABLE_FIELDS = [
  "first_name",
  "middle_name",
  "last_name",
  "email",
  "phone",
  "department",
  "position",
  "date_of_birth",
  "date_hired",
  "daily_rate",
  "monthly_rate",
  "max_cash_advance",
  "sss_number",
  "philhealth_number",
  "pagibig_number",
  "tin_number",
  "bank_account",
  "user_email",
  "employment_type",
  "agency_fee_percentage",
  "status",
  "photo_url",
  "qr_code",
];

function comparable(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
  if (!["super_admin", "admin"].includes(session.user.role)) {
    return res.status(403).json({ error: "Only administrators can edit employee profiles." });
  }

  const employeeRecordId = String(req.body?.employee_record_id || "").trim();
  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  const hrPasscode = String(req.body?.hr_passcode || "").trim();
  const adminPasscode = String(req.body?.admin_passcode || "").trim();
  const reason = String(req.body?.reason || "").trim();
  const submitted = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};

  if (!employeeRecordId || !companyProfileId) {
    return res.status(400).json({ error: "Employee and company are required." });
  }
  if (!hrPasscode || !adminPasscode) {
    return res.status(400).json({ error: "Both HR Officer and Admin passcodes are required." });
  }
  if (reason.length < 3) {
    return res.status(400).json({ error: "Enter a reason for editing the employee profile." });
  }

  const [employee] = await listRecords("Employee", {
    filter: { id: employeeRecordId, company_profile_id: companyProfileId },
    limit: 1,
  });
  if (!employee) return res.status(404).json({ error: "Employee not found." });

  const [todayCode] = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyProfileId, date: manilaDateString() },
    limit: 1,
  });
  if (!todayCode) {
    return res.status(400).json({ error: "No daily passcodes have been generated for today." });
  }
  if (String(todayCode.passcode || "") !== hrPasscode) {
    return res.status(403).json({ error: "Incorrect HR Officer passcode." });
  }
  if (String(todayCode.manager_passcode || "") !== adminPasscode) {
    return res.status(403).json({ error: "Incorrect Admin passcode." });
  }

  const updates = {};
  EDITABLE_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(submitted, field)) updates[field] = submitted[field];
  });

  const changedFields = EDITABLE_FIELDS.filter(field =>
    Object.prototype.hasOwnProperty.call(updates, field) &&
    comparable(employee[field]) !== comparable(updates[field])
  );
  if (changedFields.length === 0) {
    return res.status(400).json({ error: "No employee profile changes were detected." });
  }

  const changedAt = new Date().toISOString();
  const changedBy = session.user.name || session.user.email || "unknown";
  const employeeName = [updates.first_name ?? employee.first_name, updates.middle_name ?? employee.middle_name, updates.last_name ?? employee.last_name]
    .filter(Boolean)
    .join(" ");
  const updated = await updateRecord("Employee", employee.id, {
    ...updates,
    passcode_audit_action: "employee_profile_updated",
    passcode_audit_at: changedAt,
    passcode_audit_by: changedBy,
    passcode_audit_reason: reason,
    passcode_audit_summary: `Employee profile updated: ${changedFields.join(", ")}`,
  });

  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyProfileId,
    source_entity: "Employee",
    source_record_id: employee.id,
    action: "employee_profile_updated",
    occurred_at: changedAt,
    authorized_by: changedBy,
    reason,
    summary: `Employee profile updated: ${changedFields.join(", ")}`,
    employee_record_id: employee.id,
    employee_id: employee.employee_id,
    employee_name: employeeName,
    changed_fields: changedFields,
    record_date: manilaDateString(),
  });

  return res.status(200).json({ employee: updated, changed_fields: changedFields });
}
