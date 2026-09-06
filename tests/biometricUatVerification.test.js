import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceLooksBiometricDerived,
  evaluatePhase1Uat,
  findForbiddenPayloadKeys,
  snapshotDiff,
  timeLogSnapshot,
} from '../src/server/biometric/uatVerification.js';

test('forbidden payload keys include templates, passwords, card and QR blobs', () => {
  assert.deepEqual(findForbiddenPayloadKeys({
    LogID: '15',
    Action: 'FP',
    LogImage: 'aaa',
    FaceData: 'bbb',
    password: 'secret',
    CardNo: '1234',
    QRData: 'xyz',
  }).sort(), ['CardNo', 'FaceData', 'LogImage', 'QRData', 'password']);
  assert.deepEqual(findForbiddenPayloadKeys({
    Event: 'TimeLog_v2',
    LogID: '15',
    Action: 'FP',
    Photo: 'No',
  }), []);
});

test('Phase 1 verification report accepts the expected UAT rows', () => {
  const result = evaluatePhase1Uat({
    logs15: [{
      processingStatus: 'mapped_pending_attendance',
      verifyMethodNormalized: 'fingerprint',
      verifyMethod: 'FP',
      rawPayload: { LogID: '15', Action: 'FP', Photo: 'No' },
      attendanceLogId: null,
      mappedSlot: null,
    }],
    logs14: [{
      processingStatus: 'company_not_authorized',
      attendanceLogId: null,
      mappedSlot: null,
    }],
    attendanceHits: [],
  });
  assert.equal(result.ok, true);
});

test('Phase 1 verification fails when Log ID 15 is duplicated or interpreted', () => {
  const result = evaluatePhase1Uat({
    logs15: [
      { processingStatus: 'mapped_pending_attendance', verifyMethodNormalized: 'fingerprint', rawPayload: { Action: 'FP' }, attendanceLogId: 'att-1' },
      { processingStatus: 'mapped_pending_attendance', verifyMethodNormalized: 'fingerprint', rawPayload: { Action: 'FP' } },
    ],
    logs14: [{ processingStatus: 'mapped_pending_attendance' }],
    attendanceHits: [{ id: 'att-1' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(check => check.id === 'log15_exists_once').ok, false);
  assert.equal(result.checks.find(check => check.id === 'log14_quarantined').ok, false);
  assert.equal(result.checks.find(check => check.id === 'no_attendance_from_biometric').ok, false);
});

test('replay snapshot comparison detects mutation and ignores identical payloads', () => {
  const row = {
    id: 'row-1',
    deviceSerial: '202605260025',
    logId: '15',
    processingStatus: 'mapped_pending_attendance',
    rawPayload: { LogID: '15', Action: 'FP' },
    attendanceLogId: null,
  };
  assert.deepEqual(snapshotDiff(timeLogSnapshot(row), timeLogSnapshot(row)), []);
  assert.ok(snapshotDiff(timeLogSnapshot(row), timeLogSnapshot({ ...row, processingStatus: 'unmapped_user' })).includes('processingStatus'));
});

test('attendance records are biometric-derived only when they reference the terminal events', () => {
  assert.equal(attendanceLooksBiometricDerived({
    data: { employee_id: 'EMP-1', time_in: '2026-09-06T03:47:00.000Z' },
  }, { deviceSerial: '202605260025', logIds: ['14', '15'], timeLogIds: ['abc'] }), false);
  assert.equal(attendanceLooksBiometricDerived({
    data: { source: 'biometric', biometric_time_log_id: 'abc' },
  }, { deviceSerial: '202605260025', logIds: ['15'], timeLogIds: ['abc'] }), true);
});
