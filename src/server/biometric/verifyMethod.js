// @ts-nocheck

/** Only the live-verified F500 value FP is normalized in Phase 1. */
export function normalizeVerifyMethod(action) {
  if (action === undefined || action === null || action === "") return null;
  const raw = String(action);
  return raw.trim().toLowerCase() === "fp" ? "fingerprint" : null;
}
