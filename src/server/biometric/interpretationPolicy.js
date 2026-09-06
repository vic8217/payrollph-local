// @ts-nocheck
import { DUPLICATE_SCAN_WINDOW_MS, lastManualPunch } from "../attendance/applyAttendancePunch.js";

export const CATCHUP_REVIEW_MS = 48 * 60 * 60 * 1000;

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function punchTimes(log) {
  return [log?.time_in, log?.break_time_out, log?.break_time_in, log?.time_out]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && Number.isFinite(value.getTime()));
}

export function workDateFromOccurredAt(occurredAt, manilaDateString) {
  return manilaDateString(occurredAt);
}

export function isHolidayOrNoWorkDate(workDate, holidays = [], noWorkDays = []) {
  const date = dateOnly(workDate);
  const holiday = holidays.some((item) => dateOnly(item.date) === date);
  const noWork = noWorkDays.some((item) => dateOnly(item.date) === date);
  return { holiday, noWork, blocked: holiday || noWork };
}

export function isSavedPayrollPeriodDate(workDate, periods = []) {
  const date = dateOnly(workDate);
  return periods.some((period) => {
    const start = dateOnly(period.start_date);
    const end = dateOnly(period.end_date);
    return start && end && date >= start && date <= end;
  });
}

export function isCatchupReview(occurredAt, receivedAt, now = occurredAt) {
  if (!occurredAt || !receivedAt) return false;
  return receivedAt.getTime() - occurredAt.getTime() > CATCHUP_REVIEW_MS;
}

export function isOutOfOrder(occurredAt, existingLog) {
  if (!occurredAt || !existingLog) return false;
  const later = punchTimes(existingLog).some((punch) => punch.getTime() > occurredAt.getTime());
  return later;
}

export function isAttendanceDayComplete(occurredAt, existingLog) {
  if (!existingLog?.time_out || !occurredAt) return false;
  const timeOut = new Date(existingLog.time_out);
  if (!Number.isFinite(timeOut.getTime())) return false;
  return occurredAt.getTime() > timeOut.getTime() + DUPLICATE_SCAN_WINDOW_MS;
}

export function evaluateInterpretationHolds({
  event,
  workDate,
  holidays = [],
  noWorkDays = [],
  savedPeriods = [],
  existingLog = null,
  skipHolds = false,
} = {}) {
  if (skipHolds) return [];

  const occurredAt = event?.occurredAt instanceof Date ? event.occurredAt : event?.occurredAt ? new Date(event.occurredAt) : null;
  const receivedAt = event?.receivedAt instanceof Date ? event.receivedAt : event?.receivedAt ? new Date(event.receivedAt) : null;
  const holds = [];

  if (!occurredAt || !Number.isFinite(occurredAt.getTime())) {
    return [{ code: "MISSING_OCCURRED_AT", terminal: true }];
  }
  if (isCatchupReview(occurredAt, receivedAt)) {
    holds.push({ code: "CATCHUP_REQUIRES_REVIEW" });
  }
  if (isOutOfOrder(occurredAt, existingLog)) {
    holds.push({ code: "OUT_OF_ORDER" });
  }
  const calendar = isHolidayOrNoWorkDate(workDate, holidays, noWorkDays);
  if (calendar.blocked) {
    holds.push({ code: "NON_WORKING_DATE" });
  }
  if (isSavedPayrollPeriodDate(workDate, savedPeriods)) {
    holds.push({ code: "PAYROLL_PERIOD_SAVED" });
  }
  if (isAttendanceDayComplete(occurredAt, existingLog)) {
    holds.push({ code: "ATTENDANCE_COMPLETE" });
  }
  return holds;
}

export function lastPunchIso(log) {
  return lastManualPunch(log);
}
