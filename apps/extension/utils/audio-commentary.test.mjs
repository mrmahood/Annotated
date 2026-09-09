import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_MAX_BYTE_SIZE,
  createAudioStoragePath,
  formatAudioDuration,
  getAudioValidationError,
  getCommentaryContractError,
  getPublishRpcName,
  hasPublishableCommentary,
  parseAnnotationAudio,
  reduceRecordingState,
  selectRecordingMimeType,
} from './audio-commentary.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

test('formats compact audio durations', () => {
  assert.equal(formatAudioDuration(0), '0:00');
  assert.equal(formatAudioDuration(1_001), '0:02');
  assert.equal(formatAudioDuration(101_001), '1:42');
  assert.equal(formatAudioDuration(300_000), '5:00');
});

test('selects preferred WebM Opus and falls back only to WebM', () => {
  assert.equal(
    selectRecordingMimeType((value) => value === 'audio/webm;codecs=opus'),
    'audio/webm;codecs=opus',
  );
  assert.equal(
    selectRecordingMimeType((value) => value === 'audio/webm'),
    'audio/webm',
  );
  assert.equal(selectRecordingMimeType(() => false), null);
});

test('validates duration, byte size, and stored MIME', () => {
  assert.match(getAudioValidationError(new Blob(['x'], { type: 'audio/webm' }), 999), /at least 1 second/);
  assert.match(getAudioValidationError({ size: AUDIO_MAX_BYTE_SIZE + 1, type: 'audio/webm' }, 1_000), /6 MiB/);
  assert.match(getAudioValidationError(new Blob(['x'], { type: 'audio/mpeg' }), 1_000), /WebM/);
  assert.equal(getAudioValidationError(new Blob(['x'], { type: 'audio/webm' }), 1_000), null);
});

test('generates an opaque owned WebM object path', () => {
  assert.equal(
    createAudioStoragePath(USER_ID, () => FILE_ID),
    `${USER_ID}/${FILE_ID}.webm`,
  );
  assert.throws(() => createAudioStoragePath('not-a-user', () => FILE_ID));
});

test('safely parses optional public audio metadata', () => {
  assert.deepEqual(parseAnnotationAudio({
    storage_path: `${USER_ID}/${FILE_ID}.webm`,
    duration_ms: 62_000,
    mime_type: 'audio/webm',
    byte_size: 2_048,
  }), {
    storagePath: `${USER_ID}/${FILE_ID}.webm`,
    durationMs: 62_000,
    mimeType: 'audio/webm',
    byteSize: 2_048,
  });
  assert.equal(parseAnnotationAudio([]), null);
  assert.equal(parseAnnotationAudio({ storage_path: 'https://evil.test/audio.webm' }), null);
});

test('recording reducer ignores stale transitions and supports discard', () => {
  const idle = { status: 'idle' };
  assert.deepEqual(reduceRecordingState(idle, { type: 'start' }), idle);
  const requesting = reduceRecordingState(idle, { type: 'request' });
  assert.deepEqual(reduceRecordingState(requesting, { type: 'start' }), {
    status: 'recording', elapsedMs: 0,
  });
  assert.deepEqual(reduceRecordingState(requesting, { type: 'discard' }), idle);
});

test('text and audio publications route to separate RPCs', () => {
  assert.equal(getPublishRpcName(false), 'publish_article_annotation');
  assert.equal(getPublishRpcName(true), 'publish_article_annotation_with_audio');
});

test('publish gating requires typed commentary, a recorded clip, or both', () => {
  assert.equal(hasPublishableCommentary('', false), false);
  assert.equal(hasPublishableCommentary('   ', false), false);
  assert.equal(hasPublishableCommentary('Noted.', false), true);
  assert.equal(hasPublishableCommentary('', true), true);
  assert.equal(hasPublishableCommentary('Noted.', true), true);
  assert.match(getCommentaryContractError('', false), /typed commentary, a voice clip, or both/);
  assert.match(getCommentaryContractError('x'.repeat(2_001), true), /2,000/);
  assert.equal(getCommentaryContractError('', true), null);
});
