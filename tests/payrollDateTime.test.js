import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeviceOccurredAt } from '../src/server/biometric/time.js';
import { previewAttendancePunch } from '../src/server/attendance/previewAttendancePunch.js';
import {
  formatDeviceDateTime,
  formatPayrollDateTime,
  formatPayrollDateTimeParts,
  formatPayrollTime,
  formatUtcDebug,
  parseDeviceWallClock,
} from '../src/lib/payrollDateTime.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('authoritative UTC occurredAt displays as Manila afternoon, not 6:52 AM', () => {
  assert.equal(formatPayrollDateTime('2026-09-06T06:52:17.000Z'), 'Sep 6, 2026 · 2:52:17 PM');
  assert.equal(formatPayrollDateTime(new Date('2026-09-06T06:52:17.000Z')), 'Sep 6, 2026 · 2:52:17 PM');
  assert.equal(formatPayrollTime('2026-09-06T06:52:17.000Z'), 'Sep 6, 2:52 PM');
  assert.equal(formatPayrollDateTime('2026-09-06T06:52:17.000Z', { includeSeconds: false }), 'Sep 6, 2026 · 2:52 PM');
  assert.equal(formatUtcDebug('2026-09-06T06:52:17.000Z'), '2026-09-06T06:52:17.000Z');
});

test('midnight and date-boundary conversion stays on the Manila calendar date', () => {
  assert.equal(formatPayrollDateTime('2026-09-05T16:00:00.000Z'), 'Sep 6, 2026 · 12:00:00 AM');
  assert.equal(formatPayrollDateTime('2026-09-06T16:00:00.000Z'), 'Sep 7, 2026 · 12:00:00 AM');
  const parts = formatPayrollDateTimeParts('2026-09-05T16:00:00.000Z');
  assert.equal(parts.date, 'Sep 6, 2026');
  assert.equal(parts.time, '12:00:00 AM');
});

test('null and invalid timestamps do not crash display formatters', () => {
  assert.equal(formatPayrollDateTime(null), '');
  assert.equal(formatPayrollDateTime(undefined), '');
  assert.equal(formatPayrollDateTime(''), '');
  assert.equal(formatPayrollDateTime('not-a-date'), '');
  assert.equal(formatPayrollTime('bogus'), '');
  assert.equal(formatDeviceDateTime(null), '');
  assert.equal(formatDeviceDateTime('2026-13-40-T25:61:90Z'), '');
  assert.equal(formatUtcDebug(null), '');
  assert.equal(formatUtcDebug(undefined), '');
});

test('device-local manufacturer Time is not given a second +8 conversion', () => {
  const raw = '2026-9-6-T14:52:17Z';
  assert.deepEqual(parseDeviceWallClock(raw), {
    year: 2026,
    month: 9,
    day: 6,
    hour: 14,
    minute: 52,
    second: 17,
    raw,
  });
  assert.equal(formatDeviceDateTime(raw), 'Sep 6, 2026 · 2:52:17 PM');
  assert.notEqual(formatDeviceDateTime(raw), formatPayrollDateTime('2026-09-06T14:52:17.000Z'));
  assert.equal(formatPayrollDateTime('2026-09-06T06:52:17.000Z'), formatDeviceDateTime(raw));
  assert.equal(parseDeviceWallClock(new Date('2026-09-06T06:52:17.000Z')), null);
});

test('Phase 1 stored occurredAt remains unchanged and Log 16 semantics stay device-local', () => {
  const parsed = parseDeviceOccurredAt({
    Time: '2026-9-6-T14:52:17Z',
    UtcTimezoneMinutes: 480,
  });
  assert.equal(parsed.occurredAtLocal, '2026-9-6-T14:52:17Z');
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-06T06:52:17.000Z');
  assert.equal(formatPayrollDateTime(parsed.occurredAt), 'Sep 6, 2026 · 2:52:17 PM');
  assert.equal(formatDeviceDateTime(parsed.occurredAtLocal), 'Sep 6, 2026 · 2:52:17 PM');

  const timeSource = readFileSync(join(root, 'src/server/biometric/time.js'), 'utf8');
  assert.match(timeSource, /trailing Z is a literal/);
  assert.equal(timeSource.includes('formatPayrollDateTime'), false);
});

test('display helpers do not interpret events or write attendance', async () => {
  const store = {
    records: { AttendanceLog: [], Settings: [], OvertimeRequest: [], PasscodeAuditLog: [] },
    async listRecords(entity) { return this.records[entity] || []; },
    async createRecord() { throw new Error('preview must not write through the live store'); },
    async updateRecord() { throw new Error('preview must not write through the live store'); },
  };
  const before = JSON.stringify(store.records);
  const preview = await previewAttendancePunch({
    employee: { id: 'emp-1', employee_id: 'EMP-1', company_profile_id: 'co-1', first_name: 'Ada', last_name: 'Lovelace', work_schedule: 'regular' },
    occurredAt: new Date('2026-09-06T06:52:17.000Z'),
    source: 'biometric',
    shiftSettings: [{
      id: 'regular',
      setting_name: 'Regular',
      shift_start_time: '08:00',
      shift_end_time: '17:00',
      overtime_start_time: '17:30',
      is_default: true,
      is_active: true,
    }],
    overtimeRequests: [],
  }, store);
  assert.equal(preview.preview, true);
  assert.equal(JSON.stringify(store.records), before);

  const eventsUi = readFileSync(join(root, 'src/pages/BiometricEvents.jsx'), 'utf8');
  assert.match(eventsUi, /formatPayrollDateTime/);
  assert.match(eventsUi, /formatDeviceDateTime/);
  assert.equal(eventsUi.includes('interpretTimeLog('), false);
});
