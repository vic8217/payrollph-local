// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
  createRecord,
  deleteRecord,
  listRecords,
  listRecordsPage,
  updateRecord,
} from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { isAgencyEmployee, moneyToCents, normalizePayrollMethod } from "@/lib/agencyPayroll";
import { payrollReconciliationReadiness } from "@/server/payrollReconciliationReadiness";
import { ENTITY_PERMISSIONS, hasPermission } from "@/lib/permissions";

async function assertPayrollReleaseReadiness(periodId) {
  const [period] = await listRecords("PayrollPeriod", { filter: { id: periodId }, limit: 1 });
  if (!period || period.status === "released") return;
  const readiness = await payrollReconciliationReadiness(period.company_profile_id, periodId);
  if (!readiness.isReadyForFinalization) {
    const error = new Error(`Payroll cannot be finalized. Outstanding reconciliation items: ${readiness.pendingEmployees} pending reconciliations; ${readiness.unresolvedEmployees} unresolved variances; ${readiness.remarksForResolution.noteCount} reviewer remarks requiring response; ${readiness.remarksForReview.noteCount} reviewer responses awaiting confirmation.`);
    error.statusCode = 409; error.details = { pending: readiness.pendingEmployees, unresolved: readiness.unresolvedEmployees, remarksForResolution: readiness.remarksForResolution.noteCount, remarksForReview: readiness.remarksForReview.noteCount, reviewerNotesAvailable: readiness.reviewerNotesAvailable }; throw error;
  }
}

function validateCompanyAgencySettings(data = {}) {
  if (data.uses_employee_agency !== true) return data;
  const cents = moneyToCents(data.agency_fee_per_employee);
  if (cents == null) {
    const error = new Error("Agency fee must be a valid non-negative amount with no more than two decimal places.");
    error.statusCode = 400;
    throw error;
  }
  return { ...data, agency_fee_per_employee: cents / 100, agency_fee_frequency: "PER_DAY" };
}

function validateEmployeeClassifications(data = {}) {
  const result = { ...data };
  if (Object.prototype.hasOwnProperty.call(result, "payroll_disbursement_method")) {
    result.payroll_disbursement_method = normalizePayrollMethod(result.payroll_disbursement_method);
  }
  if (Object.prototype.hasOwnProperty.call(result, "is_agency_employee")) {
    result.is_agency_employee = isAgencyEmployee(result.is_agency_employee);
  }
  return result;
}

function sendError(res, error) {
  if (error.code === "P1000") {
    return res.status(503).json({
      error:
        "Database authentication failed. Update DATABASE_URL in .env with valid local PostgreSQL credentials, then restart the dev server.",
    });
  }

  res.status(error.statusCode || 500).json({
    error: error.message || "Unexpected server error",
  });
}

function entityNameFromQuery(query) {
  const raw = query.entity;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

const ATTENDANCE_LOG_LIST_FIELDS = [
  "id",
  "created_date",
  "updated_date",
  "company_profile_id",
  "employee_record_id",
  "employee_id",
  "employee_name",
  "date",
  "time_in",
  "time_in_actual_punch_at",
  "time_in_original_value",
  "time_in_review_status",
  "time_in_review_category",
  "time_in_review_note",
  "time_in_review_requested_at",
  "time_in_review_requested_by",
  "time_in_review_decision_note",
  "time_in_review_decided_at",
  "time_in_review_decided_by",
  "time_in_adjustment_note",
  "time_in_adjusted_at",
  "time_in_adjusted_by",
  "break_time_out",
  "break_time_out_actual_punch_at",
  "break_time_in",
  "break_time_in_actual_punch_at",
  "time_out",
  "time_out_actual_punch_at",
  "work_schedule",
  "shift_start_time",
  "shift_end_time",
  "shift_overtime_start_time",
  "shift_break_start_time",
  "shift_break_end_time",
  "shift_break_duration_minutes",
  "shift_grace_period_minutes",
  "shift_time_in_allowance_minutes",
  "shift_paid_break_time",
  "status",
  "day_type",
  "hours_worked",
  "undertime_minutes",
  "ot_actual_hours",
  "overtime_hours",
  "ot_requested_hours",
  "ot_status",
  "overtime_request_id",
  "ot_hr_approved",
  "ot_admin_approved",
  "ot_reviewed_at",
  "ot_reviewed_by",
  "ot_review_reason",
  "night_diff_hours",
  "late_minutes",
  "photo_url",
  "photo_action",
  "time_in_photo_url",
  "time_in_photo_captured_at",
  "break_time_out_photo_url",
  "break_time_out_photo_captured_at",
  "break_time_in_photo_url",
  "break_time_in_photo_captured_at",
  "time_out_photo_url",
  "time_out_photo_captured_at",
  "time_in_verification_method",
  "break_time_out_verification_method",
  "break_time_in_verification_method",
  "time_out_verification_method",
  "record_source",
  "synchronized_at",
  "offline_client_request_id",
].join(",");

function fieldsForListRequest(entity, query) {
  if (query.fields) return query.fields;
  if (entity !== "AttendanceLog") return undefined;

  const limit = Number(query.limit) || 0;
  if (limit >= 1000) return ATTENDANCE_LOG_LIST_FIELDS;
  return undefined;
}

function normalizedId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function previousManilaDate(date) {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() - 1);
  return manilaDateString(value);
}

