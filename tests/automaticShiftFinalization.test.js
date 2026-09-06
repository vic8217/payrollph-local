import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAttendancePunch } from '../src/server/attendance/applyAttendancePunch.js';
import {
  evaluateAutomaticShiftFinalization,
  finalizeAutomaticShiftLogs,
  AUTOMATIC_SHIFT_FINALIZATION,
} from '../src/server/attendance/finalizeAutomaticShifts.js';

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

const SCHEDULED_DAY_OUT = '2026-08-18T09:00:00.000Z';
const SCHEDULED_NIGHT_OUT = '2026-08-18T22:00:00.000Z';
const JOB_AS_OF = '2026-08-18T20:00:00.000Z';

function matches(record, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$lte' in value && !(record[key] <= value.$lte)) return false;
      if ('$gte' in value && !(record[key] >= value.$gte)) return false;
      return true;
    }
    return record[key] === value;
  });
}

function createStore(seed = {}) {
  const records = {
    AttendanceLog: [...(seed.AttendanceLog || [])],
    Settings: [...(seed.Settings || [dayAutomatic, dayNoBreakAuto, nightAutomatic])],
    Employee: [...(seed.Employee || [employee])],
    OvertimeRequest: [...(seed.OvertimeRequest || [])],
    PasscodeAuditLog: [...(seed.PasscodeAuditLog || [])],
  };
  let seq = 1;
  let gate = Promise.resolve();
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
    async updateRecordIf(entity, id, data, predicate = {}) {
      const run = gate.then(async () => {
        await Promise.resolve();
        const row = records[entity].find((record) => record.id === id);
        if (!row) return { updated: false, record: null };
        const ok = Object.entries(predicate).every(([key, expected]) => {
          const actual = row[key];
          return expected == null ? actual == null || actual === '' : String(actual) === String(expected);
        });
        if (!ok) return { updated: false, record: { ...row } };
        Object.assign(row, data);
        return { updated: true, record: row };
      });
      gate = run.then(() => undefined, () => undefined);
      return run;
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

async function dayLogWithReturn(store = createStore()) {
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  await punch(store, new Date('2026-08-18T05:00:00.000Z'));
  return store;
}

test('evaluate does not finalize before the snapshotted shift end', () => {
  const decision = evaluateAutomaticShiftFinalization({
    shift_attendance_punch_mode: 'automatic_shift',
    scheduled_time_out: SCHEDULED_DAY_OUT,
    shift_has_break: true,
    time_in: '2026-08-18T00:00:00.000Z',
    break_time_in: '2026-08-18T05:00:00.000Z',
  }, new Date('2026-08-18T08:59:59.000Z'));
  assert.equal(decision.action, AUTOMATIC_SHIFT_FINALIZATION.PENDING);
});

test('finalization without opening Attendance UI writes snapshotted Time Out (2)', async () => {
  const store = await dayLogWithReturn();
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);

  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);

  assert.equal(result.summary.finalized, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
  assert.equal(store.records.AttendanceLog[0].time_out_source, 'scheduled');
  assert.notEqual(store.records.AttendanceLog[0].time_out, JOB_AS_OF);
});

test('no finalization before shift end', async () => {
  const store = await dayLogWithReturn();
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date('2026-08-18T08:30:00.000Z'),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.summary.finalized, 0);
  assert.equal(result.summary.pending, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
});

test('automatic shift with valid Time In (2) finalizes after shift end', async () => {
  const store = await dayLogWithReturn();
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(SCHEDULED_DAY_OUT),
    logIds: [store.records.AttendanceLog[0].id],
  }, store);
  assert.equal(result.results[0].action, AUTOMATIC_SHIFT_FINALIZATION.FINALIZE);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
  assert.equal(store.records.AttendanceLog[0].time_in_2_missing, false);
});

test('automatic no-break shift finalizes from Time In (1) only', async () => {
  const noBreakEmployee = { ...employee, work_schedule: 'hr-day-nobreak' };
  const store = createStore({ Settings: [dayNoBreakAuto], Employee: [noBreakEmployee] });
  await punch(store, new Date('2026-08-18T00:00:00.000Z'), {
    employee: noBreakEmployee,
    shiftSettings: [dayNoBreakAuto],
  });
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.summary.finalized, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
  assert.equal(store.records.AttendanceLog[0].break_time_in, undefined);
});

test('missing Time In (2) is sent to review and does not write Time Out (2)', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'));
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.summary.missing_time_in_2, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
  assert.equal(store.records.AttendanceLog[0].time_in_2_missing, true);
  assert.equal(store.records.AttendanceLog[0].review_reason, 'MISSING_TIME_IN_2');
  const hours = Number(store.records.AttendanceLog[0].hours_worked || 0);
  assert.equal(hours, 0);
});

