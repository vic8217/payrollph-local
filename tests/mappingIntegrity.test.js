import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectMappingIntegrity,
  MAPPING_CODES,
  planMappingRepair,
  validateMappingIdentity,
} from '../src/server/biometric/mappingIntegrity.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const liveEmployee = {
  id: 'cmojer3dy00002abdfurqh3yq',
  employee_id: 'VCB-0001D',
  employee_id_aliases: ['VCB0001D', 'vcb-0001d'],
  company_profile_id: 'demo-company',
  status: 'active',
};

const otherCompanyEmployee = {
  id: 'emp-other-co',
  employee_id: 'VCB-0001D',
  company_profile_id: 'other-company',
  status: 'active',
};

const inactiveEmployee = {
  id: 'emp-inactive',
  employee_id: 'EMP-INACTIVE',
  company_profile_id: 'demo-company',
  status: 'inactive',
};

const otherActiveEmployee = {
  id: 'emp-other-active',
  employee_id: 'EMP-OTHER',
  company_profile_id: 'demo-company',
  status: 'active',
};

function validate(overrides = {}) {
  return validateMappingIdentity({
    employees: [liveEmployee, otherCompanyEmployee, inactiveEmployee, otherActiveEmployee],
    declaredEmployeeId: 'VCB-0001D',
    declaredEmployeeRecordId: liveEmployee.id,
    companyProfileId: 'demo-company',
    deviceCompanyId: 'demo-company',
    ...overrides,
  });
}

test('stale employeeRecordId is rejected even when the employee code is valid', () => {
  const result = validate({
    declaredEmployeeRecordId: 'cmojer3dy00002abdfurgh3yg',
    declaredEmployeeId: 'VCB-0001D',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, MAPPING_CODES.EMPLOYEE_RECORD_NOT_FOUND);
  assert.match(result.error, /code is not enough/i);
});

test('wrong employeeRecordId for a valid employee code is rejected', () => {
  const result = validate({
    declaredEmployeeRecordId: otherActiveEmployee.id,
    declaredEmployeeId: 'VCB-0001D',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, MAPPING_CODES.EMPLOYEE_RECORD_ID_MISMATCH);
});

test('alias resolves to the correct employee record', () => {
  const byAlias = validate({
    declaredEmployeeRecordId: '',
    declaredEmployeeId: 'VCB0001D',
  });
  assert.equal(byAlias.ok, true);
  assert.equal(byAlias.employee.id, liveEmployee.id);

  const byIdAndAlias = validate({
    declaredEmployeeRecordId: liveEmployee.id,
    declaredEmployeeId: 'vcb-0001d',
  });
  assert.equal(byIdAndAlias.ok, true);
  assert.equal(byIdAndAlias.employee.id, liveEmployee.id);
});

test('cross-company employee mapping is rejected', () => {
  const byCode = validate({
    employees: [otherCompanyEmployee],
    declaredEmployeeRecordId: '',
    declaredEmployeeId: 'VCB-0001D',
  });
  assert.equal(byCode.ok, false);
  assert.equal(byCode.code, MAPPING_CODES.EMPLOYEE_COMPANY_MISMATCH);

  const byId = validate({
    declaredEmployeeRecordId: otherCompanyEmployee.id,
    declaredEmployeeId: 'VCB-0001D',
  });
  assert.equal(byId.ok, false);
  assert.equal(byId.code, MAPPING_CODES.EMPLOYEE_COMPANY_MISMATCH);
});

test('inactive employee mapping is rejected', () => {
  const result = validate({
    declaredEmployeeRecordId: inactiveEmployee.id,
    declaredEmployeeId: 'EMP-INACTIVE',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, MAPPING_CODES.EMPLOYEE_INACTIVE);
});

test('mapping repair writes before/after IDs and never auto-requeues events', () => {
  const mapping = {
    id: 'map-1',
    companyProfileId: 'demo-company',
    employeeRecordId: 'cmojer3dy00002abdfurgh3yg',
    employeeId: 'VCB-0001D',
    deviceUserId: '1',
  };
  assert.equal(inspectMappingIntegrity(mapping, [liveEmployee], 'demo-company').stale, true);

  const planned = planMappingRepair(mapping, [liveEmployee], 'demo-company');
  assert.equal(planned.ok, true);
  assert.equal(planned.events_requeued, false);
  assert.equal(planned.update.employeeRecordId, liveEmployee.id);
  assert.equal(planned.update.employeeId, 'VCB-0001D');
  assert.equal(planned.audit.eventType, 'mapping_corrected');
  assert.equal(planned.audit.details.previousEmployeeRecordId, 'cmojer3dy00002abdfurgh3yg');
  assert.equal(planned.audit.details.employeeRecordId, liveEmployee.id);
  assert.equal(planned.audit.details.events_requeued, false);
});

test('mapping API repair path does not interpret or requeue failed events', () => {
  const source = readFileSync(join(root, 'pages/api/biometric/mappings.js'), 'utf8');
  assert.match(source, /operation === ['"]repair['"]/);
  assert.match(source, /planMappingRepair/);
  assert.match(source, /events_requeued/);
  const repairBlock = source.slice(source.indexOf('operation === "repair"'), source.indexOf('const inputRows'));
  assert.equal(repairBlock.includes('reprocessHeldTimeLogs'), false);
  assert.equal(repairBlock.includes('interpretTimeLog'), false);
  assert.equal(repairBlock.includes('requeueFailedInterpretation'), false);
});
