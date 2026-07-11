// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
  createRecord,
  deleteRecord,
  listRecords,
  updateRecord,
} from "@/server/entityStore";

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
      const record = await updateRecord(entity, req.body.id, req.body.data);
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
