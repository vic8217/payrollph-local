import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAttendancePunch } from '../src/server/attendance/applyAttendancePunch.js';
import {
  evaluateInterpretationHolds,
  CATCHUP_REVIEW_MS,
} from '../src/server/biometric/interpretationPolicy.js';
import {
  INTERPRET,
  dismissInterpretationReview,
  interpretTimeLog,
  requeueFailedInterpretation,
  rollbackInterpretation,
} from '../src/server/biometric/interpretTimeLog.js';
import { previewInterpretation } from '../src/server/biometric/previewInterpretation.js';
import { manilaDateString } from '../src/lib/dateUtils.js';

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

const employee = {
  id: 'emp-rec-1',
  employee_id: 'EMP-1',
  company_profile_id: 'co-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  work_schedule: 'regular',
  status: 'active',
};

function matches(record, filter = {}) {
  return Object.entries(filter).every(([key, value]) => record[key] === value);
}

function createStore(seed = {}) {
  const records = {
    AttendanceLog: [...(seed.AttendanceLog || [])],
    Employee: [...(seed.Employee || [employee])],
    Holiday: [...(seed.Holiday || [])],
    NoWorkDay: [...(seed.NoWorkDay || [])],
    PayrollPeriod: [...(seed.PayrollPeriod || [])],
    Settings: [...(seed.Settings || [])],
    OvertimeRequest: [...(seed.OvertimeRequest || [])],
    PasscodeAuditLog: [],
  };
  let seq = 1;
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

function createEvent(overrides = {}) {
  const rawPayload = { UserID: '2', LogID: '101', AttendStat: 'DutyOn', Time: '2026-08-18 08:05:00', Action: 'FP' };
  return {
    id: 'evt-101',
    companyProfileId: 'co-1',
    deviceId: 'dev-1',
    deviceSerial: '202605260025',
    logId: '101',
    deviceUserId: '2',
    employeeRecordId: 'emp-rec-1',
    employeeId: 'EMP-1',
    occurredAt: new Date('2026-08-18T00:05:00.000Z'),
    receivedAt: new Date('2026-08-18T00:05:05.000Z'),
    attendStatus: 'DutyOn',
    verifyMethod: 'FP',
    verifyMethodNormalized: 'fingerprint',
    processingStatus: INTERPRET.PENDING,
    rawPayload: { ...rawPayload },
    attendanceLogId: null,
    mappedSlot: null,
    device: {
      id: 'dev-1',
      status: 'active',
      companyProfileId: 'co-1',
      allowedCompanies: [{ companyProfileId: 'co-1', status: 'active' }],
    },
    ...overrides,
  };
}

function createDeps({ event, store, mapping, shiftSettings } = {}) {
  const events = new Map([[event.id, event]]);
  const mappings = [mapping || {
    deviceId: event.deviceId,
    deviceUserId: event.deviceUserId,
    employeeRecordId: event.employeeRecordId,
    companyProfileId: event.companyProfileId,
    status: 'active',
  }];
  const audits = [];
  return {
    store,
    audits,
    events,
    prisma: {
      biometricTimeLog: {
        async findUnique({ where }) {
          const row = events.get(where.id);
          return row ? { ...row, device: row.device } : null;
        },
        async findMany({ where }) {
          return [...events.values()].filter((row) => {
            if (where.id?.in && !where.id.in.includes(row.id)) return false;
            if (where.companyProfileId && row.companyProfileId !== where.companyProfileId) return false;
            return true;
          });
        },
        async updateMany({ where, data }) {
          const row = events.get(where.id);
          if (!row || row.processingStatus !== where.processingStatus) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
        async update({ where, data }) {
          const row = events.get(where.id);
          Object.assign(row, data);
          return row;
        },
      },
      biometricUserMapping: {
        async findFirst({ where }) {
          return mappings.find((item) =>
            item.deviceId === where.deviceId &&
            item.deviceUserId === where.deviceUserId &&
            item.status === where.status
          ) || null;
        },
      },
    },
    listRecords: store.listRecords,
    updateRecord: store.updateRecord,
    applyAttendancePunch: (args) => applyAttendancePunch({
      ...args,
      shiftSettings: shiftSettings || [dayShift],
      overtimeRequests: [],
    }, store),
    recordBiometricAudit: async (entry) => { audits.push(entry); },
    evaluateInterpretationHolds,
    manilaDateString,
  };
}

test('Phase 1 ingest still never calls interpretation', () => {
  const ingest = [
    'src/server/biometric/timeLogStore.js',
    'src/server/biometric/reprocess.js',
    'pages/api/device/upload_log.js',
  ];
  for (const relative of ingest) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.equal(source.includes('interpretTimeLog'), false, relative);
    assert.equal(source.includes('applyAttendancePunch'), false, relative);
  }
});

test('review holds do not invent attendance', () => {
  const occurredAt = new Date('2026-08-16T00:05:00.000Z');
  const receivedAt = new Date(occurredAt.getTime() + CATCHUP_REVIEW_MS + 1);
  const catchup = evaluateInterpretationHolds({
    event: { occurredAt, receivedAt },
    workDate: '2026-08-16',
  });
  assert.equal(catchup.some((hold) => hold.code === 'CATCHUP_REQUIRES_REVIEW'), true);

  const outOfOrder = evaluateInterpretationHolds({
    event: { occurredAt: new Date('2026-08-18T00:01:00.000Z'), receivedAt: new Date('2026-08-18T00:01:05.000Z') },
    workDate: '2026-08-18',
    existingLog: { time_in: '2026-08-18T00:10:00.000Z' },
  });
  assert.equal(outOfOrder.some((hold) => hold.code === 'OUT_OF_ORDER'), true);

  const holiday = evaluateInterpretationHolds({
    event: { occurredAt: new Date('2026-08-18T00:05:00.000Z'), receivedAt: new Date('2026-08-18T00:05:05.000Z') },
    workDate: '2026-08-18',
    holidays: [{ date: '2026-08-18' }],
  });
  assert.equal(holiday.some((hold) => hold.code === 'NON_WORKING_DATE'), true);

  const saved = evaluateInterpretationHolds({
    event: { occurredAt: new Date('2026-08-18T00:05:00.000Z'), receivedAt: new Date('2026-08-18T00:05:05.000Z') },
    workDate: '2026-08-18',
    savedPeriods: [{ start_date: '2026-08-16', end_date: '2026-08-22' }],
  });
  assert.equal(saved.some((hold) => hold.code === 'PAYROLL_PERIOD_SAVED'), true);

  const complete = evaluateInterpretationHolds({
    event: { occurredAt: new Date('2026-08-18T09:30:00.000Z'), receivedAt: new Date('2026-08-18T09:30:05.000Z') },
    workDate: '2026-08-18',
    existingLog: { time_out: '2026-08-18T09:00:00.000Z' },
  });
  assert.equal(complete.some((hold) => hold.code === 'ATTENDANCE_COMPLETE'), true);
});

test('only pending events are consumed and a second interpret is a no-op', async () => {
  const store = createStore();
  const event = createEvent();
  const deps = createDeps({ event, store });

  const first = await interpretTimeLog(event.id, { actorId: 'admin@test' }, deps);
  assert.equal(first.ok, true);
  assert.equal(first.event.processingStatus, INTERPRET.INTERPRETED);
  assert.equal(first.result.action, 'time_in');
  assert.equal(store.records.AttendanceLog.length, 1);
  assert.equal(store.records.AttendanceLog[0].time_in, '2026-08-18T00:05:00.000Z');
  assert.equal(store.records.AttendanceLog[0].time_in_biometric_event_id, 'evt-101');
  assert.equal(store.records.AttendanceLog[0].time_in_device_log_id, '101');

  const second = await interpretTimeLog(event.id, { actorId: 'admin@test' }, deps);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'ALREADY_FINAL');
  assert.equal(store.records.AttendanceLog.length, 1);
  assert.equal(store.records.AttendanceLog[0].time_in, '2026-08-18T00:05:00.000Z');
});

