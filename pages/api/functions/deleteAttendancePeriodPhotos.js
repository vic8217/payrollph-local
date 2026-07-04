// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords, updateRecord } from "@/server/entityStore";

const ADMIN_ROLES = new Set(["super_admin", "admin", "user"]);
const RETENTION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_FIELDS = [
  "time_in_photo_url",
  "break_time_out_photo_url",
  "break_time_in_photo_url",
  "time_out_photo_url",
];

function uploadDir() {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "public", "uploads");
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
    const error = new Error("Not authorized to delete attendance photos.");
    error.statusCode = 403;
    throw error;
  }

  if (session.user.role === "super_admin") return;
  if (sessionCompanyProfileIds(session).includes(String(companyProfileId || ""))) return;

  const error = new Error("You can only delete attendance photos for your assigned company.");
  error.statusCode = 403;
  throw error;
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

function parseManilaDate(date) {
  return new Date(`${date}T00:00:00+08:00`);
}

function formatManilaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function differenceInCalendarDays(left, right) {
  const leftDay = Date.UTC(left.getUTCFullYear(), left.getUTCMonth(), left.getUTCDate());
  const rightDay = Date.UTC(right.getUTCFullYear(), right.getUTCMonth(), right.getUTCDate());
  return Math.round((leftDay - rightDay) / DAY_MS);
}

function startOfWeek(date, weekStartsOn) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  start.setDate(start.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function payrollPeriodStartForDate(date = new Date(), company) {
  const startDay = Number.isInteger(Number(company?.payroll_period_start_day))
    ? Math.min(6, Math.max(0, Number(company.payroll_period_start_day)))
    : 6;
  const lengthDays = Number.isInteger(Number(company?.payroll_period_length_days))
    ? Math.min(31, Math.max(1, Number(company.payroll_period_length_days)))
    : 7;
  const anchorStart = startOfWeek(new Date(2024, 0, 1), startDay);
  const daysSinceAnchor = differenceInCalendarDays(date, anchorStart);
  const periodIndex = Math.floor(daysSinceAnchor / lengthDays);
  return addDays(anchorStart, periodIndex * lengthDays);
}

async function assertRetentionElapsed(companyProfileId, startDate) {
  const companies = await listRecords("CompanyProfile", { limit: 10000 });
  const company = companies.find((item) => String(item.id || "") === String(companyProfileId || ""));
  const currentPeriodStart = payrollPeriodStartForDate(new Date(), company);
  const eligibleOn = addDays(parseManilaDate(startDate), RETENTION_DAYS);
  if (currentPeriodStart.getTime() >= eligibleOn.getTime()) return;

  const error = new Error(`Attendance photos for this payroll period can be deleted once the current payroll period reaches ${formatManilaDate(eligibleOn)}.`);
  error.statusCode = 409;
  throw error;
}

function uploadFileNameFromUrl(photoUrl) {
  const pathname = String(photoUrl || "").split("?")[0];
  const marker = "/api/uploads/";
  const index = pathname.indexOf(marker);
  const rawName = index >= 0 ? pathname.slice(index + marker.length) : pathname;
  const fileName = path.basename(rawName);
  return fileName && fileName === rawName ? fileName : "";
}

function photoUrlsFromLog(log) {
  return [...new Set([
    ...PHOTO_FIELDS.map((field) => log[field]),
    log.photo_url,
  ].filter(Boolean))];
}

function isPhotoUrlStillReferenced(logs, photoUrl) {
  return logs.some((log) =>
    PHOTO_FIELDS.some((field) => log[field] === photoUrl) || log.photo_url === photoUrl
  );
}

async function deleteUploadFile(photoUrl, remainingLogs) {
  const fileName = uploadFileNameFromUrl(photoUrl);
  if (!fileName || isPhotoUrlStillReferenced(remainingLogs, photoUrl)) return false;

  try {
    await fs.unlink(path.join(uploadDir(), fileName));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
    await assertRetentionElapsed(companyProfileId, startDate);

    const logs = await listRecords("AttendanceLog", { limit: 10000 });
    const periodLogs = logs.filter((log) =>
      String(log.company_profile_id || "") === companyProfileId &&
      log.date >= startDate &&
      log.date <= endDate &&
      photoUrlsFromLog(log).length > 0
    );

    const deletedAt = new Date().toISOString();
    const deletedBy = session.user.email || session.user.name || session.user.id || null;
    const photoUrls = new Set();
    let clearedReferences = 0;

    await Promise.all(periodLogs.map((log) => {
      const updates = {
        attendance_photos_deleted_at: deletedAt,
        attendance_photos_deleted_by: deletedBy,
        attendance_photos_deleted_period_start: startDate,
        attendance_photos_deleted_period_end: endDate,
      };

      for (const field of PHOTO_FIELDS) {
        if (log[field]) {
          photoUrls.add(log[field]);
          updates[field] = null;
          updates[`${field.replace(/_url$/, "")}_deleted_at`] = deletedAt;
          updates[`${field.replace(/_url$/, "")}_deleted_by`] = deletedBy;
          clearedReferences += 1;
        }
      }

      if (log.photo_url) {
        photoUrls.add(log.photo_url);
        updates.photo_url = null;
        updates.photo_action = null;
        clearedReferences += 1;
      }

      return updateRecord("AttendanceLog", log.id, updates);
    }));

    const remainingLogs = await listRecords("AttendanceLog", { limit: 10000 });
    let deletedFiles = 0;
    for (const photoUrl of photoUrls) {
      if (await deleteUploadFile(photoUrl, remainingLogs)) {
        deletedFiles += 1;
      }
    }

    return res.status(200).json({
      ok: true,
      period: { start_date: startDate, end_date: endDate },
      logsUpdated: periodLogs.length,
      clearedReferences,
      deletedFiles,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to delete payroll-period attendance photos.",
    });
  }
}
