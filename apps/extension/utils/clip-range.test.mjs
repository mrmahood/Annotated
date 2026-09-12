import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyClipPresetFromPlayhead,
  clipPreviewReachedEnd,
  clipPreviewUserReleased,
  CLIP_PRESET_30_MS,
  CLIP_PRESET_60_MS,
  formatClipBudgetLabel,
  formatClipClock,
  formatClipSpanReadout,
  getClipBudget,
  mediaDurationSliderMaxMs,
  moveClipHandle,
  snapMsToWholeSeconds,
} from './clip-range.ts';
import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';

test('handles snap to whole seconds', () => {
  assert.equal(snapMsToWholeSeconds(1_499), 1_000);
  assert.equal(snapMsToWholeSeconds(1_500), 2_000);
  assert.equal(snapMsToWholeSeconds(90_000), 90_000);
  assert.equal(snapMsToWholeSeconds(0), 0);
});

test('30s and 60s presets start at the playhead and clamp to duration and 90s', () => {
  assert.deepEqual(applyClipPresetFromPlayhead(72_400, 180_000, CLIP_PRESET_30_MS), {
    startMs: 72_000,
    endMs: 102_000,
  });
  assert.deepEqual(applyClipPresetFromPlayhead(10_000, 180_000, CLIP_PRESET_60_MS), {
    startMs: 10_000,
    endMs: 70_000,
  });
  assert.deepEqual(applyClipPresetFromPlayhead(100_000, 120_000, CLIP_PRESET_30_MS), {
    startMs: 100_000,
    endMs: 120_000,
  });
  assert.deepEqual(applyClipPresetFromPlayhead(0, 200_000, 120_000), {
    startMs: 0,
    endMs: 90_000,
  });
  assert.equal(
    getNewMediaPublicationRangeError(0, 90_000, 200_000),
    null,
  );
});

test('preset near the media end keeps start at now even when the window is short', () => {
  assert.deepEqual(applyClipPresetFromPlayhead(119_600, 120_000, CLIP_PRESET_30_MS), {
    startMs: 119_000,
    endMs: 120_000,
  });
});

test('dragging a handle snaps, keeps at least 1s, and never exceeds 90s', () => {
  assert.deepEqual(moveClipHandle({
    startMs: 60_000,
    endMs: 90_000,
    durationMs: 180_000,
    handle: 'end',
    nextMs: 150_400,
  }), { startMs: 60_000, endMs: 150_000 });

  assert.deepEqual(moveClipHandle({
    startMs: 0,
    endMs: 30_000,
    durationMs: 180_000,
    handle: 'end',
    nextMs: 100_000,
  }), { startMs: 0, endMs: 90_000 });

  assert.deepEqual(moveClipHandle({
    startMs: 90_000,
    endMs: 150_000,
    durationMs: 180_000,
    handle: 'start',
    nextMs: 0,
  }), { startMs: 60_000, endMs: 150_000 });

  assert.deepEqual(moveClipHandle({
    startMs: 10_000,
    endMs: 40_000,
    durationMs: 180_000,
    handle: 'start',
    nextMs: 39_200,
  }), { startMs: 39_000, endMs: 40_000 });

  assert.deepEqual(moveClipHandle({
    startMs: null,
    endMs: null,
    durationMs: 180_000,
    handle: 'end',
    nextMs: 15_400,
  }), { startMs: 0, endMs: 15_000 });
});

test('slider max stays inside the known media duration', () => {
  assert.equal(mediaDurationSliderMaxMs(90_400), 90_000);
  assert.equal(mediaDurationSliderMaxMs(45_999), 45_000);
  assert.equal(mediaDurationSliderMaxMs(null), null);
});

test('publish stays disabled until a valid 1–90s range exists', () => {
  assert.match(getNewMediaPublicationRangeError(null, null, 180_000), /both/);
  assert.match(getNewMediaPublicationRangeError(0, 500, 180_000), /at least/);
  assert.equal(getNewMediaPublicationRangeError(0, 90_000, 180_000), null);
  assert.match(getNewMediaPublicationRangeError(0, 91_000, 180_000), /90 seconds/);
});

test('timecode readout and remaining-to-90 budget are whole seconds', () => {
  assert.equal(formatClipClock(72_000), '1:12');
  assert.equal(formatClipSpanReadout(72_000, 102_000), '1:12–1:42');
  assert.equal(formatClipSpanReadout(null, null), '–');
  assert.equal(formatClipBudgetLabel(getClipBudget(null, null)), '90s left');
  assert.equal(formatClipBudgetLabel(getClipBudget(72_000, 102_000)), '30s used · 60s left');
  assert.equal(formatClipBudgetLabel(getClipBudget(0, 90_000)), '90s used · 0s left');
});

test('preview stops at the selected end and releases when the user pauses earlier', () => {
  assert.equal(clipPreviewReachedEnd(7.96, 8), true);
  assert.equal(clipPreviewReachedEnd(7.9, 8), false);
  assert.equal(clipPreviewReachedEnd(90, 90), true);
  assert.equal(clipPreviewUserReleased(6, 8, true), true);
  assert.equal(clipPreviewUserReleased(8, 8, true), false);
  assert.equal(clipPreviewUserReleased(6, 8, false), false);
});
