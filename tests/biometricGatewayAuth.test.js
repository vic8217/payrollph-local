import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBearerToken,
  requireGatewayAuth,
  verifyGatewaySecret,
} from '../src/server/biometric/gatewayAuth.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('bearer extraction is case-insensitive', () => {
  assert.equal(extractBearerToken({ headers: { authorization: 'Bearer secret-one' } }), 'secret-one');
  assert.equal(extractBearerToken({ headers: { Authorization: 'bearer secret-one' } }), 'secret-one');
  assert.equal(extractBearerToken({ headers: {} }), null);
});

test('timing-safe compare rejects missing or wrong secrets', () => {
  assert.equal(verifyGatewaySecret('secret-one', 'secret-one'), true);
  assert.equal(verifyGatewaySecret('secret-two', 'secret-one'), false);
  assert.equal(verifyGatewaySecret('', 'secret-one'), false);
  assert.equal(verifyGatewaySecret('secret-one', ''), false);
});

test('unconfigured secret is 503 and wrong token is 401', () => {
  const missing = mockRes();
  assert.equal(requireGatewayAuth({ headers: {} }, missing, {}), false);
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.reason, 'GATEWAY_SECRET_NOT_CONFIGURED');

  const denied = mockRes();
  assert.equal(requireGatewayAuth(
    { headers: { authorization: 'Bearer wrong' } },
    denied,
    { BIOMETRIC_GATEWAY_SECRET: 'expected-secret' },
  ), false);
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.reason, 'GATEWAY_UNAUTHORIZED');

  const ok = mockRes();
  assert.equal(requireGatewayAuth(
    { headers: { authorization: 'Bearer expected-secret' } },
    ok,
    { BIOMETRIC_GATEWAY_SECRET: 'expected-secret' },
  ), true);
  assert.equal(ok.statusCode, 200);
});
