import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMediaTime,
  getHistoricalStoredTargetRangeError,
  getNewMediaPublicationRangeError,
} from './media-time.ts';

test('formats media times for minutes and hours', () => {
  assert.equal(formatMediaTime(42_000), '00:42');
  assert.equal(formatMediaTime(73_000), '01:13');
  assert.equal(formatMediaTime(3_737_000), '1:02:17');
});

test('validates new hosted-media publication at the 90-second product limit', () => {
  assert.match(getNewMediaPublicationRangeError(null, 2_000), /both/);
  assert.match(getNewMediaPublicationRangeError(2_000, 2_000), /after/);
  assert.match(getNewMediaPublicationRangeError(2_000, 2_999), /at least/);
  assert.equal(getNewMediaPublicationRangeError(2_000, 92_000), null);
  assert.match(getNewMediaPublicationRangeError(2_000, 92_001), /90 seconds/);
});

test('keeps historical stored targets readable through five minutes', () => {
  assert.equal(getHistoricalStoredTargetRangeError(2_000, 302_000), null);
  assert.match(getHistoricalStoredTargetRangeError(2_000, 302_001), /5-minute/);
});

test('rejects a range beyond a known media duration', () => {
  assert.equal(getNewMediaPublicationRangeError(0, 10_000, 10_000), null);
  assert.match(getNewMediaPublicationRangeError(0, 10_001, 10_000), /media duration/);
});
