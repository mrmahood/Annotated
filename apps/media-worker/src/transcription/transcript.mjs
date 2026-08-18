import { MediaCoreError, mediaCoreFailure } from '../domain/media-core-error.mjs';
import { verifyDerivativeAudioInput } from './derivative-audio.mjs';

export const MAX_TRANSCRIPT_CHARACTERS = 20_000;
export const MAX_SEGMENTS = 500;
export const MAX_SEGMENT_CHARACTERS = 2_000;
export const MAX_SEGMENTS_JSON_BYTES = 65_536;
export const MAX_PROVIDER_METADATA_JSON_BYTES = 16_384;
export const SEGMENT_ROUNDING_TOLERANCE_MS = 20;

function characterLength(value) {
  return [...value].length;
}

function normalizePlainText(value, label, maximum) {
  if (typeof value !== 'string') mediaCoreFailure('transcribing', 'transcript_invalid', `${label} must be text.`);
  const normalized = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized || characterLength(normalized) > maximum) {
    mediaCoreFailure('transcribing', 'transcript_invalid', `${label} is blank or exceeds its bound.`);
  }
  return normalized;
}

function normalizeLanguage(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcript language is invalid.');
  const parts = value.trim().split('-');
  const normalized = parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[A-Za-z]{2}$/u.test(part)) return part.toUpperCase();
    return part;
  }).join('-');
  if (normalized.length < 2 || normalized.length > 35 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(normalized)) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcript language is invalid.');
  }
  return normalized;
}

function boundedIdentifier(value, label, maximum) {
  return normalizePlainText(value, label, maximum);
}

function deepFreezeJson(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      mediaCoreFailure('transcribing', 'transcript_invalid', 'Provider metadata contains a forbidden key.');
    }
    deepFreezeJson(child, seen);
  }
  return Object.freeze(value);
}

function normalizeProviderMetadata(value) {
  if (value === undefined || value === null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Provider metadata must be an object.');
  }
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Provider metadata is not JSON serializable.');
  }
  if (!json || Buffer.byteLength(json, 'utf8') > MAX_PROVIDER_METADATA_JSON_BYTES) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Provider metadata exceeds its bound.');
  }
  const normalized = JSON.parse(json);
  return deepFreezeJson(normalized);
}

function finiteTimestamp(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 90_020) {
    mediaCoreFailure('transcribing', 'transcript_invalid', `${label} is invalid.`);
  }
  return Math.round(value);
}

export function normalizeTranscriptSegments(value, durationMs) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SEGMENTS) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcript segments must be a nonempty bounded array.');
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 90_000) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Derivative duration is invalid.');
  }

  const segments = [];
  let previousEnd = 0;
  for (const [index, source] of value.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      mediaCoreFailure('transcribing', 'transcript_invalid', `Segment ${index} is invalid.`);
    }
    const keys = Object.keys(source).sort();
    if (keys.length !== 3 || keys[0] !== 'end_ms' || keys[1] !== 'start_ms' || keys[2] !== 'text') {
      mediaCoreFailure('transcribing', 'transcript_invalid', `Segment ${index} has unsupported fields.`);
    }
    let startMs = finiteTimestamp(source.start_ms, `Segment ${index} start`);
    let endMs = finiteTimestamp(source.end_ms, `Segment ${index} end`);
    if (startMs < previousEnd) {
      if (previousEnd - startMs > SEGMENT_ROUNDING_TOLERANCE_MS) {
        mediaCoreFailure('transcribing', 'transcript_invalid', `Segment ${index} overlaps the previous segment.`);
      }
      startMs = previousEnd;
    }
    if (endMs > durationMs) {
      if (endMs - durationMs > SEGMENT_ROUNDING_TOLERANCE_MS) {
        mediaCoreFailure('transcribing', 'transcript_invalid', `Segment ${index} exceeds derivative duration.`);
      }
      endMs = Math.floor(durationMs);
    }
    if (endMs <= startMs) mediaCoreFailure('transcribing', 'transcript_invalid', `Segment ${index} has no positive duration.`);
    const text = normalizePlainText(source.text, `Segment ${index} text`, MAX_SEGMENT_CHARACTERS);
    const segment = Object.freeze({ start_ms: startMs, end_ms: endMs, text });
    segments.push(segment);
    previousEnd = endMs;
  }

  if (Buffer.byteLength(JSON.stringify(segments), 'utf8') > MAX_SEGMENTS_JSON_BYTES) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcript segments exceed their JSON bound.');
  }
  return Object.freeze(segments);
}

export function normalizeTranscriptResult(value, durationMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcriber result is invalid.');
  }
  const allowed = new Set(['text', 'language', 'segments', 'provider', 'model', 'providerMetadata']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    mediaCoreFailure('transcribing', 'transcript_invalid', 'Transcriber result contains unsupported fields.');
  }
  return Object.freeze({
    transcriptText: normalizePlainText(value.text, 'Transcript text', MAX_TRANSCRIPT_CHARACTERS),
    language: normalizeLanguage(value.language),
    segments: normalizeTranscriptSegments(value.segments, durationMs),
    provider: boundedIdentifier(value.provider, 'Provider', 100),
    model: boundedIdentifier(value.model, 'Model', 200),
    providerMetadata: normalizeProviderMetadata(value.providerMetadata),
  });
}

const allowedProviderFailures = new Set(['provider_timeout', 'provider_rate_limited', 'transcription_failed']);

export async function transcribeAndValidate(transcriber, derivativeAudioInput) {
  await verifyDerivativeAudioInput(derivativeAudioInput);
  if (!transcriber || typeof transcriber.transcribe !== 'function') {
    mediaCoreFailure('transcribing', 'transcription_failed', 'Transcriber is unavailable.');
  }
  let result;
  try {
    result = await transcriber.transcribe(derivativeAudioInput);
  } catch (error) {
    if (error instanceof MediaCoreError && error.stage === 'transcribing' && allowedProviderFailures.has(error.code)) throw error;
    throw new MediaCoreError('transcribing', 'transcription_failed', 'Transcriber execution failed.');
  }
  const durationMs = derivativeAudioInput?.durationMs;
  return normalizeTranscriptResult(result, durationMs);
}
