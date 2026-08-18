export const OFFLINE_ATTENDANCE_KEY = 'payrollph:pending-attendance:v1';

export function isSystemUnavailableError(error) {
  const status = Number(error?.status) || 0;
  return !status || [502, 503, 504].includes(status) || status >= 500;
}

export function pendingAttendance(storage) {
  try {
    const value = JSON.parse(storage?.getItem(OFFLINE_ATTENDANCE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item?.clientRequestId && item?.syncStatus === 'PENDING_SYNC') : [];
  } catch {
    return [];
  }
}

export function queueAttendanceAttempt(storage, event) {
  const pending = pendingAttendance(storage);
  if (pending.some(item => item.clientRequestId === event.clientRequestId)) return pending;
  const next = [...pending, { ...event, syncStatus: 'PENDING_SYNC' }]
    .sort((a, b) => String(a.attemptedAt).localeCompare(String(b.attemptedAt)));
  storage?.setItem(OFFLINE_ATTENDANCE_KEY, JSON.stringify(next));
  return next;
}

export function acknowledgeAttendanceAttempt(storage, clientRequestId) {
  const next = pendingAttendance(storage).filter(item => item.clientRequestId !== clientRequestId);
  storage?.setItem(OFFLINE_ATTENDANCE_KEY, JSON.stringify(next));
  return next;
}

export function createClientRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
