import { MediaCoreError, mediaCoreFailure } from '../domain/media-core-error.mjs';
import { assertDerivativeAudioInput } from './derivative-audio.mjs';

const supportedFailures = new Set(['provider_timeout', 'provider_rate_limited', 'transcription_failed']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export class DeterministicFakeTranscriber {
  constructor(options = {}) {
    if (options.failureCode && !supportedFailures.has(options.failureCode)) {
      mediaCoreFailure('transcribing', 'transcription_failed', 'Fake failure code is invalid.');
    }
    this.response = deepFreeze(clone(options.response));
    this.failureCode = options.failureCode ?? null;
    Object.freeze(this);
  }

  async transcribe(input) {
    assertDerivativeAudioInput(input);
    if (this.failureCode) throw new MediaCoreError('transcribing', this.failureCode, 'Deterministic fake failure.');
    if (this.response !== undefined) return clone(this.response);

    const midpoint = Math.max(1, Math.floor(input.durationMs / 2));
    const end = Math.max(midpoint + 1, Math.floor(input.durationMs));
    const fingerprint = input.checksumSha256.slice(0, 16);
    return {
      text: `Synthetic excerpt ${fingerprint}.`,
      language: 'en',
      segments: [
        { start_ms: 0, end_ms: midpoint, text: 'Synthetic excerpt' },
        { start_ms: midpoint, end_ms: end, text: fingerprint },
      ],
      provider: 'deterministic-fake',
      model: 'fixture-v1',
      providerMetadata: { audio_sha256: input.checksumSha256 },
    };
  }
}
