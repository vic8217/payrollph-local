// @ts-nocheck
import { createRecord, listRecords } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";

function truncate(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== "object") return null;
  const latitude = Number(rawLocation.latitude);
  const longitude = Number(rawLocation.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return {
    status: truncate(rawLocation.status || (hasCoordinates ? "captured" : "unavailable"), 32),
    ...(hasCoordinates ? {
      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7)),
      accuracy: Number.isFinite(Number(rawLocation.accuracy)) ? Number(Number(rawLocation.accuracy).toFixed(2)) : null,
    } : {}),
    error: truncate(rawLocation.error, 160) || null,
    captured_at: rawLocation.captured_at || new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const employeeId = truncate(req.body?.employee_id, 100);
  const employeeRecordId = truncate(req.body?.employee_record_id, 100);
  const requestedCompanyId = truncate(req.body?.company_profile_id, 100);
  const stage = truncate(req.body?.stage || "attendance", 64);
  const reason = truncate(req.body?.reason || "Attendance punch failed");
  const attemptedAt = new Date().toISOString();

  const employees = employeeId
    ? await listRecords("Employee", { filter: { employee_id: employeeId }, limit: 2000 })
    : [];
  const employee = employeeRecordId
    ? employees.find(item => String(item.id) === employeeRecordId) || employees[0]
    : requestedCompanyId
      ? employees.find(item => String(item.company_profile_id) === requestedCompanyId) || employees[0]
      : employees[0];
  const companyProfileId = employee?.company_profile_id || requestedCompanyId;

  if (!companyProfileId) {
    return res.status(400).json({ error: "Company is required to record a failed attendance attempt." });
  }

  const employeeName = employee
    ? [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" ")
    : "Unrecognized employee";
  const receipt = await createRecord("PasscodeAuditLog", {
    company_profile_id: companyProfileId,
    source_entity: "AttendanceLog",
    source_record_id: req.body?.attendance_log_id || null,
    action: "attendance_punch_failed",
    punch_action: truncate(req.body?.punch_action, 64) || null,
    failure_stage: stage,
    occurred_at: attemptedAt,
    authorized_by: "Employee Portal",
    reason,
    summary: `Attendance attempt failed during ${stage}: ${reason}`,
    employee_record_id: employee?.id || employeeRecordId || null,
    employee_id: employee?.employee_id || employeeId || "unknown",
    employee_name: employeeName,
    record_date: manilaDateString(),
    attempted_at: attemptedAt,
    location: sanitizeLocation(req.body?.location),
  });

  return res.status(201).json({ receipt });
}
