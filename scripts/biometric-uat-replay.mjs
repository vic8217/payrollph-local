#!/usr/bin/env node
/**
 * Phase 1 UAT: replay an existing BiometricTimeLog through /api/device/upload_log
 * using its stored sanitized payload. Does not update the original row.
 *
 *   npm run biometric:uat-replay
 *   npm run biometric:uat-replay -- --serial 202605260025 --log-id 15
 */
import { prisma } from "../src/server/prisma.js";
import { loadPayrollphEnv, requiredEnv } from "./biometric-uat-env.mjs";
import {
  UAT_DEVICE_SERIAL,
  UAT_MAPPED_LOG_ID,
  snapshotDiff,
  timeLogSnapshot,
} from "../src/server/biometric/uatVerification.js";

loadPayrollphEnv();

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]);
  return fallback;
}

const deviceSerial = arg("--serial", process.env.BIOMETRIC_UAT_DEVICE_SERIAL || UAT_DEVICE_SERIAL);
const logId = arg("--log-id", process.env.BIOMETRIC_UAT_LOG_ID || UAT_MAPPED_LOG_ID);
const baseUrl = String(process.env.PAYROLLPH_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

function replayType(payload) {
  const event = String(payload?.Event || "TimeLog_v2");
  return event === "TimeLog" || event === "TimeLog_v2" ? event : "TimeLog_v2";
}

async function loadTimeLog() {
  return prisma.biometricTimeLog.findMany({
    where: { deviceSerial, logId },
    orderBy: { createdAt: "asc" },
  });
}

async function main() {
  let secret;
  try {
    secret = requiredEnv("BIOMETRIC_GATEWAY_SECRET");
  } catch {
    throw new Error("BIOMETRIC_GATEWAY_SECRET is required. Set it in .env or the environment, then retry: npm run biometric:uat-replay");
  }
  const beforeRows = await loadTimeLog();
  if (beforeRows.length !== 1) {
    throw new Error(`Expected exactly one BiometricTimeLog for (${deviceSerial}, ${logId}); found ${beforeRows.length}.`);
  }

  const before = beforeRows[0];
  const beforeSnapshot = timeLogSnapshot(before);
  const auditSince = new Date();
  const attendanceBefore = await prisma.entityRecord.count({ where: { entity: "AttendanceLog" } });

  const payload = {
    ...(before.rawPayload && typeof before.rawPayload === "object" ? before.rawPayload : {}),
    DeviceSerialNo: before.deviceSerial,
    LogID: before.logId,
  };
  const type = replayType(payload);
  const url = `${baseUrl}/api/device/upload_log?type=${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));

  const afterRows = await loadTimeLog();
  const after = afterRows[0] || null;
  const changedFields = snapshotDiff(beforeSnapshot, timeLogSnapshot(after));
  const duplicateAudits = (await prisma.biometricAuditEvent.findMany({
    where: {
      eventType: "ingest_duplicate",
      deviceSerial,
      occurredAt: { gte: new Date(auditSince.getTime() - 1000) },
    },
    orderBy: { occurredAt: "desc" },
    take: 20,
  })).filter((event) => (
    event.biometricTimeLogId === before.id
    || event.details?.logId === logId
    || event.details?.logId === Number(logId)
  ));
  const attendanceAfter = await prisma.entityRecord.count({ where: { entity: "AttendanceLog" } });

  const checks = [
    { id: "http_200", ok: response.status === 200, detail: `status=${response.status}` },
    { id: "duplicate_true", ok: body.duplicate === true && body.ok === true, detail: JSON.stringify(body) },
    { id: "one_row", ok: afterRows.length === 1, detail: `count=${afterRows.length}` },
    { id: "row_unmodified", ok: changedFields.length === 0, detail: changedFields.length ? changedFields.join(",") : "immutable fields unchanged" },
    { id: "ingest_duplicate_audit", ok: duplicateAudits.length >= 1, detail: `new_audit_rows=${duplicateAudits.length}` },
    { id: "status_unchanged", ok: after?.processingStatus === before.processingStatus, detail: after?.processingStatus || "missing" },
    { id: "attendance_count_unchanged", ok: attendanceBefore === attendanceAfter, detail: `${attendanceBefore} -> ${attendanceAfter}` },
  ];

  const report = {
    ok: checks.every((check) => check.ok),
    action: "replay_existing_timelog",
    url,
    deviceSerial,
    logId,
    processingStatus: after?.processingStatus || null,
    checks,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
