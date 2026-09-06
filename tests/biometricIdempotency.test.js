import test from 'node:test';
import assert from 'node:assert/strict';
import { insertImmutableUnique, isUniqueConflict } from '../src/server/biometric/time.js';

test('duplicate (deviceSerial, logId) returns the original row unchanged', async () => {
  const store = new Map();
  const key = '202605260025::13';
  const original = {
    deviceSerial: '202605260025',
    logId: '13',
    processingStatus: 'unmapped_user',
    rawPayload: { LogID: '13', Action: 'FP' },
  };

  const first = await insertImmutableUnique(
    async () => {
      store.set(key, { ...original });
      return store.get(key);
    },
    async () => store.get(key),
  );
  assert.equal(first.duplicate, false);

  const second = await insertImmutableUnique(
    async () => {
      const error = new Error('Unique constraint failed');
      error.code = 'P2002';
      throw error;
    },
    async () => store.get(key),
  );

  assert.equal(second.duplicate, true);
  assert.equal(second.record, store.get(key));
  assert.deepEqual(store.get(key).rawPayload, original.rawPayload);
  assert.equal(store.get(key).processingStatus, 'unmapped_user');
  assert.equal(store.size, 1);
});

test('Prisma unique conflicts are recognized without treating other errors as duplicates', () => {
  assert.equal(isUniqueConflict({ code: 'P2002' }), true);
  assert.equal(isUniqueConflict({ code: 'P2003' }), false);
});
