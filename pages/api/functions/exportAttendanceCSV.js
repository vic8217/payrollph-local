// @ts-nocheck
import { listRecords } from "@/server/entityStore";

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatLocation(location) {
  if (!location || typeof location !== "object") return "";
  if (Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
    const accuracy = location.accuracy ? ` +/- ${location.accuracy}m` : "";
    return `${location.latitude},${location.longitude}${accuracy}`;
  }
  return location.status || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { company_profile_id, start_date, end_date } = req.body || {};
  const logs = await listRecords("AttendanceLog", {
    filter: company_profile_id ? { company_profile_id } : {},
    sort: "date",
    limit: 5000,
  });

  const filtered = logs.filter((log) => {
    if (start_date && log.date < start_date) return false;
    if (end_date && log.date > end_date) return false;
    return true;
  });

  const header = [
    "Date",
    "Employee ID",
    "Employee Name",
    "Time In",
    "Time In GPS",
    "Break Out",
    "Break Out GPS",
    "Break In",
    "Break In GPS",
    "Time Out",
    "Time Out GPS",
    "Hours Worked",
    "Status",
  ];
  const rows = filtered.map((log) => [
    log.date,
    log.employee_id,
    log.employee_name,
    log.time_in,
    formatLocation(log.time_in_location),
    log.break_time_out,
    formatLocation(log.break_time_out_location),
    log.break_time_in,
    formatLocation(log.break_time_in_location),
    log.time_out,
    formatLocation(log.time_out_location),
    log.hours_worked,
    log.status,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return res.status(200).json({
    filename: `attendance-${start_date || "all"}-${end_date || "all"}.csv`,
    csv,
  });
}
