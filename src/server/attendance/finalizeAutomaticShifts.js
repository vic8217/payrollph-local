import {
  createRecord,
  listRecords,
  listRecordsPage,
  updateRecordIf,
} from "../entityStore.js";
import { ATTENDANCE_PUNCH_MODE } from "../../lib/shiftSettings.js";
import {
  attendanceCompletionFields,
  isClosedAttendanceLog,
  isDeclaredHalfDay,
} from "./applyAttendancePunch.js";

export const AUTOMATIC_SHIFT_FINALIZATION = Object.freeze({
  FINALIZE: "finalize",
  MISSING_TIME_IN_2: "missing_time_in_2",
  PENDING: "pending",
  UNCHANGED: "unchanged",
  SKIP: "skip",
});

const defaultStore = {
  createRecord,
  listRecords,
  listRecordsPage,
  updateRecordIf,
};

function toDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isPresent(value) {
  return value != null && value !== "";
}

export function snapshotScheduledTimeOut(log) {
  return toDate(log?.scheduled_time_out);
}

export function snapshotHasBreak(log) {
  if (log?.shift_has_break === false || log?.shift_has_break === "false") return false;
  if (log?.shift_has_break === true || log?.shift_has_break === "true") return true;
  return Boolean(log?.shift_break_start_time && log?.shift_break_end_time);
}

function snapshotPunchMode(log) {
  return String(log?.shift_attendance_punch_mode || "").toLowerCase();
}

/**
 * Snapshot-only eligibility. Live Settings, job execution time, and the
 * Attendance page are not inputs to this decision except asOf for "has the
 * snapshotted shift end been reached?"
 */
export function evaluateAutomaticShiftFinalization(log, asOf) {
  const asOfDate = toDate(asOf);
  if (!log || !asOfDate) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "invalid" };
  }
  if (isClosedAttendanceLog(log)) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "closed" };
  }
  if (isDeclaredHalfDay(log)) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "half_day" };
  }
  if (snapshotPunchMode(log) !== ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "not_automatic" };
  }

  const scheduled = snapshotScheduledTimeOut(log);
  if (!scheduled) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "no_scheduled_time_out" };
  }
  const scheduledIso = scheduled.toISOString();

  if (isPresent(log.time_out)) {
    const alreadyScheduled = log.time_out === scheduledIso && log.time_out_source === "scheduled";
    return {
      action: AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED,
      reason: alreadyScheduled ? "already_finalized" : "time_out_present",
      scheduled_time_out: scheduledIso,
    };
  }

  if (asOfDate.getTime() < scheduled.getTime()) {
    return {
      action: AUTOMATIC_SHIFT_FINALIZATION.PENDING,
      reason: "before_shift_end",
      scheduled_time_out: scheduledIso,
    };
  }

  if (snapshotHasBreak(log)) {
    if (!isPresent(log.break_time_in)) {
      if (log.time_in_2_missing && log.review_reason === "MISSING_TIME_IN_2") {
        return {
          action: AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED,
          reason: "missing_time_in_2",
          scheduled_time_out: scheduledIso,
        };
      }
      return {
        action: AUTOMATIC_SHIFT_FINALIZATION.MISSING_TIME_IN_2,
        reason: "MISSING_TIME_IN_2",
        scheduled_time_out: scheduledIso,
      };
    }
  } else if (!isPresent(log.time_in)) {
    return { action: AUTOMATIC_SHIFT_FINALIZATION.SKIP, reason: "missing_time_in_1" };
  }

  return {
    action: AUTOMATIC_SHIFT_FINALIZATION.FINALIZE,
    reason: "eligible",
    scheduled_time_out: scheduledIso,
  };
}

function companyFilter(companyProfileId) {
  return companyProfileId ? { company_profile_id: companyProfileId } : {};
}

