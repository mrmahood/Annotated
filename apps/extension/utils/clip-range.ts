import {
  formatMediaTime,
  MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS,
  MINIMUM_MEDIA_DURATION_MS,
} from '@annotated/shared/media-time';

export const CLIP_PRESET_30_MS = 30_000;
export const CLIP_PRESET_60_MS = 60_000;
export const CLIP_PREVIEW_END_EPSILON_SECONDS = 0.05;

export const CLIP_PRESETS = [
  { label: '30s', durationMs: CLIP_PRESET_30_MS },
  { label: '60s', durationMs: CLIP_PRESET_60_MS },
] as const;

export function snapMsToWholeSeconds(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 0;
  return Math.round(milliseconds / 1_000) * 1_000;
}

export function floorMsToWholeSeconds(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 0;
  return Math.floor(milliseconds / 1_000) * 1_000;
}

export function mediaDurationSliderMaxMs(durationMs: number | null): number | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return floorMsToWholeSeconds(durationMs);
}

function clampToMedia(milliseconds: number, maxMs: number | null): number {
  const snapped = snapMsToWholeSeconds(milliseconds);
  if (maxMs === null) return Math.max(0, snapped);
  return Math.min(maxMs, Math.max(0, snapped));
}

export function formatClipClock(milliseconds: number): string {
  return formatMediaTime(milliseconds).replace(/^0(\d:)/, '$1');
}

export function formatClipSpanReadout(
  startMs: number | null,
  endMs: number | null,
): string {
  if (startMs === null || endMs === null) return '–';
  return `${formatClipClock(startMs)}–${formatClipClock(endMs)}`;
}

export type ClipBudget = {
  usedMs: number;
  remainingMs: number;
  usedSeconds: number;
  remainingSeconds: number;
};

export function getClipBudget(
  startMs: number | null,
  endMs: number | null,
): ClipBudget {
  const usedMs = startMs !== null && endMs !== null && endMs > startMs
    ? endMs - startMs
    : 0;
  const remainingMs = Math.max(0, MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS - usedMs);
  return {
    usedMs,
    remainingMs,
    usedSeconds: Math.round(usedMs / 1_000),
    remainingSeconds: Math.round(remainingMs / 1_000),
  };
}

export function formatClipBudgetLabel(budget: ClipBudget): string {
  if (budget.usedMs <= 0) return '90s left';
  return `${budget.usedSeconds}s used · ${budget.remainingSeconds}s left`;
}

export function applyClipPresetFromPlayhead(
  playheadMs: number,
  durationMs: number | null,
  presetMs: number,
): { startMs: number; endMs: number } {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  const preset = Math.min(
    MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS,
    Math.max(MINIMUM_MEDIA_DURATION_MS, snapMsToWholeSeconds(presetMs)),
  );
  const startMs = clampToMedia(floorMsToWholeSeconds(playheadMs), maxMs);
  let endMs = startMs + preset;
  if (maxMs !== null) endMs = Math.min(maxMs, endMs);
  if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS && maxMs !== null && maxMs >= MINIMUM_MEDIA_DURATION_MS) {
    endMs = Math.min(maxMs, startMs + MINIMUM_MEDIA_DURATION_MS);
  }
  return { startMs, endMs };
}

