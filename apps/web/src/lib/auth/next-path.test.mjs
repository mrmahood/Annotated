import assert from 'node:assert/strict';
import test from 'node:test';
import { getSafeNextPath } from './next-path.ts';

test('keeps safe relative next paths', () => {
  assert.equal(getSafeNextPath('/account?tab=profile#details'), '/account?tab=profile#details');
  assert.equal(getSafeNextPath('/'), '/');
});

test('rejects absolute and protocol-relative next paths', () => {
  assert.equal(getSafeNextPath('https://example.com/steal'), '/');
  assert.equal(getSafeNextPath('//example.com/steal'), '/');
  assert.equal(getSafeNextPath('/\\example.com/steal'), '/');
  assert.equal(getSafeNextPath(null), '/');
});