test('tenant or mapping mismatch is failed_terminal and writes no attendance', async () => {
  const store = createStore();
  const event = createEvent();
  const deps = createDeps({
    event,
    store,
    mapping: {
      deviceId: event.deviceId,
      deviceUserId: event.deviceUserId,
      employeeRecordId: 'other-emp',
      companyProfileId: event.companyProfileId,
      status: 'active',
    },
  });
  const result = await interpretTimeLog(event.id, {}, deps);
  assert.equal(result.ok, false);
  assert.equal(result.event.processingStatus, INTERPRET.FAILED_TERMINAL);
  assert.equal(result.reason, 'MAPPING_STALE');
  assert.equal(store.records.AttendanceLog.length, 0);
});

test('review holds leave official attendance unchanged', async () => {
  const store = createStore({ Holiday: [{ date: '2026-08-18', company_profile_id: 'co-1' }] });
  const event = createEvent();
  const deps = createDeps({ event, store });
  const result = await interpretTimeLog(event.id, {}, deps);
  assert.equal(result.event.processingStatus, INTERPRET.NEEDS_REVIEW);
  assert.equal(result.event.reviewReason.includes('NON_WORKING_DATE'), true);
  assert.equal(store.records.AttendanceLog.length, 0);
});

test('rollback restores the owned slot and never mutates rawPayload', async () => {
  const store = createStore();
  const rawPayload = { UserID: '2', LogID: '202', AttendStat: 'DutyOn', Time: '2026-08-18 08:10:00' };
  const event = createEvent({
    id: 'evt-202',
    logId: '202',
    occurredAt: new Date('2026-08-18T00:10:00.000Z'),
    rawPayload,
  });
  const frozen = JSON.stringify(rawPayload);
  const deps = createDeps({ event, store });

  const applied = await interpretTimeLog(event.id, {}, deps);
  assert.equal(applied.event.processingStatus, INTERPRET.INTERPRETED);
  assert.equal(JSON.stringify(event.rawPayload), frozen);

  const rolled = await rollbackInterpretation(event.id, { actorId: 'admin@test' }, deps);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.event.processingStatus, INTERPRET.PENDING);
  assert.equal(rolled.event.attendanceLogId, null);
  assert.equal(store.records.AttendanceLog[0].time_in, null);
  assert.equal(store.records.AttendanceLog[0].status, 'rejected');
  assert.equal(JSON.stringify(event.rawPayload), frozen);
});

