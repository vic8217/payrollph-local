// @ts-nocheck
import { recordBiometricAudit } from "../../../src/server/biometric/audit.js";
import { assignedCompanyId } from "../../../src/server/biometric/classifyTimeLog.js";
import { findActiveBiometricDevice, markDeviceActivity, validateDeviceToken } from "../../../src/server/biometric/deviceAuth.js";
import { requireDeviceGatewayPost } from "../../../src/server/biometric/gatewayAuth.js";

export default async function handler(req, res) {
  if (!requireDeviceGatewayPost(req, res)) return;

  const { sn, token } = req.body || {};
  if (!sn || !token) return res.status(400).json({ reason: "DEVICE_CREDENTIAL_REQUIRED" });

  const device = await findActiveBiometricDevice(sn);
  if (!device) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  if (!(await validateDeviceToken(device, token))) {
    await recordBiometricAudit({
      actorType: "device",
      actorId: String(sn),
      deviceId: device.id,
      deviceSerial: device.deviceSerial,
      eventType: "device_login_rejected",
      result: "rejected",
      reasonCode: "FailUnknownToken",
    });
    return res.status(403).json({ reason: "FailUnknownToken" });
  }

  const now = new Date();
  await markDeviceActivity(device.id, { lastLoginAt: now, lastSeenAt: now, lastOnlineAt: now });
  await recordBiometricAudit({
    actorType: "device",
    actorId: device.deviceSerial,
    companyProfileId: assignedCompanyId(device),
    deviceId: device.id,
    deviceSerial: device.deviceSerial,
    eventType: "device_login",
    result: "success",
    reasonCode: "LOGIN_OK",
  });
  return res.status(200).json({ ok: true });
}
