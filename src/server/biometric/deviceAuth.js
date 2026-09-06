// @ts-nocheck
import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { assignedCompanyId } from "./classifyTimeLog.js";
import { deviceActivityUpdate } from "./presence.js";

export function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function generateDeviceToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function findActiveBiometricDevice(deviceSerial) {
  if (!deviceSerial) return null;
  return prisma.biometricDevice.findFirst({
    where: { deviceSerial: String(deviceSerial), status: "active" },
    include: { allowedCompanies: { where: { status: "active" } } },
  });
}

export function deviceAssignedCompanyId(device) {
  return assignedCompanyId(device);
}

export async function validateDeviceToken(device, token) {
  if (!device || !token || !device.registrationSecretHash) return false;
  const supplied = Buffer.from(hashDeviceToken(token), "utf8");
  const expected = Buffer.from(device.registrationSecretHash, "utf8");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export async function issueRegistrationToken(device) {
  const token = generateDeviceToken();
  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: {
      registrationSecretHash: hashDeviceToken(token),
      ...deviceActivityUpdate(),
    },
  });
  return token;
}

export async function markDeviceActivity(deviceId, extra = {}) {
  return prisma.biometricDevice.update({
    where: { id: deviceId },
    data: deviceActivityUpdate(extra),
  });
}
