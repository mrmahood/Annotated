import { getOptionalText, isUuid } from './social-helpers.ts';

const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const AUDIO_MAX_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_MAX_LENGTH = 20_000;
const TRANSCRIPT_SEGMENT_MAX_LENGTH = 2_000;
const TRANSCRIPT_SEGMENT_LIMIT = 500;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 90_000;
// Matches worker/SQL DERIVATIVE_DURATION_TOLERANCE_MS (100 ms, ~4.7 AAC-LC frames).
export const DURATION_SLACK_MS = 100;

type UnknownRecord = Record<string, unknown>;

export type HostedExcerptMedia = {
  id: string;
  mimeType: 'video/mp4' | 'audio/mp4';
  durationMs: number;
  width: number | null;
  height: number | null;
};

export type HostedExcerptTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type HostedExcerptTranscript = {
  text: string;
  language: string | null;
  segments: HostedExcerptTranscriptSegment[] | null;
};

export type HostedExcerpt =
  | {
      status: 'ready';
      media: HostedExcerptMedia;
      transcript: HostedExcerptTranscript | null;
    }
  | { status: 'removed' };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

export function getMediaPlaybackPath(annotationId: string, attempt = 0): string {
  if (!isUuid(annotationId) || !safeIntegerIn(attempt, 0, 1)) {
    throw new Error('Invalid media playback identity.');
  }
  return `/api/media/playback/${annotationId}?attempt=${attempt}`;
}

export function parsePublicTranscript(
  value: unknown,
  annotationId: string,
  durationMs: number,
): HostedExcerptTranscript | null {
  if (!isRecord(value) || value.annotation_id !== annotationId) return null;
  const text = getOptionalText(value.transcript_text);
  const language = value.language === null ? null : getOptionalText(value.language);
  if (
    !text ||
    text.length > TRANSCRIPT_MAX_LENGTH ||
    (language !== null && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
  ) return null;

  if (value.segments === null) return { text, language, segments: null };
  if (!Array.isArray(value.segments) || value.segments.length > TRANSCRIPT_SEGMENT_LIMIT) {
    return null;
  }

  const segments: HostedExcerptTranscriptSegment[] = [];
  let previousEnd = 0;
  for (const candidate of value.segments) {
    if (!isRecord(candidate) || Object.keys(candidate).sort().join(',') !== 'end_ms,start_ms,text') {
      return null;
    }
    const segmentText = getOptionalText(candidate.text);
    if (
      !segmentText ||
      segmentText.length > TRANSCRIPT_SEGMENT_MAX_LENGTH ||
      !safeIntegerIn(candidate.start_ms, previousEnd, durationMs) ||
      !safeIntegerIn(candidate.end_ms, (candidate.start_ms as number) + 1, durationMs)
    ) return null;
    segments.push({
      startMs: candidate.start_ms as number,
      endMs: candidate.end_ms as number,
      text: segmentText,
    });
    previousEnd = candidate.end_ms as number;
  }
  return { text, language, segments };
}

function parseReadyMedia(
  value: UnknownRecord,
  annotationId: string,
  expectedType: 'video' | 'audio',
  targetDurationMs: number,
): HostedExcerptMedia | null {
  if (
    value.annotation_id !== annotationId ||
    !isUuid(String(value.media_id ?? '')) ||
    value.media_type !== expectedType ||
    value.availability !== 'ready' ||
    !safeIntegerIn(
      value.duration_ms,
      Math.max(MIN_DURATION_MS, targetDurationMs - DURATION_SLACK_MS),
      Math.min(MAX_DURATION_MS, targetDurationMs + DURATION_SLACK_MS),
    )
  ) return null;

  if (expectedType === 'video') {
    if (
      value.mime_type !== 'video/mp4' ||
      !safeIntegerIn(value.width, 2, 8192) ||
      !safeIntegerIn(value.height, 2, 8192) ||
      !safeIntegerIn(value.byte_size, 1, VIDEO_MAX_BYTES)
    ) return null;
    return {
      id: value.media_id as string,
      mimeType: 'video/mp4',
      durationMs: value.duration_ms as number,
      width: value.width as number,
      height: value.height as number,
    };
  }

  if (
    value.mime_type !== 'audio/mp4' ||
    value.width !== null ||
    value.height !== null ||
    !safeIntegerIn(value.byte_size, 1, AUDIO_MAX_BYTES)
  ) return null;
  return {
    id: value.media_id as string,
    mimeType: 'audio/mp4',
    durationMs: value.duration_ms as number,
    width: null,
    height: null,
  };
}

function isRemovedMedia(
  value: UnknownRecord,
  annotationId: string,
  expectedType: 'video' | 'audio',
): boolean {
  return value.annotation_id === annotationId &&
    isUuid(String(value.media_id ?? '')) &&
    value.media_type === expectedType &&
    value.availability === 'removed' &&
    value.mime_type === null &&
    value.duration_ms === null &&
    value.width === null &&
    value.height === null &&
    value.byte_size === null;
}

export function parsePublicHostedExcerpt(
  mediaStateValue: unknown,
  transcriptValue: unknown,
  annotationId: string,
  expectedType: 'video' | 'audio',
  targetDurationMs: number,
): HostedExcerpt | null {
  if (mediaStateValue === null || !isRecord(mediaStateValue)) return null;
  if (isRemovedMedia(mediaStateValue, annotationId, expectedType)) {
    return transcriptValue === null ? { status: 'removed' } : null;
  }
  const media = parseReadyMedia(mediaStateValue, annotationId, expectedType, targetDurationMs);
  if (!media) return null;
  const transcript = parsePublicTranscript(transcriptValue, annotationId, media.durationMs);
  return { status: 'ready', media, transcript };
}

export function isHostedExcerptReady(
  hosted: HostedExcerpt | null,
): hosted is Extract<HostedExcerpt, { status: 'ready' }> {
  return hosted?.status === 'ready';
}

export function hasHostedExcerptTranscript(
  transcript: HostedExcerptTranscript | null | undefined,
): transcript is HostedExcerptTranscript {
  return typeof transcript?.text === 'string' && transcript.text.length > 0;
}
