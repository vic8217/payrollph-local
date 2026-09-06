// @ts-nocheck
import { listRecords, updateRecord } from "../entityStore.js";
import { manilaDateString } from "../../lib/dateUtils.js";
import { resolveShiftOccurrence } from "../../lib/shiftSettings.js";
import { applyAttendancePunch } from "../attendance/applyAttendancePunch.js";
import { recordBiometricAudit } from "./audit.js";
import { assignedCompanyId } from "./classifyTimeLog.js";
import { evaluateInterpretationHolds } from "./interpretationPolicy.js";
import { prisma } from "../prisma.js";

export const INTERPRET = Object.freeze({
  PENDING: "mapped_pending_attendance",
  PROCESSING: "processing",
  INTERPRETED: "interpreted",
  IGNORED_DUPLICATE: "ignored_duplicate",
  NEEDS_REVIEW: "needs_review",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_TERMINAL: "failed_terminal",
});

const TERMINAL_STATUSES = new Set([
  INTERPRET.INTERPRETED,
  INTERPRET.IGNORED_DUPLICATE,
  INTERPRET.NEEDS_REVIEW,
  INTERPRET.FAILED_TERMINAL,
]);

const SLOT_VALUE = {
  time_in: (log) => log?.time_in || null,
  break_time_out: (log) => log?.break_time_out || null,
  break_time_in: (log) => log?.break_time_in || null,
  time_out: (log) => log?.time_out || null,
};

const SLOT_EVENT_FIELD = {
  time_in: "time_in_biometric_event_id",
  break_time_out: "break_time_out_biometric_event_id",
  break_time_in: "break_time_in_biometric_event_id",
  time_out: "time_out_biometric_event_id",
};

function defaultDeps() {
  return {
    prisma,
    listRecords,
    updateRecord,
    applyAttendancePunch,
    recordBiometricAudit,
    evaluateInterpretationHolds,
    manilaDateString,
  };
}

function originalPayload(row) {
  return row.rawPayload;
}

async function restoreRawPayloadIfChanged(row, deps) {
  const after = await deps.prisma.biometricTimeLog.findUnique({ where: { id: row.id } });
  if (JSON.stringify(after?.rawPayload) !== JSON.stringify(originalPayload(row))) {
    await deps.prisma.biometricTimeLog.update({
      where: { id: row.id },
      data: { rawPayload: originalPayload(row) },
    });
  }
}

async function loadEvent(eventId, deps) {
  return deps.prisma.biometricTimeLog.findUnique({
    where: { id: eventId },
    include: {
      device: { include: { allowedCompanies: { where: { status: "active" } } } },
    },
  });
}

async function revalidateTenancy(event, deps) {
  const device = event.device;
  if (!device || device.status !== "active") {
    return { ok: false, code: "DEVICE_NOT_ACTIVE", terminal: true };
  }
  const deviceCompany = assignedCompanyId(device);
  if (!deviceCompany || deviceCompany !== String(event.companyProfileId || "")) {
    return { ok: false, code: "DEVICE_COMPANY_MISMATCH", terminal: true };
  }
  if (!event.deviceUserId || !event.employeeRecordId) {
    return { ok: false, code: "MAPPING_MISSING", terminal: true };
  }
  const mapping = await deps.prisma.biometricUserMapping.findFirst({
    where: {
      deviceId: event.deviceId,
      deviceUserId: event.deviceUserId,
      status: "active",
    },
  });
  if (!mapping) {
    return { ok: false, code: "MAPPING_INACTIVE", terminal: true };
  }
  if (mapping.employeeRecordId !== event.employeeRecordId || mapping.companyProfileId !== event.companyProfileId) {
    return { ok: false, code: "MAPPING_STALE", terminal: true };
  }
  const employees = await deps.listRecords("Employee", {
    filter: { company_profile_id: event.companyProfileId },
    limit: 10000,
  });
  const employee = employees.find((item) => String(item.id) === String(event.employeeRecordId));
  if (!employee) {
    return { ok: false, code: "EMPLOYEE_NOT_FOUND", terminal: true };
  }
  if (String(employee.company_profile_id) !== String(event.companyProfileId)) {
    return { ok: false, code: "EMPLOYEE_COMPANY_MISMATCH", terminal: true };
  }
  if (String(employee.status || "active").toLowerCase() !== "active") {
    return { ok: false, code: "EMPLOYEE_INACTIVE", terminal: true };
  }
  return { ok: true, employee, mapping, deviceCompany };
}

