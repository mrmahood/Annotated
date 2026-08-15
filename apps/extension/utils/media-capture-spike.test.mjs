import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_CAPTURE_FIXED_DURATION_MS,
  MEDIA_CAPTURE_MAX_DURATION_MS,
  captureRequestMatchesConnectedTab,
  getCaptureDurationError,
  getMediaCaptureEligibility,
  getCaptureTrackExpectation,
  hasCompleteCaptureCleanup,
  isCaptureStartRequest,
  isMediaCaptureStartMessage,
  isOffscreenStartMessage,
  reduceCaptureUiState,
  selectCaptureMimeType,
  sourceIdentityMatchesUrl,
} from './media-capture-spike.ts';

const youtubeSource = {
  kind: 'youtube',
  pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  sourceKey: 'abcdefghijk',
};

const request = {
  source: youtubeSource,
  tabId: 42,
  intent: { kind: 'selected-range', startMs: 5_000, endMs: 20_000 },
};

test('validates explicit fixed-duration and selected-range capture intents', () => {
  assert.equal(getCaptureDurationError(1_000, 1_000 + MEDIA_CAPTURE_MAX_DURATION_MS), null);
  assert.match(getCaptureDurationError(1_000, 1_001 + MEDIA_CAPTURE_MAX_DURATION_MS), /90-second/);
  assert.equal(isCaptureStartRequest(request), true);
  assert.equal(isCaptureStartRequest({
    ...request,
    intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
  }), true);
  assert.equal(isCaptureStartRequest({
    ...request,
    intent: { kind: 'selected-range', startMs: 5_000 },
  }), false);
  assert.equal(isCaptureStartRequest({
    ...request,
    intent: { kind: 'selected-range', startMs: 5_000, endMs: 5_999 },
  }), false);
  assert.equal(isCaptureStartRequest({
    ...request,
    intent: { kind: 'selected-range', startMs: 5_000, endMs: 5_001 + MEDIA_CAPTURE_MAX_DURATION_MS },
  }), false);
  assert.equal(isCaptureStartRequest({
    ...request,
    intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_MAX_DURATION_MS + 1 },
  }), false);
  assert.equal(isCaptureStartRequest({ ...request, intent: { kind: 'automatic' } }), false);
  assert.equal(isCaptureStartRequest({ ...request, intent: null }), false);
});

test('fixed-duration start message survives the real runtime message validator unchanged', () => {
  const message = {
    target: 'background',
    type: 'annotated.mediaCaptureSpike.start.v1',
    request: {
      ...request,
      intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
    },
  };
  assert.equal(isMediaCaptureStartMessage(message), true);
  assert.deepEqual(message.request.intent, { kind: 'fixed-duration', durationMs: 15_000 });
});

test('selected-range start message survives the real runtime message validator unchanged', () => {
  const message = {
    target: 'background',
    type: 'annotated.mediaCaptureSpike.start.v1',
    request,
  };
  assert.equal(isMediaCaptureStartMessage(message), true);
  assert.deepEqual(message.request.intent, { kind: 'selected-range', startMs: 5_000, endMs: 20_000 });
});

test('runtime validator rejects malformed discriminants and malformed intent payloads', () => {
  const message = { target: 'background', type: 'annotated.mediaCaptureSpike.start.v1', request };
  assert.equal(isMediaCaptureStartMessage({
    ...message,
    request: { ...request, intent: { kind: 'automatic', durationMs: 15_000 } },
  }), false);
  assert.equal(isMediaCaptureStartMessage({
    ...message,
    request: { ...request, intent: { kind: 'fixed-duration' } },
  }), false);
  assert.equal(isMediaCaptureStartMessage({
    ...message,
    request: { ...request, intent: { kind: 'fixed-duration', durationMs: '15000' } },
  }), false);
  assert.equal(isMediaCaptureStartMessage({
    ...message,
    request: { ...request, intent: { kind: 'selected-range', startMs: 5_000 } },
  }), false);
  assert.equal(isMediaCaptureStartMessage({
    ...message,
    request: { ...request, intent: { kind: 'selected-range', startMs: 20_000, endMs: 5_000 } },
  }), false);
});

test('selects preferred supported video and audio WebM MIME types', () => {
  assert.equal(
    selectCaptureMimeType(true, (value) => value === 'video/webm;codecs=vp8,opus'),
    'video/webm;codecs=vp8,opus',
  );
  assert.equal(
    selectCaptureMimeType(false, (value) => value === 'audio/webm'),
    'audio/webm',
  );
  assert.equal(selectCaptureMimeType(true, () => false), null);
});

test('distinguishes video and audio capture track expectations', () => {
  assert.deepEqual(getCaptureTrackExpectation('youtube'), { audioRequired: true, videoRequired: true });
  assert.deepEqual(getCaptureTrackExpectation('video'), { audioRequired: true, videoRequired: true });
  assert.deepEqual(getCaptureTrackExpectation('audio'), { audioRequired: true, videoRequired: false });
});

