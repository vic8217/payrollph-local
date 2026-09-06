import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAttendancePunch } from '../src/server/attendance/applyAttendancePunch.js';
import { previewAttendancePunch } from '../src/server/attendance/previewAttendancePunch.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const dayShift = {
  id: 'regular',
  setting_name: 'Regular',
  shift_start_time: '08:00',
  shift_end_time: '17:00',
  overtime_start_time: '17:30',
  is_default: true,
  is_active: true,
};

const dayShiftWithBreak = {
  ...dayShift,
  break_start_time: '12:00',
  break_end_time: '13:00',
  break_duration_minutes: 60,
};

const graveyardShift = {
  id: 'graveyard',
  setting_name: 'Graveyard',
  shift_start_time: '22:00',
  shift_end_time: '06:00',
  overtime_start_time: '06:30',
  is_active: true,
};

const employee = {
  id: 'emp-rec-1',
  employee_id: 'EMP-1',
  company_profile_id: 'co-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  work_schedule: 'regular',
  status: 'active',
};

function createStore(seed = {}) {
  const records = {
    AttendanceLog: [...(seed.AttendanceLog || [])],
    Settings: [...(seed.Settings || [])],
    OvertimeRequest: [...(seed.OvertimeRequest || [])],
    PasscodeAuditLog: [...(seed.PasscodeAuditLog || [])],
  };
  let seq = 1;
  const matches = (record, filter = {}) => Object.entries(filter).every(([key, value]) => record[key] === value);
  return {
    records,
    async listRecords(entity, { filter } = {}) {
      return (records[entity] || []).filter((record) => matches(record, filter));
    },
    async createRecord(entity, data) {
      const row = { id: `${entity}-${seq++}`, created_date: new Date().toISOString(), ...data };
      records[entity].push(row);
      return row;
    },
    async updateRecord(entity, id, data) {
      const row = records[entity].find((record) => record.id === id);
      Object.assign(row, data);
      return row;
    },
  };
}

function punch(store, occurredAt, extra = {}) {
  return applyAttendancePunch({
    employee: extra.employee || employee,
    occurredAt,
    source: extra.source || 'employee_portal',
    sourceRef: extra.sourceRef || null,
    shiftSettings: extra.shiftSettings || [dayShift],
    overtimeRequests: extra.overtimeRequests || [],
    authorizedBy: extra.authorizedBy || 'Employee Portal',
    declaredDayType: extra.declaredDayType || null,
  }, store);
}

test('occurredAt is required and is never replaced by wall-clock now', async () => {
  const store = createStore();
  const missing = await punch(store, null);
  assert.equal(missing.outcome, 'rejected');
  assert.equal(missing.code, 'OCCURRED_AT_REQUIRED');

  const occurredAt = new Date('2026-08-18T00:05:00.000Z');
  const before = Date.now();
  const applied = await punch(store, occurredAt);
  const after = Date.now();
  assert.equal(applied.outcome, 'applied');
  assert.equal(applied.action, 'time_in');
  assert.equal(applied.log.time_in, occurredAt.toISOString());
  assert.notEqual(applied.log.time_in, new Date(before).toISOString());
  assert.notEqual(applied.log.time_in, new Date(after).toISOString());
  assert.equal(applied.log.date, '2026-08-18');
});

test('portal wrapper still supplies occurredAt as new Date() and does not own slot rules', () => {
  const wrapper = readFileSync(join(root, 'pages/api/functions/logAttendance.js'), 'utf8');
  assert.match(wrapper, /occurredAt:\s*new Date\(\)/);
  assert.match(wrapper, /source:\s*['"]employee_portal['"]/);
  assert.equal(wrapper.includes('DUPLICATE_SCAN_WINDOW_MS'), false);
  assert.equal(wrapper.includes('DutyOn'), false);
});

test('four-slot sequence uses PayrollPH order, not AttendStat', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:05:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: {
      biometricTimeLogId: 'evt-on',
      deviceSerial: '202605260025',
      deviceLogId: '101',
      attendStat: 'DutyOn',
      verifyMethod: 'FP',
      verifyMethodNormalized: 'fingerprint',
    },
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.time_in_source, 'biometric');
  assert.equal(first.log.time_in_attend_stat, 'DutyOn');
  assert.equal(first.log.time_in_verification_method, 'fingerprint');
  assert.equal(first.log.record_source, 'biometric');

  assert.equal(Boolean(first.log.break_time_out), true);
  const second = await punch(store, new Date('2026-08-18T05:05:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: {
      biometricTimeLogId: 'evt-off',
      deviceSerial: '202605260025',
      deviceLogId: '102',
      attendStat: 'DutyOff',
      verifyMethod: 'FP',
      verifyMethodNormalized: 'fingerprint',
    },
  });
  assert.equal(second.action, 'break_time_in');
  assert.equal(second.log.time_out, undefined);
  assert.equal(second.log.break_time_in_attend_stat, 'DutyOff');
  assert.equal(second.log.time_in_source, 'biometric');

  const third = await punch(store, new Date('2026-08-18T09:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(third.action, 'time_out');
  assert.equal(typeof third.log.hours_worked, 'number');
  assert.equal(typeof third.log.late_minutes, 'number');
});

test('early Time In stays audit-only and duplicate window ignores a second scan', async () => {
  const store = createStore();
  const early = await punch(store, new Date('2026-08-17T22:30:00.000Z'));
  assert.equal(early.outcome, 'early_attempt');
  assert.equal(store.records.AttendanceLog.length, 0);
  assert.equal(store.records.PasscodeAuditLog[0].action, 'early_time_in_attempt');

  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  assert.equal(first.action, 'time_in');
  const duplicate = await punch(store, new Date('2026-08-18T00:01:00.000Z'));
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(store.records.AttendanceLog[0].break_time_out, undefined);
});

test('minimum step interval blocks the next official slot', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  const tooSoon = await punch(store, new Date('2026-08-18T00:03:00.000Z'));
  assert.equal(tooSoon.outcome, 'duplicate');
});