function isOvernightAttendance(log = {}) {
  const start = String(log.shift_start_time || "").slice(0, 5);
  const end = String(log.shift_end_time || "").slice(0, 5);
  return Boolean(start && end && end <= start);
}

async function resolveTimeInForOvertimeRequest(data = {}) {
  const companyProfileId = data.company_profile_id;
  const requestDate = String(data.date || "").slice(0, 10);
  const employeeRecordId = normalizedId(data.employee_record_id);
  const employeeId = normalizedId(data.employee_id);

  if (!companyProfileId || !requestDate || (!employeeRecordId && !employeeId)) {
    const error = new Error("Employee and OT date are required.");
    error.statusCode = 400;
    throw error;
  }

  const logs = await listRecords("AttendanceLog", {
    filter: { company_profile_id: companyProfileId, date: requestDate },
  });
  const matchingTimeIn = logs.find(log => {
    const sameEmployee =
      (employeeRecordId && normalizedId(log.employee_record_id) === employeeRecordId) ||
      (employeeId && normalizedId(log.employee_id) === employeeId);
    return sameEmployee && log.status !== "rejected" && Boolean(String(log.time_in || "").trim());
  });

  if (matchingTimeIn) return requestDate;

  // After midnight, an employee's active/completed night shift still belongs
  // to the previous work date. Resolve that attendance instead of requiring a
  // nonexistent Time In under the new calendar date.
  if (requestDate === manilaDateString()) {
    const previousDate = previousManilaDate(requestDate);
    const previousLogs = await listRecords("AttendanceLog", {
      filter: { company_profile_id: companyProfileId, date: previousDate },
    });
    const overnightTimeIn = previousLogs.find(log => {
      const sameEmployee =
        (employeeRecordId && normalizedId(log.employee_record_id) === employeeRecordId) ||
        (employeeId && normalizedId(log.employee_id) === employeeId);
      return sameEmployee && log.status !== "rejected" && isOvernightAttendance(log) && Boolean(String(log.time_in || "").trim());
    });
    if (overnightTimeIn) return previousDate;
  }

  const error = new Error("You can only file an OT request after recording Time In for the selected date.");
  error.statusCode = 400;
  throw error;
}

async function requireCompletedAttendanceForOvertimeApproval(requestId, updates = {}) {
  if (updates.status !== "approved") return;
  if (updates.time_out_confirmed !== true) {
    const error = new Error("HR Officer and Admin must confirm the employee's final Time Out before approving OT.");
    error.statusCode = 400;
    throw error;
  }

  const requests = await listRecords("OvertimeRequest", { filter: { id: requestId }, limit: 1 });
  const request = requests[0];
  if (!request) {
    const error = new Error("OT request not found.");
    error.statusCode = 404;
    throw error;
  }
  const dailyPasscodes = await listRecords("DailyPasscode", {
    filter: { company_profile_id: request.company_profile_id, date: manilaDateString() },
    limit: 10,
  });
  const passcodesMatch = dailyPasscodes.some(record =>
    String(record.passcode || "") === String(updates.hr_confirmation_passcode || "") &&
    String(record.manager_passcode || "") === String(updates.admin_confirmation_passcode || "")
  );
  if (!passcodesMatch) {
    const error = new Error("Valid HR Officer and Admin passcodes are required to confirm the final Time Out.");
    error.statusCode = 403;
    throw error;
  }
  const logs = await listRecords("AttendanceLog", {
    filter: { company_profile_id: request.company_profile_id, date: request.date },
  });
  const employeeRecordId = normalizedId(request.employee_record_id);
  const employeeId = normalizedId(request.employee_id);
  const attendance = logs.find(log =>
    (employeeRecordId && normalizedId(log.employee_record_id) === employeeRecordId) ||
    (employeeId && normalizedId(log.employee_id) === employeeId)
  );
  if (!attendance?.time_out) {
    const error = new Error("A completed attendance record with final Time Out is required before OT approval.");
    error.statusCode = 400;
    throw error;
  }

  const actualHours = Math.max(0, Number(attendance.ot_actual_hours ?? attendance.overtime_hours) || 0);
  const approvedHours = Math.max(0, Number(updates.approved_hours) || 0);
  if (!(actualHours > 0)) {
    const error = new Error("The completed attendance record has no actual overtime. Correct the attendance times before approving OT.");
    error.statusCode = 400;
    throw error;
  }
  if (approvedHours > actualHours + 0.005) {
    const error = new Error(`Approved OT cannot exceed the ${actualHours.toFixed(2)} actual hours supported by the final Time Out.`);
    error.statusCode = 400;
    throw error;
  }
}

