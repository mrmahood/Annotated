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
}): { startMs: number; endMs: number } {
  const maxMs = mediaDurationSliderMaxMs(input.durationMs);
  const next = clampToMedia(input.nextMs, maxMs);
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
