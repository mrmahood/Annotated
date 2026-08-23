import { MediaCoreError, mediaCoreFailure } from '../domain/media-core-error.mjs';
import { assertDerivativeAudioInput, readDerivativeAudioBytes } from './derivative-audio.mjs';

export const OPENAI_WHISPER_MODEL = 'whisper-1';
export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const OPENAI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const ISO_LANGUAGE_CODES = new Set([
  'ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko',
  'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sv', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'zh',
]);
const WHISPER_LANGUAGE_NAMES = new Map([
  ['arabic', 'ar'], ['chinese', 'zh'], ['czech', 'cs'], ['danish', 'da'], ['dutch', 'nl'], ['english', 'en'],
  ['farsi', 'fa'], ['finnish', 'fi'], ['french', 'fr'], ['german', 'de'], ['greek', 'el'], ['hebrew', 'he'],
  ['hindi', 'hi'], ['hungarian', 'hu'], ['indonesian', 'id'], ['italian', 'it'], ['japanese', 'ja'],
  ['korean', 'ko'], ['malay', 'ms'], ['norwegian', 'no'], ['persian', 'fa'], ['polish', 'pl'],
  ['portuguese', 'pt'], ['romanian', 'ro'], ['russian', 'ru'], ['spanish', 'es'], ['swedish', 'sv'],
  ['tamil', 'ta'], ['thai', 'th'], ['turkish', 'tr'], ['ukrainian', 'uk'], ['urdu', 'ur'],
  ['vietnamese', 'vi'],
]);

function providerFailure(code) {
  throw new MediaCoreError('transcribing', code, 'Transcription provider request failed.');
}

function languageCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (ISO_LANGUAGE_CODES.has(normalized)) return normalized;
  return WHISPER_LANGUAGE_NAMES.get(normalized) ?? null;
}

function milliseconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) providerFailure('transcription_failed');
  return value * 1000;
}

export function mapWhisperVerboseResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string') {
    providerFailure('transcription_failed');
  }
  if (!Array.isArray(value.segments) || value.segments.length < 1) providerFailure('transcription_failed');
  const segments = value.segments.map((segment) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment) || typeof segment.text !== 'string') {
      providerFailure('transcription_failed');
    }
    return { start_ms: milliseconds(segment.start), end_ms: milliseconds(segment.end), text: segment.text };
  });
  return {
    text: value.text,
    language: languageCode(value.language),
    segments,
    provider: 'openai',
    model: OPENAI_WHISPER_MODEL,
    providerMetadata: {
      response_format: 'verbose_json',
      timestamp_granularity: 'segment',
    },
  };
}

export class OpenAIWhisperTranscriber {
  constructor({ apiKey, fetchImpl = globalThis.fetch, endpoint = OPENAI_TRANSCRIPTIONS_URL, timeoutMs = 120_000 } = {}) {
    if (typeof apiKey !== 'string' || Buffer.byteLength(apiKey, 'utf8') < 32 || Buffer.byteLength(apiKey, 'utf8') > 512) {
      throw new TypeError('OpenAI API key is invalid.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('OpenAI fetch implementation is unavailable.');
    if (endpoint !== OPENAI_TRANSCRIPTIONS_URL) throw new TypeError('OpenAI transcription endpoint is not approved.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 180_000) {
      throw new TypeError('OpenAI timeout must be between 10,000 and 180,000 milliseconds.');
    }
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    Object.freeze(this);
  }

  async transcribe(input) {
    assertDerivativeAudioInput(input);
    if (input.byteSize > OPENAI_MAX_AUDIO_BYTES) {
      mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Derivative transcription audio exceeds the provider limit.');
    }
    const bytes = await readDerivativeAudioBytes(input);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/flac' }), 'excerpt.flac');
    form.append('model', OPENAI_WHISPER_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') providerFailure('provider_timeout');
      providerFailure('transcription_failed');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) providerFailure('provider_rate_limited');
    if ([408, 504].includes(response.status)) providerFailure('provider_timeout');
    if (!response.ok) providerFailure('transcription_failed');
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) providerFailure('transcription_failed');
    let text;
    try { text = await response.text(); }
    catch { providerFailure('transcription_failed'); }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) providerFailure('transcription_failed');
    let value;
    try { value = JSON.parse(text); }
    catch { providerFailure('transcription_failed'); }
    return mapWhisperVerboseResponse(value);
  }
}