async function findOpenLog(employee, workDate, deps) {
  const logs = await deps.listRecords("AttendanceLog", {
    filter: {
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
    },
    sort: "-created_date",
    limit: 20,
  });
  return logs.find((log) => log.status !== "rejected" && log.date === workDate) || null;
}

function isStuckProcessing(event) {
  return event.processingStatus === INTERPRET.PROCESSING
    && !event.attendanceLogId
    && !event.interpretedAt;
}

function lockFromStatus(event, applyReview) {
  if (isStuckProcessing(event)) return INTERPRET.PROCESSING;
  if (applyReview && event.processingStatus === INTERPRET.NEEDS_REVIEW) return INTERPRET.NEEDS_REVIEW;
  if (event.processingStatus === INTERPRET.FAILED_RETRYABLE) return INTERPRET.FAILED_RETRYABLE;
  return INTERPRET.PENDING;
}

function canStart(event, applyReview) {
  return event.processingStatus === INTERPRET.PENDING
    || event.processingStatus === INTERPRET.FAILED_RETRYABLE
    || isStuckProcessing(event)
    || (applyReview && event.processingStatus === INTERPRET.NEEDS_REVIEW);
}

async function lockEvent(event, fromStatus, deps) {
  const result = await deps.prisma.biometricTimeLog.updateMany({
    where: { id: event.id, processingStatus: fromStatus },
    data: { processingStatus: INTERPRET.PROCESSING },
  });
  return result.count === 1;
}

async function finalizeEvent(event, data, audit, deps) {
  const updated = await deps.prisma.biometricTimeLog.update({
    where: { id: event.id },
    data,
  });
  await restoreRawPayloadIfChanged(event, deps);
  await deps.recordBiometricAudit({
    actorType: audit.actorType,
    actorId: audit.actorId,
    companyProfileId: event.companyProfileId,
    deviceId: event.deviceId,
    deviceSerial: event.deviceSerial,
    biometricTimeLogId: event.id,
    eventType: audit.eventType,
    result: audit.result,
    reasonCode: audit.reasonCode || data.interpretationCode || null,
    details: {
      logId: event.logId,
      processingStatus: data.processingStatus,
      mappedSlot: data.mappedSlot || null,
      attendanceLogId: data.attendanceLogId || null,
      ...(audit.details || {}),
    },
  });
  return updated;
}

function snapshotFor(result, beforeLog) {
  const action = result.action;
  return {
    action,
    attendanceLogId: result.log?.id || null,
    createdLog: !beforeLog,
    previousValue: beforeLog ? SLOT_VALUE[action]?.(beforeLog) || null : null,
    punchIso: result.log ? SLOT_VALUE[action]?.(result.log) || null : null,
  };
}

