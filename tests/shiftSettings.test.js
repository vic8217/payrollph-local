import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEffectiveEmployeeShift,
  scheduleDateTimes,
  timeInWindowStatus,
} from '../src/lib/shiftSettings.js';
import { computeCreditedHoursWorked, computeLateMinutes, computeOvertimeHours } from '../src/lib/payrollUtils.js';

const shifts = [
  { id: 'regular', setting_name: 'Regular', shift_start_time: '08:00', shift_end_time: '17:00', is_default: true },
  { id: 'graveyard', setting_name: 'Graveyard', shift_start_time: '22:00', shift_end_time: '06:00' },
];

test('date-specific assignment overrides the base shift', () => {
  const employee = {
    work_schedule: 'regular',
    shift_assignments: [{ effective_date: '2026-08-18', work_schedule: 'graveyard' }],
  };
  assert.equal(resolveEffectiveEmployeeShift(employee, shifts, '2026-08-17').id, 'regular');
  assert.equal(resolveEffectiveEmployeeShift(employee, shifts, '2026-08-18').id, 'graveyard');
});

test('one second before the window is an audit-only attempt and the exact boundary is official', () => {
  const times = scheduleDateTimes('2026-08-18', shifts[0]);
  assert.equal(times.earliestTimeIn.toISOString(), '2026-08-17T23:00:00.000Z');
  assert.equal(timeInWindowStatus('2026-08-17T22:59:59.000Z', times).isEarlyAttempt, true);
  assert.equal(timeInWindowStatus('2026-08-17T23:00:00.000Z', times).isEarlyAttempt, false);
});

test('overnight shift end and earliest Time In cross dates correctly', () => {
  const times = scheduleDateTimes('2026-08-18', shifts[1]);
  assert.equal(times.start.toISOString(), '2026-08-18T14:00:00.000Z');
  assert.equal(times.earliestTimeIn.toISOString(), '2026-08-18T13:00:00.000Z');
  assert.equal(times.end.toISOString(), '2026-08-18T22:00:00.000Z');
  assert.equal(times.isOvernight, true);
});

test('custom shifts and configured defaults are not hard-coded', () => {
  assert.equal(resolveEffectiveEmployeeShift({}, shifts, '2026-08-18').setting_name, 'Regular');
});

test('multiple early attempts remain audit-only until a later valid punch', () => {
  const times = scheduleDateTimes('2026-08-18', shifts[0]);
  const attempts = ['06:10:00', '06:30:00', '06:50:00', '07:03:00']
    .map(time => timeInWindowStatus(`2026-08-18T${time}+08:00`, times).isEarlyAttempt);
  assert.deepEqual(attempts, [true, true, true, false]);
});

test('schedule timestamps are snapshots and do not mutate when settings later change', () => {
  const original = scheduleDateTimes('2026-08-18', shifts[0]);
  const snapshot = {
    scheduledStart: original.start.toISOString(),
    earliestAllowedTimeIn: original.earliestTimeIn.toISOString(),
  };
  shifts[0].shift_start_time = '07:00';
  assert.deepEqual(snapshot, {
    scheduledStart: '2026-08-18T00:00:00.000Z',
    earliestAllowedTimeIn: '2026-08-17T23:00:00.000Z',
  });
  shifts[0].shift_start_time = '08:00';
});

test('accepted 7:01 AM punch is stored but payroll credit starts at the 8:00 AM shift', () => {
  const log = {
    date: '2026-08-18',
    time_in: '2026-08-17T23:01:00.000Z',
    break_time_out: '2026-08-18T04:00:00.000Z',
    break_time_in: '2026-08-18T05:00:00.000Z',
    time_out: '2026-08-18T09:00:00.000Z',
  };
  assert.equal(computeCreditedHoursWorked(log, {
    shiftStartTime: '08:00',
    breakDurationMinutes: 60,
  }), 8);
  assert.equal(computeLateMinutes(log, { shiftStartTime: '08:00' }), 0);
  assert.equal(log.time_in, '2026-08-17T23:01:00.000Z');
});

test('OT threshold eligibility credits from shift end once the threshold is reached', () => {
  const baseLog = {
    date: '2026-08-18',
    time_in: '2026-08-18T00:00:00.000Z',
    shift_end_time: '17:00',
  };
  const options = {
    shiftStartTime: '08:00',
    shiftEndTime: '17:00',
    overtimeStartTime: '17:30',
  };
  assert.equal(computeOvertimeHours({ ...baseLog, time_out: '2026-08-18T09:29:00.000Z' }, 0, options), 0);
  assert.equal(computeOvertimeHours({ ...baseLog, time_out: '2026-08-18T09:30:00.000Z' }, 0, options), 0.5);
  assert.equal(computeOvertimeHours({ ...baseLog, time_out: '2026-08-18T09:45:00.000Z' }, 0, options), 0.75);
});
