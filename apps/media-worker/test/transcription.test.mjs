import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicFakeTranscriber } from '../src/transcription/fake-transcriber.mjs';
import { buildTranscriptionAudioArguments } from '../src/transcription/derivative-audio.mjs';
import {
  MAX_SEGMENTS,
  normalizeTranscriptResult,
  normalizeTranscriptSegments,
  transcribeAndValidate,
} from '../src/transcription/transcript.mjs';

function errorCode(code) {
  return (error) => error?.stage === 'transcribing' && error?.code === code;
}

function validResult(overrides = {}) {
  return {
    text: '  A\r\n normalized\t transcript.  ',
    language: 'EN-us',
    segments: [
      { start_ms: 0, end_ms: 1_000, text: ' A ' },
      { start_ms: 999.6, end_ms: 2_000.2, text: ' normalized transcript. ' },
    ],
    provider: ' deterministic-fake ',
    model: ' fixture-v1 ',
    providerMetadata: { fixture: true, nested: { stable: true } },
    ...overrides,
  };
}

test('normalizes bounded transcript text, language, segments, and identifiers', () => {
  const result = normalizeTranscriptResult(validResult(), 2_000);
  assert.deepEqual(result, {
    transcriptText: 'A normalized transcript.',
    language: 'en-US',
    segments: [
      { start_ms: 0, end_ms: 1_000, text: 'A' },
      { start_ms: 1_000, end_ms: 2_000, text: 'normalized transcript.' },
    ],
    provider: 'deterministic-fake',
    model: 'fixture-v1',
    providerMetadata: { fixture: true, nested: { stable: true } },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.segments), true);
  assert.equal(Object.isFrozen(result.providerMetadata.nested), true);
});

test('segments may be omitted but cannot be an empty present list', () => {
  assert.equal(normalizeTranscriptSegments(null, 2_000), null);
  assert.throws(() => normalizeTranscriptSegments([], 2_000), errorCode('transcript_invalid'));
});

test('segment rounding clamps only overlap and duration drift within 20ms', () => {
  assert.deepEqual(normalizeTranscriptSegments([
    { start_ms: 0, end_ms: 1_010, text: 'first' },
    { start_ms: 1_000, end_ms: 2_015, text: 'second' },
  ], 2_000), [
    { start_ms: 0, end_ms: 1_010, text: 'first' },
    { start_ms: 1_010, end_ms: 2_000, text: 'second' },
  ]);
  assert.throws(() => normalizeTranscriptSegments([
    { start_ms: 0, end_ms: 1_050, text: 'first' },
    { start_ms: 1_000, end_ms: 1_500, text: 'second' },
  ], 2_000), errorCode('transcript_invalid'));
  assert.throws(() => normalizeTranscriptSegments([
    { start_ms: 0, end_ms: 2_021, text: 'too late' },
  ], 2_000), errorCode('transcript_invalid'));
});

for (const [name, overrides] of [
  ['blank text', { text: ' \n\t ' }],
  ['oversized text', { text: 'x'.repeat(20_001) }],
  ['invalid language', { language: 'english_US' }],
  ['blank provider', { provider: '   ' }],
  ['oversized model', { model: 'm'.repeat(201) }],
  ['array provider metadata', { providerMetadata: [] }],
  ['oversized provider metadata', { providerMetadata: { value: 'x'.repeat(16_384) } }],
  ['unknown result field', { unexpected: true }],
  ['blank segment', { segments: [{ start_ms: 0, end_ms: 1_000, text: ' ' }] }],
  ['backwards segment', { segments: [{ start_ms: 1_000, end_ms: 500, text: 'backwards' }] }],
  ['unknown segment field', { segments: [{ start_ms: 0, end_ms: 1_000, text: 'text', confidence: 1 }] }],
]) {
  test(`${name} is rejected before staging`, () => {
    assert.throws(() => normalizeTranscriptResult(validResult(overrides), 2_000), errorCode('transcript_invalid'));
  });
}

test('more than 500 segments is rejected', () => {
  const segments = Array.from({ length: MAX_SEGMENTS + 1 }, (_, index) => ({
    start_ms: index,
    end_ms: index + 1,
    text: 'x',
  }));
  assert.throws(() => normalizeTranscriptSegments(segments, 2_000), errorCode('transcript_invalid'));
});

test('raw or shape-forged input cannot reach even a malicious adapter', async () => {
  let called = false;
  const adapter = { async transcribe() { called = true; return validResult(); } };
  const forgedRawInput = Object.freeze({
    kind: 'derivative_audio_v1',
    durationMs: 2_000,
    checksumSha256: 'a'.repeat(64),
    sourceDerivativeChecksumSha256: 'b'.repeat(64),
  });
  await assert.rejects(() => transcribeAndValidate(adapter, forgedRawInput), errorCode('transcript_input_invalid'));
  assert.equal(called, false);
});

test('fake transcriber accepts only supported bounded failure codes', () => {
  assert.throws(() => new DeterministicFakeTranscriber({ failureCode: 'raw_provider_message' }), errorCode('transcription_failed'));
  const fake = new DeterministicFakeTranscriber({ response: validResult() });
  assert.equal(Object.isFrozen(fake), true);
  assert.equal(Object.isFrozen(fake.response.segments), true);
});

test('transcription audio extraction uses one fixed derivative-audio map', () => {
  const args = buildTranscriptionAudioArguments('excerpt.mp4', 'transcription.flac');
  assert.equal(args[args.indexOf('-i') + 1], 'excerpt.mp4');
  assert.equal(args[args.indexOf('-map') + 1], '0:a:0');
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'flac');
  assert.equal(args[args.indexOf('-ar') + 1], '16000');
  assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.deepEqual(args.slice(-2), ['flac', 'transcription.flac']);
});
