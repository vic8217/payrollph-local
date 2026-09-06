// @ts-nocheck

export const TIMELOG_ALLOWED_FIELDS = Object.freeze([
  "Event",
  "DeviceSerialNo",
  "LogID",
  "TransID",
  "Time",
  "UtcTimezoneMinutes",
  "UserID",
  "UserID_Base36",
  "AttendStat",
  "Action",
  "JobCode",
  "Photo",
  "BodyTemperature100",
  "AttendOnly",
  "Expired",
  "Latitude",
  "Longitude",
  "APStat",
  "TerminalType",
  "ProductName",
  "CloudId",
  "TerminalID",
]);

export const ADMINLOG_ALLOWED_FIELDS = Object.freeze([
  "Event",
  "DeviceSerialNo",
  "LogID",
  "TransID",
  "Time",
  "UtcTimezoneMinutes",
  "UserID",
  "AdminID",
  "Action",
  "Stat",
  "TerminalType",
  "ProductName",
  "CloudId",
  "TerminalID",
]);

const DENIED_FIELD_NAMES = new Set([
  "logimage",
  "facedata",
  "fingerdata",
  "palmdata",
  "password",
  "userpassword",
  "cardno",
  "carddata",
  "qr",
  "qrdata",
  "qrcode",
  "template",
  "templatedata",
]);

const BASE64_LIKE = /^(?:[A-Za-z0-9+/]{4}){20,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PHOTO_ALLOWED = new Set(["yes", "no", "true", "false", "0", "1", "y", "n"]);

function deniedFieldName(name) {
  const normalized = String(name || "").replace(/[_\-\s]/g, "").toLowerCase();
  if (DENIED_FIELD_NAMES.has(normalized)) return true;
  return /(?:face|finger|palm|card|qr|password|template|image|photoevidence)/i.test(normalized)
    && !["photo"].includes(normalized);
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function looksLikeBinaryBlob(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 80) return false;
  if (trimmed.startsWith("data:")) return true;
  return BASE64_LIKE.test(trimmed.replace(/\s+/g, ""));
}

function sanitizeValue(field, value) {
  if (value === undefined) return undefined;
  if (!isScalar(value)) return undefined;
  if (looksLikeBinaryBlob(value)) return undefined;

  if (field === "Photo") {
    const normalized = String(value).trim().toLowerCase();
    return PHOTO_ALLOWED.has(normalized) ? String(value).trim() : undefined;
  }

  return value;
}

export function sanitizeManufacturerPayload(payload, allowedFields = TIMELOG_ALLOWED_FIELDS) {
  const allowed = new Set(allowedFields);
  const sanitized = {};
  const discardedFieldNames = [];

  for (const [key, value] of Object.entries(payload && typeof payload === "object" ? payload : {})) {
    if (!allowed.has(key) || deniedFieldName(key)) {
      discardedFieldNames.push(key);
      continue;
    }
    const next = sanitizeValue(key, value);
    if (next === undefined) {
      discardedFieldNames.push(key);
      continue;
    }
    sanitized[key] = next;
  }

  return {
    sanitized,
    discardedFieldNames: [...new Set(discardedFieldNames)],
    payloadSanitized: true,
  };
}