test('dismiss review does not write attendance', async () => {
  const store = createStore();
  const event = createEvent({
    processingStatus: INTERPRET.NEEDS_REVIEW,
    interpretationCode: 'NON_WORKING_DATE',
  });
  const deps = createDeps({ event, store });
  const dismissed = await dismissInterpretationReview(event.id, {}, deps);
  assert.equal(dismissed.event.processingStatus, INTERPRET.IGNORED_DUPLICATE);
  assert.equal(store.records.AttendanceLog.length, 0);
});

test('stuck processing without an attendance effect can be reclaimed once', async () => {
  const store = createStore();
  const event = createEvent({ processingStatus: INTERPRET.PROCESSING });
  const deps = createDeps({ event, store });
  const first = await interpretTimeLog(event.id, {}, deps);
  assert.equal(first.ok, true);
  assert.equal(first.event.processingStatus, INTERPRET.INTERPRETED);
  assert.equal(store.records.AttendanceLog.length, 1);
  const second = await interpretTimeLog(event.id, {}, deps);
  assert.equal(second.skipped, true);
  assert.equal(store.records.AttendanceLog.length, 1);
});

test('Log 15-style interpret during break still produces Time In (2)', async () => {
  const breakEmployee = {
    ...employee,
    break_time: '12:00',
    break_duration_minutes: 60,
  };
  const store = createStore({ Employee: [breakEmployee] });
  const event = createEvent({
    id: 'evt-15',
    logId: '15',
    occurredAt: new Date('2026-09-06T05:49:15.000Z'),
    receivedAt: new Date('2026-09-06T05:49:20.000Z'),
    attendStatus: 'DutyOff',
  });
  const deps = createDeps({
    event,
    store,
    shiftSettings: [{
      ...dayShift,
      break_start_time: '12:00',
      break_end_time: '13:00',
      break_duration_minutes: 60,
    }],
  });
  const result = await interpretTimeLog(event.id, {}, deps);
  assert.equal(result.ok, true);
  assert.equal(result.result.action, 'break_time_in');
  assert.equal(store.records.AttendanceLog[0].time_in, null);
  assert.equal(store.records.AttendanceLog[0].break_time_in, '2026-09-06T05:49:15.000Z');
  assert.equal(store.records.AttendanceLog[0].break_time_in_source, 'biometric');
  assert.equal(store.records.AttendanceLog[0].time_in_source, undefined);
});

