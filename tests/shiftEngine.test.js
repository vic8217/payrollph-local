import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfiguredBreak,
  resolveShiftOccurrence,
  describeShiftOccurrence,
} from '../src/lib/shiftSettings.js';
import { applyAttendancePunch } from '../src/server/attendance/applyAttendancePunch.js';
import { previewAttendancePunch } from '../src/server/attendance/previewAttendancePunch.js';
import { INTERPRET, interpretTimeLog } from '../src/server/biometric/interpretTimeLog.js';
import { previewInterpretation } from '../src/server/biometric/previewInterpretation.js';
import { evaluateInterpretationHolds } from '../src/server/biometric/interpretationPolicy.js';
import { manilaDateString } from '../src/lib/dateUtils.js';

const dayShift = {
  id: 'hr-day',
  setting_name: 'Day Shift',
  shift_start_time: '08:00',
  shift_end_time: '17:00',
  overtime_start_time: '17:30',
  break_start_time: '12:00',
  break_end_time: '13:00',
  break_duration_minutes: 60,
  is_default: true,
  is_active: true,
};

const nightShift = {
  id: 'hr-night',
  setting_name: 'Night Shift',
  shift_start_time: '18:00',
  shift_end_time: '06:00',
  overtime_start_time: '06:30',
  break_start_time: '00:00',
  break_end_time: '01:00',
  break_duration_minutes: 60,
  is_active: true,
};

const noBreakDay = {
  id: 'hr-day-nobreak',
  setting_name: 'Day No Break',
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
  work_schedule: 'hr-day',
  status: 'active',
};

function createStore(seed = {}) {
  const records = {
    AttendanceLog: [...(seed.AttendanceLog || [])],
    Employee: [...(seed.Employee || [employee])],
    Settings: [...(seed.Settings || [])],
    OvertimeRequest: [...(seed.OvertimeRequest || [])],
    PasscodeAuditLog: [...(seed.PasscodeAuditLog || [])],
    Holiday: [...(seed.Holiday || [])],
    NoWorkDay: [...(seed.NoWorkDay || [])],
    PayrollPeriod: [...(seed.PayrollPeriod || [])],
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
    shiftSettings: extra.shiftSettings,
    overtimeRequests: extra.overtimeRequests || [],
    authorizedBy: extra.authorizedBy || 'Employee Portal',
    declaredDayType: extra.declaredDayType || null,
  }, store);
}

function createEvent(overrides = {}) {
  return {
    id: 'evt-shift-1',
    companyProfileId: 'co-1',
    deviceId: 'dev-1',
    deviceSerial: '202605260025',
    logId: '501',
    deviceUserId: '2',
    employeeRecordId: 'emp-rec-1',
    employeeId: 'EMP-1',
    occurredAt: new Date('2026-08-18T00:05:00.000Z'),
    receivedAt: new Date('2026-08-18T00:05:05.000Z'),
    attendStatus: 'DutyOn',
    processingStatus: INTERPRET.PENDING,
    rawPayload: { UserID: '2', LogID: '501', AttendStat: 'DutyOn' },
    device: {
      id: 'dev-1',
      status: 'active',
      companyProfileId: 'co-1',
      allowedCompanies: [{ companyProfileId: 'co-1', status: 'active' }],
    },
    ...overrides,
  };
}

function createDeps({ event, store, shiftSettings }) {
  const events = new Map([[event.id, event]]);
  return {
    store,
    audits: [],
    prisma: {
      biometricTimeLog: {
        async findUnique({ where }) { return events.get(where.id) || null; },
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
        async findFirst() {
          return {
            deviceId: event.deviceId,
            deviceUserId: event.deviceUserId,
            employeeRecordId: event.employeeRecordId,
            companyProfileId: event.companyProfileId,
            status: 'active',
          };
        },
      },
    },
    listRecords: store.listRecords,
    updateRecord: store.updateRecord,
    applyAttendancePunch: (args) => applyAttendancePunch({
      ...args,
      shiftSettings: shiftSettings || store.records.Settings,
      overtimeRequests: [],
    }, store),
    recordBiometricAudit: async (entry) => { store.records.PasscodeAuditLog.push(entry); },
    evaluateInterpretationHolds,
    manilaDateString,
  };
}

