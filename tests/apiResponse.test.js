import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentTypeIsJson,
  parseApiJsonText,
  readApiJson,
  sanitizeResponsePreview,
} from '../src/lib/apiResponse.js';

function fakeResponse({ status = 200, contentType = 'application/json', body = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  };
}

test('HTML documents are never treated as JSON', () => {
  const parsed = parseApiJsonText('<!DOCTYPE html><html><head></head></html>', 'text/html; charset=utf-8');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'html');
  assert.equal(sanitizeResponsePreview('<!DOCTYPE html><html><body>secret token=abc</body></html>'), 'HTML document');
  assert.equal(contentTypeIsJson('text/html'), false);
});

test('successful interpret JSON is accepted', async () => {
  const data = await readApiJson(fakeResponse({
    body: JSON.stringify({ interpreted: 1, ignored: 0, needs_review: 0, failed: 0, results: [] }),
  }));
  assert.equal(data.interpreted, 1);
});

test('authorization and validation JSON errors become readable API errors', async () => {
  await assert.rejects(
    () => readApiJson(fakeResponse({ status: 401, body: JSON.stringify({ error: 'Authentication required.' }) })),
    { message: 'Authentication required.', status: 401 },
  );
  await assert.rejects(
    () => readApiJson(fakeResponse({ status: 400, body: JSON.stringify({ error: 'Company is required.' }) })),
    { message: 'Company is required.', status: 400 },
  );
});

test('non-JSON server responses do not throw Unexpected token', async () => {
  await assert.rejects(
    () => readApiJson(fakeResponse({
      status: 500,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html><body>Internal Server Error</body></html>',
    })),
    (error) => {
      assert.equal(error.code, 'NON_JSON_RESPONSE');
      assert.match(error.message, /HTML document/);
      assert.equal(error.message.includes('Unexpected token'), false);
      assert.equal(error.message.includes('<!DOCTYPE'), false);
      return true;
    },
  );
});