test('preview interpretation is read-only and mapping repair does not requeue failed_terminal', async () => {
  const store = createStore();
  const event = createEvent();
  const preview = await previewInterpretation(event, {
    employee,
    store,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.expected_slot, 'time_in');
  assert.equal(preview.expected_label, 'Time In (1)');
  assert.equal(store.records.AttendanceLog.length, 0);

  const failed = createEvent({
    id: 'evt-fail',
    processingStatus: INTERPRET.FAILED_TERMINAL,
    interpretationCode: 'MAPPING_STALE',
  });
  const deps = createDeps({ event: failed, store });
  assert.equal(store.records.AttendanceLog.length, 0);
  assert.equal(failed.processingStatus, INTERPRET.FAILED_TERMINAL);
  const interpretSkipped = await interpretTimeLog(failed.id, {}, deps);
  assert.equal(interpretSkipped.skipped, true);
  assert.equal(failed.processingStatus, INTERPRET.FAILED_TERMINAL);

  const requeued = await requeueFailedInterpretation(failed.id, { actorId: 'admin@test' }, deps);
  assert.equal(requeued.ok, true);
  assert.equal(requeued.event.processingStatus, INTERPRET.PENDING);
  assert.equal(deps.audits.at(-1).eventType, 'event_reset_requeued');
  assert.equal(store.records.AttendanceLog.length, 0);
});

test('AttendStat does not choose the slot and preview matches actual interpretation', async () => {
  const dutyOffStore = createStore();
  const dutyOnStore = createStore();
  const dutyOff = createEvent({
    id: 'evt-dutyoff',
    attendStatus: 'DutyOff',
    occurredAt: new Date('2026-08-18T00:05:00.000Z'),
  });
  const dutyOn = createEvent({
    id: 'evt-dutyon',
    attendStatus: 'DutyOn',
    occurredAt: new Date('2026-08-18T00:05:00.000Z'),
  });
  const offPreview = await previewInterpretation(dutyOff, { employee, store: dutyOffStore });
  const onPreview = await previewInterpretation(dutyOn, { employee, store: dutyOnStore });
  assert.equal(offPreview.expected_slot, 'time_in');
  assert.equal(onPreview.expected_slot, 'time_in');

  const offResult = await interpretTimeLog(dutyOff.id, {}, createDeps({ event: dutyOff, store: dutyOffStore }));
  const onResult = await interpretTimeLog(dutyOn.id, {}, createDeps({ event: dutyOn, store: dutyOnStore }));
  assert.equal(offResult.result.action, 'time_in');
  assert.equal(onResult.result.action, 'time_in');
  assert.equal(offResult.result.action, offPreview.expected_slot);
  assert.equal(onResult.result.action, onPreview.expected_slot);
  assert.equal(dutyOffStore.records.AttendanceLog[0].day_type, 'regular');
  assert.equal(dutyOnStore.records.AttendanceLog[0].day_type, 'regular');
});

test('existing half-day log uses Time Out (2) and preview agrees without rewriting slots', async () => {
  const store = createStore({
    AttendanceLog: [{
      id: 'log-half',
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
      date: '2026-08-18',
      time_in: '2026-08-18T06:00:00.000Z',
      day_type: 'half_day',
      status: 'pending',
    }],
  });
  const event = createEvent({
    id: 'evt-half-out',
    logId: '216',
    occurredAt: new Date('2026-08-18T09:00:00.000Z'),
    receivedAt: new Date('2026-08-18T09:00:05.000Z'),
    attendStatus: 'DutyOff',
  });
  const preview = await previewInterpretation(event, { employee, store });
  assert.equal(preview.expected_slot, 'time_out');
  assert.equal(preview.expected_label, 'Time Out (2)');
  assert.equal(store.records.AttendanceLog[0].time_out, undefined);

  const result = await interpretTimeLog(event.id, {}, createDeps({ event, store }));
  assert.equal(result.result.action, 'time_out');
  assert.equal(result.result.action, preview.expected_slot);
  assert.equal(store.records.AttendanceLog[0].time_in, '2026-08-18T06:00:00.000Z');
  assert.equal(store.records.AttendanceLog[0].time_out, '2026-08-18T09:00:00.000Z');
  assert.equal(store.records.AttendanceLog[0].break_time_in, undefined);
  assert.equal(store.records.AttendanceLog[0].day_type, 'half_day');
  assert.equal(store.records.AttendanceLog[0].time_out_source, 'biometric');
  assert.equal(store.records.AttendanceLog[0].time_in_source, undefined);
});

test('unmapped or quarantined statuses are not interpreted', async () => {
  const store = createStore();
  const event = createEvent({ processingStatus: 'company_not_authorized' });
  const deps = createDeps({ event, store });
  const result = await interpretTimeLog(event.id, {}, deps);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'NOT_PENDING');
  assert.equal(store.records.AttendanceLog.length, 0);
});
