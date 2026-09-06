// @ts-nocheck
import { recordBiometricAudit } from "../../../src/server/biometric/audit.js";
import { findActiveBiometricDevice, markDeviceActivity } from "../../../src/server/biometric/deviceAuth.js";
import { requireDeviceGatewayPost } from "../../../src/server/biometric/gatewayAuth.js";
import { sourceIpFromRequest, storeAdminLog, storeTimeLog } from "../../../src/server/biometric/timeLogStore.js";

const TIME_TYPES = new Set(["TimeLog", "TimeLog_v2"]);
const ADMIN_TYPES = new Set(["AdminLog", "AdminLog_v2"]);

export default async function handler(req, res) {
  if (!requireDeviceGatewayPost(req, res)) return;

  const type = String(req.query.type || "");
  if (!TIME_TYPES.has(type) && !ADMIN_TYPES.has(type)) {
    return res.status(400).json({ reason: "UNSUPPORTED_LOG_TYPE" });
  }

  const payload = req.body || {};
  const serial = payload.DeviceSerialNo;
  if (!serial) return res.status(400).json({ reason: "DEVICE_SERIAL_REQUIRED" });

  const device = await findActiveBiometricDevice(serial);
  if (!device) {
    await recordBiometricAudit({
      actorType: "device",
      actorId: String(serial),
      deviceSerial: String(serial),
      eventType: "ingest_rejected",
      result: "rejected",
      reasonCode: "DEVICE_NOT_REGISTERED",
    });
    return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });
  }

  try {
    const args = { device, payload, sourceIp: sourceIpFromRequest(req) };
    const result = TIME_TYPES.has(type)
      ? await storeTimeLog(args)
      : await storeAdminLog(args);

    await markDeviceActivity(device.id);

    // Phase 1 stops after durable raw storage. AttendanceLog is never mutated.
    // Duplicate device replays are ACKed as successful so the broker sends OK.
    return res.status(200).json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    console.error("Biometric log ingest failed", error);
    await recordBiometricAudit({
      actorType: "gateway",
      actorId: device.deviceSerial,
      deviceId: device.id,
      deviceSerial: device.deviceSerial,
      eventType: "ingest_failed",
      result: "failed",
      reasonCode: error?.message === "TIME_LOG_ID_REQUIRED" || error?.message === "ADMIN_LOG_ID_REQUIRED"
        ? "LOG_ID_REQUIRED"
        : "BIOMETRIC_LOG_INGEST_FAILED",
    });
    if (error?.message === "TIME_LOG_ID_REQUIRED" || error?.message === "ADMIN_LOG_ID_REQUIRED") {
      return res.status(400).json({ reason: "LOG_ID_REQUIRED" });
    }
    return res.status(500).json({ reason: "BIOMETRIC_LOG_INGEST_FAILED" });
  }
}