export async function interpretTimeLog(eventId, {
  actorType = "user",
  actorId = null,
  applyReview = false,
} = {}, injectedDeps = null) {
  const deps = injectedDeps || defaultDeps();
  const event = await loadEvent(eventId, deps);
  if (!event) return { ok: false, skipped: true, reason: "NOT_FOUND" };

  if (event.processingStatus === INTERPRET.INTERPRETED || event.processingStatus === INTERPRET.IGNORED_DUPLICATE) {
    return { ok: true, skipped: true, reason: "ALREADY_FINAL", event };
  }
  if (event.processingStatus === INTERPRET.FAILED_TERMINAL && !applyReview) {
    return { ok: false, skipped: true, reason: "FAILED_TERMINAL", event };
  }
  if (!canStart(event, applyReview)) {
    return { ok: false, skipped: true, reason: "NOT_PENDING", event };
  }

  const locked = await lockEvent(event, lockFromStatus(event, applyReview), deps);
  if (!locked) return { ok: false, skipped: true, reason: "LOCK_FAILED", event };

  const actor = { actorType, actorId };
  try {
    await deps.recordBiometricAudit({
      ...actor,
      companyProfileId: event.companyProfileId,
      deviceId: event.deviceId,
      deviceSerial: event.deviceSerial,
      biometricTimeLogId: event.id,
      eventType: "interpret_started",
      result: "success",
      details: { logId: event.logId },
    });
    const tenancy = await revalidateTenancy(event, deps);
    if (!tenancy.ok) {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.FAILED_TERMINAL,
        interpretationCode: tenancy.code,
        interpretationMessage: "Tenancy or mapping is no longer valid.",
        reviewReason: tenancy.code,
      }, { ...actor, eventType: "interpret_failed", result: "failed", reasonCode: tenancy.code }, deps);
      return { ok: false, event: updated, reason: tenancy.code };
    }

    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
    const [holidays, noWorkDays, periods, shiftSettings] = await Promise.all([
      deps.listRecords("Holiday", { filter: { company_profile_id: event.companyProfileId }, limit: 5000 }),
      deps.listRecords("NoWorkDay", { filter: { company_profile_id: event.companyProfileId }, limit: 5000 }),
      deps.listRecords("PayrollPeriod", { filter: { company_profile_id: event.companyProfileId }, limit: 500 }),
      deps.listRecords("Settings", { filter: { company_profile_id: event.companyProfileId } }),
    ]);
    const provisional = occurredAt && Number.isFinite(occurredAt.getTime())
      ? resolveShiftOccurrence({ employee: tenancy.employee, shiftSettings, punchAt: occurredAt })
      : null;
    const workDate = provisional?.workDate
      || (occurredAt && Number.isFinite(occurredAt.getTime()) ? deps.manilaDateString(occurredAt) : null);
    const existingLog = tenancy.employee && workDate ? await findOpenLog(tenancy.employee, workDate, deps) : null;
    const holds = deps.evaluateInterpretationHolds({
      event,
      workDate,
      holidays,
      noWorkDays,
      savedPeriods: periods,
      existingLog,
      skipHolds: applyReview,
    });
    const terminalHold = holds.find((hold) => hold.terminal);
    if (terminalHold) {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.FAILED_TERMINAL,
        interpretationCode: terminalHold.code,
        interpretationMessage: "The biometric event cannot be interpreted.",
        reviewReason: terminalHold.code,
      }, { ...actor, eventType: "interpret_failed", result: "failed", reasonCode: terminalHold.code }, deps);
      return { ok: false, event: updated, reason: terminalHold.code };
    }
    if (holds.length) {
      const reason = holds.map((hold) => hold.code).join(",");
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.NEEDS_REVIEW,
        interpretationCode: holds[0].code,
        interpretationMessage: "Held for review; official attendance was not changed.",
        reviewReason: reason,
      }, { ...actor, eventType: "interpret_needs_review", result: "held", reasonCode: holds[0].code, details: { holds } }, deps);
      return { ok: true, event: updated, reason };
    }

    const beforeLog = existingLog;
    const result = await deps.applyAttendancePunch({
      employee: tenancy.employee,
      occurredAt,
      source: "biometric",
      sourceRef: {
        biometricTimeLogId: event.id,
        deviceSerial: event.deviceSerial,
        deviceLogId: event.logId,
        attendStat: event.attendStatus,
        verifyMethod: event.verifyMethod,
        verifyMethodNormalized: event.verifyMethodNormalized,
      },
      authorizedBy: "Biometric terminal",
    });

    if (result.outcome === "applied") {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.INTERPRETED,
        attendanceLogId: result.log?.id || null,
        mappedSlot: result.action,
        interpretedAt: new Date(),
        interpretationCode: result.action,
        interpretationMessage: result.action,
        reviewReason: null,
        interpretationSnapshot: snapshotFor(result, beforeLog),
      }, { ...actor, eventType: "interpret_applied", result: "success", reasonCode: result.action }, deps);
      return { ok: true, event: updated, result };
    }

    if (result.outcome === "duplicate") {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.IGNORED_DUPLICATE,
        interpretationCode: result.code || "DUPLICATE_SCAN",
        interpretationMessage: result.message,
        reviewReason: null,
      }, { ...actor, eventType: "interpret_duplicate", result: "duplicate", reasonCode: "DUPLICATE_SCAN" }, deps);
      return { ok: true, event: updated, result };
    }

    if (result.outcome === "early_attempt" || result.outcome === "rejected") {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.NEEDS_REVIEW,
        interpretationCode: result.code,
        interpretationMessage: result.message || result.error,
        reviewReason: result.code,
      }, { ...actor, eventType: "interpret_needs_review", result: "held", reasonCode: result.code }, deps);
      return { ok: true, event: updated, result };
    }

    const updated = await finalizeEvent(event, {
      processingStatus: INTERPRET.FAILED_RETRYABLE,
      interpretationCode: result.code || "INTERPRET_FAILED",
      interpretationMessage: result.error || "Interpretation failed.",
    }, { ...actor, eventType: "interpret_failed", result: "failed", reasonCode: result.code || "INTERPRET_FAILED" }, deps);
    return { ok: false, event: updated, result };
  } catch (error) {
    try {
      const updated = await finalizeEvent(event, {
        processingStatus: INTERPRET.FAILED_RETRYABLE,
        interpretationCode: "INTERPRET_EXCEPTION",
        interpretationMessage: String(error?.message || error),
      }, { actorType, actorId, eventType: "interpret_failed", result: "failed", reasonCode: "INTERPRET_EXCEPTION" }, deps);
      return { ok: false, event: updated, error: String(error?.message || error) };
    } catch (finalizeError) {
      return {
        ok: false,
        event,
        error: String(error?.message || error),
        finalizeError: String(finalizeError?.message || finalizeError),
      };
    }
  }
}

