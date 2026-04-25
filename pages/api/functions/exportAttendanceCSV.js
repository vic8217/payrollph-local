// @ts-nocheck
import { listRecords } from "@/server/entityStore";

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
    "Break Out",
    "Break In",
    "Time Out",
    "Hours Worked",
    "Status",
  ];
  const rows = filtered.map((log) => [
    log.date,
    log.employee_id,
    log.employee_name,
    log.time_in,
    log.break_time_out,
    log.break_time_in,
    log.time_out,
    log.hours_worked,
    log.status,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return res.status(200).json({
    filename: `attendance-${start_date || "all"}-${end_date || "all"}.csv`,
    csv,
  });
}