test('overnight punch after midnight stays on the prior shift date', async () => {
  const store = createStore();
  const overnightEmployee = { ...employee, work_schedule: 'graveyard' };
  const first = await punch(store, new Date('2026-08-18T14:30:00.000Z'), {
    employee: overnightEmployee,
    shiftSettings: [graveyardShift],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');

  const second = await punch(store, new Date('2026-08-18T18:00:00.000Z'), {
    employee: overnightEmployee,
    shiftSettings: [graveyardShift],
  });
  assert.equal(second.log.id, first.log.id);
  assert.equal(second.action, 'time_out');
  assert.equal(second.log.date, '2026-08-18');
});

test('after shift end with no open log is rejected and a complete day stays complete', async () => {
  const store = createStore();
  const late = await punch(store, new Date('2026-08-18T10:00:00.000Z'));
  assert.equal(late.outcome, 'rejected');
  assert.equal(late.code, 'TIME_IN_AFTER_SHIFT_END');

  await punch(store, new Date('2026-08-18T00:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  await punch(store, new Date('2026-08-18T05:20:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  await punch(store, new Date('2026-08-18T09:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  const extra = await punch(store, new Date('2026-08-18T09:30:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(extra.outcome, 'rejected');
  assert.equal(extra.code, 'ATTENDANCE_COMPLETE');
});

test('Log 15-style first punch during break writes Time In (2) only', async () => {
  const store = createStore();
  const withBreak = {
    ...employee,
    break_time: '12:00',
    break_duration_minutes: 60,
  };
  const shift = {
    ...dayShift,
    break_start_time: '12:00',
    break_end_time: '13:00',
    break_duration_minutes: 60,
  };
  const result = await punch(store, new Date('2026-09-06T05:49:15.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
    source: 'biometric',
    sourceRef: {
      biometricTimeLogId: 'cmtpe681g000b2aixbk9q5300',
      deviceSerial: '202605260025',
      deviceLogId: '15',
      attendStat: 'DutyOff',
    },
  });
  assert.equal(result.outcome, 'applied');
  assert.equal(result.action, 'break_time_in');
  assert.equal(result.log.time_in, null);
  assert.equal(Boolean(result.log.break_time_out), true);
  assert.equal(result.log.break_time_in, '2026-09-06T05:49:15.000Z');
  assert.equal(result.log.time_out, undefined);
  assert.equal(result.log.break_time_in_source, 'biometric');
  assert.equal(result.log.break_time_in_device_serial, '202605260025');
  assert.equal(result.log.break_time_in_device_log_id, '15');
  assert.equal(result.log.time_in_source, undefined);
  assert.equal(result.log.time_out_source, undefined);
  assert.equal(result.log.break_time_out_source, undefined);
  assert.equal(result.log.record_source, 'biometric');
});

test('sequential four-punch clean day and a duplicate does not advance the slot', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:05:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: { biometricTimeLogId: 'evt-1', deviceSerial: '202605260025', deviceLogId: '1', attendStat: 'DutyOn' },
  });
  assert.equal(first.action, 'time_in');

  const duplicate = await punch(store, new Date('2026-08-18T00:06:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: { biometricTimeLogId: 'evt-1b', deviceSerial: '202605260025', deviceLogId: '1b', attendStat: 'DutyOn' },
  });
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(store.records.AttendanceLog[0].time_in_device_log_id, '1');

  const second = await punch(store, new Date('2026-08-18T05:05:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: { biometricTimeLogId: 'evt-2', deviceSerial: '202605260025', deviceLogId: '2', attendStat: 'DutyOn' },
  });
  assert.equal(second.action, 'break_time_in');
  assert.equal(second.log.break_time_in_source, 'biometric');

  const third = await punch(store, new Date('2026-08-18T09:00:00.000Z'), {
    shiftSettings: [dayShiftWithBreak],
    source: 'biometric',
    sourceRef: { biometricTimeLogId: 'evt-3', deviceSerial: '202605260025', deviceLogId: '3', attendStat: 'DutyOff' },
  });
  assert.equal(third.action, 'time_out');
  assert.equal(third.log.time_out_source, 'biometric');
  assert.equal(third.log.time_in_device_log_id, '1');
  assert.equal(third.log.break_time_in_device_log_id, '2');
  assert.equal(third.log.time_out_device_log_id, '3');
});

test('preview is read-only and reuses the canonical punch engine', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:05:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  const before = JSON.stringify(store.records.AttendanceLog);

  const preview = await previewAttendancePunch({
    employee,
    occurredAt: new Date('2026-08-18T05:05:00.000Z'),
    source: 'biometric',
    sourceRef: { biometricTimeLogId: 'preview-1', deviceSerial: '202605260025', deviceLogId: '99' },
    shiftSettings: [dayShiftWithBreak],
    overtimeRequests: [],
  }, store);

  assert.equal(preview.preview, true);
  assert.equal(preview.action, 'break_time_in');
  assert.equal(preview.label, 'Time In (2)');
  assert.equal(JSON.stringify(store.records.AttendanceLog), before);
});

test('normal complete day uses the four-slot PayrollPH sequence', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(first.action, 'time_in');
  assert.equal(Boolean(first.log.break_time_out), true);
  assert.equal((await punch(store, new Date('2026-08-18T05:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] })).action, 'break_time_in');
  const done = await punch(store, new Date('2026-08-18T09:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(done.action, 'time_out');
  assert.equal(done.log.time_in, '2026-08-18T00:00:00.000Z');
  assert.equal(done.log.break_time_in, '2026-08-18T05:00:00.000Z');
  assert.equal(done.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(done.log.day_type, 'regular');
});

test('declared half-day PM uses Time In (1) then Time Out (2) and keeps HALF DAY', async () => {
  const store = createStore();
  const shift = { ...dayShift, break_start_time: '12:00', break_end_time: '13:00', break_duration_minutes: 60 };
  const withBreak = { ...employee, break_time: '12:00', break_duration_minutes: 60 };
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
    declaredDayType: 'half_day',
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.time_in, '2026-08-18T06:00:00.000Z');
  assert.equal(first.log.break_time_out, undefined);
  assert.equal(first.log.break_time_in, undefined);
  assert.equal(first.log.day_type, 'half_day');

  const preview = await previewAttendancePunch({
    employee: withBreak,
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    source: 'biometric',
    shiftSettings: [shift],
    overtimeRequests: [],
  }, store);
  assert.equal(preview.preview, true);
  assert.equal(preview.action, 'time_out');

  const last = await punch(store, new Date('2026-08-18T09:00:00.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
  });
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(last.log.break_time_out, undefined);
  assert.equal(last.log.break_time_in, undefined);
  assert.equal(last.log.day_type, 'half_day');
});

test('existing AM half-day policy: undeclared 08:00 then 12:00 is Time Out (1), not auto HALF DAY', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(first.action, 'time_in');
  assert.equal(Boolean(first.log.break_time_out), true);
  assert.equal(first.log.day_type, 'regular');
  const second = await punch(store, new Date('2026-08-18T05:05:00.000Z'), { shiftSettings: [dayShiftWithBreak] });
  assert.equal(second.action, 'break_time_in');
  assert.equal(second.log.time_out, undefined);
  assert.equal(second.log.day_type, 'regular');
});

test('declared AM half-day uses Time In (1) then Time Out (2) without inventing break punches', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), { declaredDayType: 'half_day' });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.day_type, 'half_day');
  const second = await punch(store, new Date('2026-08-18T04:00:00.000Z'));
  assert.equal(second.action, 'time_out');
  assert.equal(second.log.time_in, '2026-08-18T00:00:00.000Z');
  assert.equal(second.log.time_out, '2026-08-18T04:00:00.000Z');
  assert.equal(second.log.break_time_out, undefined);
  assert.equal(second.log.break_time_in, undefined);
  assert.equal(second.log.day_type, 'half_day');
});

test('undeclared afternoon first punch without a scheduled break is Time In (1) then Time Out (2), still regular', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'));
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.day_type, 'regular');
  const last = await punch(store, new Date('2026-08-18T09:00:00.000Z'));
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.time_in, '2026-08-18T06:00:00.000Z');
  assert.equal(last.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(last.log.day_type, 'regular');
});