export default async function handler(req, res) {
  const entity = entityNameFromQuery(req.query);
  if (!entity) {
    return res.status(400).json({ error: "Entity name required" });
  }

  try {
    const entityPermission = ENTITY_PERMISSIONS[entity];
    const session = await getServerSession(req, res, authOptions);
    if (session?.user?.role === "attendance_staff" && !entityPermission && entity !== "Employee") {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (entityPermission) {
      if (!session?.user || !hasPermission(session.user.role, entityPermission)) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }
    if (entity === "EmployeePasskey") {
      return res.status(403).json({ error: "Employee passkeys are available only through the protected passkey workflow." });
    }
    if (req.method === "GET") {
      const filter = req.query.filter ? JSON.parse(req.query.filter) : {};
      const paginationRequested = req.query.page !== undefined || req.query.pageSize !== undefined;
      if (paginationRequested && ["AttendanceLog", "PasscodeAuditLog"].includes(entity)) {
        const result = await listRecordsPage(entity, {
          filter,
          sort: req.query.sort,
          page: req.query.page,
          pageSize: req.query.pageSize,
          fields: fieldsForListRequest(entity, { ...req.query, limit: req.query.pageSize }),
          legacyAttendanceAudit: req.query.legacyAttendanceAudit === "true",
          search: req.query.search,
        });
        return res.status(200).json(result);
      }
      const records = await listRecords(entity, {
        filter,
        sort: req.query.sort,
        limit: req.query.limit,
        offset: req.query.offset,
        fields: fieldsForListRequest(entity, req.query),
      });
      return res.status(200).json(records);
    }

    if (req.method === "POST") {
      if (entity === "Settings") {
        return res.status(403).json({
          error: "Shift settings must be changed through the protected shift-change workflow.",
        });
      }
      let data = req.body;
      if (entity === "AttendanceLog") {
        const companyId = String(data?.company_profile_id || "").trim();
        const workDate = String(data?.date || "").slice(0, 10);
        const employeeRecordId = normalizedId(data?.employee_record_id);
        const employeeId = normalizedId(data?.employee_id);
        if (!companyId || !workDate || (!employeeRecordId && !employeeId)) {
          return res.status(400).json({ error: "Company, employee, and attendance work date are required." });
        }
        const existingLogs = await listRecords("AttendanceLog", {
          filter: { company_profile_id: companyId, date: workDate },
          limit: 1000,
        });
        const duplicate = existingLogs.find(log =>
          log.status !== "rejected" &&
          ((employeeRecordId && normalizedId(log.employee_record_id) === employeeRecordId) ||
            (employeeId && normalizedId(log.employee_id) === employeeId))
        );
        if (duplicate) {
          return res.status(409).json({
            code: "DUPLICATE_ATTENDANCE_WORK_DATE",
            error: "An attendance record already exists for this employee and work date. The duplicate was not created.",
            existingAttendanceId: duplicate.id,
          });
        }
      }
      if (entity === "Employee") {
        const session = await getServerSession(req, res, authOptions);
        const companyId = String(data?.company_profile_id || "");
        const assigned = session?.user?.company_profile_ids || (session?.user?.company_profile_id ? [session.user.company_profile_id] : []);
        if (!session?.user || !["super_admin", "admin", "user"].includes(session.user.role)) return res.status(403).json({ error: "HR or administrator access is required." });
        if (session.user.role !== "super_admin" && !assigned.includes(companyId)) return res.status(403).json({ error: "You cannot create employees for this company." });
      }
      if (entity === "Employee" && !String(data?.employee_id || "").trim()) {
        return res.status(400).json({ error: "Employee ID is required. The employee profile was not saved." });
      }
      if (entity === "OvertimeRequest") {
        data = { ...data, date: await resolveTimeInForOvertimeRequest(data) };
        const existingRequests = await listRecords("OvertimeRequest", {
          filter: { company_profile_id: data.company_profile_id, date: data.date },
          limit: 1000,
        });
        const employeeRecordId = normalizedId(data.employee_record_id);
        const employeeId = normalizedId(data.employee_id);
        const duplicate = existingRequests.find(request =>
          ["pending", "approved"].includes(normalizedId(request.status)) &&
          ((employeeRecordId && normalizedId(request.employee_record_id) === employeeRecordId) ||
            (employeeId && normalizedId(request.employee_id) === employeeId))
        );
        if (duplicate) {
          return res.status(409).json({
            code: "DUPLICATE_OVERTIME_REQUEST",
            error: normalizedId(duplicate.status) === "approved"
              ? `You already have an approved OT request for ${data.date}.`
              : `You already have an open OT request for ${data.date}.`,
            existingOvertimeRequestId: duplicate.id,
          });
        }
      }
      if (entity === "CompanyProfile") {
        const session = await getServerSession(req, res, authOptions);
        data = validateCompanyAgencySettings({
          ...(req.body || {}),
          ...(session?.user?.id
            ? {
                created_by_user_id: req.body?.created_by_user_id || session.user.id,
                created_by_user_email: req.body?.created_by_user_email || session.user.email || null,
                created_by_user_name: req.body?.created_by_user_name || session.user.name || null,
              }
            : {}),
        });
      }
      if (entity === "PayrollReconciliation" && data?.resolution_status) {
        const session = await getServerSession(req, res, authOptions);
        if (!session?.user) return res.status(401).json({ error: "Authentication is required to resolve a reconciliation." });
        data = {
          ...data,
          resolved_by: session.user.name || session.user.email || "Unknown officer",
          resolved_at: new Date().toISOString(),
        };
      }
      if (entity === "Employee") data = validateEmployeeClassifications(data);
      const record = await createRecord(entity, data);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      if (entity === "Settings") {
        return res.status(403).json({
          error: "Shift settings must be changed through the protected shift-change workflow.",
        });
      }
      if (
        entity === "Employee" &&
        ["work_schedule", "shift_assignments", "break_time", "break_duration_minutes"]
          .some(field => Object.prototype.hasOwnProperty.call(req.body.data || {}, field))
      ) {
        return res.status(403).json({
          error: "Employee work schedules must be changed through the protected work-schedule workflow.",
        });
      }
      if (entity === "OvertimeRequest") {
        await requireCompletedAttendanceForOvertimeApproval(req.body.id, req.body.data || {});
      }
      let updateData = { ...(req.body.data || {}) };
      if (entity === "PayrollPeriod" && updateData.status === "released") await assertPayrollReleaseReadiness(req.body.id);
      if (entity === "CompanyProfile") {
        const session = await getServerSession(req, res, authOptions);
        const [company] = await listRecords("CompanyProfile", { filter: { id: req.body.id }, limit: 1 });
        const assigned = session?.user?.company_profile_ids || (session?.user?.company_profile_id ? [session.user.company_profile_id] : []);
        const ownsCompany = company && (assigned.includes(company.id) || company.created_by_user_id === session?.user?.id);
        if (!session?.user || (session.user.role !== "super_admin" && !ownsCompany)) return res.status(403).json({ error: "You cannot update this company." });
      }
      if (entity === "CompanyProfile") updateData = validateCompanyAgencySettings(updateData);
      if (entity === "PayrollReconciliation" && Object.prototype.hasOwnProperty.call(updateData, "resolution_status")) {
        const session = await getServerSession(req, res, authOptions);
        if (!session?.user) return res.status(401).json({ error: "Authentication is required to resolve a reconciliation." });
        updateData.resolved_by = session.user.name || session.user.email || "Unknown officer";
        updateData.resolved_at = new Date().toISOString();
      }
      if (entity === "Employee") updateData = validateEmployeeClassifications(updateData);
      if (entity === "AttendanceLog" && Object.prototype.hasOwnProperty.call(updateData, "time_in")) {
        return res.status(403).json({
          error: "Time In (1) is an immutable employee scan. Use the attendance review workflow to document an issue.",
        });
      }
      delete updateData.hr_confirmation_passcode;
      delete updateData.admin_confirmation_passcode;
      const record = await updateRecord(entity, req.body.id, updateData);
      return res.status(200).json(record);
    }

    if (req.method === "DELETE") {
      if (entity === "Settings") {
        return res.status(403).json({
          error: "Shift settings must be changed through the protected shift-change workflow.",
        });
      }
      const result = await deleteRecord(entity, req.body.id);
      return res.status(200).json(result);
    }

    res.setHeader("Allow", "GET,POST,PATCH,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
