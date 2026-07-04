// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords, updateRecord } from "@/server/entityStore";

const ADMIN_ROLES = new Set(["super_admin", "admin", "user"]);
const PHOTO_FIELDS = [
  "time_in_photo_url",
  "break_time_out_photo_url",
  "break_time_in_photo_url",
  "time_out_photo_url",
];

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validateDate(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${label} must be in YYYY-MM-DD format.`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function sessionCompanyProfileIds(session) {
  const explicitIds = Array.isArray(session?.user?.company_profile_ids)
    ? session.user.company_profile_ids
    : [];
  const legacyIds = String(session?.user?.company_profile_id || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return [...new Set([...explicitIds, ...legacyIds])];
}

function assertCanManageCompany(session, companyProfileId) {
  if (!ADMIN_ROLES.has(session?.user?.role)) {
    const error = new Error("Not authorized to back up attendance photos.");
    error.statusCode = 403;
    throw error;
  }

  if (session.user.role === "super_admin") return;
  if (sessionCompanyProfileIds(session).includes(String(companyProfileId || ""))) return;

  const error = new Error("You can only back up attendance photos for your assigned company.");
  error.statusCode = 403;
  throw error;
}

function findReleasedPayrollPeriod(periods, companyProfileId, startDate, endDate) {
  return periods.find((period) =>
    String(period.company_profile_id || "") === String(companyProfileId || "") &&
    period.start_date === startDate &&
    period.end_date === endDate &&
    period.status === "released"
  );
}

function photoReferenceCount(log) {
  const urls = new Set([
    ...PHOTO_FIELDS.map((field) => log[field]),
    log.photo_url,
  ].filter(Boolean));
  return urls.size;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const companyProfileId = String(req.body?.company_profile_id || "").trim();
    const startDate = validateDate(req.body?.start_date, "start_date");
    const endDate = validateDate(req.body?.end_date, "end_date");

    if (!companyProfileId) {
      return res.status(400).json({ error: "company_profile_id is required." });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: "start_date must be before or equal to end_date." });
    }

    assertCanManageCompany(session, companyProfileId);

    const periods = await listRecords("PayrollPeriod", { limit: 10000 });
    const payrollPeriod = findReleasedPayrollPeriod(periods, companyProfileId, startDate, endDate);
    if (!payrollPeriod) {
      return res.status(409).json({ error: "Attendance photo backup is available only after the payroll period is released to employees." });
    }

    const logs = await listRecords("AttendanceLog", {
      filter: { company_profile_id: companyProfileId },
      sort: "date",
      limit: 10000,
    });
    const periodLogs = logs.filter((log) => log.date >= startDate && log.date <= endDate);
    const filename = `attendance-photo-backup-${startDate}-${endDate}.csv`;
    const backedUpAt = new Date().toISOString();
    const backedUpBy = session.user.email || session.user.name || session.user.id || null;

    const header = [
      "Payroll Period",
      "Period Start",
      "Period End",
      "Date",
      "Employee ID",
      "Employee Name",
      "Time In",
      "Time In Photo URL",
      "Break Out",
      "Break Out Photo URL",
      "Break In",
      "Break In Photo URL",
      "Time Out",
      "Time Out Photo URL",
      "Legacy Photo URL",
      "Photo Action",
      "Status",
      "Backed Up At",
      "Backed Up By",
    ];
    const rows = periodLogs.map((log) => [
      payrollPeriod.period_name,
      startDate,
      endDate,
      log.date,
      log.employee_id,
      log.employee_name,
      log.time_in,
      log.time_in_photo_url,
      log.break_time_out,
      log.break_time_out_photo_url,
      log.break_time_in,
      log.break_time_in_photo_url,
      log.time_out,
      log.time_out_photo_url,
      log.photo_url,
      log.photo_action,
      log.status,
      backedUpAt,
      backedUpBy,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

    const photoReferences = periodLogs.reduce((sum, log) => sum + photoReferenceCount(log), 0);
    const updatedPeriod = await updateRecord("PayrollPeriod", payrollPeriod.id, {
      attendance_photos_backup_completed_at: backedUpAt,
      attendance_photos_backup_completed_by: backedUpBy,
      attendance_photos_backup_filename: filename,
      attendance_photos_backup_log_count: periodLogs.length,
      attendance_photos_backup_photo_reference_count: photoReferences,
    });

    return res.status(200).json({
      filename,
      csv,
      payrollPeriod: updatedPeriod,
      logCount: periodLogs.length,
      photoReferenceCount: photoReferences,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to back up attendance photos.",
    });
  }
}
