// @ts-nocheck

export const DEFAULT_STALE_MS = 5 * 60 * 1000;

export function presenceStaleMs(env = process.env) {
  const parsed = Number.parseInt(String(env.BIOMETRIC_PRESENCE_STALE_MS || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_MS;
}

export function latestDeviceActivity(device) {
  const candidates = [device?.lastSeenAt, device?.lastLoginAt, device?.lastOnlineAt]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && Number.isFinite(value.getTime()));
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((value) => value.getTime())));
}

/**
 * Phase 1 presence is inferred from authenticated activity only.
 * Exact broker disconnect/offline is deferred.
 */
export function deriveConnectionStatus(device, now = new Date(), staleMs = DEFAULT_STALE_MS) {
  const last = latestDeviceActivity(device);
  if (!last) return "unknown";
  return now.getTime() - last.getTime() <= staleMs ? "online" : "stale";
}

export function deviceActivityUpdate(extra = {}) {
  const now = extra.lastSeenAt || new Date();
  return {
    lastSeenAt: now,
    lastOnlineAt: now,
    ...extra,
  };
}
