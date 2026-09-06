import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const phase1Ingest = [
  'src/server/biometric/timeLogStore.js',
  'src/server/biometric/reprocess.js',
  'src/server/biometric/classifyTimeLog.js',
  'pages/api/device/upload_log.js',
  'pages/api/biometric/mappings.js',
];

test('Phase 1 biometric ingest never imports logAttendance or writes AttendanceLog', () => {
  for (const relative of phase1Ingest) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.equal(source.includes('logAttendance'), false, relative);
    assert.equal(source.includes('createRecord("AttendanceLog"'), false, relative);
    assert.equal(source.includes("createRecord('AttendanceLog'"), false, relative);
    assert.equal(source.includes('interpretTimeLog'), false, relative);
    assert.equal(source.includes('applyAttendancePunch'), false, relative);
  }
});

test('admin events API may interpret only through explicit authenticated operations', () => {
  const route = readFileSync(join(root, 'pages/api/biometric/events.js'), 'utf8');
  const handler = readFileSync(join(root, 'src/server/biometric/eventsApi.js'), 'utf8');
  assert.equal(route.includes('interpretTimeLogs'), true);
  assert.match(handler, /operation === ['"]interpret['"]/);
  assert.equal(route.includes('logAttendance'), false);
  assert.equal(handler.includes('logAttendance'), false);
});