test('HR-created 08:00-17:00 shift with a configured break uses four slots', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), { shiftSettings: [dayShift] });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');
  assert.equal(first.log.shift_setting_name, 'Day Shift');
  assert.equal(first.log.shift_start_time, '08:00');
  assert.equal(first.log.shift_end_time, '17:00');
  assert.equal(first.log.shift_is_overnight, false);
  assert.equal(first.resolvedShift.name, 'Day Shift');
  assert.equal(first.resolvedShift.has_valid_break, true);
  assert.equal((await punch(store, new Date('2026-08-18T05:00:00.000Z'), { shiftSettings: [dayShift] })).action, 'break_time_in');
  const done = await punch(store, new Date('2026-08-18T09:00:00.000Z'), { shiftSettings: [dayShift] });
  assert.equal(done.action, 'time_out');
});

test('HR-created 18:00-06:00 overnight shift keeps both punches on the start date', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T10:15:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightShift],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');
  assert.equal(first.log.shift_is_overnight, true);
  assert.equal(first.resolvedShift.is_overnight, true);

  const afterMidnight = await punch(store, new Date('2026-08-18T18:30:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightShift],
  });
  assert.equal(afterMidnight.log.id, first.log.id);
  assert.equal(afterMidnight.log.date, '2026-08-18');
});

test('midnight break on a night shift is valid when HR configured both ends', () => {
  const configured = resolveConfiguredBreak(nightShift);
  assert.equal(configured.valid, true);
  assert.equal(configured.start, '00:00');
  assert.equal(configured.end, '01:00');

  const occurrence = resolveShiftOccurrence({
    employee: { ...employee, work_schedule: 'hr-night' },
    shiftSettings: [nightShift],
    punchAt: new Date('2026-08-18T10:15:00.000Z'),
  });
  assert.equal(occurrence.hasValidBreak, true);
  assert.equal(occurrence.break.startAt.toISOString(), '2026-08-18T16:00:00.000Z');
  assert.equal(occurrence.break.endAt.toISOString(), '2026-08-18T17:00:00.000Z');
});

test('placeholder 00:00 without a configured end does not trigger break logic', async () => {
  const placeholderEmployee = { ...employee, work_schedule: 'hr-day-nobreak', break_time: '00:00' };
  assert.equal(resolveConfiguredBreak(noBreakDay, placeholderEmployee).valid, false);

  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), {
    employee: placeholderEmployee,
    shiftSettings: [noBreakDay],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.time_in, '2026-08-18T06:00:00.000Z');
  assert.equal(first.log.break_time_out, undefined);
  assert.equal(first.log.shift_break_start_time, null);
  assert.equal(first.resolvedShift.has_valid_break, false);

  const second = await punch(store, new Date('2026-08-18T09:00:00.000Z'), {
    employee: placeholderEmployee,
    shiftSettings: [noBreakDay],
  });
  assert.equal(second.action, 'time_out');
  assert.equal(second.log.break_time_in, undefined);
});

test('punch after midnight resolves to the prior overnight work date', async () => {
  const nightNoBreak = {
    ...nightShift,
    break_start_time: null,
    break_end_time: null,
    break_duration_minutes: null,
  };
  const nightEmployee = { ...employee, work_schedule: 'hr-night' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T18:10:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightNoBreak],
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');
  assert.equal(first.resolvedShift.work_date, '2026-08-18');
});

test('break windows may cross midnight', () => {
  const crossing = {
    ...nightShift,
    break_start_time: '23:30',
    break_end_time: '00:30',
  };
  const occurrence = resolveShiftOccurrence({
    employee: { ...employee, work_schedule: 'hr-night' },
    shiftSettings: [crossing],
    punchAt: new Date('2026-08-18T10:15:00.000Z'),
  });
  assert.equal(occurrence.hasValidBreak, true);
  assert.equal(occurrence.break.startAt.toISOString(), '2026-08-18T15:30:00.000Z');
  assert.equal(occurrence.break.endAt.toISOString(), '2026-08-18T16:30:00.000Z');
});

test('no-break shift uses Time In (1) then Time Out (2)', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), {
    employee: { ...employee, work_schedule: 'hr-day-nobreak' },
    shiftSettings: [noBreakDay],
  });
  assert.equal(first.action, 'time_in');
  const second = await punch(store, new Date('2026-08-18T09:00:00.000Z'), {
    employee: { ...employee, work_schedule: 'hr-day-nobreak' },
    shiftSettings: [noBreakDay],
  });
  assert.equal(second.action, 'time_out');
  assert.equal(second.log.break_time_out, undefined);
  assert.equal(second.log.break_time_in, undefined);
});