test('binds capture to the connected tab and stable source identity', () => {
  const connected = { tabId: 42, url: youtubeSource.pageUrl };
  assert.equal(captureRequestMatchesConnectedTab(request, connected, { id: 42, url: `${youtubeSource.pageUrl}&t=10s` }), true);
  assert.equal(captureRequestMatchesConnectedTab(request, connected, { id: 43, url: youtubeSource.pageUrl }), false);
  assert.equal(captureRequestMatchesConnectedTab(request, connected, { id: 42, url: 'https://www.youtube.com/watch?v=other-video' }), false);
  assert.equal(sourceIdentityMatchesUrl(youtubeSource, 'https://m.youtube.com/watch?v=abcdefghijk&t=20'), true);
});

test('blocks capture without a connected source', () => {
  assert.deepEqual(getMediaCaptureEligibility({
    source: 'not-connected',
    connectedTab: 'missing',
    sourceIdentity: 'unknown',
    player: 'not-found',
  }), {
    eligible: false,
    blockedReason: 'No supported connected media source.',
  });
});

test('blocks capture when the connected source identity changed', () => {
  const result = getMediaCaptureEligibility({
    source: 'youtube',
    connectedTab: 'connected',
    sourceIdentity: 'mismatch',
    player: 'ready',
  });
  assert.equal(result.eligible, false);
  assert.match(result.blockedReason, /no longer matches/);
});

test('blocks unsupported sources even when a tab is connected', () => {
  const result = getMediaCaptureEligibility({
    source: 'unsupported',
    connectedTab: 'connected',
    sourceIdentity: 'match',
    player: 'not-found',
  });
  assert.equal(result.eligible, false);
  assert.match(result.blockedReason, /No supported media player/);
});

test('enables capture only for a valid supported connected source', () => {
  assert.deepEqual(getMediaCaptureEligibility({
    source: 'youtube',
    connectedTab: 'connected',
    sourceIdentity: 'match',
    player: 'ready',
  }), { eligible: true, blockedReason: null });
});

test('capture state transitions reject stale events and report cleanup completeness', () => {
  const preparing = reduceCaptureUiState({ status: 'idle' }, { type: 'prepare', captureId: 'pending' });
  const recording = reduceCaptureUiState(preparing, {
    type: 'event',
    snapshot: { status: 'recording', captureId: 'capture-a', requestedDurationMs: 15_000 },
  });
  assert.equal(recording.status, 'recording');
  assert.equal(hasCompleteCaptureCleanup(recording), false);
  const stale = reduceCaptureUiState(recording, {
    type: 'event',
    snapshot: { status: 'cancelled', captureId: 'capture-b', code: 'unexpected', message: 'stale' },
  });
  assert.deepEqual(stale, recording);
  assert.equal(hasCompleteCaptureCleanup({ status: 'cancelled', captureId: 'capture-a', code: 'unexpected', message: 'done' }), true);
});

test('rejects malformed offscreen start messages', () => {
  const valid = {
    target: 'offscreen',
    type: 'annotated.mediaCaptureSpike.offscreenStart.v1',
    captureId: 'capture-123',
    streamId: 'stream-id',
    prepared: {
      sourceKind: 'youtube',
      requestedStartMs: 5_000,
      requestedEndMs: 20_000,
      requestedDurationMs: 15_000,
      playerCurrentTimeBeforeRecordingMs: 5_000,
      mediaDurationMs: 60_000,
      pageUrl: youtubeSource.pageUrl,
      geometry: {
        viewportWidth: 1280,
        viewportHeight: 720,
        devicePixelRatio: 1,
        boundingClientRect: {
          x: 10,
          y: 20,
          width: 960,
          height: 540,
          top: 20,
          right: 970,
          bottom: 560,
          left: 10,
        },
        videoWidth: 1920,
        videoHeight: 1080,
        objectFit: 'contain',
        objectPosition: '50% 50%',
        fullscreen: false,
        fullscreenElement: null,
        scrollX: 0,
        scrollY: 0,
      },
    },
  };
  assert.equal(isOffscreenStartMessage(valid), true);
  assert.equal(isOffscreenStartMessage({ ...valid, streamId: '' }), false);
  assert.equal(isOffscreenStartMessage({ ...valid, prepared: { ...valid.prepared, geometry: {} } }), false);
  assert.equal(isOffscreenStartMessage({ ...valid, prepared: { ...valid.prepared, requestedDurationMs: 90_001 } }), false);
  assert.equal(isOffscreenStartMessage({ ...valid, prepared: { ...valid.prepared, sourceKind: 'screen' } }), false);
});
