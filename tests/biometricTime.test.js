import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceOccurredAt } from '../src/server/biometric/time.js';

test('F500 Time with trailing Z is device-local and UtcTimezoneMinutes derives UTC', () => {
  const parsed = parseDeviceOccurredAt({
    Time: '2026-9-6-T8:55:20Z',
    UtcTimezoneMinutes: '480',
  });
  assert.equal(parsed.occurredAtLocal, '2026-9-6-T8:55:20Z');
  assert.equal(parsed.utcTimezoneMinutes, 480);
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-06T00:55:20.000Z');
});

test('live UAT punch Time is not treated as UTC because of Z', () => {
  const parsed = parseDeviceOccurredAt({
    Time: '2026-09-06-T11:47:00Z',
    UtcTimezoneMinutes: 480,
  });
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-06T03:47:00.000Z');
  assert.notEqual(parsed.occurredAt.toISOString(), '2026-09-06T11:47:00.000Z');
});

test('missing timezone offset keeps the raw local clock and does not assume Manila', () => {
  const parsed = parseDeviceOccurredAt({ Time: '2026-9-6-T8:55:20Z' });
  assert.equal(parsed.occurredAt, null);
  assert.equal(parsed.occurredAtLocal, '2026-9-6-T8:55:20Z');
  assert.equal(parsed.utcTimezoneMinutes, null);
});

test('invalid calendar date does not invent a UTC timestamp', () => {
  const parsed = parseDeviceOccurredAt({
    Time: '2026-13-40-T25:61:90Z',
    UtcTimezoneMinutes: '480',
  });
  assert.equal(parsed.occurredAt, null);
  assert.equal(parsed.occurredAtLocal, '2026-13-40-T25:61:90Z');
});