test('overnight 18:00-06:00 finalizes on the start work date after shift end', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night-auto' };
  const store = createStore({ Settings: [nightAutomatic], Employee: [nightEmployee] });
  await punch(store, new Date('2026-08-18T10:15:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightAutomatic],
  });
  await punch(store, new Date('2026-08-18T17:05:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightAutomatic],
  });
  const beforeEnd = await finalizeAutomaticShiftLogs({
    asOf: new Date('2026-08-18T21:59:00.000Z'),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(beforeEnd.summary.finalized, 0);
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);

  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date('2026-08-19T02:00:00.000Z'),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.summary.finalized, 1);
  assert.equal(store.records.AttendanceLog[0].date, '2026-08-18');
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_NIGHT_OUT);
  assert.equal(store.records.AttendanceLog[0].time_out_source, 'scheduled');
});

test('concurrent and repeated finalization write the same scheduled timestamp', async () => {
  const store = await dayLogWithReturn();
  const [first, second] = await Promise.all([
    finalizeAutomaticShiftLogs({ asOf: new Date(JOB_AS_OF), companyProfileId: 'co-1' }, store),
    finalizeAutomaticShiftLogs({ asOf: new Date(JOB_AS_OF), companyProfileId: 'co-1' }, store),
  ]);
  const finalized = first.summary.finalized + second.summary.finalized;
  const unchanged = first.summary.unchanged + second.summary.unchanged;
  assert.equal(finalized, 1);
  assert.ok(unchanged >= 1);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
  assert.equal(store.records.AttendanceLog[0].time_out_source, 'scheduled');

  const repeat = await finalizeAutomaticShiftLogs({
    asOf: new Date('2026-08-19T00:00:00.000Z'),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(repeat.summary.finalized, 0);
  assert.equal(repeat.summary.unchanged, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
});

test('historical shift snapshot keeps punch mode after HR edits Settings', async () => {
  const store = await dayLogWithReturn();
  store.records.Settings[0] = { ...dayAutomatic, attendance_punch_mode: 'full_punch' };
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(store.records.AttendanceLog[0].shift_attendance_punch_mode, 'automatic_shift');
  assert.equal(result.summary.finalized, 1);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
});

test('declared half-day is excluded from automatic shift-end finalization', async () => {
  const store = createStore();
  await punch(store, new Date('2026-08-18T00:00:00.000Z'), { declaredDayType: 'half_day' });
  store.records.AttendanceLog[0].scheduled_time_out = SCHEDULED_DAY_OUT;
  store.records.AttendanceLog[0].shift_attendance_punch_mode = 'automatic_shift';
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.results[0].reason, 'half_day');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);
});

test('rejected and voided attendance are excluded', async () => {
  const rejectedStore = await dayLogWithReturn();
  rejectedStore.records.AttendanceLog[0].status = 'rejected';
  const rejected = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, rejectedStore);
  assert.equal(rejected.summary.skipped, 1);
  assert.equal(rejected.results[0].reason, 'closed');
  assert.equal(rejectedStore.records.AttendanceLog[0].time_out, undefined);

  const voidedStore = await dayLogWithReturn();
  voidedStore.records.AttendanceLog[0].status = 'voided';
  const voided = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, voidedStore);
  assert.equal(voided.summary.skipped, 1);
  assert.equal(voided.results[0].reason, 'closed');
  assert.equal(voidedStore.records.AttendanceLog[0].time_out, undefined);
});

test('official Time Out (2) is the snapshot, never the job execution timestamp', async () => {
  const store = await dayLogWithReturn();
  const result = await finalizeAutomaticShiftLogs({
    asOf: new Date(JOB_AS_OF),
    companyProfileId: 'co-1',
  }, store);
  assert.equal(result.as_of, JOB_AS_OF);
  assert.equal(store.records.AttendanceLog[0].time_out, SCHEDULED_DAY_OUT);
  assert.notEqual(store.records.AttendanceLog[0].time_out, result.as_of);
  const audit = store.records.PasscodeAuditLog.find((row) => row.action === 'automatic_shift_finalized');
  assert.equal(audit.recorded_time, SCHEDULED_DAY_OUT);
  assert.equal(audit.details.as_of, JOB_AS_OF);
});

test('Attendance page is a fallback caller, not the writer of official Time Out (2)', () => {
  const source = readFileSync(new URL('../src/pages/Attendance.jsx', import.meta.url), 'utf8');
  assert.match(source, /finalizeAutomaticShifts/);
  assert.match(source, /Run automatic shift finalization/);
  assert.equal(source.includes("entities.update('AttendanceLog', log.id, {\n        time_out: log.scheduled_time_out"), false);
});
