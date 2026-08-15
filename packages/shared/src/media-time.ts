export const MINIMUM_MEDIA_DURATION_MS = 1_000;
export const MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS = 90_000;
export const MAXIMUM_HISTORICAL_STORED_TARGET_DURATION_MS = 300_000;

export function formatMediaTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '00:00';
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pair = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pair(minutes)}:${pair(seconds)}`
    : `${pair(minutes)}:${pair(seconds)}`;
}

function getMediaRangeError(
  startMs: number | null,
  endMs: number | null,
  maximumDurationMs: number,
  maximumDurationMessage: string,
  durationMs?: number | null,
): string | null {
  if (startMs === null || endMs === null) return 'Set both a clip start and end.';
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0) {
    return 'The clip times are invalid.';
  }
  if (endMs <= startMs) return 'Clip end must be after clip start.';
  const clipDuration = endMs - startMs;
  if (clipDuration < MINIMUM_MEDIA_DURATION_MS) return 'A clip must be at least 1 second long.';
  if (clipDuration > maximumDurationMs) return maximumDurationMessage;
  if (
    durationMs !== undefined && durationMs !== null &&
    (!Number.isSafeInteger(durationMs) || durationMs < 0 || endMs > durationMs)
  ) {
    return 'Clip end cannot exceed the media duration.';
  }
  return null;
}

export function getNewMediaPublicationRangeError(
  startMs: number | null,
  endMs: number | null,
  durationMs?: number | null,
): string | null {
  return getMediaRangeError(
    startMs,
    endMs,
    MAXIMUM_NEW_MEDIA_PUBLICATION_DURATION_MS,
    'A hosted clip cannot be longer than 90 seconds.',
    durationMs,
  );
}

export function getHistoricalStoredTargetRangeError(
  startMs: number | null,
  endMs: number | null,
): string | null {
  return getMediaRangeError(
    startMs,
    endMs,
    MAXIMUM_HISTORICAL_STORED_TARGET_DURATION_MS,
    'A stored clip cannot be longer than the historical 5-minute limit.',
  );
}
