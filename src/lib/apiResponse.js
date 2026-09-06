const HTML_HINT = /<!DOCTYPE|<html[\s>]|<head[\s>]/i;

export function contentTypeIsJson(contentType) {
  return String(contentType || "").toLowerCase().includes("application/json");
}

export function sanitizeResponsePreview(text, maxLength = 72) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (HTML_HINT.test(normalized) || normalized.startsWith("<")) return "HTML document";
  return normalized.slice(0, maxLength);
}

export function parseApiJsonText(text, contentType = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { ok: false, data: null, reason: "empty" };
  if (!contentTypeIsJson(contentType) && (HTML_HINT.test(trimmed) || trimmed.startsWith("<"))) {
    return { ok: false, data: null, reason: "html" };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed), reason: null };
  } catch {
    return { ok: false, data: null, reason: "invalid_json" };
  }
}

export async function readApiJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const parsed = parseApiJsonText(text, contentType);
  if (!parsed.ok) {
    const preview = sanitizeResponsePreview(text);
    const error = new Error(
      `API ${response.status} returned ${contentType || "an unknown type"} instead of JSON${preview ? ` (${preview})` : ""}.`,
    );
    error.status = response.status;
    error.contentType = contentType;
    error.code = "NON_JSON_RESPONSE";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(parsed.data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.payload = parsed.data;
    throw error;
  }
  return parsed.data;
}