export async function interpretTimeLogs(eventIds, options = {}, injectedDeps = null) {
  const deps = injectedDeps || defaultDeps();
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const rows = await deps.prisma.biometricTimeLog.findMany({
    where: {
      id: { in: ids },
      ...(options.companyProfileId ? { companyProfileId: options.companyProfileId } : {}),
    },
    orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }],
  });
  const results = [];
  for (const row of rows) {
    results.push(await interpretTimeLog(row.id, options, deps));
  }
  return {
    interpreted: results.filter((item) => item.event?.processingStatus === INTERPRET.INTERPRETED).length,
    ignored: results.filter((item) => item.event?.processingStatus === INTERPRET.IGNORED_DUPLICATE).length,
    needs_review: results.filter((item) => item.event?.processingStatus === INTERPRET.NEEDS_REVIEW).length,
    failed: results.filter((item) => !item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    results,
  };
}

export async function rollbackInterpretation(eventId, { actorType = "user", actorId = null } = {}, injectedDeps = null) {
  const deps = injectedDeps || defaultDeps();
  const event = await loadEvent(eventId, deps);
  if (!event) return { ok: false, error: "NOT_FOUND" };
  if (event.processingStatus !== INTERPRET.INTERPRETED) {
    return { ok: false, error: "NOT_INTERPRETED" };
  }

  const snapshot = event.interpretationSnapshot || {};
  const attendanceLogId = event.attendanceLogId || snapshot.attendanceLogId;
  if (attendanceLogId && snapshot.action) {
    const logs = await deps.listRecords("AttendanceLog", { filter: { id: attendanceLogId }, limit: 1 });
    const log = logs[0];
    if (log) {
      const ownerField = SLOT_EVENT_FIELD[snapshot.action];
      const stillOwned = !ownerField || log[ownerField] === event.id || !log[ownerField];
      if (stillOwned) {
        const clear = { [snapshot.action]: snapshot.previousValue ?? null };
        if (snapshot.action === "time_out") {
          Object.assign(clear, {
            hours_worked: null,
            ot_actual_hours: 0,
            overtime_hours: 0,
            night_diff_hours: 0,
            late_minutes: 0,
          });
        }
        if (ownerField) {
          clear[ownerField] = null;
          clear[`${snapshot.action}_source`] = null;
          clear[`${snapshot.action}_device_serial`] = null;
          clear[`${snapshot.action}_device_log_id`] = null;
          clear[`${snapshot.action}_attend_stat`] = null;
        }
        const after = await deps.updateRecord("AttendanceLog", log.id, clear);
        const remaining = [after.time_in, after.break_time_out, after.break_time_in, after.time_out].filter(Boolean);
        if (snapshot.createdLog && remaining.length === 0) {
          await deps.updateRecord("AttendanceLog", log.id, { status: "rejected" });
        }
      }
    }
  }

  const updated = await finalizeEvent(event, {
    processingStatus: INTERPRET.PENDING,
    attendanceLogId: null,
    mappedSlot: null,
    interpretedAt: null,
    interpretationCode: null,
    interpretationMessage: null,
    reviewReason: null,
    interpretationSnapshot: null,
  }, {
    actorType,
    actorId,
    eventType: "interpret_rolled_back",
    result: "success",
    reasonCode: "ROLLBACK",
  }, deps);
  return { ok: true, event: updated };
}

