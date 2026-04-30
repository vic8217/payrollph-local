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
  const raw = String(value || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = String(req.body?.code || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (!code) {
    return res.status(400).json({ error: "Employee code is required" });
  }

  const scannedCandidates = codeCandidates(code);

  const employees = await listRecords("Employee", { limit: 2000 });
  const employee = employees.find((emp) => {
    if (!isActiveEmployee(emp)) return false;
    const employeeCandidates = [
      ...codeCandidates(emp.employee_id),
      ...codeCandidates(emp.qr_code),
    ];
    return scannedCandidates.some((candidate) => employeeCandidates.includes(candidate));
  });

  if (employee) {
    return res.status(200).json({ employee });
  }

  return res.status(404).json({ error: "Employee not found" });
}
