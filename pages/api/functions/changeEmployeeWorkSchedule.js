// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import {
  buildShiftAssignmentUpdate,
  resolveEmployeeWorkSchedule,
  sortedShiftAssignments,
} from "@/lib/shiftSettings";

const ALLOWED_OPERATIONS = new Set([
  "assign_shift",
  "cancel_shift",
]);

function cancellationUpdate(employee, effectiveDate, fallbackValue) {
  const nextAssignments = sortedShiftAssignments(employee)
    .filter(item => item.effective_date !== effectiveDate);
  return {
    shift_assignments: nextAssignments,
    work_schedule: resolveEmployeeWorkSchedule(
      { ...employee, shift_assignments: nextAssignments },
      manilaDateString(),
      fallbackValue,
    ),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    operation,
    company_profile_id: companyProfileId,
    employee_record_id: employeeRecordId,
    effective_date: effectiveDate,
    shift_value: shiftValue,
    hr_passcode: hrPasscode,
    admin_passcode: adminPasscode,
  } = req.body || {};

  if (!companyProfileId || !employeeRecordId || !ALLOWED_OPERATIONS.has(operation)) {
    return res.status(400).json({ error: "Company, employee, and a valid work-schedule operation are required." });
  }
  if (!String(hrPasscode || "").trim() || !String(adminPasscode || "").trim()) {
    return res.status(400).json({ error: "Both HR Officer and Admin Manager passcodes are required." });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: "Your session could not be verified. Please sign in again." });
  }
  const assignedCompanyIds = [
    ...(Array.isArray(session.user.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session.user.company_profile_id || "").split(","),
  ].map(value => String(value).trim()).filter(Boolean);
  if (
    session.user.role !== "super_admin" &&
    !assignedCompanyIds.includes(String(companyProfileId))
  ) {
    return res.status(403).json({ error: "You cannot change work schedules for this company." });
  }

  const passcodes = await listRecords("DailyPasscode", {
    filter: { company_profile_id: companyProfileId, date: manilaDateString() },
    limit: 10,
  });
  const matchedPasscodes = passcodes.some(record =>
    String(record.passcode || "") === String(hrPasscode).trim() &&
    String(record.manager_passcode || "") === String(adminPasscode).trim()
  );
  if (!matchedPasscodes) {
    return res.status(403).json({
      error: passcodes.length
        ? "Incorrect HR Officer or Admin Manager passcode."
        : "No daily HR/Admin passcodes exist for today.",
    });
  }

  const employees = await listRecords("Employee", {
    filter: { company_profile_id: companyProfileId },
    limit: 10000,
  });
  const employee = employees.find(item => String(item.id) === String(employeeRecordId));
  if (!employee) return res.status(404).json({ error: "Employee not found." });

  const shifts = await listRecords("Settings", {
    filter: { company_profile_id: companyProfileId },
    limit: 500,
  });
  const fallbackValue = shifts.find(shift => shift.is_default)?.id || shifts[0]?.id || employee.work_schedule || "day_shift";
  let updates;
  let summary;
  let recordDate = manilaDateString();
  let previousShiftValue = null;
  let newShiftValue = null;

  if (operation === "assign_shift") {
    if (!shiftValue || !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ""))) {
      return res.status(400).json({ error: "Shift and effective date are required." });
    }
    const validShift = ["day_shift", "night_shift"].includes(shiftValue) ||
      shifts.some(shift => String(shift.id) === String(shiftValue));
    if (!validShift) return res.status(400).json({ error: "Selected shift is invalid." });
    previousShiftValue = resolveEmployeeWorkSchedule(employee, effectiveDate, fallbackValue);
    newShiftValue = shiftValue;
    updates = buildShiftAssignmentUpdate(employee, shiftValue, effectiveDate, {
      today: manilaDateString(),
      fallbackValue,
    });
    summary = `Employee shift changed to ${shiftValue} effective ${effectiveDate}`;
    recordDate = effectiveDate;
  } else if (operation === "cancel_shift") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ""))) {
      return res.status(400).json({ error: "Scheduled shift effective date is required." });
    }
    const assignment = sortedShiftAssignments(employee)
      .find(item => item.effective_date === effectiveDate);
    if (!assignment) return res.status(404).json({ error: "Scheduled shift change not found." });
    previousShiftValue = assignment.work_schedule;
    updates = cancellationUpdate(employee, effectiveDate, fallbackValue);
    newShiftValue = resolveEmployeeWorkSchedule(
      { ...employee, ...updates },
      effectiveDate,
      fallbackValue,
    );
    summary = `Scheduled employee shift change effective ${effectiveDate} cancelled`;
    recordDate = effectiveDate;
  } else {
    return res.status(400).json({ error: "Unsupported work-schedule operation." });
  }

  const updated = await updateRecord("Employee", employee.id, updates);
  const changedAt = new Date().toISOString();
  const changedBy = session.user.name || session.user.email || "unknown";
  const shiftLabel = value => {
    if (value === "day_shift") return "Day Shift";
    if (value === "night_shift") return "Night Shift";
    return shifts.find(shift => String(shift.id) === String(value))?.setting_name || value || null;
  };
  await createRecord("PasscodeAuditLog", {
    company_profile_id: companyProfileId,
    source_entity: "Employee",
    source_record_id: employee.id,
    action: `employee_work_schedule_${operation}`,
    occurred_at: changedAt,
    authorized_by: changedBy,
    reason: "HR Officer and Admin Manager passcodes verified",
    summary,
    employee_id: employee.employee_id,
    employee_name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    record_date: recordDate,
    previous_shift_value: previousShiftValue,
    previous_shift_label: shiftLabel(previousShiftValue),
    new_shift_value: newShiftValue,
    new_shift_label: shiftLabel(newShiftValue),
  });

  return res.status(200).json({ employee: updated });
}
