// @ts-nocheck
import { prisma } from "../prisma.js";

function text(value) {
  return value === undefined || value === null ? null : String(value);
}

function intOrNull(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function sourceIpFromRequest(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export function parseDeviceOccurredAt(payload) {
  const raw = text(payload.Time);
  if (!raw) return { occurredAt: null, occurredAtLocal: null };
  const timezoneMinutes = intOrNull(payload.UtcTimezoneMinutes);
  const normalized = raw.replace(/-T/, "T");
  let instant = null;

  // Some F500 firmware sends a trailing Z while also providing UtcTimezoneMinutes.
  // Preserve the raw value and, when an explicit numeric offset is absent, treat the
  // clock reading as device-local time using UtcTimezoneMinutes.
  const clock = normalized.replace(/Z$/i, "");
  const simpleClock = clock.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/);
  if (simpleClock && timezoneMinutes !== null) {
    const localAsUtc = Date.parse(`${simpleClock[1]}Z`);
    if (Number.isFinite(localAsUtc)) instant = new Date(localAsUtc - timezoneMinutes * 60_000);
  } else {
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) instant = new Date(parsed);
  }

  return { occurredAt: instant, occurredAtLocal: raw };
}

function isUniqueConflict(error) {
  return error?.code === "P2002";
}

export async function storeTimeLog({ device, payload, sourceIp }) {
  const logId = text(payload.LogID);
  if (!logId) throw new Error("TIME_LOG_ID_REQUIRED");
  const { occurredAt, occurredAtLocal } = parseDeviceOccurredAt(payload);

  try {
    const record = await prisma.biometricTimeLog.create({
      data: {
        companyProfileId: device.companyProfileId,
        deviceId: device.id,
        deviceSerial: device.deviceSerial,
        logId,
        deviceUserId: text(payload.UserID),
        occurredAt,
        occurredAtLocal,
        utcTimezoneMinutes: intOrNull(payload.UtcTimezoneMinutes),
        attendStatus: text(payload.AttendStat),
        verifyMethod: text(payload.Action),
        jobCode: text(payload.JobCode),
        transId: text(payload.TransID),
        rawPayload: payload,
        sourceIp,
        processingStatus: "received",
      },
    });
    return { record, duplicate: false };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const record = await prisma.biometricTimeLog.findUnique({
      where: { deviceSerial_logId: { deviceSerial: device.deviceSerial, logId } },
    });
    return { record, duplicate: true };
  }
}

export async function storeAdminLog({ device, payload, sourceIp }) {
  const logId = text(payload.LogID);
  if (!logId) throw new Error("ADMIN_LOG_ID_REQUIRED");
  const { occurredAt, occurredAtLocal } = parseDeviceOccurredAt(payload);

  try {
    const record = await prisma.biometricAdminLog.create({
      data: {
        companyProfileId: device.companyProfileId,
        deviceId: device.id,
        deviceSerial: device.deviceSerial,
        logId,
        adminId: text(payload.AdminID),
        deviceUserId: text(payload.UserID),
        occurredAt,
        occurredAtLocal,
        action: text(payload.Action),
        stat: text(payload.Stat),
        transId: text(payload.TransID),
        rawPayload: payload,
        sourceIp,
        processingStatus: "received",
      },
    });
    return { record, duplicate: false };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const record = await prisma.biometricAdminLog.findUnique({
      where: { deviceSerial_logId: { deviceSerial: device.deviceSerial, logId } },
    });
    return { record, duplicate: true };
  }
}
