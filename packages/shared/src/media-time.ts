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

export const TYPED_MEDIA_TIME_FORMAT_ERROR = 'Enter a time like 1:00 or 1:02:17.';

export type ParsedMediaTime =
  | { status: 'empty' }
  | { status: 'ok'; milliseconds: number }
  | { status: 'incomplete' }
  | { status: 'invalid' };

const COMPLETE_HOUR_TIME = /^(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/;
const COMPLETE_MINUTE_TIME = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/;
const INCOMPLETE_TYPED_TIME = /^(?:\d{1,3}:?|\d{1,3}:[0-5]|\d{1,3}:[0-5]\d:|\d{1,3}:[0-5]\d:[0-5]|\d{1,3}(?::[0-5]\d){1,2}\.)$/;

function fractionToMilliseconds(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value.padEnd(3, '0'), 10);
}

export function parseMediaTime(value: string): ParsedMediaTime {
  const trimmed = value.trim();
  if (!trimmed) return { status: 'empty' };
  const hourMatch = COMPLETE_HOUR_TIME.exec(trimmed);
  if (hourMatch) {
    const hours = Number.parseInt(hourMatch[1], 10);
    const minutes = Number.parseInt(hourMatch[2], 10);
    const seconds = Number.parseInt(hourMatch[3], 10);
    const milliseconds = (((hours * 60 + minutes) * 60) + seconds) * 1_000
      + fractionToMilliseconds(hourMatch[4]);
    if (!Number.isSafeInteger(milliseconds)) return { status: 'invalid' };
    return { status: 'ok', milliseconds };
  }
  const minuteMatch = COMPLETE_MINUTE_TIME.exec(trimmed);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    const seconds = Number.parseInt(minuteMatch[2], 10);
    const milliseconds = (minutes * 60 + seconds) * 1_000
      + fractionToMilliseconds(minuteMatch[3]);
    if (!Number.isSafeInteger(milliseconds)) return { status: 'invalid' };
    return { status: 'ok', milliseconds };
  }
  return INCOMPLETE_TYPED_TIME.test(trimmed)
    ? { status: 'incomplete' }
    : { status: 'invalid' };
}

export function formatTypedMediaTime(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '';
  const clock = formatMediaTime(milliseconds);
  const remainder = milliseconds % 1_000;
  if (remainder === 0) return clock;
  return `${clock}.${String(remainder).padStart(3, '0').replace(/0+$/, '')}`;
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
  if (durationMs !== undefined && durationMs !== null) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      return 'The clip times are invalid.';
    }
    if (startMs > durationMs) return 'Clip start cannot exceed the media duration.';
    if (endMs > durationMs) return 'Clip end cannot exceed the media duration.';
  }
  return null;
}

export function getMediaEndpointBoundError(
  milliseconds: number | null,
  durationMs: number | null | undefined,
  endpoint: 'start' | 'end',
): string | null {
  if (milliseconds === null || durationMs === undefined || durationMs === null) return null;
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return 'The clip times are invalid.';
  if (milliseconds <= durationMs) return null;
  return endpoint === 'start'
    ? 'Clip start cannot exceed the media duration.'
    : 'Clip end cannot exceed the media duration.';
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
