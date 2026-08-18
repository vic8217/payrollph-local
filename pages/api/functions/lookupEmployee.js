// @ts-nocheck
import { listRecords } from "@/server/entityStore";
import { manilaDateString } from "@/lib/dateUtils";
import { resolveEffectiveEmployeeShift, scheduleDateTimes } from "@/lib/shiftSettings";

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/-PayrollPH$/i, "")
    .replace(/^.*[?&](?:empId|employeeId|employee_id|id|code|qr|qr_code)=([^&]+).*$/i, "$1")
    .replace(/^["'`]+|["'`]+$/g, "")
    .toUpperCase();
}

function cleanRawValue(value) {
  return String(value || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function isActiveEmployee(employee) {
  return String(employee?.status || "active").toLowerCase() === "active";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function addCandidate(set, value) {
  const normalized = normalizeCode(safeDecode(value));
  if (normalized) set.add(normalized);
}

function codeCandidates(value) {
  const raw = cleanRawValue(value);
  const candidates = new Set();
  addCandidate(candidates, raw);

  try {
    const url = new URL(raw);
    ["empId", "employeeId", "employee_id", "id", "code", "qr", "qr_code"].forEach((key) => {
      addCandidate(candidates, url.searchParams.get(key));
    });
    url.pathname.split("/").forEach((part) => addCandidate(candidates, part));
  } catch {
    // Not a URL; continue with generic extraction.
  }

  raw.split(/[\s,/|:;]+/).forEach((part) => addCandidate(candidates, part));

  const idLikeMatches = raw.match(/[A-Z0-9]{2,16}-[A-Z0-9-]{4,}/gi) || [];
  idLikeMatches.forEach((part) => addCandidate(candidates, part));

  return [...candidates].filter(Boolean);
}

function metadataCandidates(value) {
  const raw = cleanRawValue(value);
  const metadata = {
    employeeRecordIds: new Set(),
    companyProfileIds: new Set(),
  };

  const addRecordId = (item) => {
    const cleaned = cleanRawValue(safeDecode(item));
    if (cleaned) metadata.employeeRecordIds.add(cleaned);
  };
  const addCompanyId = (item) => {
    const cleaned = cleanRawValue(safeDecode(item));
    if (cleaned) metadata.companyProfileIds.add(cleaned);
  };

  try {
    const url = new URL(raw);
    ["employee_record_id", "record_id", "entity_id"].forEach((key) => addRecordId(url.searchParams.get(key)));
    ["company_profile_id", "companyProfileId", "company_id", "companyId"].forEach((key) => addCompanyId(url.searchParams.get(key)));
  } catch {
    // Not a URL; continue with generic extraction.
  }

  const recordMatches = raw.match(/(?:employee_record_id|record_id|entity_id)=([^&\s,|;]+)/gi) || [];
  recordMatches.forEach((match) => addRecordId(match.replace(/^[^=]+=/, "")));

  const companyMatches = raw.match(/(?:company_profile_id|companyProfileId|company_id|companyId)=([^&\s,|;]+)/gi) || [];
  companyMatches.forEach((match) => addCompanyId(match.replace(/^[^=]+=/, "")));

  return {
    employeeRecordIds: [...metadata.employeeRecordIds],
    companyProfileIds: [...metadata.companyProfileIds],
  };
}

function employeeMatchesCandidates(employee, scannedCandidates) {
  const employeeCandidates = [
    ...codeCandidates(employee.employee_id),
    ...codeCandidates(employee.qr_code),
    ...(Array.isArray(employee.employee_id_aliases)
      ? employee.employee_id_aliases.flatMap((alias) => codeCandidates(alias))
      : []),
  ];
  return scannedCandidates.some((candidate) => employeeCandidates.includes(candidate));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = cleanRawValue(req.body?.code);
  const requestedCompanyProfileId = cleanRawValue(req.body?.company_profile_id);
  if (!code) {
    return res.status(400).json({ error: "Employee code is required" });
  }

  const scannedCandidates = codeCandidates(code);
  const scannedMetadata = metadataCandidates(code);
  if (requestedCompanyProfileId) scannedMetadata.companyProfileIds.push(requestedCompanyProfileId);

  const requestedCompanies = [...new Set(scannedMetadata.companyProfileIds.filter(Boolean))];
  // Scope the database query before applying the result limit. Loading a global
  // page and filtering it afterward can exclude valid employees from the active
  // company when they fall outside that page (commonly recently added staff).
  const employeeBatches = requestedCompanies.length
    ? await Promise.all(requestedCompanies.map(companyProfileId =>
      listRecords("Employee", { filter: { company_profile_id: companyProfileId }, limit: 2000 })))
    : [await listRecords("Employee", { limit: 2000 })];
  const employees = [...new Map(
    employeeBatches.flat().map(employee => [String(employee.id || employee.employee_id), employee])
  ).values()];
  const activeEmployees = employees.filter(isActiveEmployee);

  const belongsToRequestedCompany = emp => requestedCompanies.length === 0 ||
    requestedCompanies.includes(String(emp.company_profile_id || ""));
  const recordMatchedEmployee = scannedMetadata.employeeRecordIds.length
    ? activeEmployees.find((emp) =>
      scannedMetadata.employeeRecordIds.includes(String(emp.id || "")) && belongsToRequestedCompany(emp))
    : null;

  if (recordMatchedEmployee) {
    return res.status(200).json({ employee: await withCurrentShift(recordMatchedEmployee) });
  }

  const employeeMatches = employees.filter((emp) => {
    if (!isActiveEmployee(emp)) return false;
    return employeeMatchesCandidates(emp, scannedCandidates);
  });
  const employee = requestedCompanies.length
    ? employeeMatches.find(belongsToRequestedCompany)
    : employeeMatches[0];

  if (employee) {
    return res.status(200).json({ employee: await withCurrentShift(employee) });
  }

  const inactiveEmployee = employees.find(emp =>
    !isActiveEmployee(emp) && employeeMatchesCandidates(emp, scannedCandidates));
  if (inactiveEmployee) {
    return res.status(403).json({
      code: "EMPLOYEE_INACTIVE",
      error: "This employee profile is inactive. Please contact HR.",
    });
  }

  if (requestedCompanies.length) {
    const allEmployees = await listRecords("Employee");
    const otherCompanyEmployee = allEmployees.find(emp =>
      isActiveEmployee(emp) &&
      !belongsToRequestedCompany(emp) &&
      employeeMatchesCandidates(emp, scannedCandidates));
    if (otherCompanyEmployee) {
      return res.status(403).json({
        code: "EMPLOYEE_COMPANY_MISMATCH",
        error: "This Employee ID belongs to a different company. Please ask HR to open the correct company portal.",
      });
    }
  }

  return res.status(404).json({ error: "Employee not found" });
}

async function withCurrentShift(employee) {
  const date = manilaDateString();
  const [settings, logs] = await Promise.all([
    listRecords("Settings", { filter: { company_profile_id: employee.company_profile_id }, limit: 1000 }),
    listRecords("AttendanceLog", {
      filter: { company_profile_id: employee.company_profile_id, employee_record_id: employee.id },
      sort: "-created_date",
      limit: 10,
    }),
  ]);
  const shift = resolveEffectiveEmployeeShift(employee, settings, date);
  const times = scheduleDateTimes(date, shift);
  const log = logs.find(item => item.status !== "rejected" && item.date === date);
  const attendanceStatus = !log
    ? "Not Yet Timed In"
    : log.time_out ? "Timed Out"
      : log.break_time_out && !log.break_time_in ? "On Break"
        : log.time_in ? "Timed In" : "Not Yet Timed In";
  return {
    ...employee,
    effective_schedule: shift ? {
      date,
      id: shift.id,
      name: shift.setting_name || "Work Shift",
      startTime: shift.shift_start_time,
      endTime: shift.shift_end_time,
      breakStartTime: shift.break_start_time || employee.break_time || null,
      breakEndTime: shift.break_end_time || null,
      breakDurationMinutes: Number(shift.break_duration_minutes || employee.break_duration_minutes) || null,
      startDateTime: times?.start.toISOString() || null,
      endDateTime: times?.end.toISOString() || null,
      earliestAllowedTimeIn: times?.earliestTimeIn.toISOString() || null,
      isOvernight: Boolean(times?.isOvernight),
      isRestDay: Boolean(shift.is_rest_day),
      attendanceStatus,
    } : { date, isRestDay: false, attendanceStatus, noSchedule: true },
  };
}
