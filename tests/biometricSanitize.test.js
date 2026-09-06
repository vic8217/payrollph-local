import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeManufacturerPayload } from '../src/server/biometric/sanitizePayload.js';
import { normalizeVerifyMethod } from '../src/server/biometric/verifyMethod.js';

const livePayload = {
  Event: 'TimeLog_v2',
  DeviceSerialNo: '202605260025',
  LogID: '13',
  TransID: 'abc',
  Time: '2026-09-06-T11:47:00Z',
  UtcTimezoneMinutes: '480',
  UserID: '2',
  AttendStat: 'DutyOn',
  Action: 'FP',
  JobCode: '0',
  Photo: 'No',
  LogImage: 'iVBoRw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  FaceData: 'AAAA',
  FingerData: 'BBBB',
  UnknownBlob: 'CCCCCCCC',
  Password: 'secret',
};

test('allow-list keeps reviewed attendance metadata and drops credentials', () => {
  const { sanitized, discardedFieldNames, payloadSanitized } = sanitizeManufacturerPayload(livePayload);
  assert.equal(payloadSanitized, true);
  assert.equal(sanitized.LogID, '13');
  assert.equal(sanitized.AttendStat, 'DutyOn');
  assert.equal(sanitized.Action, 'FP');
  assert.equal(sanitized.Photo, 'No');
  assert.equal(sanitized.LogImage, undefined);
  assert.equal(sanitized.FaceData, undefined);
  assert.equal(sanitized.Password, undefined);
  assert.ok(discardedFieldNames.includes('LogImage'));
  assert.ok(discardedFieldNames.includes('UnknownBlob'));
  assert.ok(!Object.values(sanitized).includes('secret'));
});

test('unknown field values are never retained; only names may be recorded', () => {
  const { sanitized, discardedFieldNames } = sanitizeManufacturerPayload({
    LogID: '1',
    MysteryTemplate: 'base64-should-never-be-stored',
  });
  assert.equal(sanitized.MysteryTemplate, undefined);
  assert.deepEqual(discardedFieldNames, ['MysteryTemplate']);
  assert.equal(JSON.stringify(sanitized).includes('base64-should-never-be-stored'), false);
});

test('Photo yes/no is kept but photo binaries are discarded', () => {
  const kept = sanitizeManufacturerPayload({ Photo: 'Yes' });
  const dropped = sanitizeManufacturerPayload({
    Photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
  });
  assert.equal(kept.sanitized.Photo, 'Yes');
  assert.equal(dropped.sanitized.Photo, undefined);
});

test('only verified live Action FP normalizes to fingerprint', () => {
  assert.equal(normalizeVerifyMethod('FP'), 'fingerprint');
  assert.equal(normalizeVerifyMethod('fp'), 'fingerprint');
  assert.equal(normalizeVerifyMethod('Face'), null);
  assert.equal(normalizeVerifyMethod('Card'), null);
  assert.equal(normalizeVerifyMethod('UnknownX'), null);
});
