// @ts-nocheck
import { prisma } from "../../../src/server/prisma.js";
import { findActiveBiometricDevice } from "../../../src/server/biometric/deviceAuth.js";
import { sourceIpFromRequest, storeAdminLog, storeTimeLog } from "../../../src/server/biometric/timeLogStore.js";

const TIME_TYPES = new Set(["TimeLog", "TimeLog_v2"]);
const ADMIN_TYPES = new Set(["AdminLog", "AdminLog_v2"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ reason: "METHOD_NOT_ALLOWED" });
  }

  const type = String(req.query.type || "");
  if (!TIME_TYPES.has(type) && !ADMIN_TYPES.has(type)) {
    return res.status(400).json({ reason: "UNSUPPORTED_LOG_TYPE" });
  }

  const payload = req.body || {};
  const serial = payload.DeviceSerialNo;
  if (!serial) return res.status(400).json({ reason: "DEVICE_SERIAL_REQUIRED" });

  // devicebroker only forwards events after a successful device Login. We still
  // require an active server-side registry entry and never trust source IP as identity.
  const device = await findActiveBiometricDevice(serial);
  if (!device) return res.status(403).json({ reason: "DEVICE_NOT_REGISTERED" });

  try {
    const args = { device, payload, sourceIp: sourceIpFromRequest(req) };
    const result = TIME_TYPES.has(type)
      ? await storeTimeLog(args)
      : await storeAdminLog(args);

    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    // Phase 1 intentionally stops after durable raw storage. It does not mutate
    // AttendanceLog yet. Duplicate device replays are ACKed as successful.
    return res.status(200).json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    console.error("Biometric log ingest failed", error);
    return res.status(500).json({ reason: "BIOMETRIC_LOG_INGEST_FAILED" });
  }
}
