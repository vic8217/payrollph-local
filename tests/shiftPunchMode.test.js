import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAttendancePunch, finalizeAutomaticShiftAttendance } from '../src/server/attendance/applyAttendancePunch.js';
import { previewAttendancePunch } from '../src/server/attendance/previewAttendancePunch.js';
import { resolveAttendancePunchMode, ATTENDANCE_PUNCH_MODE } from '../src/lib/shiftSettings.js';

const dayAutomatic = {
  id: 'hr-day-auto',
  setting_name: 'Day Automatic',
  shift_start_time: '08:00',
  shift_end_time: '17:00',
  overtime_start_time: '17:30',
  break_start_time: '12:00',
  break_end_time: '13:00',
  break_duration_minutes: 60,
  has_break: true,
  attendance_punch_mode: 'automatic_shift',
  is_default: true,
  is_active: true,
};

const dayFullPunch = {
  ...dayAutomatic,
  id: 'hr-day-full',
  setting_name: 'Day Full Punch',
  attendance_punch_mode: 'full_punch',
};

const dayNoBreakAuto = {
  id: 'hr-day-nobreak',
  setting_name: 'Day No Break Automatic',
  shift_start_time: '08:00',
  shift_end_time: '17:00',
  overtime_start_time: '17:30',
  has_break: false,
  attendance_punch_mode: 'automatic_shift',
  is_default: true,
  is_active: true,
};

const nightAutomatic = {
  id: 'hr-night-auto',
  setting_name: 'Night Automatic',
  shift_start_time: '18:00',
  shift_end_time: '06:00',
  overtime_start_time: '06:30',
  break_start_time: '00:00',
  break_end_time: '01:00',
  break_duration_minutes: 60,
  has_break: true,
  attendance_punch_mode: 'automatic_shift',
  is_active: true,
};

const employee = {
  id: 'emp-rec-1',
  employee_id: 'EMP-1',
  company_profile_id: 'co-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  work_schedule: 'hr-day-auto',
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
    shiftSettings: extra.shiftSettings || [dayAutomatic],
    overtimeRequests: extra.overtimeRequests || [],
    authorizedBy: extra.authorizedBy || 'Employee Portal',
    declaredDayType: extra.declaredDayType || null,
  }, store);
}

test('punch mode is an explicit shift policy and is not inferred from times or names', () => {
  assert.equal(resolveAttendancePunchMode({
    setting_name: 'Night Shift',
    shift_start_time: '18:00',
    shift_end_time: '06:00',
  }), ATTENDANCE_PUNCH_MODE.FULL_PUNCH);
  assert.equal(resolveAttendancePunchMode({
    attendance_punch_mode: 'automatic_shift',
    setting_name: 'Day Shift',
  }), ATTENDANCE_PUNCH_MODE.AUTOMATIC_SHIFT);
});

