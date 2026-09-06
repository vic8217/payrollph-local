import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manilaDateString } from '../src/lib/dateUtils.js';
import { getPayrollPeriodForDate } from '../src/lib/payrollPeriod.js';
import {
  attendanceBelongsToEmployee,
  isVisibleAttendanceLog,
  manilaWeekAnchor,
  selectAttendanceLogsForEmployeeWeek,
  sortEmployeesForAttendancePicker,
} from '../src/lib/attendanceVisibility.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const juan = {
  id: 'cmojer3dy00002abdfurqh3yq',
  employee_id: 'VCB-0001D',
  first_name: 'Juan',
  middle_name: 'Gitna',
  last_name: 'Dela Cruz',
  status: 'active',
};

const archivedVcb = {
  id: 'cmodratjx00002acjwc0oe48k',
  employee_id: 'VCB-20260425-110413288',
  first_name: 'v',
  middle_name: 'c',
  last_name: 'b',
  status: 'archived',
};

const log15Style = {
  id: 'cmtpg0dbw00062ajkh8kmhxqm',
  company_profile_id: 'demo-company',
  employee_record_id: 'cmojer3dy00002abdfurqh3yq',
  employee_id: 'VCB-0001D',
  employee_name: 'Juan Gitna Dela Cruz',
  date: '2026-09-06',
  time_in: null,
  break_time_out: '2026-09-05T16:00:00.000Z',
  break_time_in: '2026-09-06T05:49:15.000Z',
  time_out: null,
  status: 'pending',
  record_source: 'biometric',
  break_time_in_source: 'biometric',
  work_schedule: 'demo-shift',
};

const week = { companyProfileId: 'demo-company', startDate: '2026-09-05', endDate: '2026-09-11' };

test('Log 15-style open biometric row is visible for the correct employee and Manila week', () => {
  const visible = selectAttendanceLogsForEmployeeWeek([log15Style], { ...week, employee: juan });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, log15Style.id);
  assert.equal(visible[0].time_in, null);
  assert.equal(visible[0].break_time_in, log15Style.break_time_in);
  assert.equal(isVisibleAttendanceLog(log15Style, { ...week, employee: juan }), true);
});

test('the same row is not shown for a different archived VCB employee', () => {
  assert.equal(attendanceBelongsToEmployee(log15Style, archivedVcb), false);
  assert.equal(isVisibleAttendanceLog(log15Style, { ...week, employee: archivedVcb }), false);
  assert.deepEqual(selectAttendanceLogsForEmployeeWeek([log15Style], { ...week, employee: archivedVcb }), []);
});

test('Manila week boundaries use the attendance work date, not UTC punch days', () => {
  assert.equal(manilaDateString('2026-09-05T16:00:00.000Z'), '2026-09-06');
  assert.equal(isVisibleAttendanceLog(log15Style, { ...week, employee: juan, startDate: '2026-09-06', endDate: '2026-09-06' }), true);
  assert.equal(isVisibleAttendanceLog(log15Style, { ...week, employee: juan, startDate: '2026-09-05', endDate: '2026-09-05' }), false);
  assert.equal(isVisibleAttendanceLog({ ...log15Style, date: '2026-09-04' }, { ...week, employee: juan }), false);
  assert.equal(isVisibleAttendanceLog({ ...log15Style, date: '2026-09-12' }, { ...week, employee: juan }), false);
  assert.equal(isVisibleAttendanceLog({ ...log15Style, date: '2026-09-05' }, { ...week, employee: juan }), true);
  assert.equal(isVisibleAttendanceLog({ ...log15Style, date: '2026-09-11' }, { ...week, employee: juan }), true);
});

test('overnight work dates stay on the stored Manila work date', () => {
  const overnight = {
    ...log15Style,
    date: '2026-09-06',
    work_schedule: 'night',
    shift_start_time: '18:00',
    shift_end_time: '06:00',
    break_time_out: '2026-09-05T16:00:00.000Z',
  };
  assert.equal(isVisibleAttendanceLog(overnight, { ...week, employee: juan }), true);
  assert.equal(isVisibleAttendanceLog(overnight, {
    companyProfileId: 'demo-company',
    employee: juan,
    startDate: '2026-09-05',
    endDate: '2026-09-05',
  }), false);
});

test('employee record-id filtering matches the live record, not a similar code prefix', () => {
  assert.equal(attendanceBelongsToEmployee(log15Style, juan), true);
  assert.equal(attendanceBelongsToEmployee({ ...log15Style, employee_record_id: 'other-id' }, juan), true);
  assert.equal(attendanceBelongsToEmployee({
    ...log15Style,
    employee_record_id: archivedVcb.id,
    employee_id: archivedVcb.employee_id,
  }, juan), false);
});

test('incomplete open attendance remains visible when valid', () => {
  const open = { ...log15Style, time_out: null, hours_worked: null, status: 'pending' };
  assert.equal(isVisibleAttendanceLog(open, { ...week, employee: juan }), true);
});

test('Saturday-start Manila week for Sep 6 includes the Log 15 work date', () => {
  const anchor = manilaWeekAnchor(new Date('2026-09-06T06:52:17.000Z'));
  assert.equal(manilaDateString(anchor), '2026-09-06');
  const period = getPayrollPeriodForDate(anchor, {
    payroll_period_start_day: 6,
    payroll_period_length_days: 7,
  });
  assert.equal(period.start_date <= '2026-09-06', true);
  assert.equal(period.end_date >= '2026-09-06', true);
  assert.equal(isVisibleAttendanceLog(log15Style, {
    companyProfileId: 'demo-company',
    employee: juan,
    startDate: period.start_date,
    endDate: period.end_date,
  }), true);
});

test('attendance picker lists active employees before archived lookalikes', () => {
  const ordered = sortEmployeesForAttendancePicker([archivedVcb, juan]);
  assert.equal(ordered[0].id, juan.id);
  assert.equal(ordered[1].id, archivedVcb.id);
});

test('Attendance page uses the shared visibility helper and does not require Time In (1)', () => {
  const source = readFileSync(join(root, 'src/pages/Attendance.jsx'), 'utf8');
  assert.match(source, /selectAttendanceLogsForEmployeeWeek/);
  assert.match(source, /manilaWeekAnchor/);
  assert.equal(source.includes('time_in && l.date'), false);
});
