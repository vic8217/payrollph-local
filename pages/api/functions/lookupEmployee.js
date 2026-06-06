// @ts-nocheck
import { listRecords } from "@/server/entityStore";

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

  const employees = await listRecords("Employee", { limit: 2000 });
  const activeEmployees = employees.filter(isActiveEmployee);

  const recordMatchedEmployee = scannedMetadata.employeeRecordIds.length
    ? activeEmployees.find((emp) => scannedMetadata.employeeRecordIds.includes(String(emp.id || "")))
    : null;

  if (recordMatchedEmployee) {
    return res.status(200).json({ employee: recordMatchedEmployee });
  }

  const employeeMatches = employees.filter((emp) => {
    if (!isActiveEmployee(emp)) return false;
    const employeeCandidates = [
      ...codeCandidates(emp.employee_id),
      ...codeCandidates(emp.qr_code),
    ];
    return scannedCandidates.some((candidate) => employeeCandidates.includes(candidate));
  });
  const employee = scannedMetadata.companyProfileIds.length
    ? employeeMatches.find((emp) => scannedMetadata.companyProfileIds.includes(String(emp.company_profile_id || ""))) || employeeMatches[0]
    : employeeMatches[0];

  if (employee) {
    return res.status(200).json({ employee });
  }

  return res.status(404).json({ error: "Employee not found" });
}
