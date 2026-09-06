// @ts-nocheck

function text(value) {
  return value === undefined || value === null ? null : String(value);
}

function intOrNull(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function validUtcDateParts(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second
  );
}

/**
 * Manufacturer Time is a device-local wall clock. The trailing Z is a literal,
 * not UTC. Apply UtcTimezoneMinutes to derive occurredAt.
 */
export function parseDeviceOccurredAt(payload) {
  const raw = text(payload?.Time);
  if (!raw) return { occurredAt: null, occurredAtLocal: null, utcTimezoneMinutes: intOrNull(payload?.UtcTimezoneMinutes) };

  const timezoneMinutes = intOrNull(payload?.UtcTimezoneMinutes);

  const f500Clock = raw.trim().match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})-?T(\d{1,2}):(\d{1,2}):(\d{1,2})(?:Z)?$/i
  );

  if (f500Clock && timezoneMinutes !== null) {
    const [, y, mo, d, h, mi, s] = f500Clock;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = Number(s);

    if (validUtcDateParts(year, month, day, hour, minute, second)) {
      const localWallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      return {
        occurredAt: new Date(localWallClockAsUtc - timezoneMinutes * 60_000),
        occurredAtLocal: raw,
        utcTimezoneMinutes: timezoneMinutes,
      };
    }
  }

  if (f500Clock && timezoneMinutes === null) {
    return { occurredAt: null, occurredAtLocal: raw, utcTimezoneMinutes: null };
  }

  return { occurredAt: null, occurredAtLocal: raw, utcTimezoneMinutes: timezoneMinutes };
}

export function textField(value) {
  return text(value);
}

export function intField(value) {
  return intOrNull(value);
}

export function isUniqueConflict(error) {
  return error?.code === "P2002";
}

export async function insertImmutableUnique(createFn, findExistingFn) {
  try {
    const record = await createFn();
    return { record, duplicate: false };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const record = await findExistingFn();
    return { record, duplicate: true };
  }
}
