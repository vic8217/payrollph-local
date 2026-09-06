// @ts-nocheck
import { prisma } from "../prisma.js";
import { recordBiometricAudit } from "./audit.js";
import { assignedCompanyId, classifyTimeLog } from "./classifyTimeLog.js";
import { ADMINLOG_ALLOWED_FIELDS, sanitizeManufacturerPayload } from "./sanitizePayload.js";
import { insertImmutableUnique, intField, parseDeviceOccurredAt, textField } from "./time.js";
import { normalizeVerifyMethod } from "./verifyMethod.js";

export { parseDeviceOccurredAt } from "./time.js";

export function sourceIpFromRequest(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

async function resolveMapping(deviceId, deviceUserId) {
  if (!deviceUserId) return null;
  return prisma.biometricUserMapping.findFirst({
    where: { deviceId, deviceUserId, status: "active" },
  });
}

function attachedIdentity(decision, mapping) {
  if (!decision.attachEmployee || !mapping) {
    return { companyProfileId: null, employeeRecordId: null, employeeId: null };
  }
  return {
    companyProfileId: mapping.companyProfileId,
    employeeRecordId: mapping.employeeRecordId,
    employeeId: mapping.employeeId,
  };
}

export async function storeTimeLog({ device, payload, sourceIp, ingestSource = "push" }) {
  const { sanitized, discardedFieldNames } = sanitizeManufacturerPayload(payload);
  const logId = textField(sanitized.LogID || payload?.LogID);
  if (!logId) throw new Error("TIME_LOG_ID_REQUIRED");

  const deviceUserId = textField(sanitized.UserID);
  const { occurredAt, occurredAtLocal, utcTimezoneMinutes } = parseDeviceOccurredAt(sanitized);
  const mapping = await resolveMapping(device.id, deviceUserId);
  const companyId = assignedCompanyId(device);
  const decision = classifyTimeLog({ mapping, assignedCompanyId: companyId });
  const identity = attachedIdentity(decision, mapping);
  const verifyMethod = textField(sanitized.Action);

  const result = await insertImmutableUnique(
    () => prisma.biometricTimeLog.create({
      data: {
        ...identity,
        deviceId: device.id,
        deviceSerial: device.deviceSerial,
        logId,
        deviceUserId,
        occurredAt,
        occurredAtLocal,
        utcTimezoneMinutes: utcTimezoneMinutes ?? intField(sanitized.UtcTimezoneMinutes),
        attendStatus: textField(sanitized.AttendStat),
        verifyMethod,
        verifyMethodNormalized: normalizeVerifyMethod(verifyMethod),
        jobCode: textField(sanitized.JobCode),
        transId: textField(sanitized.TransID),
        rawPayload: sanitized,
        payloadSanitized: true,
        discardedFieldNames,
        ingestSource,
        sourceIp,
        processingStatus: decision.processingStatus,
      },
    }),
    () => prisma.biometricTimeLog.findUnique({
      where: { deviceSerial_logId: { deviceSerial: device.deviceSerial, logId } },
    }),
  );

  const auditBase = {
    actorType: "device",
    actorId: device.deviceSerial,
    deviceId: device.id,
    deviceSerial: device.deviceSerial,
    biometricTimeLogId: result.record?.id || null,
    details: {
      logId,
      deviceUserId,
      transId: textField(sanitized.TransID),
      processingStatus: result.duplicate ? result.record?.processingStatus : decision.processingStatus,
      discardedFieldNames,
    },
  };

  if (result.duplicate) {
    await recordBiometricAudit({
      ...auditBase,
      companyProfileId: result.record?.companyProfileId || null,
      eventType: "ingest_duplicate",
      result: "duplicate",
      reasonCode: "DEVICE_SERIAL_LOG_ID",
    });
    return result;
  }

  if (decision.securityEvent) {
    await recordBiometricAudit({
      ...auditBase,
      companyProfileId: companyId,
      eventType: "ingest_held_unauthorized",
      result: "held",
      reasonCode: "MAPPING_COMPANY_MISMATCH",
      details: {
        ...auditBase.details,
        mappingCompanyProfileId: mapping?.companyProfileId || null,
        deviceCompanyProfileId: companyId,
      },
    });
  } else if (decision.processingStatus === "unmapped_user") {
    await recordBiometricAudit({
      ...auditBase,
      companyProfileId: companyId,
      eventType: "ingest_held_unmapped",
      result: "held",
      reasonCode: "UNMAPPED_USER",
    });
  } else {
    await recordBiometricAudit({
      ...auditBase,
      companyProfileId: identity.companyProfileId,
      eventType: "ingest_accepted",
      result: "success",
      reasonCode: "MAPPED_PENDING_ATTENDANCE",
    });
  }

  return result;
}

export async function storeAdminLog({ device, payload, sourceIp }) {
  const { sanitized, discardedFieldNames } = sanitizeManufacturerPayload(payload, ADMINLOG_ALLOWED_FIELDS);
  const logId = textField(sanitized.LogID || payload?.LogID);
  if (!logId) throw new Error("ADMIN_LOG_ID_REQUIRED");
  const { occurredAt, occurredAtLocal } = parseDeviceOccurredAt(sanitized);

  const result = await insertImmutableUnique(
    () => prisma.biometricAdminLog.create({
      data: {
        companyProfileId: null,
        deviceId: device.id,
        deviceSerial: device.deviceSerial,
        logId,
        adminId: textField(sanitized.AdminID),
        deviceUserId: textField(sanitized.UserID),
        occurredAt,
        occurredAtLocal,
        action: textField(sanitized.Action),
        stat: textField(sanitized.Stat),
        transId: textField(sanitized.TransID),
        rawPayload: sanitized,
        sourceIp,
        processingStatus: "received",
      },
    }),
    () => prisma.biometricAdminLog.findUnique({
      where: { deviceSerial_logId: { deviceSerial: device.deviceSerial, logId } },
    }),
  );

  await recordBiometricAudit({
    actorType: "device",
    actorId: device.deviceSerial,
    deviceId: device.id,
    deviceSerial: device.deviceSerial,
    eventType: result.duplicate ? "ingest_duplicate" : "admin_log_received",
    result: result.duplicate ? "duplicate" : "success",
    reasonCode: result.duplicate ? "DEVICE_SERIAL_LOG_ID" : "ADMIN_LOG",
    details: { logId, discardedFieldNames },
  });

  return result;
}
