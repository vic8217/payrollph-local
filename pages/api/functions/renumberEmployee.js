// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { prisma } from "@/server/prisma";

const LINKED_ENTITIES = [
  "AttendanceLog",
  "CashAdvance",
  "CashAdvanceLedger",
  "PayrollRecord",
  "PayrollIncentive",
  "PersonalLeave",
  "SeparationPay",
  "ThirteenthMonthPay",
  "EmployeeMemo",
  "EmployeeSuspension",
  "EmployeeTermination",
  "EmployeePromissoryNote",
  "VehicleTripReport",
];

function normalizeEmployeeId(value) {
  return String(value || "").trim().toUpperCase();
}

function sessionCompanyIds(session) {
  const ids = Array.isArray(session?.user?.company_profile_ids)
    ? session.user.company_profile_ids
    : [session?.user?.company_profile_id];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
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
  const authenticatedUser = await prisma.appUser.findFirst({
    where: session.user.id
      ? { id: session.user.id }
      : { email: String(session.user.email || "").toLowerCase() },
    select: { id: true, email: true, name: true, role: true, companyProfileId: true },
  });
  const effectiveRole = authenticatedUser?.role || session.user.role;
  if (!["super_admin", "admin"].includes(effectiveRole)) {
    return res.status(403).json({ error: "Only an admin or super admin can change an employee number" });
  }

  const employeeRecordId = String(req.body?.employee_record_id || "").trim();
  const newEmployeeId = normalizeEmployeeId(req.body?.new_employee_id);
  const hrPasscode = String(req.body?.hr_passcode || "").trim();
  const adminPasscode = String(req.body?.admin_passcode || "").trim();
  const reason = String(req.body?.reason || "").trim();

  if (!employeeRecordId || !newEmployeeId) {
    return res.status(400).json({ error: "Employee and new employee number are required" });
  }
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(newEmployeeId)) {
    return res.status(400).json({ error: "Use 3-40 letters, numbers, or hyphens for the employee number" });
  }
  if (!hrPasscode || !adminPasscode) {
    return res.status(400).json({ error: "Both HR Officer and Admin passcodes are required" });
  }
  if (reason.length < 3) {
    return res.status(400).json({ error: "Enter a reason for changing the employee number" });
  }

  const employees = await listRecords("Employee", { limit: 5000 });
  const employee = employees.find((item) => String(item.id) === employeeRecordId);
  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }
  if (effectiveRole === "admin") {
    const companies = await listRecords("CompanyProfile", { limit: 5000 });
    const allowedCompanyIds = new Set([
      ...String(authenticatedUser?.companyProfileId || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      ...sessionCompanyIds(session),
      ...companies
        .filter((company) => String(company.created_by_user_id || "") === String(authenticatedUser?.id || session.user.id || ""))
        .map((company) => String(company.id)),
    ]);
    if (!allowedCompanyIds.has(String(employee.company_profile_id || ""))) {
      return res.status(403).json({ error: "Admins can only change employee numbers within their companies" });
    }
  }

  const oldEmployeeId = normalizeEmployeeId(employee.employee_id);
  if (newEmployeeId === oldEmployeeId) {
    return res.status(400).json({ error: "The new employee number is the same as the current number" });
  }

  const duplicate = employees.find((item) =>
    String(item.id) !== employeeRecordId &&
    String(item.company_profile_id || "") === String(employee.company_profile_id || "") &&
    (
      normalizeEmployeeId(item.employee_id) === newEmployeeId ||
      (Array.isArray(item.employee_id_aliases) &&
        item.employee_id_aliases.some((alias) => normalizeEmployeeId(alias) === newEmployeeId))
    )
  );
  if (duplicate) {
    return res.status(409).json({ error: "That employee number is already assigned in this company" });
  }

  const passcodes = await listRecords("DailyPasscode", {
    filter: {
      company_profile_id: employee.company_profile_id,
      date: manilaDateString(),
    },
    limit: 10,
  });
  const todayPasscode = passcodes[0];
  if (!todayPasscode) {
    return res.status(400).json({ error: "No daily passcodes have been generated for today" });
  }
  if (String(todayPasscode.passcode || "") !== hrPasscode) {
    return res.status(403).json({ error: "Incorrect HR Officer passcode" });
  }
  if (String(todayPasscode.manager_passcode || "") !== adminPasscode) {
    return res.status(403).json({ error: "Incorrect Admin passcode" });
  }

  const aliases = [...new Set([
    ...(Array.isArray(employee.employee_id_aliases) ? employee.employee_id_aliases : []),
    oldEmployeeId,
  ].map(normalizeEmployeeId).filter(Boolean))].filter((alias) => alias !== newEmployeeId);
  const changedAt = new Date().toISOString();
  const changedBy = authenticatedUser?.name || authenticatedUser?.email || session.user.name || session.user.email || "unknown";

  const linkedUpdates = [];
  for (const entity of LINKED_ENTITIES) {
    const records = await listRecords(entity, { limit: 10000 });
    const matches = records.filter((record) =>
      normalizeEmployeeId(record.employee_id) === oldEmployeeId &&
      (
        !employee.company_profile_id ||
        !record.company_profile_id ||
        String(record.company_profile_id) === String(employee.company_profile_id)
      )
    );
    linkedUpdates.push(...matches.map((record) =>
      updateRecord(entity, record.id, {
        employee_id: newEmployeeId,
        employee_record_id: record.employee_record_id || employee.id,
      })
    ));
  }
  await Promise.all(linkedUpdates);

  const updatedEmployee = await updateRecord("Employee", employee.id, {
    employee_id: newEmployeeId,
    qr_code: newEmployeeId,
    employee_id_aliases: aliases,
    previous_employee_id: oldEmployeeId,
    employee_id_changed_at: changedAt,
    employee_id_changed_by: changedBy,
    passcode_audit_action: "employee_number_changed",
    passcode_audit_at: changedAt,
    passcode_audit_by: changedBy,
    passcode_audit_reason: reason,
    passcode_audit_summary: `Employee number changed from ${oldEmployeeId} to ${newEmployeeId}`,
  });

  await createRecord("PasscodeAuditLog", {
    company_profile_id: employee.company_profile_id,
    source_entity: "Employee",
    source_record_id: employee.id,
    action: "employee_number_changed",
    occurred_at: changedAt,
    authorized_by: changedBy,
    reason,
    summary: `Employee number changed from ${oldEmployeeId} to ${newEmployeeId}`,
    employee_id: newEmployeeId,
    employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "),
    old_employee_id: oldEmployeeId,
    new_employee_id: newEmployeeId,
    linked_records_updated: linkedUpdates.length,
  });

  return res.status(200).json({
    employee: updatedEmployee,
    old_employee_id: oldEmployeeId,
    new_employee_id: newEmployeeId,
    linked_records_updated: linkedUpdates.length,
  });
}
