import test from 'node:test';
import assert from 'node:assert/strict';
import { employeesMissingBreakTime } from '../src/lib/breakTimeRequirements.js';

const employee = (id, work_schedule) => ({ id, status: 'active', work_schedule });

test('break-time attention follows the employee’s assigned shift policy', () => {
  const shifts = [
    {
      id: 'day',
      is_default: true,
      has_break: true,
      break_start_time: '12:00',
      break_end_time: '13:00',
      break_duration_minutes: 60,
    },
    { id: 'night', has_break: false },
    { id: 'incomplete', has_break: true },
  ];
  const employees = [
    employee('configured-break', 'day'),
    employee('no-break-required', 'night'),
    employee('missing-break-policy', 'incomplete'),
  ];

  assert.deepEqual(
    employeesMissingBreakTime(employees, shifts, '2026-09-07').map(item => item.id),
    ['missing-break-policy'],
  );
});