export async function dismissInterpretationReview(eventId, { actorType = "user", actorId = null } = {}, injectedDeps = null) {
  const deps = injectedDeps || defaultDeps();
  const event = await loadEvent(eventId, deps);
  if (!event) return { ok: false, error: "NOT_FOUND" };
  if (event.processingStatus !== INTERPRET.NEEDS_REVIEW) return { ok: false, error: "NOT_IN_REVIEW" };
  const updated = await finalizeEvent(event, {
    processingStatus: INTERPRET.IGNORED_DUPLICATE,
    interpretationCode: event.interpretationCode || "DISMISSED",
    interpretationMessage: "Review dismissed without applying attendance.",
  }, {
    actorType,
    actorId,
    eventType: "interpret_review_dismissed",
    result: "success",
    reasonCode: "DISMISSED",
  }, deps);
  return { ok: true, event: updated };
}

export async function requeueFailedInterpretation(eventId, { actorType = "user", actorId = null } = {}, injectedDeps = null) {
  const deps = injectedDeps || defaultDeps();
  const event = await loadEvent(eventId, deps);
  if (!event) return { ok: false, error: "NOT_FOUND" };
  if (event.processingStatus !== INTERPRET.FAILED_TERMINAL && event.processingStatus !== INTERPRET.FAILED_RETRYABLE) {
    return { ok: false, error: "NOT_FAILED" };
  }
  const rawPayload = event.rawPayload;
  const updated = await finalizeEvent(event, {
    processingStatus: INTERPRET.PENDING,
    attendanceLogId: null,
    mappedSlot: null,
    interpretedAt: null,
    interpretationCode: null,
    interpretationMessage: null,
    reviewReason: null,
    interpretationSnapshot: null,
  }, {
    actorType,
    actorId,
    eventType: "event_reset_requeued",
    result: "success",
    reasonCode: "EXPLICIT_REQUEUE",
  }, deps);
  await restoreRawPayloadIfChanged({ ...event, rawPayload }, deps);
  return { ok: true, event: updated };
}

export { TERMINAL_STATUSES };
