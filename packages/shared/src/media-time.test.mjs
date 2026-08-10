import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMediaTime, getClipRangeError } from './media-time.ts';

test('formats media times for minutes and hours', () => {
  assert.equal(formatMediaTime(42_000), '00:42');
  assert.equal(formatMediaTime(73_000), '01:13');
  assert.equal(formatMediaTime(3_737_000), '1:02:17');
});

test('validates clip ordering and duration bounds', () => {
  assert.match(getClipRangeError(null, 2_000), /both/);
  assert.match(getClipRangeError(2_000, 2_000), /after/);
  assert.match(getClipRangeError(2_000, 2_999), /at least/);
  assert.equal(getClipRangeError(2_000, 302_000), null);
  assert.match(getClipRangeError(2_000, 302_001), /5 minutes/);
});

test('rejects a range beyond a known media duration', () => {
  assert.equal(getClipRangeError(0, 10_000, 10_000), null);
  assert.match(getClipRangeError(0, 10_001, 10_000), /media duration/);
});
