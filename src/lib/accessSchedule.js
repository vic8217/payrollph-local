// @ts-nocheck
export const ACCESS_SCHEDULE_TIME_ZONE = "Asia/Manila";

export const ACCESS_SCHEDULE_DAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
];

export const DEFAULT_ACCESS_SCHEDULE = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start_time: "08:00",
  end_time: "17:00",
  timezone: ACCESS_SCHEDULE_TIME_ZONE,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeAccessSchedule(schedule) {
  if (!schedule || schedule.enabled === false) {
    return null;
  }

  const days = Array.isArray(schedule.days)
    ? [...new Set(schedule.days.map(Number))]
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .sort((a, b) => a - b)
    : [];
  const startTime = String(schedule.start_time || "").trim();
  const endTime = String(schedule.end_time || "").trim();

  if (!days.length) {
    throw new Error("Choose at least one allowed access day");
  }
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    throw new Error("Access start and end times must use HH:MM format");
  }
  if (startTime === endTime) {
    throw new Error("Access start and end times cannot be the same");
  }

  return {
    enabled: true,
    days,
    start_time: startTime,
    end_time: endTime,
    timezone: ACCESS_SCHEDULE_TIME_ZONE,
  };
}

export function isWithinAccessSchedule(schedule, now = new Date()) {
  let normalized = null;
  try {
    normalized = normalizeAccessSchedule(schedule);
  } catch {
    return false;
  }
  if (!normalized) {
    return true;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized.timezone || ACCESS_SCHEDULE_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDay = weekdayMap[getPart("weekday")];
  const currentTime = `${getPart("hour")}:${getPart("minute")}`;
  const previousDay = currentDay === 0 ? 6 : currentDay - 1;

  if (normalized.start_time > normalized.end_time) {
    return (
      (normalized.days.includes(currentDay) && currentTime >= normalized.start_time) ||
      (normalized.days.includes(previousDay) && currentTime <= normalized.end_time)
    );
  }

  return (
    normalized.days.includes(currentDay) &&
    currentTime >= normalized.start_time &&
    currentTime <= normalized.end_time
  );
}

export function describeAccessSchedule(schedule) {
  let normalized = null;
  try {
    normalized = normalizeAccessSchedule(schedule);
  } catch {
    return "Invalid schedule";
  }
  if (!normalized) {
    return "No time restriction";
  }

  const dayLabels = normalized.days
    .map((day) => ACCESS_SCHEDULE_DAYS.find((item) => item.value === day)?.short)
    .filter(Boolean)
    .join(", ");

  const overnightNote = normalized.start_time > normalized.end_time ? " next day" : "";
  return `${dayLabels} ${normalized.start_time}-${normalized.end_time}${overnightNote} PH time`;
}
