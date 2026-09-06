// @ts-nocheck
import { listRecords } from "@/server/entityStore";
import { applyAttendancePunch } from "@/server/attendance/applyAttendancePunch";

function sourceIpFromRequest(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const employeeId = req.body?.employee_id;
  const employeeRecordId = String(req.body?.employee_record_id || "").trim();
  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  const location = req.body?.location;

  if (!employeeId) {
    return res.status(400).json({ error: "employee_id is required" });
  }

  const matchingEmployees = await listRecords("Employee", {
    filter: { employee_id: employeeId },
    limit: 2000,
  });
  const employee = employeeRecordId
    ? matchingEmployees.find((item) => String(item.id || "") === employeeRecordId) || matchingEmployees[0]
    : companyProfileId
      ? matchingEmployees.find((item) => String(item.company_profile_id || "") === companyProfileId) || matchingEmployees[0]
      : matchingEmployees[0];

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const result = await applyAttendancePunch({
    employee,
    occurredAt: new Date(),
    source: "employee_portal",
    location,
    authorizedBy: "Employee Portal",
    requestMeta: {
      sourceIp: sourceIpFromRequest(req),
      userAgent: req.headers?.["user-agent"],
    },
  });

  if (result.outcome === "applied") {
    return res.status(200).json({ action: result.action, log: result.log, receipt: result.receipt });
  }
  if (result.outcome === "duplicate") {
    return res.status(200).json({
      action: result.action,
      log: result.log,
      duplicate: true,
      message: result.message,
    });
  }
  if (result.outcome === "early_attempt") {
    return res.status(200).json({
      code: result.code,
      message: result.message,
      attemptedAt: result.attemptedAt,
      scheduledStart: result.scheduledStart,
      earliestAllowedTimeIn: result.earliestAllowedTimeIn,
      officialTimeInCreated: false,
      duplicateSuppressed: result.duplicateSuppressed,
      receiptId: result.receiptId || null,
    });
  }
  if (result.code === "EARLY_TIME_IN_AUDIT_FAILED") {
    return res.status(500).json({
      code: result.code,
      error: result.error,
    });
  }
  if (result.code === "TIME_IN_AFTER_SHIFT_END" || result.code === "BREAK_TIME_IN_TOO_EARLY") {
    return res.status(409).json({ error: result.error, code: result.code });
  }
  if (result.code === "ATTENDANCE_COMPLETE") {
    return res.status(409).json({ error: result.error });
  }
  return res.status(409).json({ error: result.error || "Attendance punch was not recorded.", code: result.code });
}
