import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeAttendanceAttempt, isSystemUnavailableError, pendingAttendance, queueAttendanceAttempt } from '../src/lib/offlineAttendance.js';

function memoryStorage() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) }; }

test('system failures are distinguished from business responses', () => {
  assert.equal(isSystemUnavailableError(new TypeError('Failed to fetch')), true);
  assert.equal(isSystemUnavailableError({ status: 503 }), true);
  assert.equal(isSystemUnavailableError({ status: 409, code: 'EARLY_TIME_IN_RECORDED' }), false);
});

test('pending attempts are ordered, idempotent, and removed only after acknowledgement', () => {
  const storage = memoryStorage();
  queueAttendanceAttempt(storage, { clientRequestId: 'later', attemptedAt: '2026-08-18T00:30:00Z' });
  queueAttendanceAttempt(storage, { clientRequestId: 'earlier', attemptedAt: '2026-08-18T00:00:00Z' });
  queueAttendanceAttempt(storage, { clientRequestId: 'earlier', attemptedAt: '2026-08-18T00:00:00Z' });
  assert.deepEqual(pendingAttendance(storage).map(item => item.clientRequestId), ['earlier', 'later']);
  acknowledgeAttendanceAttempt(storage, 'earlier');
  assert.deepEqual(pendingAttendance(storage).map(item => item.clientRequestId), ['later']);
});
