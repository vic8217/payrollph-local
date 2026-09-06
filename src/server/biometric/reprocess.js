// @ts-nocheck
import { prisma } from "../prisma.js";
import { recordBiometricAudit } from "./audit.js";
import {
  applyReprocessDecision,
  assignedCompanyId,
  canExplicitlyReprocess,
  shouldAutoReprocessOnMapping,
} from "./classifyTimeLog.js";

function identityFrom(decision, mapping) {
  if (!decision.attachEmployee || !mapping) {
    return { companyProfileId: null, employeeRecordId: null, employeeId: null };
  }
  return {
    companyProfileId: mapping.companyProfileId,
    employeeRecordId: mapping.employeeRecordId,
    employeeId: mapping.employeeId,
  };
}

async function loadDevice(deviceId) {
  return prisma.biometricDevice.findUnique({
    where: { id: deviceId },
    include: { allowedCompanies: { where: { status: "active" } } },
  });
}

export async function reprocessHeldTimeLogs({
  deviceId,
  deviceUserId,
  mapping,
  explicitQuarantine = false,
  actorType = "user",
  actorId = null,
} = {}) {
  if (!deviceId || !deviceUserId) return { updated: 0, skipped: 0, ids: [] };

  const device = await loadDevice(deviceId);
  if (!device) return { updated: 0, skipped: 0, ids: [] };
  const companyId = assignedCompanyId(device);

  const rows = await prisma.biometricTimeLog.findMany({
    where: {
      deviceId,
      deviceUserId: String(deviceUserId),
      processingStatus: explicitQuarantine
        ? { in: ["unmapped_user", "company_not_authorized"] }
        : "unmapped_user",
    },
  });

  let updated = 0;
  let skipped = 0;
  const ids = [];

  for (const row of rows) {
    if (!explicitQuarantine && !shouldAutoReprocessOnMapping(row.processingStatus)) {
      skipped += 1;
      continue;
    }
    if (explicitQuarantine && !canExplicitlyReprocess(row.processingStatus)) {
      skipped += 1;
      continue;
    }

    const decision = applyReprocessDecision({
      processingStatus: row.processingStatus,
      mapping,
      assignedCompanyId: companyId,
      explicitQuarantine,
    });

    if (decision.skipped || !decision.attachEmployee) {
      skipped += 1;
      continue;
    }

    const originalPayload = row.rawPayload;
    await prisma.biometricTimeLog.update({
      where: { id: row.id },
      data: {
        ...identityFrom(decision, mapping),
        processingStatus: decision.processingStatus,
      },
    });

    const after = await prisma.biometricTimeLog.findUnique({ where: { id: row.id } });
    if (JSON.stringify(after.rawPayload) !== JSON.stringify(originalPayload)) {
      await prisma.biometricTimeLog.update({
        where: { id: row.id },
        data: { rawPayload: originalPayload },
      });
    }

    updated += 1;
    ids.push(row.id);
  }

  await recordBiometricAudit({
    actorType,
    actorId,
    companyProfileId: mapping?.companyProfileId || companyId,
    deviceId,
    deviceSerial: device.deviceSerial,
    eventType: explicitQuarantine ? "events_reprocessed_explicit" : "events_reprocessed",
    result: "success",
    reasonCode: explicitQuarantine ? "ADMIN_REPROCESS" : "MAPPING_CREATED",
    mappingId: mapping?.id || null,
    details: { deviceUserId, updated, skipped, ids },
  });

  return { updated, skipped, ids };
}

export async function reprocessEventIds({
  eventIds,
  explicitQuarantine = false,
  actorType = "user",
  actorId = null,
  companyProfileId = null,
} = {}) {
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { updated: 0, skipped: 0, ids: [] };

  const rows = await prisma.biometricTimeLog.findMany({
    where: { id: { in: ids } },
    include: { device: { include: { allowedCompanies: { where: { status: "active" } } } } },
  });

  let updated = 0;
  let skipped = 0;
  const changed = [];

  for (const row of rows) {
    if (companyProfileId) {
      const deviceCompany = assignedCompanyId(row.device);
      const visible = row.companyProfileId === companyProfileId || deviceCompany === companyProfileId;
      if (!visible) {
        skipped += 1;
        continue;
      }
    }

    const mapping = row.deviceUserId
      ? await prisma.biometricUserMapping.findFirst({
          where: { deviceId: row.deviceId, deviceUserId: row.deviceUserId, status: "active" },
        })
      : null;

    const decision = applyReprocessDecision({
      processingStatus: row.processingStatus,
      mapping,
      assignedCompanyId: assignedCompanyId(row.device),
      explicitQuarantine,
    });

    if (decision.skipped || !decision.attachEmployee) {
      skipped += 1;
      continue;
    }

    const originalPayload = row.rawPayload;
    await prisma.biometricTimeLog.update({
      where: { id: row.id },
      data: {
        ...identityFrom(decision, mapping),
        processingStatus: decision.processingStatus,
      },
    });
    const after = await prisma.biometricTimeLog.findUnique({ where: { id: row.id } });
    if (JSON.stringify(after.rawPayload) !== JSON.stringify(originalPayload)) {
      await prisma.biometricTimeLog.update({
        where: { id: row.id },
        data: { rawPayload: originalPayload },
      });
    }
    updated += 1;
    changed.push(row.id);
  }

  await recordBiometricAudit({
    actorType,
    actorId,
    companyProfileId,
    eventType: explicitQuarantine ? "events_reprocessed_explicit" : "events_reprocessed",
    result: "success",
    reasonCode: "ADMIN_REPROCESS",
    details: { updated, skipped, ids: changed },
  });

  return { updated, skipped, ids: changed };
}
