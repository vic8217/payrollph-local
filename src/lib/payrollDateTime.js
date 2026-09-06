import { MANILA_TIME_ZONE } from "./dateUtils.js";

const F500_WALL_CLOCK = /^(\d{4})-(\d{1,2})-(\d{1,2})-?T(\d{1,2}):(\d{1,2}):(\d{1,2})(?:Z)?$/i;

function toValidDate(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isValidWallClockParts(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second
  );
}

function partValue(parts, type) {
  return String(parts.find((part) => part.type === type)?.value || "").replace(/\u202f/g, " ").trim();
}

function formatClockParts(date, timeZone, { includeYear = true, includeSeconds = true } = {}) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).formatToParts(date);

  const dateLabel = includeYear
    ? `${partValue(parts, "month")} ${partValue(parts, "day")}, ${partValue(parts, "year")}`
    : `${partValue(parts, "month")} ${partValue(parts, "day")}`;
  const timeLabel = includeSeconds
    ? `${partValue(parts, "hour")}:${partValue(parts, "minute")}:${partValue(parts, "second")} ${partValue(parts, "dayPeriod")}`
    : `${partValue(parts, "hour")}:${partValue(parts, "minute")} ${partValue(parts, "dayPeriod")}`;

  return {
    date: dateLabel,
    time: timeLabel,
    full: includeYear ? `${dateLabel} · ${timeLabel}` : `${dateLabel}, ${timeLabel}`,
  };
}

export function parseDeviceWallClock(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return null;
  const match = String(value).trim().match(F500_WALL_CLOCK);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isValidWallClockParts(year, month, day, hour, minute, second)) return null;
  return { year, month, day, hour, minute, second, raw: String(value).trim() };
}

export function formatPayrollDateTime(value, { includeYear = true, includeSeconds = true } = {}) {
  const date = toValidDate(value);
  if (!date) return "";
  return formatClockParts(date, MANILA_TIME_ZONE, { includeYear, includeSeconds }).full;
}

export function formatPayrollTime(value) {
  return formatPayrollDateTime(value, { includeYear: false, includeSeconds: false });
}

export function formatPayrollDateTimeParts(value, options = {}) {
  const date = toValidDate(value);
  if (!date) return { date: "", time: "", full: "" };
  return formatClockParts(date, MANILA_TIME_ZONE, options);
}

export function formatDeviceDateTime(value, { includeYear = true, includeSeconds = true } = {}) {
  const wall = parseDeviceWallClock(value);
  if (!wall) return "";
  const asUtcWallClock = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
  return formatClockParts(asUtcWallClock, "UTC", { includeYear, includeSeconds }).full;
}

export function formatDeviceDateTimeParts(value, options = {}) {
  const wall = parseDeviceWallClock(value);
  if (!wall) return { date: "", time: "", full: "" };
  const asUtcWallClock = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
  return formatClockParts(asUtcWallClock, "UTC", options);
}

export function formatUtcDebug(value) {
  const date = toValidDate(value);
  if (date) return date.toISOString();
  if (value == null || value === "") return "";
  return String(value);
}