test('late first punch is Time In (1) and is not automatically half-day', async () => {
  const store = createStore();
  const late = await punch(store, new Date('2026-08-18T01:30:00.000Z'));
  assert.equal(late.action, 'time_in');
  assert.equal(late.log.day_type, 'regular');
  assert.equal(late.log.time_in, '2026-08-18T01:30:00.000Z');
});

test('approved personal leave does not invent a half-day punch classification', async () => {
  const store = createStore({
    PersonalLeave: [{
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
      status: 'approved',
      leave_type: 'personal',
      start_date: '2026-08-18',
      end_date: '2026-08-18',
    }],
  });
  const first = await punch(store, new Date('2026-08-18T00:05:00.000Z'));
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.day_type, 'regular');
});

test('afternoon first punch with a scheduled break stays Time In (2), not invented half-day', async () => {
  const store = createStore();
  const shift = { ...dayShift, break_start_time: '12:00', break_end_time: '13:00', break_duration_minutes: 60 };
  const withBreak = { ...employee, break_time: '12:00', break_duration_minutes: 60 };
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
  });
  assert.equal(first.action, 'break_time_in');
  assert.equal(first.log.day_type, 'regular');
  assert.equal(first.log.time_in, null);
});

test('portal and biometric write the same slots and half-day classification for identical timestamps', async () => {
  const portal = createStore();
  const biometric = createStore();
  const shift = { ...dayShift, break_start_time: '12:00', break_end_time: '13:00' };
  const withBreak = { ...employee, break_time: '12:00' };
  const times = [
    new Date('2026-08-18T06:00:00.000Z'),
    new Date('2026-08-18T09:00:00.000Z'),
  ];
  for (const time of times) {
    await punch(portal, time, { employee: withBreak, shiftSettings: [shift], source: 'employee_portal', declaredDayType: 'half_day' });
    await punch(biometric, time, {
      employee: withBreak,
      shiftSettings: [shift],
      source: 'biometric',
      declaredDayType: 'half_day',
      sourceRef: { biometricTimeLogId: `evt-${time.toISOString()}`, deviceSerial: '202605260025', deviceLogId: '99', attendStat: 'DutyOff' },
    });
  }
  assert.equal(portal.records.AttendanceLog[0].time_in, biometric.records.AttendanceLog[0].time_in);
  assert.equal(portal.records.AttendanceLog[0].time_out, biometric.records.AttendanceLog[0].time_out);
  assert.equal(portal.records.AttendanceLog[0].day_type, 'half_day');
  assert.equal(biometric.records.AttendanceLog[0].day_type, 'half_day');
  assert.equal(biometric.records.AttendanceLog[0].time_out_source, 'biometric');
  assert.equal(biometric.records.AttendanceLog[0].time_in_source, 'biometric');
  assert.equal(portal.records.AttendanceLog[0].time_out_source, undefined);
});

