// @ts-nocheck
import { prisma } from "../../../src/server/prisma.js";
import { findActiveBiometricDevice, issueRegistrationToken } from "../../../src/server/biometric/deviceAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ reason: "METHOD_NOT_ALLOWED" });
  }

  const { sn, terminal_type, product_name, cloud_id } = req.body || {};
  if (!sn) return res.status(400).json({ reason: "DEVICE_SERIAL_REQUIRED" });

  const device = await findActiveBiometricDevice(sn);
  if (!device) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  if (device.cloudId && cloud_id && device.cloudId !== String(cloud_id)) {
    return res.status(403).json({ reason: "CLOUD_ID_MISMATCH" });
  }

  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: {
      terminalType: terminal_type || device.terminalType,
      productName: product_name || device.productName,
      cloudId: device.cloudId || cloud_id || null,
      lastSeenAt: new Date(),
    },
  });

  const token = await issueRegistrationToken(device);
  return res.status(200).json({ token });
}
