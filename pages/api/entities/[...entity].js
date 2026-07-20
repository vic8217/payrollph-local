// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
  createRecord,
  deleteRecord,
  listRecords,
  updateRecord,
} from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";

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
  "break_time_out",
  "break_time_in",
  "time_out",
  "work_schedule",
  "shift_start_time",
  "shift_end_time",
  "shift_overtime_start_time",
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
  "break_time_out_photo_url",
  "break_time_in_photo_url",
  "time_out_photo_url",
  "time_in_verification_method",
  "break_time_out_verification_method",
  "break_time_in_verification_method",
  "time_out_verification_method",
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

async function requireTimeInForOvertimeRequest(data = {}) {
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
  const hasTimeIn = logs.some(log => {
    const sameEmployee =
      (employeeRecordId && normalizedId(log.employee_record_id) === employeeRecordId) ||
      (employeeId && normalizedId(log.employee_id) === employeeId);
    return sameEmployee && Boolean(String(log.time_in || "").trim());
  });

  if (!hasTimeIn) {
    const error = new Error("You can only file an OT request after recording Time In for the selected date.");
    error.statusCode = 400;
    throw error;
  }
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
    if (entity === "EmployeePasskey") {
      return res.status(403).json({ error: "Employee passkeys are available only through the protected passkey workflow." });
    }
    if (req.method === "GET") {
      const filter = req.query.filter ? JSON.parse(req.query.filter) : {};
      const records = await listRecords(entity, {
        filter,
        sort: req.query.sort,
        limit: req.query.limit,
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
      if (entity === "OvertimeRequest") {
        await requireTimeInForOvertimeRequest(data);
      }
      if (entity === "CompanyProfile") {
        const session = await getServerSession(req, res, authOptions);
        data = {
          ...(req.body || {}),
          ...(session?.user?.id
            ? {
                created_by_user_id: req.body?.created_by_user_id || session.user.id,
                created_by_user_email: req.body?.created_by_user_email || session.user.email || null,
                created_by_user_name: req.body?.created_by_user_name || session.user.name || null,
              }
            : {}),
        };
      }
      const record = await createRecord(entity, data);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      if (entity === "Settings") {
        return res.status(403).json({
          error: "Shift settings must be changed through the protected shift-change workflow.",
        });
      }
      if (entity === "OvertimeRequest") {
        await requireCompletedAttendanceForOvertimeApproval(req.body.id, req.body.data || {});
      }
      const updateData = { ...(req.body.data || {}) };
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