async function listCandidateLogs(store, { companyProfileId, logIds }) {
  if (Array.isArray(logIds) && logIds.length > 0) {
    const uniqueIds = [...new Set(logIds.map((id) => String(id || "").trim()).filter(Boolean))];
    const logs = [];
    for (const id of uniqueIds) {
      const matches = await store.listRecords("AttendanceLog", { filter: { id } });
      if (matches[0]) logs.push(matches[0]);
    }
    return logs;
  }

  const filter = {
    ...companyFilter(companyProfileId),
    shift_attendance_punch_mode: ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT,
  };

  if (typeof store.listRecordsPage === "function") {
    const logs = [];
    for (let page = 1; page <= 100; page += 1) {
      const result = await store.listRecordsPage("AttendanceLog", {
        filter,
        page,
        pageSize: 200,
        sort: "date",
      });
      logs.push(...(result.data || []));
      if (!result.pagination?.hasNextPage) break;
    }
    return logs;
  }

  return store.listRecords("AttendanceLog", { filter });
}

function findEmployee(employees, log) {
  return employees.find((employee) =>
    (log.employee_record_id && String(employee.id) === String(log.employee_record_id)) ||
    String(employee.employee_id) === String(log.employee_id)
  ) || {
    id: log.employee_record_id,
    employee_id: log.employee_id,
    company_profile_id: log.company_profile_id,
    work_schedule: log.work_schedule,
    break_duration_minutes: log.shift_break_duration_minutes,
  };
}

async function claimUpdate(store, log, patch, predicate) {
  if (typeof store.updateRecordIf !== "function") {
    const [current] = await store.listRecords("AttendanceLog", { filter: { id: log.id } });
    const matches = current && Object.entries(predicate).every(([key, expected]) => {
      const actual = current[key];
      return expected == null ? !isPresent(actual) : String(actual) === String(expected);
    });
    if (!matches) return { updated: false, record: current || log };
    const record = await store.updateRecord("AttendanceLog", log.id, patch);
    return { updated: true, record };
  }
  return store.updateRecordIf("AttendanceLog", log.id, patch, predicate);
}

async function writeAudit(store, log, action, scheduledIso, asOfIso) {
  if (typeof store.createRecord !== "function") return null;
  try {
    return await store.createRecord("PasscodeAuditLog", {
      company_profile_id: log.company_profile_id,
      source_entity: "AttendanceLog",
      source_record_id: log.id,
      action,
      punch_action: action === "automatic_shift_finalized" ? "time_out" : "missing_time_in_2",
      record_date: log.date,
      employee_record_id: log.employee_record_id,
      employee_id: log.employee_id,
      employee_name: log.employee_name,
      recorded_time: scheduledIso,
      occurred_at: scheduledIso,
      authorized_by: "Automatic shift finalization",
      reason: action === "automatic_shift_finalized" ? "SCHEDULED_SHIFT_END" : "MISSING_TIME_IN_2",
      summary: action === "automatic_shift_finalized"
        ? `Scheduled Time Out (2) finalized at snapshotted shift end ${scheduledIso}`
        : "Time In (2) is missing. Scheduled Time Out (2) was not awarded.",
      details: { as_of: asOfIso, scheduled_time_out: scheduledIso },
    });
  } catch {
    return null;
  }
}

async function finalizeEligibleLog(store, log, decision, asOfIso, context) {
  const scheduledIso = decision.scheduled_time_out;
  const employee = findEmployee(context.employees, log);
  const completion = attendanceCompletionFields(
    log,
    scheduledIso,
    employee,
    context.shiftSettings,
    context.overtimeRequests,
  );
  const claimed = await claimUpdate(store, log, {
    time_out: scheduledIso,
    time_out_source: "scheduled",
    time_in_2_missing: false,
    review_reason: log.review_reason === "MISSING_TIME_IN_2" ? null : log.review_reason ?? null,
    ...completion,
  }, {
    time_out: null,
    scheduled_time_out: scheduledIso,
  });
  const record = claimed.record || log;
  if (claimed.updated) {
    await writeAudit(store, record, "automatic_shift_finalized", scheduledIso, asOfIso);
    return {
      id: log.id,
      action: AUTOMATIC_SHIFT_FINALIZATION.FINALIZE,
      reason: "eligible",
      time_out: record.time_out,
      time_out_source: record.time_out_source,
      log: record,
    };
  }
  return {
    id: log.id,
    action: AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED,
    reason: record.time_out ? "already_finalized" : "lost_claim",
    time_out: record.time_out || null,
    time_out_source: record.time_out_source || null,
    log: record,
  };
}

