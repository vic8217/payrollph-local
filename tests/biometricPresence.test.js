import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveConnectionStatus } from '../src/server/biometric/presence.js';

test('presence is unknown without authenticated activity', () => {
  assert.equal(deriveConnectionStatus({}), 'unknown');
});

test('recent lastSeenAt is online and an old timestamp is stale', () => {
  const now = new Date('2026-09-06T04:00:00.000Z');
  assert.equal(deriveConnectionStatus({ lastSeenAt: '2026-09-06T03:59:00.000Z' }, now, 5 * 60 * 1000), 'online');
  assert.equal(deriveConnectionStatus({ lastLoginAt: '2026-09-06T03:50:00.000Z' }, now, 5 * 60 * 1000), 'stale');
});
