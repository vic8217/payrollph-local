// @ts-nocheck
import { prisma } from "../../../src/server/prisma.js";
import { findActiveBiometricDevice, validateDeviceToken } from "../../../src/server/biometric/deviceAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ reason: "METHOD_NOT_ALLOWED" });
  }

  const { sn, token } = req.body || {};
  if (!sn || !token) return res.status(400).json({ reason: "DEVICE_CREDENTIAL_REQUIRED" });

  const device = await findActiveBiometricDevice(sn);
  if (!device) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  if (!(await validateDeviceToken(device, token))) {
    return res.status(403).json({ reason: "FailUnknownToken" });
  }

  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), lastLoginAt: new Date() },
  });
  return res.status(200).json({ ok: true });
}