test('AttendStat does not choose the half-day slot and a duplicate scan does not change classification', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), {
    declaredDayType: 'half_day',
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOff', deviceLogId: '1' },
  });
  assert.equal(first.action, 'time_in');
  const duplicate = await punch(store, new Date('2026-08-18T06:01:00.000Z'), {
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOn', deviceLogId: '2' },
  });
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
  assert.equal(store.records.AttendanceLog[0].day_type, 'half_day');
});

test('lapsed Time In 2 becomes Time Out 2 and portal provenance is not overwritten', async () => {
  const store = createStore();
  const withBreak = {
    ...employee,
    break_time: '12:00',
    break_duration_minutes: 60,
  };
  const shift = { ...dayShift, break_start_time: '12:00', break_end_time: '13:00', break_duration_minutes: 60 };
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
    source: 'employee_portal',
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.record_source, undefined);
  assert.equal(Boolean(first.log.break_time_out), true);

  const timedOut = await punch(store, new Date('2026-08-18T06:05:00.000Z'), {
    employee: withBreak,
    shiftSettings: [shift],
    source: 'biometric',
    sourceRef: {
      biometricTimeLogId: 'evt-to',
      deviceSerial: '202605260025',
      deviceLogId: '201',
      attendStat: 'DutyOff',
    },
  });
  assert.equal(timedOut.action, 'time_out');
  assert.equal(timedOut.log.time_out_source, 'biometric');
  assert.equal(timedOut.log.time_in_source, undefined);
  assert.equal(timedOut.log.record_source, undefined);
});
