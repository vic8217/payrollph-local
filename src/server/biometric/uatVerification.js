// @ts-nocheck

export const UAT_DEVICE_SERIAL = "202605260025";
export const UAT_MAPPED_LOG_ID = "15";
export const UAT_QUARANTINE_LOG_ID = "14";

export const FORBIDDEN_PAYLOAD_KEY_PATTERNS = [
  /^logimage$/i,
  /^facedata$/i,
  /^fingerdata$/i,
  /^palmdata$/i,
  /password/i,
  /card(no|data|id)?$/i,
  /^qr(code|data)?$/i,
];

const IMMUTABLE_FIELDS = [
  "id",
  "deviceSerial",
  "logId",
  "deviceUserId",
  "occurredAt",
  "occurredAtLocal",
  "utcTimezoneMinutes",
  "attendStatus",
  "verifyMethod",
  "verifyMethodNormalized",
  "jobCode",
  "transId",
  "rawPayload",
  "payloadSanitized",
  "discardedFieldNames",
  "ingestSource",
  "processingStatus",
  "employeeRecordId",
  "employeeId",
  "companyProfileId",
  "attendanceLogId",
  "mappedSlot",
  "receivedAt",
  "createdAt",
];

function normalizeKey(name) {
  return String(name || "").replace(/[_\-\s]/g, "");
}

export function findForbiddenPayloadKeys(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.keys(payload).filter((key) => (
    FORBIDDEN_PAYLOAD_KEY_PATTERNS.some((pattern) => pattern.test(key) || pattern.test(normalizeKey(key)))
  ));
}

export function timeLogSnapshot(row) {
  if (!row) return null;
  const snapshot = {};
  for (const field of IMMUTABLE_FIELDS) {
    const value = row[field];
    snapshot[field] = value instanceof Date ? value.toISOString() : value;
  }
  return snapshot;
}

export function snapshotDiff(before, after) {
  if (!before || !after) return ["missing_row"];
  const changed = [];
  for (const field of IMMUTABLE_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changed.push(field);
  }
  return changed;
}

export function attendanceLooksBiometricDerived(record, { deviceSerial, logIds, timeLogIds } = {}) {
  if (!record) return false;
  const data = record.data && typeof record.data === "object" ? record.data : record;
  const haystack = JSON.stringify(data).toLowerCase();
  if (haystack.includes("biometric_time_log") || haystack.includes("biometrictimelog")) return true;
  if (String(data.source || data.punch_source || data.ingest_source || "").toLowerCase().includes("biometric")) return true;
  const serial = String(deviceSerial || "").toLowerCase();
  if (serial && haystack.includes(serial) && (logIds || []).some((id) => haystack.includes(String(id).toLowerCase()))) {
    return true;
  }
  return (timeLogIds || []).some((id) => id && haystack.includes(String(id).toLowerCase()));
}

export function evaluatePhase1Uat({
  deviceSerial = UAT_DEVICE_SERIAL,
  logs15 = [],
  logs14 = [],
  attendanceHits = [],
} = {}) {
  const log15 = logs15[0] || null;
  const log14 = logs14[0] || null;
  const forbidden15 = findForbiddenPayloadKeys(log15?.rawPayload);
  const checks = [
    {
      id: "log15_exists_once",
      ok: logs15.length === 1,
      detail: `count=${logs15.length} for (${deviceSerial}, ${UAT_MAPPED_LOG_ID})`,
    },
    {
      id: "log14_quarantined",
      ok: Boolean(log14) && log14.processingStatus === "company_not_authorized",
      detail: log14 ? `processingStatus=${log14.processingStatus}` : "Log ID 14 not found",
    },
    {
      id: "log15_mapped_pending",
      ok: Boolean(log15) && log15.processingStatus === "mapped_pending_attendance",
      detail: log15 ? `processingStatus=${log15.processingStatus}` : "Log ID 15 not found",
    },
    {
      id: "no_attendance_from_biometric",
      ok: attendanceHits.length === 0
        && !log15?.attendanceLogId
        && !log14?.attendanceLogId
        && !log15?.mappedSlot
        && !log14?.mappedSlot,
      detail: attendanceHits.length
        ? `attendanceHits=${attendanceHits.length}`
        : `attendanceLogId15=${log15?.attendanceLogId || "null"} attendanceLogId14=${log14?.attendanceLogId || "null"}`,
    },
    {
      id: "log15_payload_sanitized",
      ok: Boolean(log15) && forbidden15.length === 0,
      detail: forbidden15.length ? `forbiddenKeys=${forbidden15.join(",")}` : "no credential fields",
    },
    {
      id: "log15_verify_method_fingerprint",
      ok: Boolean(log15) && log15.verifyMethodNormalized === "fingerprint",
      detail: `verifyMethodNormalized=${log15?.verifyMethodNormalized || "null"} verifyMethod=${log15?.verifyMethod || "null"}`,
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
    log15,
    log14,
  };
}
