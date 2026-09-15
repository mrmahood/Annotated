import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_MAX_BYTE_SIZE,
  MICROPHONE_CHROME_SETTINGS_URL,
  MICROPHONE_DENIED_COPY,
  MICROPHONE_DENIED_STEPS,
  MICROPHONE_ENABLE_HEADING,
  MICROPHONE_EXTENSION_PERMISSION_COPY,
  createAudioStoragePath,
  formatAudioDuration,
  getAudioValidationError,
  getCommentaryContractError,
  getMicrophoneErrorMessage,
  getMicrophoneStartErrorKind,
  getPublishRpcName,
  hasPublishableCommentary,
  parseAnnotationAudio,
  parseMicrophonePermissionState,
  queryMicrophonePermission,
  reduceRecordingState,
  selectRecordingMimeType,
  shouldShowMicrophoneEnableGuidance,
  shouldShowMicrophoneReconnectSteps,
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

test('microphone permission helpers treat unknown and denied as proactive Enable microphone states', () => {
  assert.equal(parseMicrophonePermissionState('granted'), 'granted');
  assert.equal(parseMicrophonePermissionState('denied'), 'denied');
  assert.equal(parseMicrophonePermissionState('prompt'), 'prompt');
  assert.equal(parseMicrophonePermissionState('prompt '), 'unknown');
  assert.equal(parseMicrophonePermissionState(null), 'unknown');
  assert.equal(shouldShowMicrophoneEnableGuidance('unknown', 'idle'), true);
  assert.equal(shouldShowMicrophoneEnableGuidance('prompt', 'idle'), true);
  assert.equal(shouldShowMicrophoneEnableGuidance('denied', 'idle'), true);
  assert.equal(shouldShowMicrophoneEnableGuidance('granted', 'idle'), false);
  assert.equal(shouldShowMicrophoneEnableGuidance('granted', 'idle', true), true);
  assert.equal(shouldShowMicrophoneEnableGuidance('prompt', 'requesting_permission'), false);
  assert.equal(shouldShowMicrophoneEnableGuidance('denied', 'recording'), false);
  assert.equal(shouldShowMicrophoneEnableGuidance('denied', 'recorded'), false);
  assert.equal(shouldShowMicrophoneEnableGuidance('prompt', 'error'), false);
  assert.equal(shouldShowMicrophoneEnableGuidance('prompt', 'error', true), true);
  assert.equal(shouldShowMicrophoneReconnectSteps('prompt'), false);
  assert.equal(shouldShowMicrophoneReconnectSteps('unknown'), false);
  assert.equal(shouldShowMicrophoneReconnectSteps('granted'), false);
  assert.equal(shouldShowMicrophoneReconnectSteps('denied'), true);
  assert.equal(shouldShowMicrophoneReconnectSteps('prompt', true), true);
});

test('microphone copy names the extension permission and numbered Chrome reconnect steps', () => {
  assert.equal(MICROPHONE_ENABLE_HEADING, 'Enable microphone');
  assert.equal(MICROPHONE_CHROME_SETTINGS_URL, 'chrome://settings/content/microphone');
  assert.match(MICROPHONE_EXTENSION_PERMISSION_COPY, /Annotated extension’s microphone/);
  assert.match(MICROPHONE_EXTENSION_PERMISSION_COPY, /not the website in this tab/);
  assert.match(MICROPHONE_DENIED_COPY, /blocked for the Annotated extension/);
  assert.match(MICROPHONE_DENIED_COPY, /does not control the side panel/);
  assert.equal(MICROPHONE_DENIED_STEPS.length, 3);
  assert.match(MICROPHONE_DENIED_STEPS[0], /chrome:\/\/settings\/content\/microphone/);
  assert.match(MICROPHONE_DENIED_STEPS[0], /cannot open Chrome settings/);
  assert.match(MICROPHONE_DENIED_STEPS[1], /Annotated/);
  assert.match(MICROPHONE_DENIED_STEPS[1], /the extension, not the website you are browsing/);
  assert.match(MICROPHONE_DENIED_STEPS[2], /Enable microphone or Record again/);
});

test('microphone start errors classify denied, missing, and busy devices', () => {
  assert.equal(getMicrophoneStartErrorKind(new DOMException('denied', 'NotAllowedError')), 'denied');
  assert.equal(getMicrophoneStartErrorKind(new DOMException('blocked', 'SecurityError')), 'denied');
  assert.equal(getMicrophoneStartErrorKind(new DOMException('missing', 'NotFoundError')), 'not-found');
  assert.equal(getMicrophoneStartErrorKind(new DOMException('busy', 'NotReadableError')), 'unavailable');
  assert.equal(getMicrophoneStartErrorKind(new DOMException('abort', 'AbortError')), 'unavailable');
  assert.equal(getMicrophoneStartErrorKind(new Error('nope')), 'generic');
  assert.equal(getMicrophoneErrorMessage(new DOMException('denied', 'NotAllowedError')), MICROPHONE_DENIED_COPY);
  assert.match(getMicrophoneErrorMessage(new DOMException('missing', 'NotFoundError')), /publish without audio/);
  assert.match(getMicrophoneErrorMessage(new DOMException('busy', 'NotReadableError')), /already in use/);
  assert.match(getMicrophoneErrorMessage(new Error('nope')), /retry or publish without audio/);
});

test('microphone permission query falls back to unknown when unsupported', async () => {
  assert.equal(await queryMicrophonePermission(null), 'unknown');
  assert.equal(await queryMicrophonePermission(undefined), 'unknown');
  assert.equal(await queryMicrophonePermission(async () => ({ state: 'granted' })), 'granted');
  assert.equal(await queryMicrophonePermission(async () => ({ state: 'denied' })), 'denied');
  assert.equal(await queryMicrophonePermission(async () => ({ state: 'prompt' })), 'prompt');
  assert.equal(await queryMicrophonePermission(async () => ({ state: 'unsupported' })), 'unknown');
  assert.equal(await queryMicrophonePermission(async () => {
    throw new TypeError('microphone is not a valid enum value of type PermissionName');
  }), 'unknown');
});
