// @ts-nocheck
import { prisma } from "../../../src/server/prisma.js";
import { recordBiometricAudit } from "../../../src/server/biometric/audit.js";
import { assignedCompanyId } from "../../../src/server/biometric/classifyTimeLog.js";
import { findActiveBiometricDevice, issueRegistrationToken, markDeviceActivity } from "../../../src/server/biometric/deviceAuth.js";
import { requireDeviceGatewayPost } from "../../../src/server/biometric/gatewayAuth.js";

export default async function handler(req, res) {
  if (!requireDeviceGatewayPost(req, res)) return;

  const { sn, terminal_type, product_name, cloud_id } = req.body || {};
  if (!sn) return res.status(400).json({ reason: "DEVICE_SERIAL_REQUIRED" });

  const serial = String(sn).trim();
  let device = await prisma.biometricDevice.findUnique({
    where: { deviceSerial: serial },
    include: { allowedCompanies: { where: { status: "active" } } },
  });

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
    await recordBiometricAudit({
      actorType: "device",
      actorId: serial,
      deviceId: device.id,
      deviceSerial: serial,
      eventType: "device_discovered",
      result: "rejected",
      reasonCode: "DEVICE_PENDING_APPROVAL",
    });
    return res.status(403).json({ reason: "DEVICE_PENDING_APPROVAL" });
  }

  if (device.status !== "active") {
    await markDeviceActivity(device.id, {
      terminalType: terminal_type || device.terminalType,
      productName: product_name || device.productName,
      cloudId: device.cloudId || cloud_id || null,
    });
    await recordBiometricAudit({
      actorType: "device",
      actorId: serial,
      deviceId: device.id,
      deviceSerial: serial,
      eventType: "device_login_rejected",
      result: "rejected",
      reasonCode: "DEVICE_PENDING_APPROVAL",
    });
    return res.status(403).json({ reason: "DEVICE_PENDING_APPROVAL" });
  }

  const activeDevice = await findActiveBiometricDevice(serial);
  if (!activeDevice) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  if (activeDevice.cloudId && cloud_id && activeDevice.cloudId !== String(cloud_id)) {
    await recordBiometricAudit({
      actorType: "device",
      actorId: serial,
      deviceId: activeDevice.id,
      deviceSerial: serial,
      eventType: "device_login_rejected",
      result: "rejected",
      reasonCode: "CLOUD_ID_MISMATCH",
    });
    return res.status(403).json({ reason: "CLOUD_ID_MISMATCH" });
  }

  if (!assignedCompanyId(activeDevice)) {
    await recordBiometricAudit({
      actorType: "device",
      actorId: serial,
      deviceId: activeDevice.id,
      deviceSerial: serial,
      eventType: "device_login_rejected",
      result: "rejected",
      reasonCode: "DEVICE_COMPANY_NOT_ASSIGNED",
    });
    return res.status(403).json({ reason: "DEVICE_COMPANY_NOT_ASSIGNED" });
  }

  await markDeviceActivity(activeDevice.id, {
    terminalType: terminal_type || activeDevice.terminalType,
    productName: product_name || activeDevice.productName,
    cloudId: activeDevice.cloudId || cloud_id || null,
  });

  const token = await issueRegistrationToken(activeDevice);
  await recordBiometricAudit({
    actorType: "gateway",
    actorId: serial,
    companyProfileId: assignedCompanyId(activeDevice),
    deviceId: activeDevice.id,
    deviceSerial: serial,
    eventType: "device_token_issued",
    result: "success",
    reasonCode: "REGISTER_OK",
  });
  return res.status(200).json({ token });
}
