import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBiometricEventsRequest } from '../src/server/biometric/eventsApi.js';

function createRes() {
  const result = { statusCode: 0, body: null, headers: {}, headersSent: false };
  const res = {
    headersSent: false,
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    status(code) { result.statusCode = code; return this; },
    json(payload) {
      result.body = payload;
      res.headersSent = true;
      result.headersSent = true;
      return result;
    },
  };
  return { res, result };
}

const session = { user: { id: 'admin-1', email: 'admin@test', role: 'super_admin' } };

function createDeps(overrides = {}) {
  return {
    authorize: async () => session,
    prisma: {
      biometricDevice: {
        findMany: async () => [{
          id: 'dev-1',
          companyProfileId: 'co-1',
          allowedCompanies: [{ companyProfileId: 'co-1', status: 'active' }],
        }],
      },
      biometricTimeLog: {
        findMany: async () => [{
          id: 'evt-1',
          deviceId: 'dev-1',
          deviceSerial: '202605260025',
          logId: '101',
          deviceUserId: '1',
          occurredAt: '2026-08-18T00:05:00.000Z',
          occurredAtLocal: '2026-08-18 08:05:00',
          utcTimezoneMinutes: 480,
          attendStatus: 'DutyOff',
          verifyMethod: 'FP',
          verifyMethodNormalized: 'fingerprint',
          transId: '101',
          processingStatus: 'mapped_pending_attendance',
          employeeId: 'EMP-1',
          employeeRecordId: 'emp-rec-1',
          companyProfileId: 'co-1',
          ingestSource: 'push',
          receivedAt: '2026-08-18T00:05:05.000Z',
          discardedFieldNames: ['DeviceUID'],
          attendanceLogId: null,
          mappedSlot: null,
          interpretationCode: null,
          interpretationMessage: null,
          reviewReason: null,
          interpretedAt: null,
        }],
      },
    },
    interpretTimeLogs: async () => ({ interpreted: 0, ignored: 0, needs_review: 0, failed: 0, skipped: 1, results: [] }),
    rollbackInterpretation: async () => ({ ok: true }),
    dismissInterpretationReview: async () => ({ ok: true }),
    reprocessEventIds: async () => ({ updated: 0, skipped: 0 }),
    ...overrides,
  };
}

test('GET biometric events returns application/json', async () => {
  const { res, result } = createRes();
  await handleBiometricEventsRequest({
    method: 'GET',
    query: { company_profile_id: 'co-1', status: 'mapped_pending_attendance' },
  }, res, createDeps());
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['content-type'], /application\/json/);
  assert.equal(result.body.events[0].log_id, '101');
  assert.equal(typeof result.body, 'object');
});

test('successful interpret response is JSON and does not require a live Log ID', async () => {
  const { res, result } = createRes();
  await handleBiometricEventsRequest({
    method: 'POST',
    body: { company_profile_id: 'co-1', operation: 'interpret', event_ids: [] },
  }, res, createDeps());
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['content-type'], /application\/json/);
  assert.equal(result.body.interpreted, 0);
  assert.equal(result.body.skipped, 1);
});

test('authorization failure returns JSON not HTML', async () => {
  const { res, result } = createRes();
  await handleBiometricEventsRequest({
    method: 'GET',
    query: { company_profile_id: 'co-1' },
  }, res, createDeps({
    authorize: async (_req, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.status(401).json({ error: 'Authentication required.' });
      return null;
    },
  }));
  assert.equal(result.statusCode, 401);
  assert.match(result.headers['content-type'], /application\/json/);
  assert.equal(result.body.error, 'Authentication required.');
});

test('preview is an explicit JSON operation and does not interpret', async () => {
  let interpreted = false;
  const { res, result } = createRes();
  await handleBiometricEventsRequest({
    method: 'POST',
    body: { company_profile_id: 'co-1', operation: 'preview', event_ids: ['evt-1'] },
  }, res, createDeps({
    listRecords: async () => [{
      id: 'emp-rec-1',
      employee_id: 'EMP-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_profile_id: 'co-1',
    }],
    previewInterpretation: async () => ({
      ok: true,
      expected_slot: 'time_in',
      expected_label: 'Time In (1)',
      outcome: 'applied',
      message: 'Time In (1)',
    }),
    interpretTimeLogs: async () => {
      interpreted = true;
      return { interpreted: 1 };
    },
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(interpreted, false);
  assert.equal(result.body.results[0].preview.expected_label, 'Time In (1)');
  assert.equal(result.body.results[0].attend_status, 'DutyOff');
});

test('validation and unexpected errors stay JSON', async () => {
  const missing = createRes();
  await handleBiometricEventsRequest({ method: 'GET', query: {} }, missing.res, createDeps());
  assert.equal(missing.result.statusCode, 400);
  assert.match(missing.result.headers['content-type'], /application\/json/);
  assert.equal(missing.result.body.error, 'Company is required.');

  const exploded = createRes();
  await handleBiometricEventsRequest({
    method: 'POST',
    body: { company_profile_id: 'co-1', operation: 'interpret', event_ids: ['x'] },
  }, exploded.res, createDeps({
    interpretTimeLogs: async () => { throw new Error('boom'); },
  }));
  assert.equal(exploded.result.statusCode, 500);
  assert.match(exploded.result.headers['content-type'], /application\/json/);
  assert.equal(exploded.result.body.code, 'EVENTS_API_FAILED');
  assert.equal(String(JSON.stringify(exploded.result.body)).includes('<!DOCTYPE'), false);
});
