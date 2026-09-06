import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReprocessDecision,
  shouldAutoReprocessOnMapping,
} from '../src/server/biometric/classifyTimeLog.js';

test('creating a mapping auto-reprocesses only unmapped_user rows', () => {
  assert.equal(shouldAutoReprocessOnMapping('unmapped_user'), true);
  assert.equal(shouldAutoReprocessOnMapping('company_not_authorized'), false);
  assert.equal(shouldAutoReprocessOnMapping('mapped_pending_attendance'), false);
});

test('unmapped reprocess attaches identity without rewriting manufacturer payload', () => {
  const rawPayload = Object.freeze({ LogID: '13', Time: '2026-09-06-T11:47:00Z', Action: 'FP' });
  const row = { processingStatus: 'unmapped_user', rawPayload };
  const decision = applyReprocessDecision({
    processingStatus: row.processingStatus,
    mapping: { companyProfileId: 'company-a', employeeId: 'EMP-1' },
    assignedCompanyId: 'company-a',
  });
  assert.equal(decision.processingStatus, 'mapped_pending_attendance');
  assert.equal(decision.attachEmployee, true);
  assert.deepEqual(row.rawPayload, { LogID: '13', Time: '2026-09-06-T11:47:00Z', Action: 'FP' });
});

test('DutyOn is never translated into a Time In slot during reprocess', () => {
  const decision = applyReprocessDecision({
    processingStatus: 'unmapped_user',
    mapping: { companyProfileId: 'company-a' },
    assignedCompanyId: 'company-a',
  });
  assert.equal(decision.processingStatus, 'mapped_pending_attendance');
  assert.equal(Object.hasOwn(decision, 'attendanceLogId'), false);
  assert.equal(Object.hasOwn(decision, 'mappedSlot'), false);
});