test('dynamic 08:00-17:00 automatic shift supplies scheduled outs and requires Time In (2)', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.time_in, '2026-08-18T00:00:00.000Z');
  assert.equal(Boolean(first.log.break_time_out), true);
  assert.equal(first.log.time_out, undefined);
  assert.equal(first.log.shift_attendance_punch_mode, 'automatic_shift');
  assert.equal(first.log.scheduled_time_out, '2026-08-18T09:00:00.000Z');

  const returned = await punch(store, new Date('2026-08-18T05:00:00.000Z'));
  assert.equal(returned.action, 'break_time_in');
  assert.equal(returned.log.time_out, undefined);

  const earlyFinalize = await finalizeAutomaticShiftAttendance({
    employee,
    occurredAt: new Date('2026-08-18T08:00:00.000Z'),
    shiftSettings: [dayAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(earlyFinalize.code, 'SCHEDULED_TIME_OUT_PENDING');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);

  const finalized = await finalizeAutomaticShiftAttendance({
    employee,
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    shiftSettings: [dayAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(finalized.action, 'time_out');
  assert.equal(finalized.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(finalized.log.time_out_source, 'scheduled');
});

test('dynamic 08:00-17:00 full-punch shift still uses the four-slot sequencer', async () => {
  const fullEmployee = { ...employee, work_schedule: 'hr-day-full' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:05:00.000Z'), {
    employee: fullEmployee,
    shiftSettings: [dayFullPunch],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.shift_attendance_punch_mode, 'full_punch');
  const returned = await punch(store, new Date('2026-08-18T05:05:00.000Z'), {
    employee: fullEmployee,
    shiftSettings: [dayFullPunch],
  });
  assert.equal(returned.action, 'break_time_in');
  const last = await punch(store, new Date('2026-08-18T09:00:00.000Z'), {
    employee: fullEmployee,
    shiftSettings: [dayFullPunch],
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOff', deviceLogId: '9' },
  });
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(last.log.time_out_source, 'biometric');
});

test('automatic no-break shift finalizes Time Out (2) only after shift end', async () => {
  const noBreakEmployee = { ...employee, work_schedule: 'hr-day-nobreak' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), {
    employee: noBreakEmployee,
    shiftSettings: [dayNoBreakAuto],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.break_time_out, undefined);
  assert.equal(first.log.time_out, undefined);

  const pending = await punch(store, new Date('2026-08-18T01:00:00.000Z'), {
    employee: noBreakEmployee,
    shiftSettings: [dayNoBreakAuto],
  });
  assert.equal(pending.code, 'SCHEDULED_TIME_OUT_PENDING');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);

  const finalized = await finalizeAutomaticShiftAttendance({
    employee: noBreakEmployee,
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    shiftSettings: [dayNoBreakAuto],
    overtimeRequests: [],
  }, store);
  assert.equal(finalized.action, 'time_out');
  assert.equal(finalized.log.time_out, '2026-08-18T09:00:00.000Z');
});

test('automatic shift missing Time In (2) does not award Time Out (2)', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  const missing = await finalizeAutomaticShiftAttendance({
    employee,
    occurredAt: new Date('2026-08-18T09:05:00.000Z'),
    shiftSettings: [dayAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(missing.code, 'MISSING_TIME_IN_2');
  assert.equal(missing.outcome, 'needs_review');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
  assert.equal(store.records.AttendanceLog[0].time_in_2_missing, true);
});

test('early Time In (2) is credited at the scheduled return and late Time In (2) keeps the actual punch', async () => {
  const earlyStore = createStore();
  await punch(earlyStore, new Date('2026-08-18T00:00:00.000Z'));
  const early = await punch(earlyStore, new Date('2026-08-18T04:30:00.000Z'));
  assert.equal(early.action, 'break_time_in');
  assert.equal(early.log.break_time_in, '2026-08-18T05:00:00.000Z');
  assert.equal(early.log.break_time_in_actual_punch_at, '2026-08-18T04:30:00.000Z');
  assert.equal(early.log.time_out, undefined);

  const lateStore = createStore();
  await punch(lateStore, new Date('2026-08-18T00:00:00.000Z'));
  const late = await punch(lateStore, new Date('2026-08-18T06:15:00.000Z'));
  assert.equal(late.action, 'break_time_in');
  assert.equal(late.log.break_time_in, '2026-08-18T06:15:00.000Z');
  assert.equal(late.log.time_out, undefined);
});

test('dynamic 18:00-06:00 automatic overnight shift with midnight break stays on the start date', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night-auto' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T10:15:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightAutomatic],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');
  assert.equal(first.log.shift_is_overnight, true);
  assert.equal(first.log.time_out, undefined);

  const returned = await punch(store, new Date('2026-08-18T17:05:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightAutomatic],
  });
  assert.equal(returned.action, 'break_time_in');
  assert.equal(returned.log.date, '2026-08-18');
  assert.equal(returned.log.time_out, undefined);

  const finalized = await finalizeAutomaticShiftAttendance({
    employee: nightEmployee,
    occurredAt: new Date('2026-08-18T22:00:00.000Z'),
    shiftSettings: [nightAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(finalized.action, 'time_out');
  assert.equal(finalized.log.date, '2026-08-18');
  assert.equal(finalized.log.time_out, '2026-08-18T22:00:00.000Z');
});

test('cross-midnight break remains valid on an automatic night shift', async () => {
  const crossing = {
    ...nightAutomatic,
    break_start_time: '23:30',
    break_end_time: '00:30',
  };
  const nightEmployee = { ...employee, work_schedule: 'hr-night-auto' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T10:15:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [crossing],
  });
  assert.equal(first.log.shift_break_start_time, '23:30');
  assert.equal(first.log.shift_break_end_time, '00:30');
  const returned = await punch(store, new Date('2026-08-18T16:35:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [crossing],
  });
  assert.equal(returned.action, 'break_time_in');
});

test('historical snapshot keeps automatic mode after HR switches the shift to full punch', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  await punch(store, new Date('2026-08-18T05:00:00.000Z'));
  const edited = [{ ...dayAutomatic, attendance_punch_mode: 'full_punch' }];
  const finalized = await finalizeAutomaticShiftAttendance({
    employee,
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    shiftSettings: edited,
    overtimeRequests: [],
  }, store);
  assert.equal(store.records.AttendanceLog[0].shift_attendance_punch_mode, 'automatic_shift');
  assert.equal(finalized.action, 'time_out');
  assert.equal(finalized.log.time_out_source, 'scheduled');
});

test('declared half-day does not consume the automatic full-shift end', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), { declaredDayType: 'half_day' });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.break_time_out, undefined);
  const last = await punch(store, new Date('2026-08-18T09:00:00.000Z'));
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(last.log.time_out_source, undefined);
  assert.equal(last.log.day_type, 'half_day');
});

