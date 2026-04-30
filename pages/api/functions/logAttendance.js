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

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addThirtyMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const total = hours * 60 + minutes + 30;
  const normalized = total % (24 * 60);
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`,
    crossesMidnight: total >= 24 * 60,
  };
}

function scheduledBreak(employee, date) {
  if (!employee.break_time) return null;

  const [breakHour] = employee.break_time.split(":").map(Number);
  const breakDate = employee.work_schedule === "night_shift" && breakHour < 12
    ? addDays(date, 1)
    : date;
  const breakIn = addThirtyMinutes(employee.break_time);
  const breakInDate = breakIn.crossesMidnight ? addDays(breakDate, 1) : breakDate;

  return {
    break_time_out: new Date(`${breakDate}T${employee.break_time}:00+08:00`).toISOString(),
    break_time_in: new Date(`${breakInDate}T${breakIn.time}:00+08:00`).toISOString(),
  };
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
    const autoBreak = scheduledBreak(employee, date);
    const log = await createRecord("AttendanceLog", {
      company_profile_id: employee.company_profile_id,
      employee_id: employee.employee_id,
      employee_name: employeeName,
      date,
      time_in: now,
      ...(autoBreak || {}),
      status: "pending",
      day_type: "regular",
    });
    return res.status(200).json({ action: "time_in", log });
  }

  let currentLog = lastLog;
  const autoBreak = scheduledBreak(employee, date);
  if (autoBreak && (!currentLog.break_time_out || !currentLog.break_time_in)) {
    currentLog = await updateRecord("AttendanceLog", currentLog.id, {
      ...(!currentLog.break_time_out ? { break_time_out: autoBreak.break_time_out } : {}),
      ...(!currentLog.break_time_in ? { break_time_in: autoBreak.break_time_in } : {}),
    });
  }

  if (!currentLog.break_time_out) {
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_out: now,
    });
    return res.status(200).json({ action: "break_time_out", log });
  }

  if (!currentLog.break_time_in) {
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      break_time_in: now,
    });
    return res.status(200).json({ action: "break_time_in", log });
  }

  if (!currentLog.time_out) {
    const grossHours = diffHours(currentLog.time_in, now);
    const breakHours =
      currentLog.break_time_out && currentLog.break_time_in
        ? diffHours(currentLog.break_time_out, currentLog.break_time_in)
        : 0;
    const hoursWorked = Math.max(0, grossHours - breakHours);
    const log = await updateRecord("AttendanceLog", currentLog.id, {
      time_out: now,
      hours_worked: Number(hoursWorked.toFixed(2)),
      overtime_hours: Number(Math.max(0, hoursWorked - 8).toFixed(2)),
    });
    return res.status(200).json({ action: "time_out", log });
  }

  return res.status(409).json({ error: "Attendance for today is already complete" });
}
