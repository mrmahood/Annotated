import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyClipPresetFromPlayhead,
  clampClipSliderWindowStart,
  clipPreviewReachedEnd,
  clipPreviewUserReleased,
  clipSliderDisplayOffsetSeconds,
  clipSliderMediaMsFromOffset,
  clipSliderOffsetSeconds,
  clipSliderWindowContainsRange,
  clipSliderWindowDurationMs,
  clipSliderWindowIsZoomed,
  clipSliderWindowOverlapsRange,
  CLIP_PRESET_30_MS,
  CLIP_PRESET_60_MS,
  CLIP_SLIDER_PAN_MS,
  CLIP_SLIDER_WINDOW_MS,
  CLIP_SLIDER_WINDOW_PADDING_MS,
  formatClipBudgetLabel,
  formatClipClock,
  formatClipSliderWindowCue,
  formatClipSpanReadout,
  getClipBudget,
  mediaDurationSliderMaxMs,
  moveClipHandle,
  panClipSliderWindow,
  recenterClipSliderWindow,
  relocateClipRangeIntoWindow,
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

const LONG_MEDIA_MS = 5_756_000; // 1:35:56 All-In / podcast length
const LONG_START_MS = 702_000; // 11:42
const LONG_END_MS = 792_000; // 13:12

test('long media uses a zoomed window around the current selection', () => {
  assert.equal(clipSliderWindowIsZoomed(LONG_MEDIA_MS), true);
  assert.equal(clipSliderWindowDurationMs(LONG_MEDIA_MS, LONG_START_MS, LONG_END_MS), CLIP_SLIDER_WINDOW_MS);
  const window = recenterClipSliderWindow({
    startMs: LONG_START_MS,
    endMs: LONG_END_MS,
    playheadMs: LONG_START_MS,
    durationMs: LONG_MEDIA_MS,
  });
  assert.deepEqual(window, {
    startMs: 627_000,
    endMs: 867_000,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.equal(clipSliderWindowContainsRange(window.startMs, window.durationMs, LONG_START_MS, LONG_END_MS), true);
  assert.equal(formatClipSpanReadout(LONG_START_MS, LONG_END_MS), '11:42–13:12');
  assert.equal(
    formatClipSliderWindowCue(window.startMs, window.durationMs, LONG_MEDIA_MS),
    'showing 10:27–14:27 of 1:35:56',
  );
});

test('short media and exact 4-minute media keep the full timeline', () => {
  assert.equal(clipSliderWindowIsZoomed(180_000), false);
  assert.equal(clipSliderWindowIsZoomed(CLIP_SLIDER_WINDOW_MS), false);
  assert.equal(clipSliderWindowIsZoomed(CLIP_SLIDER_WINDOW_MS + 1_000), true);
  assert.equal(clipSliderWindowDurationMs(180_000, 10_000, 40_000), 180_000);
  assert.deepEqual(recenterClipSliderWindow({
    startMs: 10_000,
    endMs: 40_000,
    playheadMs: 20_000,
    durationMs: 180_000,
  }), {
    startMs: 0,
    endMs: 180_000,
    durationMs: 180_000,
    zoomed: false,
  });
  assert.equal(formatClipSliderWindowCue(0, 180_000, 180_000), 'showing 0:00–3:00 of 3:00');
});

test('window grows only when selection plus padding exceeds the default 240s', () => {
  assert.equal(
    clipSliderWindowDurationMs(LONG_MEDIA_MS, 0, CLIP_SLIDER_WINDOW_MS + 20_000),
    CLIP_SLIDER_WINDOW_MS + 20_000 + CLIP_SLIDER_WINDOW_PADDING_MS,
  );
  assert.equal(
    clipSliderWindowDurationMs(300_000, 0, 200_000),
    260_000,
  );
});

test('pan clamps the zoom window to media bounds', () => {
  const centered = recenterClipSliderWindow({
    startMs: LONG_START_MS,
    endMs: LONG_END_MS,
    playheadMs: LONG_START_MS,
    durationMs: LONG_MEDIA_MS,
  });
  assert.deepEqual(panClipSliderWindow({
    windowStartMs: centered.startMs,
    deltaMs: -CLIP_SLIDER_PAN_MS,
    startMs: LONG_START_MS,
    endMs: LONG_END_MS,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: 567_000,
    endMs: 807_000,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.equal(clampClipSliderWindowStart(-10_000, CLIP_SLIDER_WINDOW_MS, LONG_MEDIA_MS), 0);
  assert.deepEqual(panClipSliderWindow({
    windowStartMs: 0,
    deltaMs: -CLIP_SLIDER_PAN_MS,
    startMs: LONG_START_MS,
    endMs: LONG_END_MS,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: 0,
    endMs: CLIP_SLIDER_WINDOW_MS,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.deepEqual(panClipSliderWindow({
    windowStartMs: LONG_MEDIA_MS,
    deltaMs: CLIP_SLIDER_PAN_MS,
    startMs: LONG_START_MS,
    endMs: LONG_END_MS,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: LONG_MEDIA_MS - CLIP_SLIDER_WINDOW_MS,
    endMs: LONG_MEDIA_MS,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.equal(
    clipSliderWindowContainsRange(0, CLIP_SLIDER_WINDOW_MS, LONG_START_MS, LONG_END_MS),
    false,
  );
});

test('recenter prefers the selection, else the playhead, and clamps to the start and end', () => {
  assert.deepEqual(recenterClipSliderWindow({
    startMs: null,
    endMs: null,
    playheadMs: LONG_START_MS,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: 582_000,
    endMs: 822_000,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.deepEqual(recenterClipSliderWindow({
    startMs: 0,
    endMs: 30_000,
    playheadMs: LONG_START_MS,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: 0,
    endMs: CLIP_SLIDER_WINDOW_MS,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
  assert.deepEqual(recenterClipSliderWindow({
    startMs: null,
    endMs: null,
    playheadMs: LONG_MEDIA_MS - 10_000,
    durationMs: LONG_MEDIA_MS,
  }), {
    startMs: LONG_MEDIA_MS - CLIP_SLIDER_WINDOW_MS,
    endMs: LONG_MEDIA_MS,
    durationMs: CLIP_SLIDER_WINDOW_MS,
    zoomed: true,
  });
});

test('30s and 60s presets land inside a recentered zoom window', () => {
  const preset = applyClipPresetFromPlayhead(LONG_START_MS, LONG_MEDIA_MS, CLIP_PRESET_30_MS);
  assert.deepEqual(preset, { startMs: 702_000, endMs: 732_000 });
  const window = recenterClipSliderWindow({
    startMs: preset.startMs,
    endMs: preset.endMs,
    playheadMs: LONG_START_MS,
    durationMs: LONG_MEDIA_MS,
  });
  assert.equal(clipSliderWindowContainsRange(window.startMs, window.durationMs, preset.startMs, preset.endMs), true);
  assert.equal(window.zoomed, true);
});

const DEEP_WINDOW_START_MS = 1_200_000; // 20:00
const DEEP_WINDOW_MID_MS = 1_205_000; // 20:05
const LATE_WINDOW_START_MS = 1_800_000; // 30:00

test('window-relative slider offsets stay inside the visible track after a deep pan', () => {
  assert.equal(clipSliderOffsetSeconds(0, DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS), 0);
  assert.equal(clipSliderOffsetSeconds(30_000, DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS), 0);
  assert.equal(clipSliderOffsetSeconds(DEEP_WINDOW_MID_MS, DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS), 5);
  assert.equal(clipSliderOffsetSeconds(DEEP_WINDOW_START_MS + CLIP_SLIDER_WINDOW_MS + 10_000, DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS), 240);
  assert.equal(clipSliderMediaMsFromOffset(5, DEEP_WINDOW_START_MS), DEEP_WINDOW_MID_MS);
  assert.equal(
    clipSliderWindowOverlapsRange(DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS, 0, 30_000),
    false,
  );
  assert.equal(
    clipSliderWindowOverlapsRange(DEEP_WINDOW_START_MS, CLIP_SLIDER_WINDOW_MS, DEEP_WINDOW_START_MS, DEEP_WINDOW_MID_MS),
    true,
  );
  assert.deepEqual(clipSliderDisplayOffsetSeconds({
    startMs: 0,
    endMs: 30_000,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startSeconds: 0, endSeconds: 30 });
  assert.deepEqual(clipSliderDisplayOffsetSeconds({
    startMs: LATE_WINDOW_START_MS + CLIP_SLIDER_WINDOW_MS + 5_000,
    endMs: LATE_WINDOW_START_MS + CLIP_SLIDER_WINDOW_MS + 35_000,
    windowStartMs: LATE_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startSeconds: 210, endSeconds: 240 });
  assert.deepEqual(clipSliderDisplayOffsetSeconds({
    startMs: DEEP_WINDOW_START_MS,
    endMs: DEEP_WINDOW_START_MS + 30_000,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startSeconds: 0, endSeconds: 30 });
});

test('dragging a handle after panning relocates a ≤90s range into the visible window', () => {
  assert.deepEqual(moveClipHandle({
    startMs: 0,
    endMs: 30_000,
    durationMs: LONG_MEDIA_MS,
    handle: 'end',
    nextMs: DEEP_WINDOW_MID_MS,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startMs: DEEP_WINDOW_START_MS, endMs: DEEP_WINDOW_MID_MS });

  assert.deepEqual(moveClipHandle({
    startMs: 0,
    endMs: 30_000,
    durationMs: LONG_MEDIA_MS,
    handle: 'start',
    nextMs: DEEP_WINDOW_START_MS + 10_000,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startMs: DEEP_WINDOW_START_MS + 10_000, endMs: DEEP_WINDOW_START_MS + 40_000 });

  assert.deepEqual(moveClipHandle({
    startMs: null,
    endMs: null,
    durationMs: LONG_MEDIA_MS,
    handle: 'end',
    nextMs: DEEP_WINDOW_MID_MS,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startMs: DEEP_WINDOW_START_MS + 4_000, endMs: DEEP_WINDOW_MID_MS });

  const relocated = relocateClipRangeIntoWindow({
    handle: 'end',
    nextMs: DEEP_WINDOW_START_MS,
    spanMs: 30_000,
    durationMs: LONG_MEDIA_MS,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  });
  assert.deepEqual(relocated, { startMs: DEEP_WINDOW_START_MS, endMs: DEEP_WINDOW_START_MS + 1_000 });
  assert.equal(
    clipSliderWindowContainsRange(
      DEEP_WINDOW_START_MS,
      CLIP_SLIDER_WINDOW_MS,
      relocated.startMs,
      relocated.endMs,
    ),
    true,
  );
  assert.ok(relocated.endMs - relocated.startMs <= 90_000);
});

test('in-window handle drags still clamp to 90s and keep short-media 0-origin empty end', () => {
  assert.deepEqual(moveClipHandle({
    startMs: DEEP_WINDOW_START_MS,
    endMs: DEEP_WINDOW_START_MS + 30_000,
    durationMs: LONG_MEDIA_MS,
    handle: 'end',
    nextMs: DEEP_WINDOW_START_MS + 150_000,
    windowStartMs: DEEP_WINDOW_START_MS,
    windowDurationMs: CLIP_SLIDER_WINDOW_MS,
  }), { startMs: DEEP_WINDOW_START_MS, endMs: DEEP_WINDOW_START_MS + 90_000 });

  assert.deepEqual(moveClipHandle({
    startMs: null,
    endMs: null,
    durationMs: 180_000,
    handle: 'end',
    nextMs: 15_400,
    windowStartMs: 0,
    windowDurationMs: 180_000,
  }), { startMs: 0, endMs: 15_000 });
});