export function moveClipHandle(input: {
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  handle: 'start' | 'end';
  nextMs: number;
  windowStartMs?: number | null;
  windowDurationMs?: number | null;
}): { startMs: number; endMs: number } {
  const maxMs = mediaDurationSliderMaxMs(input.durationMs);
  const next = clampToMedia(input.nextMs, maxMs);
  if (clipHandleShouldRelocate({ ...input, nextMs: next })) {
    const existingStart = input.startMs;
    const existingEnd = input.endMs;
    const hasExisting = existingStart !== null && existingEnd !== null && existingEnd > existingStart;
    return relocateClipRangeIntoWindow({
      handle: input.handle,
      nextMs: next,
      spanMs: hasExisting
        ? existingEnd - existingStart
        : MINIMUM_MEDIA_DURATION_MS,
      durationMs: input.durationMs,
      windowStartMs: input.windowStartMs ?? 0,
      windowDurationMs: input.windowDurationMs ?? 0,
    });
  }
  const fallbackEnd = maxMs === null
    ? next + MINIMUM_MEDIA_DURATION_MS
    : Math.min(maxMs, next + MINIMUM_MEDIA_DURATION_MS);
  let startMs = input.startMs === null
    ? (input.handle === 'end' ? 0 : next)
    : clampToMedia(input.startMs, maxMs);
  let endMs = input.endMs === null
    ? (input.handle === 'start' ? fallbackEnd : next)
    : clampToMedia(input.endMs, maxMs);

  if (input.handle === 'start') {
    startMs = next;
    if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS) {
      endMs = startMs + MINIMUM_MEDIA_DURATION_MS;
      if (maxMs !== null && endMs > maxMs) {
        endMs = maxMs;
        startMs = Math.max(0, endMs - MINIMUM_MEDIA_DURATION_MS);
      }
    }
    if (endMs - startMs > MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS) {
      startMs = endMs - MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS;
    }
  } else {
    endMs = next;
    if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS) {
      startMs = endMs - MINIMUM_MEDIA_DURATION_MS;
      if (startMs < 0) {
        startMs = 0;
        endMs = Math.min(maxMs ?? MINIMUM_MEDIA_DURATION_MS, MINIMUM_MEDIA_DURATION_MS);
      }
    }
    if (endMs - startMs > MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS) {
      endMs = startMs + MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS;
      if (maxMs !== null && endMs > maxMs) {
        endMs = maxMs;
        startMs = Math.max(0, endMs - MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS);
      }
    }
  }

  if (maxMs !== null) {
    endMs = Math.min(endMs, maxMs);
    startMs = Math.min(startMs, endMs);
  }
  return { startMs, endMs };
}

export function clipPreviewReachedEnd(
  currentTimeSeconds: number,
  endSeconds: number,
): boolean {
  return Number.isFinite(currentTimeSeconds)
    && Number.isFinite(endSeconds)
    && currentTimeSeconds + CLIP_PREVIEW_END_EPSILON_SECONDS >= endSeconds;
}

export function clipPreviewUserReleased(
  currentTimeSeconds: number,
  endSeconds: number,
  paused: boolean,
): boolean {
  return paused && !clipPreviewReachedEnd(currentTimeSeconds, endSeconds);
}

/** Visible slider span on long media. Short media keeps the full timeline. */
export const CLIP_SLIDER_WINDOW_MS = 240_000;
/** Extra room around a selection when it would otherwise exceed the default window. */
export const CLIP_SLIDER_WINDOW_PADDING_MS = 60_000;
/** Button pan step. Track-gutter drag can move by any amount. */
export const CLIP_SLIDER_PAN_MS = 60_000;

export type ClipSliderWindow = {
  startMs: number;
  endMs: number;
  durationMs: number;
  zoomed: boolean;
};

export function clipSliderWindowIsZoomed(durationMs: number | null): boolean {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  return maxMs !== null && maxMs > CLIP_SLIDER_WINDOW_MS;
}

export function clipSliderWindowDurationMs(
  durationMs: number | null,
  startMs: number | null,
  endMs: number | null,
): number | null {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  if (maxMs === null) return null;
  if (maxMs <= CLIP_SLIDER_WINDOW_MS) return maxMs;
  const span = startMs !== null && endMs !== null && endMs > startMs
    ? endMs - startMs
    : 0;
  return Math.min(
    maxMs,
    Math.max(CLIP_SLIDER_WINDOW_MS, span + CLIP_SLIDER_WINDOW_PADDING_MS),
  );
}

export function clampClipSliderWindowStart(
  windowStartMs: number,
  windowDurationMs: number,
  durationMs: number | null,
): number {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  if (maxMs === null || windowDurationMs <= 0) return 0;
  const maxStart = Math.max(0, maxMs - windowDurationMs);
  return Math.min(maxStart, Math.max(0, snapMsToWholeSeconds(windowStartMs)));
}

export function clipSliderFocusMs(input: {
  startMs: number | null;
  endMs: number | null;
  playheadMs: number | null;
}): number {
  if (input.startMs !== null && input.endMs !== null && input.endMs > input.startMs) {
    return snapMsToWholeSeconds((input.startMs + input.endMs) / 2);
  }
  if (input.playheadMs !== null && Number.isFinite(input.playheadMs) && input.playheadMs >= 0) {
    return snapMsToWholeSeconds(input.playheadMs);
  }
  return 0;
}