async function markMissingTimeIn2(store, log, decision, asOfIso) {
  const claimed = await claimUpdate(store, log, {
    time_in_2_missing: true,
    review_reason: "MISSING_TIME_IN_2",
  }, {
    time_out: null,
    break_time_in: null,
  });
  const record = claimed.record || log;
  if (isPresent(record.time_out)) {
    return {
      id: log.id,
      action: AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED,
      reason: "already_finalized",
      log: record,
    };
  }
  if (claimed.updated) {
    await writeAudit(store, record, "automatic_shift_missing_time_in_2", decision.scheduled_time_out, asOfIso);
  }
  return {
    id: log.id,
    action: claimed.updated
      ? AUTOMATIC_SHIFT_FINALIZATION.MISSING_TIME_IN_2
      : AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED,
    reason: "MISSING_TIME_IN_2",
    time_out: record.time_out || null,
    log: record,
  };
}

/**
 * Idempotent server-side finalization for Automatic Shift AttendanceLogs.
 * Official Time Out (2) is always the snapshotted scheduled_time_out.
 */
export async function finalizeAutomaticShiftLogs({
  asOf = new Date(),
  companyProfileId = null,
  logIds = null,
} = {}, store = defaultStore) {
  const asOfDate = toDate(asOf) || new Date();
  const asOfIso = asOfDate.toISOString();
  const candidates = await listCandidateLogs(store, { companyProfileId, logIds });
  const companies = [...new Set(
    candidates.map((log) => log.company_profile_id).filter(Boolean).concat(companyProfileId ? [companyProfileId] : [])
  )];
  const employees = [];
  const shiftSettings = [];
  const overtimeRequests = [];
  for (const company of companies.length ? companies : [null]) {
    const filter = companyFilter(company);
    employees.push(...await store.listRecords("Employee", { filter }));
    shiftSettings.push(...await store.listRecords("Settings", { filter }));
    overtimeRequests.push(...await store.listRecords("OvertimeRequest", { filter, limit: 1000 }));
  }
  const context = { employees, shiftSettings, overtimeRequests };
  const results = [];

  for (const log of candidates) {
    const decision = evaluateAutomaticShiftFinalization(log, asOfDate);
    if (decision.action === AUTOMATIC_SHIFT_FINALIZATION.FINALIZE) {
      results.push(await finalizeEligibleLog(store, log, decision, asOfIso, context));
      continue;
    }
    if (decision.action === AUTOMATIC_SHIFT_FINALIZATION.MISSING_TIME_IN_2) {
      results.push(await markMissingTimeIn2(store, log, decision, asOfIso));
      continue;
    }
    results.push({
      id: log.id,
      action: decision.action,
      reason: decision.reason,
      scheduled_time_out: decision.scheduled_time_out || null,
      time_out: log.time_out || null,
    });
  }

  const count = (action) => results.filter((item) => item.action === action).length;
  return {
    as_of: asOfIso,
    scanned: candidates.length,
    results,
    summary: {
      finalized: count(AUTOMATIC_SHIFT_FINALIZATION.FINALIZE),
      missing_time_in_2: count(AUTOMATIC_SHIFT_FINALIZATION.MISSING_TIME_IN_2),
      pending: count(AUTOMATIC_SHIFT_FINALIZATION.PENDING),
      unchanged: count(AUTOMATIC_SHIFT_FINALIZATION.UNCHANGED),
      skipped: count(AUTOMATIC_SHIFT_FINALIZATION.SKIP),
    },
  };
}