test('portal and biometric automatic punches write the same slots', async () => {
  const portal = createStore();
  const biometric = createStore();
  const times = [new Date('2026-08-18T00:00:00.000Z'), new Date('2026-08-18T05:00:00.000Z')];
  for (const time of times) {
    await punch(portal, time, { source: 'employee_portal' });
    await punch(biometric, time, {
      source: 'biometric',
      sourceRef: { attendStat: 'DutyOff', deviceLogId: String(time.getTime()) },
    });
  }
  assert.equal(portal.records.AttendanceLog[0].time_in, biometric.records.AttendanceLog[0].time_in);
  assert.equal(portal.records.AttendanceLog[0].break_time_in, biometric.records.AttendanceLog[0].break_time_in);
  assert.equal(portal.records.AttendanceLog[0].time_out, biometric.records.AttendanceLog[0].time_out);
  assert.equal(portal.records.AttendanceLog[0].shift_attendance_punch_mode, 'automatic_shift');
});

test('preview and finalize agree, and AttendStat does not choose the slot', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  const previewReturn = await previewAttendancePunch({
    employee,
    occurredAt: new Date('2026-08-18T05:00:00.000Z'),
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOn' },
    shiftSettings: [dayAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(previewReturn.expected_slot, 'break_time_in');
  assert.equal(previewReturn.punch_mode, 'automatic_shift');
  assert.equal(previewReturn.time_out_is_official, false);
  assert.equal(previewReturn.scheduled_time_out, '2026-08-18T09:00:00.000Z');

  const actual = await punch(store, new Date('2026-08-18T05:00:00.000Z'), {
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOn' },
  });
  assert.equal(actual.action, previewReturn.expected_slot);

  const previewEnd = await previewAttendancePunch({
    employee,
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    source: 'scheduled_finalization',
    shiftSettings: [dayAutomatic],
    overtimeRequests: [],
  }, store);
  assert.equal(previewEnd.expected_slot, 'time_out');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
});
