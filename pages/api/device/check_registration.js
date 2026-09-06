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

  const serial = String(sn).trim();
  let device = await prisma.biometricDevice.findUnique({ where: { deviceSerial: serial } });

  // Unknown terminals are discovered automatically, but they are never trusted
  // automatically. A super administrator must approve the pending device and
  // assign at least one company before it can log in or upload attendance.
  if (!device) {
    device = await prisma.biometricDevice.create({
      data: {
        deviceSerial: serial,
        cloudId: cloud_id ? String(cloud_id) : null,
        terminalType: terminal_type ? String(terminal_type) : null,
        productName: product_name ? String(product_name) : null,
        status: "pending",
        lastSeenAt: new Date(),
        metadata: { detectedAutomatically: true, firstDetectedAt: new Date().toISOString() },
      },
    });
    return res.status(403).json({ reason: "DEVICE_PENDING_APPROVAL" });
  }

  if (device.status !== "active") {
    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: {
        terminalType: terminal_type || device.terminalType,
        productName: product_name || device.productName,
        cloudId: device.cloudId || cloud_id || null,
        lastSeenAt: new Date(),
      },
    });
    return res.status(403).json({ reason: "DEVICE_PENDING_APPROVAL" });
  }

  const activeDevice = await findActiveBiometricDevice(serial);
  if (!activeDevice) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  if (activeDevice.cloudId && cloud_id && activeDevice.cloudId !== String(cloud_id)) {
    return res.status(403).json({ reason: "CLOUD_ID_MISMATCH" });
  }

  const allowedCompanyCount = await prisma.biometricDeviceCompany.count({
    where: { deviceId: activeDevice.id, status: "active" },
  });
  if (allowedCompanyCount === 0) {
    return res.status(403).json({ reason: "DEVICE_COMPANY_NOT_ASSIGNED" });
  }

  await prisma.biometricDevice.update({
    where: { id: activeDevice.id },
    data: {
      terminalType: terminal_type || activeDevice.terminalType,
      productName: product_name || activeDevice.productName,
      cloudId: activeDevice.cloudId || cloud_id || null,
      lastSeenAt: new Date(),
    },
  });

  const token = await issueRegistrationToken(activeDevice);
  return res.status(200).json({ token });
}
