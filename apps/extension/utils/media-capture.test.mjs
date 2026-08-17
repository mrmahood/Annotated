import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MEDIA_CAPTURE_FAILSAFE_MS,
  MEDIA_CAPTURE_START,
  captureRequestMatchesConnectedTab,
  executeHostedMediaUpload,
  getCaptureRangeError,
  isCaptureStartRequest,
  isCurrentCaptureId,
  isMediaCaptureStartMessage,
  isOffscreenStartMessage,
  selectCaptureMimeType,
  sourceIdentityMatchesUrl,
} from './media-capture.ts';
import { installMediaCapture } from './media-capture-background.ts';

const operation = {
  annotationId: '11111111-1111-4111-8111-111111111111',
  mediaId: '22222222-2222-4222-8222-222222222222',
  creatorHandle: 'creator',
  annotationSlug: 'clip-11111111',
  processingStatus: 'capture_pending',
};
const source = {
  kind: 'youtube',
  pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  sourceKey: 'abcdefghijk',
};
const request = {
  tabId: 42,
  source,
  startMs: 5_000,
  endMs: 20_000,
  operation,
  accessToken: 'a'.repeat(40),
  apiOrigin: 'http://localhost:3000',
};

test('selected range accepts exactly 90 seconds and rejects 90,001 ms', () => {
  assert.equal(getCaptureRangeError(0, 1_000), null);
  assert.equal(getCaptureRangeError(1_000, 91_000), null);
  assert.match(getCaptureRangeError(1_000, 91_001), /90 seconds/);
  assert.match(getCaptureRangeError(1_000, 1_999), /at least one second/);
});

test('stale capture identifiers are rejected before capture can advance', () => {
  assert.equal(isCurrentCaptureId('capture-current', 'capture-current'), true);
  assert.equal(isCurrentCaptureId('capture-new', 'capture-old'), false);
  assert.equal(isCurrentCaptureId(null, 'capture-old'), false);
});

