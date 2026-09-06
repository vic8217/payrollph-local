import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReprocessDecision,
  assignedCompanyId,
  classifyTimeLog,
} from '../src/server/biometric/classifyTimeLog.js';

const mappingA = { companyProfileId: 'company-a', employeeRecordId: 'emp-1', employeeId: 'EMP-1' };

test('unmapped UserID is held and never attached to an employee', () => {
  const decision = classifyTimeLog({ mapping: null, assignedCompanyId: 'company-a' });
  assert.equal(decision.processingStatus, 'unmapped_user');
  assert.equal(decision.attachEmployee, false);
});

test('mapped punch on the assigned company stops at mapped_pending_attendance', () => {
  const decision = classifyTimeLog({ mapping: mappingA, assignedCompanyId: 'company-a' });
  assert.equal(decision.processingStatus, 'mapped_pending_attendance');
  assert.equal(decision.attachEmployee, true);
});

test('mapping for another company is quarantined and is a security event', () => {
  const decision = classifyTimeLog({ mapping: mappingA, assignedCompanyId: 'company-b' });
  assert.equal(decision.processingStatus, 'company_not_authorized');
  assert.equal(decision.attachEmployee, false);
  assert.equal(decision.securityEvent, true);
});

test('Phase 1 assigned company is the single device company', () => {
  assert.equal(assignedCompanyId({ companyProfileId: 'company-a' }), 'company-a');
  assert.equal(assignedCompanyId({
    allowedCompanies: [{ companyProfileId: 'company-a', status: 'active' }],
  }), 'company-a');
  assert.equal(assignedCompanyId({
    allowedCompanies: [
      { companyProfileId: 'company-a', status: 'active' },
      { companyProfileId: 'company-b', status: 'active' },
    ],
  }), null);
});

test('company-config change does not auto-release a quarantined punch', () => {
  const decision = applyReprocessDecision({
    processingStatus: 'company_not_authorized',
    mapping: mappingA,
    assignedCompanyId: 'company-a',
    explicitQuarantine: false,
  });
  assert.equal(decision.skipped, true);
  assert.equal(decision.processingStatus, 'company_not_authorized');
  assert.equal(decision.attachEmployee, false);
});

test('explicit admin reprocess can attach a now-consistent mapping', () => {
  const decision = applyReprocessDecision({
    processingStatus: 'company_not_authorized',
    mapping: mappingA,
    assignedCompanyId: 'company-a',
    explicitQuarantine: true,
  });
  assert.equal(decision.processingStatus, 'mapped_pending_attendance');
  assert.equal(decision.attachEmployee, true);
});
