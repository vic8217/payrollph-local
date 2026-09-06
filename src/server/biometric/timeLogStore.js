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

export function parseDeviceOccurredAt(payload) {
  const raw = text(payload.Time);
  if (!raw) return { occurredAt: null, occurredAtLocal: null };

  const timezoneMinutes = intOrNull(payload.UtcTimezoneMinutes);

  // F500 observed payload example:
  //   Time="2026-9-6-T8:55:20Z", UtcTimezoneMinutes="480"
  // Despite the trailing Z, this value represents the device-local wall clock.
  // Parse the components explicitly and apply UtcTimezoneMinutes to obtain UTC.
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
      };
    }
  }

  // Fallback for firmware that sends a standards-compliant ISO timestamp.
  const normalized = raw.replace(/-T/, "T");
  const parsed = Date.parse(normalized);
  return {
    occurredAt: Number.isFinite(parsed) ? new Date(parsed) : null,
    occurredAtLocal: raw,
  };
}

function isUniqueConflict(error) {
  return error?.code === "P2002";
}

async function resolveMapping(deviceId, deviceUserId) {
  if (!deviceUserId) return null;
  return prisma.biometricUserMapping.findFirst({
    where: { deviceId, deviceUserId, status: "active" },
  });
}

async function companyAllowed(deviceId, companyProfileId) {
  if (!companyProfileId) return false;
  const allowed = await prisma.biometricDeviceCompany.findFirst({
    where: { deviceId, companyProfileId, status: "active" },
    select: { id: true },
  });
  return Boolean(allowed);
}

export async function storeTimeLog({ device, payload, sourceIp }) {
  const logId = text(payload.LogID);
  if (!logId) throw new Error("TIME_LOG_ID_REQUIRED");
  const deviceUserId = text(payload.UserID);
  const { occurredAt, occurredAtLocal } = parseDeviceOccurredAt(payload);
  const mapping = await resolveMapping(device.id, deviceUserId);
  const mappingAllowed = mapping
    ? await companyAllowed(device.id, mapping.companyProfileId)
    : false;

  // Raw storage always succeeds for a registered device. Company/employee fields
  // are populated only from an active mapping whose company is authorized on the
  // physical device. Unmapped punches remain auditable and can be resolved later.
  const processingStatus = mapping
    ? (mappingAllowed ? "mapped_pending_attendance" : "company_not_authorized")
    : "unmapped_user";

  try {
    const record = await prisma.biometricTimeLog.create({
      data: {
        companyProfileId: mappingAllowed ? mapping.companyProfileId : null,
        deviceId: device.id,
        deviceSerial: device.deviceSerial,
        logId,
        deviceUserId,
        occurredAt,
        occurredAtLocal,
        utcTimezoneMinutes: intOrNull(payload.UtcTimezoneMinutes),
        attendStatus: text(payload.AttendStat),
        verifyMethod: text(payload.Action),
        jobCode: text(payload.JobCode),
        transId: text(payload.TransID),
        rawPayload: payload,
        sourceIp,
        processingStatus,
        employeeRecordId: mappingAllowed ? mapping.employeeRecordId : null,
        employeeId: mappingAllowed ? mapping.employeeId : null,
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
        companyProfileId: null,
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
