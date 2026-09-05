// @ts-nocheck
import crypto from "node:crypto";
import { prisma } from "../prisma.js";

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
  });
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
    data: { registrationSecretHash: hashDeviceToken(token), lastSeenAt: new Date() },
  });
  return token;
}
