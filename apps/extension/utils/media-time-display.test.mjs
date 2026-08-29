import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMediaTimeTenths, getMediaRangeDisplay } from './media-time-display.ts';

test('playing-time range display derives length from the same rounded endpoints', () => {
  assert.deepEqual(getMediaRangeDisplay(849, 3_437), {
    start: '00:00.8',
    end: '00:03.4',
    length: '00:02.6',
  });
});

test('paused whole-second ranges remain exact and visibly consistent', () => {
  assert.deepEqual(getMediaRangeDisplay(1_000, 3_000), {
    start: '00:01.0',
    end: '00:03.0',
    length: '00:02.0',
  });
});

test('missing or reversed endpoints keep the length unavailable', () => {
  assert.deepEqual(getMediaRangeDisplay(null, 3_000), {
    start: '--:--', end: '00:03.0', length: '--:--',
  });
  assert.equal(getMediaRangeDisplay(3_000, 2_000).length, '--:--');
});

test('precise media clocks retain the existing hour shape', () => {
  assert.equal(formatMediaTimeTenths(3_737_260), '1:02:17.3');
});
