export const MANILA_TIME_ZONE = 'Asia/Manila';

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function manilaDateString(date = new Date()) {
  const validDate = toValidDate(date);
  if (!validDate) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(validDate);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatManilaTime(value, { hour12 = false, includeSeconds = false } = {}) {
  const date = toValidDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat(hour12 ? 'en-US' : 'en-GB', {
    timeZone: MANILA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12,
    ...(hour12 ? {} : { hourCycle: 'h23' }),
  }).format(date);
}

export function formatManilaDateTime(value, options = {}) {
  const date = toValidDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    month: options.month || 'short',
    day: options.day || 'numeric',
    year: options.year || 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options.weekday ? { weekday: options.weekday } : {}),
  }).format(date);
}