test('tagged half-day on a day shift uses Time In (1) and Time Out (2)', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T06:00:00.000Z'), {
    shiftSettings: [dayShift],
    declaredDayType: 'half_day',
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.break_time_out, undefined);
  const last = await punch(store, new Date('2026-08-18T09:00:00.000Z'), { shiftSettings: [dayShift] });
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.day_type, 'half_day');
  assert.equal(last.log.shift_start_time, '08:00');
});

test('tagged half-day on a night shift uses Time In (1) and Time Out (2)', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night' };
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T16:00:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightShift],
    declaredDayType: 'half_day',
  });
  assert.equal(first.action, 'time_in');
  assert.equal(first.log.date, '2026-08-18');
  assert.equal(first.log.break_time_in, undefined);
  const last = await punch(store, new Date('2026-08-18T21:00:00.000Z'), {
    employee: nightEmployee,
    shiftSettings: [nightShift],
  });
  assert.equal(last.action, 'time_out');
  assert.equal(last.log.day_type, 'half_day');
  assert.equal(last.log.shift_is_overnight, true);
});

test('preview and interpret resolve the same overnight work date and slot', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night' };
  const store = createStore({
    Settings: [{ ...nightShift, company_profile_id: 'co-1' }],
    Employee: [nightEmployee],
  });
  const occurredAt = new Date('2026-08-18T11:15:00.000Z');
  const event = createEvent({
    occurredAt,
    receivedAt: new Date('2026-08-18T11:15:05.000Z'),
    attendStatus: 'DutyOff',
  });
  const preview = await previewInterpretation(event, { employee: nightEmployee, store });
  assert.equal(preview.work_date, '2026-08-18');
  assert.equal(preview.expected_slot, 'time_in');
  assert.equal(preview.is_overnight, true);

  const interpreted = await interpretTimeLog(event.id, {}, createDeps({ event, store, shiftSettings: [nightShift] }));
  assert.equal(interpreted.result.action, preview.expected_slot);
  assert.equal(interpreted.result.log.date, preview.work_date);
  assert.equal(store.records.AttendanceLog.length, 1);
});

test('biometric and portal produce the same result for identical overnight timestamps', async () => {
  const nightEmployee = { ...employee, work_schedule: 'hr-night' };
  const portal = createStore();
  const biometric = createStore();
  const time = new Date('2026-08-18T18:10:00.000Z');
  const portalResult = await punch(portal, time, { employee: nightEmployee, shiftSettings: [nightShift], source: 'employee_portal' });
  const bioResult = await punch(biometric, time, {
    employee: nightEmployee,
    shiftSettings: [nightShift],
    source: 'biometric',
    sourceRef: { attendStat: 'DutyOff', deviceLogId: '77' },
  });
  assert.equal(portalResult.action, bioResult.action);
  assert.equal(portalResult.log.date, bioResult.log.date);
  assert.equal(portalResult.log.time_in, bioResult.log.time_in);
  assert.equal(portalResult.resolvedShift.work_date, bioResult.resolvedShift.work_date);
});

test('later HR edits do not change a persisted attendance snapshot', async () => {
  const store = createStore();
  const first = await punch(store, new Date('2026-08-18T00:00:00.000Z'), { shiftSettings: [dayShift] });
  assert.equal(first.log.shift_start_time, '08:00');
  const edited = [{ ...dayShift, shift_start_time: '09:00', shift_end_time: '18:00' }];
  const preview = await previewAttendancePunch({
    employee,
    occurredAt: new Date('2026-08-18T05:00:00.000Z'),
    source: 'biometric',
    shiftSettings: edited,
    overtimeRequests: [],
  }, store);
  assert.equal(store.records.AttendanceLog[0].shift_start_time, '08:00');
  assert.equal(preview.resolved_shift.shift_start_manila, '08:00');
});

test('describeShiftOccurrence exposes Manila windows for preview', () => {
  const occurrence = resolveShiftOccurrence({
    employee,
    shiftSettings: [dayShift],
    punchAt: new Date('2026-08-18T00:05:00.000Z'),
  });
  const described = describeShiftOccurrence(occurrence);
  assert.equal(described.name, 'Day Shift');
  assert.equal(described.work_date, '2026-08-18');
  assert.equal(described.shift_start_manila, '08:00');
  assert.equal(described.shift_end_manila, '17:00');
  assert.equal(described.break_start_manila, '12:00');
  assert.equal(described.break_end_manila, '13:00');
  assert.equal(described.is_overnight, false);
});
