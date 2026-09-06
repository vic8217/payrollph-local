// @ts-nocheck
import { prisma } from "../prisma.js";

export async function recordBiometricAudit({
  actorType = "gateway",
  actorId = null,
  companyProfileId = null,
  deviceId = null,
  deviceSerial = null,
  eventType,
  result,
  reasonCode = null,
  biometricTimeLogId = null,
  mappingId = null,
  details = null,
} = {}) {
  if (!eventType || !result) return null;
  try {
    return await prisma.biometricAuditEvent.create({
      data: {
        actorType,
        actorId,
        companyProfileId,
        deviceId,
        deviceSerial,
        eventType,
        result,
        reasonCode,
        biometricTimeLogId,
        mappingId,
        details,
      },
    });
  } catch (error) {
    console.error("Biometric audit write failed", error);
    return null;
  }
}