function clipSliderWindowFromStart(
  windowStartMs: number,
  windowDurationMs: number,
  durationMs: number | null,
): ClipSliderWindow | null {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  if (maxMs === null) return null;
  const startMs = clampClipSliderWindowStart(windowStartMs, windowDurationMs, durationMs);
  return {
    startMs,
    durationMs: windowDurationMs,
    endMs: startMs + windowDurationMs,
    zoomed: maxMs > CLIP_SLIDER_WINDOW_MS,
  };
}

export function recenterClipSliderWindow(input: {
  startMs: number | null;
  endMs: number | null;
  playheadMs: number | null;
  durationMs: number | null;
}): ClipSliderWindow | null {
  const windowDurationMs = clipSliderWindowDurationMs(input.durationMs, input.startMs, input.endMs);
  if (windowDurationMs === null) return null;
  const focusMs = clipSliderFocusMs(input);
  return clipSliderWindowFromStart(
    focusMs - windowDurationMs / 2,
    windowDurationMs,
    input.durationMs,
  );
}

export function panClipSliderWindow(input: {
  windowStartMs: number;
  deltaMs: number;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
}): ClipSliderWindow | null {
  const windowDurationMs = clipSliderWindowDurationMs(input.durationMs, input.startMs, input.endMs);
  if (windowDurationMs === null) return null;
  return clipSliderWindowFromStart(
    input.windowStartMs + input.deltaMs,
    windowDurationMs,
    input.durationMs,
  );
}

export function clipSliderWindowContainsRange(
  windowStartMs: number,
  windowDurationMs: number,
  startMs: number | null,
  endMs: number | null,
): boolean {
  if (startMs === null || endMs === null || endMs <= startMs) return true;
  return startMs >= windowStartMs && endMs <= windowStartMs + windowDurationMs;
}

export function clipSliderWindowOverlapsRange(
  windowStartMs: number,
  windowDurationMs: number,
  startMs: number | null,
  endMs: number | null,
): boolean {
  if (startMs === null || endMs === null || endMs <= startMs || windowDurationMs <= 0) return false;
  return startMs < windowStartMs + windowDurationMs && endMs > windowStartMs;
}

/** Map a media timestamp onto the visible slider (0 = window start). */
export function clipSliderOffsetSeconds(
  mediaMs: number,
  windowStartMs: number,
  windowDurationMs: number,
): number {
  if (windowDurationMs <= 0) return 0;
  const spanSeconds = windowDurationMs / 1_000;
  const offsetSeconds = (
    snapMsToWholeSeconds(mediaMs) - snapMsToWholeSeconds(windowStartMs)
  ) / 1_000;
  return Math.min(spanSeconds, Math.max(0, offsetSeconds));
}

export function clipSliderMediaMsFromOffset(
  offsetSeconds: number,
  windowStartMs: number,
): number {
  return snapMsToWholeSeconds(windowStartMs + offsetSeconds * 1_000);
}

/** Visible handle positions. Off-window ranges sit at the near edge so they stay grabbable. */
export function clipSliderDisplayOffsetSeconds(input: {
  startMs: number | null;
  endMs: number | null;
  windowStartMs: number;
  windowDurationMs: number;
  playheadMs?: number | null;
}): { startSeconds: number; endSeconds: number } {
  const fallbackSeconds = input.playheadMs == null
    ? 0
    : clipSliderOffsetSeconds(input.playheadMs, input.windowStartMs, input.windowDurationMs);
  if (input.startMs === null || input.endMs === null || input.endMs <= input.startMs) {
    return { startSeconds: fallbackSeconds, endSeconds: fallbackSeconds };
  }
  if (clipSliderWindowOverlapsRange(
    input.windowStartMs,
    input.windowDurationMs,
    input.startMs,
    input.endMs,
  )) {
    return {
      startSeconds: clipSliderOffsetSeconds(input.startMs, input.windowStartMs, input.windowDurationMs),
      endSeconds: clipSliderOffsetSeconds(input.endMs, input.windowStartMs, input.windowDurationMs),
    };
  }
  const spanSeconds = input.windowDurationMs > 0 ? input.windowDurationMs / 1_000 : 0;
  const rangeSeconds = Math.min(
    spanSeconds,
    Math.max(1, Math.round((input.endMs - input.startMs) / 1_000)),
  );
  if (input.endMs <= input.windowStartMs) {
    return { startSeconds: 0, endSeconds: rangeSeconds };
  }
  return {
    startSeconds: Math.max(0, spanSeconds - rangeSeconds),
    endSeconds: spanSeconds,
  };
}

