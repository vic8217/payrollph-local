#!/usr/bin/env node
/**
 * Phase 1 UAT verification for F500 serial 202605260025.
 *
 *   npm run biometric:uat-verify
 */
import { prisma } from "../src/server/prisma.js";
import { loadPayrollphEnv } from "./biometric-uat-env.mjs";
import {
  UAT_DEVICE_SERIAL,
  UAT_MAPPED_LOG_ID,
  UAT_QUARANTINE_LOG_ID,
  attendanceLooksBiometricDerived,
  evaluatePhase1Uat,
} from "../src/server/biometric/uatVerification.js";

loadPayrollphEnv();

const deviceSerial = process.env.BIOMETRIC_UAT_DEVICE_SERIAL || UAT_DEVICE_SERIAL;

async function loadLogs(logId) {
  return prisma.biometricTimeLog.findMany({
    where: { deviceSerial, logId },
    orderBy: { createdAt: "asc" },
  });
}

async function main() {
  const [logs15, logs14] = await Promise.all([
    loadLogs(UAT_MAPPED_LOG_ID),
    loadLogs(UAT_QUARANTINE_LOG_ID),
  ]);
  const timeLogIds = [...logs15, ...logs14].map((row) => row.id);
  const attendanceRecords = await prisma.entityRecord.findMany({
    where: { entity: "AttendanceLog" },
    select: { id: true, data: true, createdAt: true },
  });
  const attendanceHits = attendanceRecords.filter((record) => attendanceLooksBiometricDerived(record, {
    deviceSerial,
    logIds: [UAT_MAPPED_LOG_ID, UAT_QUARANTINE_LOG_ID],
    timeLogIds,
  }));

  const result = evaluatePhase1Uat({ deviceSerial, logs15, logs14, attendanceHits });
  const report = {
    ok: result.ok,
    deviceSerial,
    log15: logs15[0] ? {
      id: logs15[0].id,
      count: logs15.length,
      processingStatus: logs15[0].processingStatus,
      verifyMethod: logs15[0].verifyMethod,
      verifyMethodNormalized: logs15[0].verifyMethodNormalized,
      attendanceLogId: logs15[0].attendanceLogId,
      discardedFieldNames: logs15[0].discardedFieldNames || [],
    } : null,
    log14: logs14[0] ? {
      id: logs14[0].id,
      count: logs14.length,
      processingStatus: logs14[0].processingStatus,
      attendanceLogId: logs14[0].attendanceLogId,
    } : null,
    attendanceHits: attendanceHits.map((record) => record.id),
    checks: result.checks,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
