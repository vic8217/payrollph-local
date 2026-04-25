// @ts-nocheck
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diffHours(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 36e5);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const employeeId = req.body?.employee_id;
  const date = req.body?.today || todayInManila();

  if (!employeeId) {
    return res.status(400).json({ error: "employee_id is required" });
  }

  const [employee] = await listRecords("Employee", {
    filter: { employee_id: employeeId },
    limit: 1,
  });

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const existingLogs = await listRecords("AttendanceLog", {
    filter: {
      employee_id: employeeId,
      date,
      company_profile_id: employee.company_profile_id,
    },
    sort: "-created_date",
    limit: 1,
  });

  const now = new Date().toISOString();
  const employeeName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
  const [lastLog] = existingLogs;

  if (!lastLog) {
    const log = await createRecord("AttendanceLog", {
      company_profile_id: employee.company_profile_id,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      date,
      time_in: now,
      status: "pending",
      day_type: "regular",
    });
    return res.status(200).json({ action: "time_in", log });
  }

  if (!lastLog.break_time_out) {
    const log = await updateRecord("AttendanceLog", lastLog.id, {
      break_time_out: now,
    });
    return res.status(200).json({ action: "break_time_out", log });
  }

  if (!lastLog.break_time_in) {
    const log = await updateRecord("AttendanceLog", lastLog.id, {
      break_time_in: now,
    });
    return res.status(200).json({ action: "break_time_in", log });
  }

  if (!lastLog.time_out) {
    const grossHours = diffHours(lastLog.time_in, now);
    const breakHours =
      lastLog.break_time_out && lastLog.break_time_in
        ? diffHours(lastLog.break_time_out, lastLog.break_time_in)
        : 0;
    const hoursWorked = Math.max(0, grossHours - breakHours);
    const log = await updateRecord("AttendanceLog", lastLog.id, {
      time_out: now,
      hours_worked: Number(hoursWorked.toFixed(2)),
      overtime_hours: Number(Math.max(0, hoursWorked - 8).toFixed(2)),
    });
    return res.status(200).json({ action: "time_out", log });
  }

  return res.status(409).json({ error: "Attendance for today is already complete" });
}