test('tabCapture is never requested when top-frame preparation fails', async () => {
  let onMessage;
  let tabCaptureCalls = 0;
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async () => undefined,
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
    storage: { session: {
      async get(key) {
        return key === 'annotatedActiveTabContext'
          ? { [key]: { tabId: 42, windowId: 1, title: 'Video', url: source.pageUrl, capturedAt: 1 } }
          : {};
      },
      async set() {}, async remove() {},
    } },
    tabs: {
      async get() { return { id: 42, url: source.pageUrl }; },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    scripting: { async executeScript() {
      return [{ frameId: 0, result: { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Player missing.' } }];
    } },
    tabCapture: { async getMediaStreamId() { tabCaptureCalls += 1; return 'must-not-run'; } },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);
  const response = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(response.ok, false);
  assert.equal(response.snapshot.diagnosticCode, 'PLAYER_NOT_FOUND');
  assert.equal(tabCaptureCalls, 0);
});

test('runtime request validation requires every explicit production field', () => {
  assert.equal(isCaptureStartRequest(request), true);
  assert.equal(isMediaCaptureStartMessage({
    target: 'background', type: MEDIA_CAPTURE_START, request,
  }), true);
  assert.equal(isCaptureStartRequest({ ...request, endMs: undefined }), false);
  assert.equal(isCaptureStartRequest({ ...request, source: { ...source, kind: undefined } }), false);
  assert.equal(isCaptureStartRequest({ ...request, operation: { ...operation, mediaId: undefined } }), false);
  assert.equal(isCaptureStartRequest({ ...request, accessToken: undefined }), false);
});

test('capture binds the exact connected tab and stable source identity', () => {
  assert.equal(captureRequestMatchesConnectedTab(
    request,
    { tabId: 42, url: source.pageUrl },
    { id: 42, url: `${source.pageUrl}&t=20s` },
  ), true);
  assert.equal(captureRequestMatchesConnectedTab(
    request,
    { tabId: 42, url: source.pageUrl },
    { id: 42, url: 'https://www.youtube.com/watch?v=other-video' },
  ), false);
  assert.equal(sourceIdentityMatchesUrl(source, 'https://m.youtube.com/watch?v=abcdefghijk&t=10'), true);
});

test('offscreen messages reject stale or malformed ranges and carry no inferred mode', () => {
  const prepared = {
    sourceKind: 'youtube',
    requestedStartMs: 5_000,
    requestedEndMs: 20_000,
    requestedDurationMs: 15_000,
    playerCurrentTimeBeforeRecordingMs: 5_000,
    mediaDurationMs: 120_000,
    pageUrl: source.pageUrl,
    geometry: {
      viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
      boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
      videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
      fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
    },
  };
  const message = {
    target: 'offscreen',
    type: 'annotated.mediaCapture.offscreenStart.v1',
    captureId: 'capture-123',
    streamId: 'stream',
    request,
    prepared,
  };
  assert.equal(isOffscreenStartMessage(message), true);
  assert.equal(isOffscreenStartMessage({ ...message, prepared: { ...prepared, requestedEndMs: 20_001 } }), false);
  assert.equal(isOffscreenStartMessage({ ...message, captureId: 'stale' }), false);
});

test('uses WebM MIME fallback and a hard 92-second failsafe', () => {
  assert.equal(selectCaptureMimeType(true, (mime) => mime.includes('vp8')), 'video/webm;codecs=vp8,opus');
  assert.equal(selectCaptureMimeType(false, (mime) => mime === 'audio/webm'), 'audio/webm');
  assert.equal(selectCaptureMimeType(true, () => false), null);
  assert.equal(MEDIA_CAPTURE_FAILSAFE_MS, 92_000);
});

test('authorize failure cannot advance upload or completion to a processing claim', async () => {
  const calls = [];
  await assert.rejects(executeHostedMediaUpload({
    authorize: async () => { calls.push('authorize'); throw new Error('authorize failed'); },
    upload: async () => { calls.push('upload'); },
    complete: async () => { calls.push('complete'); },
  }), /authorize failed/);
  assert.deepEqual(calls, ['authorize']);
});

test('direct Storage failure cannot advance to completion or a processing claim', async () => {
  const calls = [];
  await assert.rejects(executeHostedMediaUpload({
    authorize: async () => { calls.push('authorize'); return 'https://storage.test/signed'; },
    upload: async () => { calls.push('upload'); throw new Error('storage failed'); },
    complete: async () => { calls.push('complete'); },
  }), /storage failed/);
  assert.deepEqual(calls, ['authorize', 'upload']);
});

test('completion failure remains a failure and success advances only to verification', async () => {
  const failed = [];
  await assert.rejects(executeHostedMediaUpload({
    authorize: async () => { failed.push('authorize'); return 'https://storage.test/signed'; },
    upload: async () => { failed.push('upload'); },
    complete: async () => { failed.push('complete'); throw new Error('completion failed'); },
  }), /completion failed/);
  assert.deepEqual(failed, ['authorize', 'upload', 'complete']);
  assert.equal(await executeHostedMediaUpload({
    authorize: async () => 'https://storage.test/signed',
    upload: async () => undefined,
    complete: async () => undefined,
  }), 'verifying-upload');
});

test('production manifest and capture source keep the required security shape', async () => {
  const [config, background, offscreen] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('./media-capture-background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/offscreen/main.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen'\]/);
  assert.doesNotMatch(config, /host_permissions/);
  assert.match(background, /getContexts/);
  assert.match(background, /createDocument/);
  assert.match(background, /getMediaStreamId/);
  assert.ok(background.indexOf('if (!prepared.ok)') < background.indexOf('getMediaStreamId'));
  assert.match(background, /tabs\.onRemoved/);
  assert.match(background, /tabs\.onUpdated/);
  assert.match(offscreen, /new Blob\(/);
  assert.match(offscreen, /XMLHttpRequest/);
  assert.match(offscreen, /xhr\.open\('PUT', signedUrl\)/);
  assert.doesNotMatch(offscreen, /xhr\.open\('POST', signedUrl\)/);
  assert.match(offscreen, /xhr\.upload\.addEventListener\('progress'/);
  assert.match(offscreen, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(offscreen, /new AudioContext\(\)/);
  assert.match(offscreen, /audioContext\.close\(\)/);
  assert.match(offscreen, /retained\.xhr\?\.abort\(\)/);
  assert.match(offscreen, /MEDIA_CAPTURE_OFFSCREEN_RETRY/);
  assert.match(offscreen, /status: 'waiting-to-upload'/);
  assert.match(offscreen, /if \(retained !== upload\) return/);
  assert.doesNotMatch(offscreen, /previewUrl|captureStream/);
  assert.doesNotMatch(background + offscreen, /SPIKE|spike/i);
  assert.doesNotMatch(background, /Blob/);
});