function clipHandleShouldRelocate(input: {
  startMs: number | null;
  endMs: number | null;
  nextMs: number;
  windowStartMs?: number | null;
  windowDurationMs?: number | null;
}): boolean {
  const windowStartMs = input.windowStartMs;
  const windowDurationMs = input.windowDurationMs;
  if (windowStartMs == null || windowDurationMs == null || windowDurationMs <= 0) return false;
  const windowEndMs = windowStartMs + windowDurationMs;
  if (input.nextMs < windowStartMs || input.nextMs > windowEndMs) return false;
  const hasExisting = input.startMs !== null && input.endMs !== null && input.endMs > input.startMs;
  if (hasExisting) {
    return !clipSliderWindowOverlapsRange(
      windowStartMs,
      windowDurationMs,
      input.startMs,
      input.endMs,
    );
  }
  return windowStartMs > 0;
}

export function relocateClipRangeIntoWindow(input: {
  handle: 'start' | 'end';
  nextMs: number;
  spanMs: number;
  durationMs: number | null;
  windowStartMs: number;
  windowDurationMs: number;
}): { startMs: number; endMs: number } {
  const maxMs = mediaDurationSliderMaxMs(input.durationMs);
  const windowStartMs = clampClipSliderWindowStart(
    input.windowStartMs,
    input.windowDurationMs,
    input.durationMs,
  );
  const windowEndMs = maxMs === null
    ? windowStartMs + input.windowDurationMs
    : Math.min(maxMs, windowStartMs + input.windowDurationMs);
  const placed = Math.min(windowEndMs, Math.max(windowStartMs, clampToMedia(input.nextMs, maxMs)));
  const span = Math.min(
    MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS,
    Math.max(MINIMUM_MEDIA_DURATION_MS, snapMsToWholeSeconds(input.spanMs)),
  );

  let startMs: number;
  let endMs: number;
  if (input.handle === 'start') {
    startMs = placed;
    endMs = Math.min(windowEndMs, startMs + span);
    if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS) {
      startMs = Math.max(windowStartMs, endMs - MINIMUM_MEDIA_DURATION_MS);
      endMs = Math.min(windowEndMs, startMs + MINIMUM_MEDIA_DURATION_MS);
    }
  } else {
    endMs = placed;
    startMs = Math.max(windowStartMs, endMs - span);
    if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS) {
      endMs = Math.min(windowEndMs, startMs + MINIMUM_MEDIA_DURATION_MS);
      startMs = Math.max(windowStartMs, endMs - MINIMUM_MEDIA_DURATION_MS);
    }
  }

  if (maxMs !== null) {
    endMs = Math.min(endMs, maxMs);
    startMs = Math.min(startMs, endMs);
    if (endMs - startMs < MINIMUM_MEDIA_DURATION_MS && maxMs >= MINIMUM_MEDIA_DURATION_MS) {
      endMs = Math.min(maxMs, startMs + MINIMUM_MEDIA_DURATION_MS);
      startMs = Math.max(0, endMs - MINIMUM_MEDIA_DURATION_MS);
    }
    if (endMs - startMs > MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS) {
      endMs = startMs + MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS;
      if (endMs > maxMs) {
        endMs = maxMs;
        startMs = Math.max(0, endMs - MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS);
      }
    }
  }
  return { startMs, endMs };
}

export function formatClipSliderWindowCue(
  windowStartMs: number,
  windowDurationMs: number,
  durationMs: number | null,
): string {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  if (maxMs === null || windowDurationMs <= 0) return '';
  const windowEndMs = Math.min(maxMs, windowStartMs + windowDurationMs);
  return `showing ${formatClipClock(windowStartMs)}–${formatClipClock(windowEndMs)} of ${formatClipClock(maxMs)}`;
}
