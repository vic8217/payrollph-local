import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/server/biometric/timeLogStore.js',
  'src/server/biometric/reprocess.js',
  'src/server/biometric/classifyTimeLog.js',
  'pages/api/device/upload_log.js',
  'pages/api/biometric/events.js',
  'pages/api/biometric/mappings.js',
];

test('Phase 1 biometric modules never import logAttendance or write AttendanceLog', () => {
  for (const relative of files) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.equal(source.includes('logAttendance'), false, relative);
    assert.equal(source.includes('createRecord("AttendanceLog"'), false, relative);
    assert.equal(source.includes("createRecord('AttendanceLog'"), false, relative);
  }
});
