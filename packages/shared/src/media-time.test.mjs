import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMediaTime,
  formatTypedMediaTime,
  getHistoricalStoredTargetRangeError,
  getMediaEndpointBoundError,
  getNewMediaPublicationRangeError,
  parseMediaTime,
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
  assert.match(getNewMediaPublicationRangeError(10_001, 11_001, 10_000), /start cannot exceed/);
  assert.equal(getMediaEndpointBoundError(10_000, 10_000, 'start'), null);
  assert.match(getMediaEndpointBoundError(10_001, 10_000, 'start'), /start cannot exceed/);
  assert.match(getMediaEndpointBoundError(10_001, 10_000, 'end'), /end cannot exceed/);
});

test('parses typed m:ss and h:mm:ss clip times', () => {
  assert.deepEqual(parseMediaTime(''), { status: 'empty' });
  assert.deepEqual(parseMediaTime('   '), { status: 'empty' });
  assert.deepEqual(parseMediaTime('1:00'), { status: 'ok', milliseconds: 60_000 });
  assert.deepEqual(parseMediaTime('2:30'), { status: 'ok', milliseconds: 150_000 });
  assert.deepEqual(parseMediaTime('01:00'), { status: 'ok', milliseconds: 60_000 });
  assert.deepEqual(parseMediaTime('0:00'), { status: 'ok', milliseconds: 0 });
  assert.deepEqual(parseMediaTime('1:02:17'), { status: 'ok', milliseconds: 3_737_000 });
  assert.deepEqual(parseMediaTime('1:00.5'), { status: 'ok', milliseconds: 60_500 });
  assert.deepEqual(parseMediaTime('01:01.234'), { status: 'ok', milliseconds: 61_234 });
  assert.deepEqual(parseMediaTime(' 2:30 '), { status: 'ok', milliseconds: 150_000 });
});

test('keeps in-progress typed times incomplete and rejects invalid clocks', () => {
  assert.equal(parseMediaTime('1').status, 'incomplete');
  assert.equal(parseMediaTime('1:').status, 'incomplete');
  assert.equal(parseMediaTime('1:0').status, 'incomplete');
  assert.equal(parseMediaTime('1:00:').status, 'incomplete');
  assert.equal(parseMediaTime('1:00.').status, 'incomplete');
  assert.equal(parseMediaTime('1:60').status, 'invalid');
  assert.equal(parseMediaTime('1:00:60').status, 'invalid');
  assert.equal(parseMediaTime('1:60:00').status, 'invalid');
  assert.equal(parseMediaTime('1:00x').status, 'invalid');
  assert.equal(parseMediaTime('90').status, 'incomplete');
});

test('formats typed fields so committed clip times can round-trip', () => {
  assert.equal(formatTypedMediaTime(60_000), '01:00');
  assert.equal(formatTypedMediaTime(150_000), '02:30');
  assert.equal(formatTypedMediaTime(3_737_000), '1:02:17');
  assert.equal(formatTypedMediaTime(61_234), '01:01.234');
  assert.deepEqual(parseMediaTime(formatTypedMediaTime(61_234)), {
    status: 'ok',
    milliseconds: 61_234,
  });
});
