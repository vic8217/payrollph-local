import { manilaDateString } from "../../lib/dateUtils.js";
import { resolveShiftOccurrence } from "../../lib/shiftSettings.js";
import { previewAttendancePunch, SLOT_LABELS } from "../attendance/previewAttendancePunch.js";
import { assignedCompanyId } from "./classifyTimeLog.js";
import { evaluateInterpretationHolds } from "./interpretationPolicy.js";
import { findEmployeeByRecordId } from "./mappingIntegrity.js";

export function punchLabel(action, fallback) {
  return SLOT_LABELS[action] || fallback || action || null;
}

export async function previewInterpretation(event, {
  employee,
  holidays = [],
  noWorkDays = [],
  savedPeriods = [],
  store,
} = {}) {
  if (!event?.occurredAt) {
    return {
      ok: false,
      expected_slot: null,
      expected_label: null,
      outcome: "rejected",
      code: "MISSING_OCCURRED_AT",
      message: "occurredAt is required for preview.",
    };
  }

  const occurredAt = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
  const shiftSettings = await store.listRecords("Settings", {
    filter: { company_profile_id: employee?.company_profile_id },
  });
  const logs = employee
    ? await store.listRecords("AttendanceLog", {
      filter: {
        employee_id: employee.employee_id,
        company_profile_id: employee.company_profile_id,
      },
      sort: "-created_date",
      limit: 20,
    })
    : [];
  const provisional = resolveShiftOccurrence({ employee, shiftSettings, punchAt: occurredAt });
  const existingLog = logs.find((log) =>
    log.status !== "rejected" &&
    (log.date === provisional?.workDate || log.date === manilaDateString(occurredAt))
  ) || null;
  const occurrence = resolveShiftOccurrence({
    employee,
    shiftSettings,
    punchAt: occurredAt,
    existingLog,
  });
  const workDate = occurrence?.workDate || provisional?.workDate || manilaDateString(occurredAt);

  const holds = evaluateInterpretationHolds({
    event: { ...event, occurredAt, receivedAt: event.receivedAt ? new Date(event.receivedAt) : null },
    workDate,
    holidays,
    noWorkDays,
    savedPeriods,
    existingLog,
  });
  if (holds.length) {
    return {
      ok: true,
      expected_slot: null,
      expected_label: null,
      outcome: holds[0].terminal ? "failed_terminal" : "needs_review",
      code: holds[0].code,
      message: "Held for review; official attendance would not change.",
      holds: holds.map((hold) => hold.code),
    };
  }

  const result = await previewAttendancePunch({
    employee,
    occurredAt,
    source: "biometric",
    sourceRef: {
      biometricTimeLogId: event.id,
      deviceSerial: event.deviceSerial,
      deviceLogId: event.logId,
      attendStat: event.attendStatus,
    },
    authorizedBy: "Biometric terminal",
  }, store);

  const resolvedShift = result.resolved_shift || result.resolvedShift || occurrence;
  return {
    ok: true,
    expected_slot: result.action || null,
    expected_label: punchLabel(result.action, result.code),
    outcome: result.outcome,
    code: result.code || result.action || null,
    message: result.message || result.error || punchLabel(result.action, result.outcome),
    work_date: result.work_date || workDate,
    resolved_shift: resolvedShift,
    shift_name: result.shift_name || resolvedShift?.name || null,
    shift_start_manila: result.shift_start_manila || resolvedShift?.shift_start_manila || null,
    shift_end_manila: result.shift_end_manila || resolvedShift?.shift_end_manila || null,
    break_window_manila: result.break_window_manila || null,
    is_overnight: result.is_overnight,
  };
}

export function employeeFromEvent(event, employees, device) {
  const deviceCompany = assignedCompanyId(device);
  if (deviceCompany && event.companyProfileId && String(deviceCompany) !== String(event.companyProfileId)) {
    return null;
  }
  return findEmployeeByRecordId(employees, event.employeeRecordId);
}
