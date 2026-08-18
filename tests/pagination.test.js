import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePagination } from '../src/lib/pagination.js';

test('pagination defaults invalid and non-positive values safely', () => {
  for (const page of [undefined, 'invalid', 0, -1]) {
    assert.equal(normalizePagination(page, 50).page, 1);
  }
  for (const pageSize of [undefined, 'invalid', 0, -10]) {
    assert.equal(normalizePagination(1, pageSize).pageSize, 50);
  }
});

test('pagination caps page size and truncates numeric values', () => {
  assert.deepEqual(normalizePagination(2, 50), { page: 2, pageSize: 50 });
  assert.deepEqual(normalizePagination('3.9', '75.8'), { page: 3, pageSize: 75 });
  assert.deepEqual(normalizePagination(1, 5000), { page: 1, pageSize: 200 });
});
