import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CHROME_TAB_CAPTURE_INVOKE_ERROR,
  MEDIA_CAPTURE_FAILSAFE_MS,
  MEDIA_CAPTURE_START,
  RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS,
  TAB_CAPTURE_INVOKE_MESSAGE,
  TAB_CAPTURE_STREAM_ID_TIMEOUT_MS,
  buildCaptureMetadataV2,
  canClearHostedAttentionWithoutLiveCancel,
  canClearPreparingCaptureWithoutBackgroundCancel,
  captureRequestMatchesConnectedTab,
  hostedCaptureRequiresLiveCancel,
  completeHostedMediaUpload,
  executeHostedMediaUpload,
  getCaptureRangeError,
  hostedRawUploadMimeType,
  HOSTED_CAPTURE_START_TIMEOUT_MS,
  isAudioOnlyCaptureSourceKind,
  isCapturePreparedPage,
  isCaptureStartRequest,
  isCurrentCaptureId,
  isMediaCaptureCancelMessage,
  isMediaCaptureStartMessage,
  isOffscreenStartMessage,
  isPreparingCaptureStatus,
  isTabCaptureInvocationError,
  mapTabCaptureStartFailure,
  raceHostedCaptureCancel,
  raceHostedCaptureStart,
  raceTabCaptureStreamId,
  reservedTabCaptureStreamIsFresh,
  reservedTabCaptureStreamMatchesPage,
  reservedTabCaptureStreamMatchesTab,
  selectCaptureMimeType,
  shouldReplaceHostedCaptureSnapshot,
  shouldReuseReservedTabCaptureStream,
  sourceIdentityMatchesUrl,
  beginTabCaptureStreamIdFromUserGesture,
  isTabCaptureStreamId,
  resolvePanelTabCaptureStreamId,
  usableCallerTabCaptureStreamId,
  userFacingCaptureMessage,
} from './media-capture.ts';
import {
  installMediaCapture,
  invalidateReservedTabCaptureStream,
  reserveTabCaptureStreamIdFromInvoke,
} from './media-capture-background.ts';

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
  playerIdentity: 'video:1:f8443fef',
};
const request = {
  captureId: '44444444-4444-4444-8444-444444444444',
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

test('Chrome tab-capture invocation errors map to toolbar Recapture copy', () => {
  assert.equal(isTabCaptureInvocationError(CHROME_TAB_CAPTURE_INVOKE_ERROR), true);
  assert.equal(isTabCaptureInvocationError(`Capture could not start: ${CHROME_TAB_CAPTURE_INVOKE_ERROR}`), true);
  assert.equal(isTabCaptureInvocationError('Permission denied by the user.'), false);
  assert.equal(reservedTabCaptureStreamIsFresh({ tabId: 42, reservedAt: 1_000 }, 42, 1_000 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS), true);
  assert.equal(reservedTabCaptureStreamIsFresh({ tabId: 42, reservedAt: 1_000 }, 42, 1_001 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS), false);
  assert.equal(reservedTabCaptureStreamIsFresh({ tabId: 7, reservedAt: 1_000 }, 42, 1_100), false);
  assert.equal(reservedTabCaptureStreamMatchesTab({ tabId: 42, reservedAt: 1_000 }, 42, 1_001 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS), true);
  assert.equal(reservedTabCaptureStreamMatchesTab({ tabId: 7, reservedAt: 1_000 }, 42, 1_100), false);
  assert.equal(reservedTabCaptureStreamMatchesPage(
    { tabId: 42, reservedAt: 1_000, pageUrl: source.pageUrl }, 42, source.pageUrl, 1_100,
  ), true);
  assert.equal(reservedTabCaptureStreamMatchesPage(
    { tabId: 42, reservedAt: 1_000, pageUrl: source.pageUrl },
    42,
    'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789',
    1_100,
  ), false);
  assert.equal(shouldReuseReservedTabCaptureStream(
    { tabId: 42, reservedAt: 1_000, pageUrl: source.pageUrl }, 42, source.pageUrl, 1_000 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS,
  ), true);
  assert.equal(shouldReuseReservedTabCaptureStream(
    { tabId: 42, reservedAt: 1_000, pageUrl: source.pageUrl }, 42, source.pageUrl, 1_001 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS,
  ), false);
  assert.equal(TAB_CAPTURE_STREAM_ID_TIMEOUT_MS, 4_000);
  assert.equal(HOSTED_CAPTURE_START_TIMEOUT_MS, 5_000);
  assert.equal(isPreparingCaptureStatus('preparing'), true);
  assert.equal(isPreparingCaptureStatus('idle'), false);
  assert.equal(shouldReplaceHostedCaptureSnapshot(
    { status: 'error', captureId: request.captureId, code: 'tab-capture-denied', message: TAB_CAPTURE_INVOKE_MESSAGE },
    { status: 'preparing', captureId: request.captureId },
  ), false);
  assert.equal(shouldReplaceHostedCaptureSnapshot(
    { status: 'error', captureId: request.captureId, code: 'tab-capture-denied', message: TAB_CAPTURE_INVOKE_MESSAGE },
    { status: 'capturing', captureId: request.captureId },
  ), true);
  assert.equal(canClearPreparingCaptureWithoutBackgroundCancel('preparing', false), true);
  assert.equal(canClearPreparingCaptureWithoutBackgroundCancel('capturing', false), false);
  assert.equal(canClearPreparingCaptureWithoutBackgroundCancel('capturing', true), true);
  assert.equal(canClearPreparingCaptureWithoutBackgroundCancel('uploading', false), false);
  assert.equal(hostedCaptureRequiresLiveCancel({ status: 'capturing', captureId: request.captureId }), true);
  assert.equal(hostedCaptureRequiresLiveCancel({
    status: 'error', captureId: request.captureId, code: 'upload-failed', message: 'Upload failed.',
  }), true);
  assert.equal(hostedCaptureRequiresLiveCancel({
    status: 'error', captureId: null, code: 'recapture-required', message: 'Recapture or cancel.',
  }), false);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({
    status: 'error', captureId: null, code: 'recapture-required', message: 'Recapture or cancel.',
  }, false), true);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({
    status: 'error', captureId: request.captureId, code: 'tab-capture-denied', message: TAB_CAPTURE_INVOKE_MESSAGE,
  }, false), true);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({
    status: 'error', captureId: null, code: 'unexpected', message: 'The hosted-media status could not be restored.',
  }, false), true);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({ status: 'preparing', captureId: request.captureId }, false), true);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({ status: 'capturing', captureId: request.captureId }, false), false);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({
    status: 'error', captureId: request.captureId, code: 'upload-failed', message: 'Upload failed.',
  }, false), false);
  assert.equal(canClearHostedAttentionWithoutLiveCancel({ status: 'capturing', captureId: request.captureId }, true), true);
  const mapped = mapTabCaptureStartFailure(new Error(CHROME_TAB_CAPTURE_INVOKE_ERROR), request.captureId);
  assert.equal(mapped.status, 'error');
  assert.equal(mapped.code, 'tab-capture-denied');
  assert.equal(mapped.message, TAB_CAPTURE_INVOKE_MESSAGE);
  assert.doesNotMatch(mapped.message, /activeTab|Chrome pages|invoked for the current page/i);
  assert.equal(userFacingCaptureMessage({
    status: 'error',
    captureId: request.captureId,
    code: 'unexpected',
    message: `Capture could not start: ${CHROME_TAB_CAPTURE_INVOKE_ERROR}`,
  }), TAB_CAPTURE_INVOKE_MESSAGE);
  const other = mapTabCaptureStartFailure(new Error('The offscreen recorder did not accept the capture start.'), request.captureId);
  assert.equal(other.code, 'unexpected');
  assert.match(other.message, /offscreen recorder/);
});

test('offscreen start is never requested when top-frame preparation fails', async () => {
  let onMessage;
  const calls = [];
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => {
        calls.push(message?.type ?? 'message');
        return undefined;
      },
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
      calls.push('prepare');
      return [{ frameId: 0, result: { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Player missing.' } }];
    } },
    tabCapture: { async getMediaStreamId() { calls.push('stream'); return 'stream'; } },
    offscreen: { async createDocument() { calls.push('offscreen'); } },
  };
  installMediaCapture(fakeChrome);
  const response = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(response.ok, false);
  assert.equal(response.snapshot.diagnosticCode, 'PLAYER_NOT_FOUND');
  assert.equal(calls.includes('stream'), true);
  assert.ok(calls.indexOf('stream') < calls.indexOf('prepare'));
  assert.equal(calls.includes('offscreen'), false);
  assert.equal(calls.includes('annotated.mediaCapture.offscreenStart.v1'), false);
});

test('tabCapture invocation failure is mapped before page preparation', async () => {
  let onMessage;
  let prepareCalls = 0;
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
    scripting: { async executeScript({ func }) {
      if (String(func?.name ?? '').includes('prepare')) prepareCalls += 1;
      return [{ frameId: 0, result: { ok: true } }];
    } },
    tabCapture: { async getMediaStreamId() { throw new Error(CHROME_TAB_CAPTURE_INVOKE_ERROR); } },
    offscreen: { async createDocument() { throw new Error('offscreen must not run'); } },
  };
  installMediaCapture(fakeChrome);
  const response = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(response.ok, false);
  assert.equal(response.snapshot.status, 'error');
  assert.equal(response.snapshot.code, 'tab-capture-denied');
  assert.equal(response.snapshot.message, TAB_CAPTURE_INVOKE_MESSAGE);
  assert.equal(prepareCalls, 0);
});

test('toolbar-reserved stream ID is used instead of a later getMediaStreamId', async () => {
  let onMessage;
  const streamIds = [];
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => {
        if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
          streamIds.push(message.streamId);
          return { status: 'capturing', captureId: message.captureId };
        }
        return { ok: true };
      },
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
    scripting: { async executeScript({ func }) {
      if (func.name.includes('prepare')) return [{ frameId: 0, result: {
        ok: true,
        prepared: {
          sourceKind: 'youtube', requestedStartMs: 5_000, requestedEndMs: 20_000,
          requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
          mediaDurationMs: 120_000, pageUrl: source.pageUrl,
          geometry: {
            viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
            boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
            videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
            fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
          },
        },
      } }];
      return [{ frameId: 0, result: { ok: true, acknowledgedAtMs: 1, currentTimeMs: 5_000 } }];
    } },
    tabCapture: {
      async getMediaStreamId() {
        streamIds.push('reserved-from-invoke');
        return 'reserved-from-invoke';
      },
    },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);
  await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, source.pageUrl);
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    throw new Error('begin must reuse the toolbar-reserved stream ID');
  };
  const response = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.deepEqual(streamIds, ['reserved-from-invoke', 'reserved-from-invoke']);
});

test('an in-flight toolbar reserve is awaited instead of a second getMediaStreamId', async () => {
  let onMessage;
  let releaseReserve;
  const reserveGate = new Promise((resolve) => { releaseReserve = resolve; });
  let getMediaStreamIdCalls = 0;
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => {
        if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
          return { status: 'capturing', captureId: message.captureId, streamId: message.streamId };
        }
        return { ok: true };
      },
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
    scripting: { async executeScript({ func }) {
      if (func.name.includes('prepare')) return [{ frameId: 0, result: {
        ok: true,
        prepared: {
          sourceKind: 'youtube', requestedStartMs: 5_000, requestedEndMs: 20_000,
          requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
          mediaDurationMs: 120_000, pageUrl: source.pageUrl,
          geometry: {
            viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
            boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
            videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
            fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
          },
        },
      } }];
      return [{ frameId: 0, result: { ok: true, acknowledgedAtMs: 1, currentTimeMs: 5_000 } }];
    } },
    tabCapture: {
      async getMediaStreamId() {
        getMediaStreamIdCalls += 1;
        await reserveGate;
        return 'in-flight-reserve';
      },
    },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);
  const reserved = reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, source.pageUrl);
  const started = new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getMediaStreamIdCalls, 1);
  releaseReserve();
  const [response, reservedResult] = await Promise.all([started, reserved]);
  assert.equal(response.ok, true);
  assert.equal(response.snapshot.status, 'capturing');
  assert.equal(reservedResult?.streamId, 'in-flight-reserve');
  assert.equal(getMediaStreamIdCalls, 1);
});

test('chrome:// and other non-http pages never reserve a tab-capture stream ID', async () => {
  let tabCaptureCalls = 0;
  const fakeChrome = {
    tabCapture: { async getMediaStreamId() { tabCaptureCalls += 1; return 'must-not-run'; } },
  };
  assert.equal(await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, 'chrome://extensions'), null);
  assert.equal(await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, 'about:blank'), null);
  assert.equal(tabCaptureCalls, 0);
});

test('stream-ID races time out as the Chrome invocation error', async () => {
  await assert.rejects(
    raceTabCaptureStreamId(new Promise(() => undefined), 20),
    (error) => error instanceof Error && error.message === CHROME_TAB_CAPTURE_INVOKE_ERROR,
  );
  await assert.rejects(
    raceHostedCaptureStart(new Promise(() => undefined), 20),
    (error) => error instanceof Error && error.message === CHROME_TAB_CAPTURE_INVOKE_ERROR,
  );
  assert.equal(await raceHostedCaptureCancel(new Promise(() => undefined), 20), undefined);
});

function applePodcastsRequest() {
  const pageUrl = 'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789';
  return {
    ...request,
    source: {
      kind: 'audio',
      pageUrl,
      sourceKey: pageUrl,
      playerIdentity: 'audio:1:f8443fef',
    },
  };
}

function captureChromeForHang(overrides = {}) {
  let onMessage;
  const pageUrl = overrides.pageUrl ?? source.pageUrl;
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => {
        if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
          return { status: 'capturing', captureId: message.captureId };
        }
        return { ok: true };
      },
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
    storage: { session: {
      async get(key) {
        return key === 'annotatedActiveTabContext'
          ? { [key]: { tabId: 42, windowId: 1, title: 'Media', url: pageUrl, capturedAt: 1 } }
          : {};
      },
      async set() {}, async remove() {},
    } },
    tabs: {
      async get() { return { id: 42, url: pageUrl }; },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    scripting: { async executeScript({ func }) {
      if (func.name.includes('prepare')) return [{ frameId: 0, result: {
        ok: true,
        prepared: {
          sourceKind: overrides.sourceKind ?? 'youtube',
          requestedStartMs: 5_000, requestedEndMs: 20_000,
          requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
          mediaDurationMs: 120_000, pageUrl,
          geometry: {
            viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
            boundingClientRect: overrides.sourceKind === 'audio' ? null : {
              x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0,
            },
            videoWidth: overrides.sourceKind === 'audio' ? null : 1920,
            videoHeight: overrides.sourceKind === 'audio' ? null : 1080,
            objectFit: overrides.sourceKind === 'audio' ? null : 'contain',
            objectPosition: overrides.sourceKind === 'audio' ? null : '50% 50%',
            fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
            frameMapping: null,
          },
        },
      } }];
      return [{ frameId: 0, result: { ok: true, acknowledgedAtMs: 1, currentTimeMs: 5_000 } }];
    } },
    tabCapture: { async getMediaStreamId() { return 'stream'; } },
    offscreen: { async createDocument() {} },
    ...overrides.chrome,
  };
  return { fakeChrome, getOnMessage: () => onMessage };
}

test('begin reuses a same-tab reserved stream ID instead of requesting another', async () => {
  const { fakeChrome, getOnMessage } = captureChromeForHang();
  let laterStreamCalls = 0;
  installMediaCapture(fakeChrome);
  await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, source.pageUrl);
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    laterStreamCalls += 1;
    throw new Error('begin must reuse the same-tab reserved stream ID');
  };
  const response = await new Promise((resolve) => {
    assert.equal(getOnMessage()({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(laterStreamCalls, 0);
});

test('a stale toolbar-reserved stream ID is dropped so first Publish re-acquires under activeTab', async () => {
  const captureRequest = applePodcastsRequest();
  let laterStreamCalls = 0;
  const { fakeChrome, getOnMessage } = captureChromeForHang({
    pageUrl: captureRequest.source.pageUrl,
    sourceKind: 'audio',
  });
  installMediaCapture(fakeChrome, { reservedStreamMaxAgeMs: 20, streamIdTimeoutMs: 200 });
  await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, captureRequest.source.pageUrl);
  await new Promise((resolve) => setTimeout(resolve, 30));
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    laterStreamCalls += 1;
    return 'fresh-at-publish';
  };
  const startedAt = Date.now();
  const response = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background', type: MEDIA_CAPTURE_START, request: captureRequest,
    }, {}, resolve), true);
  });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(response.ok, true);
  assert.equal(response.snapshot.status, 'capturing');
  assert.equal(laterStreamCalls, 1);
});

test('panel-acquired stream IDs stay usable only while fresh and bound to that page', () => {
  const pageUrl = 'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789';
  const acquired = { tabId: 42, streamId: 'panel-stream', reservedAt: 1_000, pageUrl };
  assert.equal(isTabCaptureStreamId('panel-stream'), true);
  assert.equal(isTabCaptureStreamId(''), false);
  assert.equal(isTabCaptureStreamId('has space'), false);
  assert.equal(usableCallerTabCaptureStreamId(acquired, 42, pageUrl, 1_000 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS), 'panel-stream');
  assert.equal(usableCallerTabCaptureStreamId(acquired, 42, pageUrl, 1_001 + RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS), null);
  assert.equal(usableCallerTabCaptureStreamId(acquired, 42, source.pageUrl, 1_100), null);
  assert.equal(usableCallerTabCaptureStreamId(acquired, 7, pageUrl, 1_100), null);
});

test('Publish click starts getMediaStreamId before any await settles', async () => {
  const order = [];
  const tabCapture = {
    async getMediaStreamId() {
      order.push('stream');
      return 'panel-stream';
    },
  };
  const pending = beginTabCaptureStreamIdFromUserGesture(tabCapture, 42, applePodcastsRequest().source.pageUrl);
  order.push('started');
  const acquired = await pending;
  assert.deepEqual(order, ['stream', 'started']);
  assert.equal(acquired?.streamId, 'panel-stream');
  assert.equal(acquired?.tabId, 42);
});

test('a caller stream ID from Publish is used after YouTube-to-Apple-Podcasts navigation', async () => {
  const captureRequest = applePodcastsRequest();
  let laterStreamCalls = 0;
  const startedStreamIds = [];
  const { fakeChrome, getOnMessage } = captureChromeForHang({
    pageUrl: captureRequest.source.pageUrl,
    sourceKind: 'audio',
  });
  const sendMessage = fakeChrome.runtime.sendMessage;
  fakeChrome.runtime.sendMessage = async (message) => {
    if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
      startedStreamIds.push(message.streamId);
    }
    return sendMessage(message);
  };
  installMediaCapture(fakeChrome);
  await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, source.pageUrl);
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    laterStreamCalls += 1;
    throw new Error(CHROME_TAB_CAPTURE_INVOKE_ERROR);
  };
  const response = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background',
      type: MEDIA_CAPTURE_START,
      request: captureRequest,
      streamId: 'panel-after-navigate',
    }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.snapshot.status, 'capturing');
  assert.equal(laterStreamCalls, 0);
  assert.deepEqual(startedStreamIds, ['panel-after-navigate']);
});

test('resolvePanelTabCaptureStreamId retries when the click-turn ID is stale', async () => {
  const pageUrl = applePodcastsRequest().source.pageUrl;
  let calls = 0;
  const tabCapture = {
    async getMediaStreamId() {
      calls += 1;
      return `retry-${calls}`;
    },
  };
  const stale = {
    tabId: 42,
    streamId: 'expired',
    reservedAt: Date.now() - RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS - 1,
    pageUrl,
  };
  assert.equal(await resolvePanelTabCaptureStreamId(tabCapture, 42, pageUrl, stale), 'retry-1');
  assert.equal(calls, 1);
});

test('a YouTube-reserved stream ID is not reused after the tab navigates to Apple Podcasts', async () => {
  const captureRequest = applePodcastsRequest();
  let laterStreamCalls = 0;
  const { fakeChrome, getOnMessage } = captureChromeForHang({
    pageUrl: captureRequest.source.pageUrl,
    sourceKind: 'audio',
  });
  installMediaCapture(fakeChrome, { streamIdTimeoutMs: 200 });
  await reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, source.pageUrl);
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    laterStreamCalls += 1;
    return 'podcast-stream';
  };
  const response = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background', type: MEDIA_CAPTURE_START, request: captureRequest,
    }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.snapshot.status, 'capturing');
  assert.equal(laterStreamCalls, 1);
});

test('a hung getMediaStreamId surfaces the toolbar Recapture error instead of staying preparing', async () => {
  const captureRequest = applePodcastsRequest();
  const { fakeChrome, getOnMessage } = captureChromeForHang({
    pageUrl: captureRequest.source.pageUrl,
    sourceKind: 'audio',
    chrome: {
      tabCapture: { getMediaStreamId() { return new Promise(() => undefined); } },
    },
  });
  installMediaCapture(fakeChrome, { streamIdTimeoutMs: 30 });
  const startedAt = Date.now();
  const response = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background', type: MEDIA_CAPTURE_START, request: captureRequest,
    }, {}, resolve), true);
  });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(response.ok, false);
  assert.equal(response.snapshot.status, 'error');
  assert.equal(response.snapshot.code, 'tab-capture-denied');
  assert.equal(response.snapshot.message, TAB_CAPTURE_INVOKE_MESSAGE);
});

test('cancel during preparing with no persisted capture clears reserved state and allows a later start', async () => {
  const captureRequest = applePodcastsRequest();
  let releaseReserve;
  const reserveGate = new Promise((resolve) => { releaseReserve = resolve; });
  let getMediaStreamIdCalls = 0;
  const { fakeChrome, getOnMessage } = captureChromeForHang({
    pageUrl: captureRequest.source.pageUrl,
    sourceKind: 'audio',
    chrome: {
      tabCapture: {
        async getMediaStreamId() {
          getMediaStreamIdCalls += 1;
          await reserveGate;
          return 'later-stream';
        },
      },
    },
  });
  installMediaCapture(fakeChrome, { streamIdTimeoutMs: 40 });
  const reserved = reserveTabCaptureStreamIdFromInvoke(fakeChrome, 42, captureRequest.source.pageUrl);
  const started = new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background', type: MEDIA_CAPTURE_START, request: captureRequest,
    }, {}, resolve), true);
  });
  await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background',
      type: 'annotated.mediaCapture.cancel.v1',
      captureId: captureRequest.captureId,
      operation,
    }, {}, resolve), true);
  });
  assert.equal(cancelled.ok, true);
  releaseReserve();
  const [startResponse] = await Promise.all([started, reserved]);
  assert.equal(startResponse.ok, false);
  assert.ok(startResponse.snapshot.status === 'cancelled' || startResponse.snapshot.status === 'error');
  invalidateReservedTabCaptureStream();
  fakeChrome.tabCapture.getMediaStreamId = async () => {
    getMediaStreamIdCalls += 1;
    return 'fresh-after-cancel';
  };
  const retry = await new Promise((resolve) => {
    assert.equal(getOnMessage()({
      target: 'background',
      type: MEDIA_CAPTURE_START,
      request: { ...captureRequest, captureId: '55555555-5555-4555-8555-555555555555' },
    }, {}, resolve), true);
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.snapshot.status, 'capturing');
});

test('Cancel after reopen clears a leftover attention snapshot and ghost active capture', async () => {
  const { accessToken: _accessToken, ...safeRequest } = request;
  let sessionStore = {
    'annotated.mediaCapture.active.v1': { captureId: request.captureId, request: safeRequest },
  };
  let onMessage;
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
    storage: { session: {
      async get(key) {
        if (key === 'annotatedActiveTabContext') {
          return { [key]: { tabId: 42, windowId: 1, title: 'Video', url: source.pageUrl, capturedAt: 1 } };
        }
        const name = typeof key === 'string' ? key : key[0];
        return name && sessionStore[name] ? { [name]: sessionStore[name] } : {};
      },
      async set(value) { sessionStore = { ...sessionStore, ...value }; },
      async remove(key) {
        const names = Array.isArray(key) ? key : [key];
        for (const name of names) delete sessionStore[name];
      },
    } },
    tabs: {
      async get() { return { id: 42, url: source.pageUrl }; },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    scripting: { async executeScript() { return [{ frameId: 0, result: null }]; } },
    tabCapture: { async getMediaStreamId() { return 'stream'; } },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);

  const leftoverAttention = await new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.cancel.v1',
      captureId: null, operation,
    }, {}, resolve), true);
  });
  assert.deepEqual(leftoverAttention, { ok: true, cancelled: true });
  assert.equal(sessionStore['annotated.mediaCapture.active.v1'], undefined);

  const status = await new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.status.v1',
    }, {}, resolve), true);
  });
  assert.equal(status.snapshot.status, 'idle');
  assert.equal(status.operation, null);
});

test('concurrent status reconciliation cannot clear a newly preparing shared media capture', async () => {
  for (const captureSource of [
    source,
    {
      kind: 'audio',
      pageUrl: 'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789',
      sourceKey: 'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789',
      playerIdentity: 'audio:1:f8443fef',
    },
    {
      kind: 'spotify',
      pageUrl: 'https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2',
      sourceKey: '6EMoFpxEsLelogfZz8eAC2',
      playerIdentity: 'spotify-now-playing:1:abcd1234',
    },
  ]) {
    let onMessage;
    let releasePersistence;
    let persistenceStarted;
    let tabCaptureCalls = 0;
    const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
    const persistenceStartedGate = new Promise((resolve) => { persistenceStarted = resolve; });
    const captureRequest = { ...request, source: captureSource };
    const geometry = captureSource.kind === 'audio' || captureSource.kind === 'spotify'
      ? {
          viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
          boundingClientRect: null, videoWidth: null, videoHeight: null,
          objectFit: null, objectPosition: null, fullscreen: false,
          fullscreenElement: null, scrollX: 0, scrollY: 0, frameMapping: null,
        }
      : {
          viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
          boundingClientRect: {
            x: 0, y: 0, width: 1280, height: 720,
            top: 0, right: 1280, bottom: 720, left: 0,
          },
          videoWidth: 1920, videoHeight: 1080,
          objectFit: 'contain', objectPosition: '50% 50%', fullscreen: false,
          fullscreenElement: null, scrollX: 0, scrollY: 0, frameMapping: null,
        };
    const fakeChrome = {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        getContexts: async () => [],
        sendMessage: async (message) => {
          if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
            return { status: 'capturing', captureId: message.captureId };
          }
          return { ok: true };
        },
        onMessage: { addListener(listener) { onMessage = listener; } },
      },
      storage: { session: {
        async get(key) {
          return key === 'annotatedActiveTabContext'
            ? { [key]: { tabId: 42, windowId: 1, title: 'Media', url: captureSource.pageUrl, capturedAt: 1 } }
            : {};
        },
        async set(value) {
          if (value['annotated.mediaCapture.active.v1']) {
            persistenceStarted();
            await persistenceGate;
          }
        },
        async remove() {},
      } },
      tabs: {
        async get() { return { id: 42, url: captureSource.pageUrl }; },
        onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
      },
      scripting: { async executeScript({ func }) {
        if (func.name.includes('prepare')) return [{ frameId: 0, result: {
          ok: true,
          prepared: {
            sourceKind: captureSource.kind,
            requestedStartMs: captureRequest.startMs,
            requestedEndMs: captureRequest.endMs,
            requestedDurationMs: captureRequest.endMs - captureRequest.startMs,
            playerCurrentTimeBeforeRecordingMs: captureRequest.startMs,
            mediaDurationMs: 120_000,
            pageUrl: captureSource.pageUrl,
            geometry,
          },
        } }];
        return [{ frameId: 0, result: {
          ok: true, acknowledgedAtMs: 1, currentTimeMs: captureRequest.startMs,
        } }];
      } },
      tabCapture: { async getMediaStreamId() { tabCaptureCalls += 1; return 'stream'; } },
      offscreen: { async createDocument() {} },
    };
    installMediaCapture(fakeChrome);
    const started = new Promise((resolve) => {
      assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request: captureRequest }, {}, resolve), true);
    });
    await persistenceStartedGate;
    const status = new Promise((resolve) => {
      assert.equal(onMessage({ target: 'background', type: 'annotated.mediaCapture.status.v1' }, {}, resolve), true);
    });
    await new Promise((resolve) => setImmediate(resolve));
    releasePersistence();

    const [startResponse, statusResponse] = await Promise.all([started, status]);
    assert.equal(startResponse.ok, true, captureSource.kind);
    assert.equal(startResponse.snapshot.status, 'capturing', captureSource.kind);
    assert.notEqual(statusResponse.snapshot.status, 'error', captureSource.kind);
    assert.equal(tabCaptureCalls, 1, captureSource.kind);
  }
});

test('runtime request validation requires every explicit production field', () => {
  assert.equal(isCaptureStartRequest(request), true);
  assert.equal(isMediaCaptureStartMessage({
    target: 'background', type: MEDIA_CAPTURE_START, request,
  }), true);
  assert.equal(isMediaCaptureStartMessage({
    target: 'background', type: MEDIA_CAPTURE_START, request, streamId: 'panel-stream',
  }), true);
  assert.equal(isMediaCaptureStartMessage({
    target: 'background', type: MEDIA_CAPTURE_START, request, streamId: '',
  }), false);
  assert.equal(isMediaCaptureCancelMessage({
    target: 'background', type: 'annotated.mediaCapture.cancel.v1',
    captureId: request.captureId, operation,
  }), true);
  assert.equal(isMediaCaptureCancelMessage({
    target: 'background', type: 'annotated.mediaCapture.cancel.v1',
    captureId: null, operation,
  }), true);
  assert.equal(isMediaCaptureCancelMessage({
    target: 'background', type: 'annotated.mediaCapture.cancel.v1', captureId: null,
  }), false);
  assert.equal(isCaptureStartRequest({ ...request, endMs: undefined }), false);
  assert.equal(isCaptureStartRequest({ ...request, captureId: 'capture-unbounded' }), false);
  assert.equal(isCaptureStartRequest({ ...request, source: { ...source, kind: undefined } }), false);
  assert.equal(isCaptureStartRequest({ ...request, source: { ...source, playerIdentity: undefined } }), false);
  assert.equal(isCaptureStartRequest({ ...request, source: { ...source, playerIdentity: 'video:6:f8443fef' } }), false);
  assert.equal(isCaptureStartRequest({ ...request, source: { ...source, playerIdentity: 'audio:1:f8443fef' } }), false);
  assert.equal(isCaptureStartRequest({ ...request, operation: { ...operation, mediaId: undefined } }), false);
  assert.equal(isCaptureStartRequest({ ...request, accessToken: undefined }), false);
});

test('stale cancellation and offscreen events cannot affect a newer capture attempt', async () => {
  let onMessage;
  const events = [];
  let returnStaleStatus = false;
  let terminalRemoveGate = null;
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      sendMessage: async (message) => {
        events.push(message);
        return returnStaleStatus && message?.type === 'annotated.mediaCapture.offscreenStatus.v1'
          ? { snapshot: { status: 'uploading', captureId: '55555555-5555-4555-8555-555555555555', progress: 100 } }
          : { status: 'capturing', captureId: message?.captureId ?? request.captureId };
      },
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
    storage: { session: {
      async get(key) {
        return key === 'annotatedActiveTabContext'
          ? { [key]: { tabId: 42, windowId: 1, title: 'Video', url: source.pageUrl, capturedAt: 1 } }
          : {};
      },
      async set() {},
      async remove() { if (terminalRemoveGate) await terminalRemoveGate.promise; },
    } },
    tabs: {
      async get() { return { id: 42, url: source.pageUrl }; },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    scripting: { async executeScript({ func }) {
      if (func.name.includes('prepare')) return [{ frameId: 0, result: {
        ok: true,
        prepared: {
          sourceKind: 'youtube', requestedStartMs: 5_000, requestedEndMs: 20_000,
          requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
          mediaDurationMs: 120_000, pageUrl: source.pageUrl,
          geometry: {
            viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
            boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
            videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
            fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
          },
        },
      } }];
      return [{ frameId: 0, result: { ok: true, acknowledgedAtMs: 1, currentTimeMs: 5_000 } }];
    } },
    tabCapture: { async getMediaStreamId() { return 'stream'; } },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);
  const started = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(started.ok, true);

  const staleCancel = await new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.cancel.v1',
      captureId: '55555555-5555-4555-8555-555555555555', operation,
    }, {}, resolve), true);
  });
  assert.deepEqual(staleCancel, { ok: true, cancelled: false });

  const staleEvent = await new Promise((resolve) => {
    onMessage({
      target: 'background', type: 'annotated.mediaCapture.offscreenEvent.v1',
      snapshot: { status: 'uploading', captureId: '55555555-5555-4555-8555-555555555555', progress: 100 },
    }, {}, resolve);
  });
  assert.equal(staleEvent.ok, false);
  assert.equal(events.some((event) => event?.snapshot?.captureId === '55555555-5555-4555-8555-555555555555'), false);

  const staleRetry = await new Promise((resolve) => {
    onMessage({
      target: 'background', type: 'annotated.mediaCapture.retry.v1',
      captureId: '55555555-5555-4555-8555-555555555555', accessToken: 'a'.repeat(40),
    }, {}, resolve);
  });
  assert.equal(staleRetry.ok, false);

  returnStaleStatus = true;
  const status = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: 'annotated.mediaCapture.status.v1' }, {}, resolve), true);
  });
  assert.equal(status.snapshot.captureId, request.captureId);

  const mismatchedOperationCancel = await new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.cancel.v1', captureId: null,
      operation: { ...operation, mediaId: '33333333-3333-4333-8333-333333333333' },
    }, {}, resolve), true);
  });
  assert.deepEqual(mismatchedOperationCancel, { ok: true, cancelled: false });

  const restoredPanelCancel = await new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.cancel.v1',
      captureId: null, operation,
    }, {}, resolve), true);
  });
  assert.deepEqual(restoredPanelCancel, { ok: true, cancelled: true });

  returnStaleStatus = false;
  const restarted = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request }, {}, resolve), true);
  });
  assert.equal(restarted.ok, true);

  let releaseTerminalRemove;
  terminalRemoveGate = {
    promise: new Promise((resolve) => { releaseTerminalRemove = resolve; }),
  };
  let terminalSettled = false;
  const terminalResponse = new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: 'annotated.mediaCapture.offscreenEvent.v1',
      snapshot: {
        status: 'verifying-upload', captureId: request.captureId,
        annotationId: operation.annotationId, mediaId: operation.mediaId,
      },
    }, {}, (value) => { terminalSettled = true; resolve(value); }), true);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminalSettled, false);
  const newerRequest = {
    ...request,
    captureId: '66666666-6666-4666-8666-666666666666',
  };
  let newerStartSettled = false;
  const newerStart = new Promise((resolve) => {
    assert.equal(onMessage({
      target: 'background', type: MEDIA_CAPTURE_START, request: newerRequest,
    }, {}, (value) => { newerStartSettled = true; resolve(value); }), true);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(newerStartSettled, false);
  releaseTerminalRemove();
  assert.deepEqual(await terminalResponse, { ok: true });
  assert.equal((await newerStart).ok, true);
  terminalRemoveGate = null;

  const completedStatus = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: 'annotated.mediaCapture.status.v1' }, {}, resolve), true);
  });
  assert.equal(completedStatus.snapshot.captureId, newerRequest.captureId);
  assert.equal(completedStatus.operation.mediaId, operation.mediaId);
});

test('a completed recorder restored after worker suspension is reconciled before the next begin', async () => {
  let onMessage;
  let removals = 0;
  const { accessToken: _accessToken, ...safeRequest } = request;
  const nextRequest = { ...request, captureId: '77777777-7777-4777-8777-777777777777' };
  const fakeChrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      sendMessage: async (message) => {
        if (message?.type === 'annotated.mediaCapture.offscreenStatus.v1') return {
          snapshot: {
            status: 'verifying-upload', captureId: request.captureId,
            annotationId: operation.annotationId, mediaId: operation.mediaId,
          },
        };
        if (message?.type === 'annotated.mediaCapture.offscreenStart.v1') {
          return { status: 'capturing', captureId: message.captureId };
        }
        return { ok: true };
      },
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
    storage: { session: {
      async get(key) {
        if (key === 'annotated.mediaCapture.active.v1') return {
          [key]: { captureId: request.captureId, request: safeRequest },
        };
        return key === 'annotatedActiveTabContext'
          ? { [key]: { tabId: 42, windowId: 1, title: 'Video', url: source.pageUrl, capturedAt: 1 } }
          : {};
      },
      async set() {},
      async remove() { removals += 1; },
    } },
    tabs: {
      async get() { return { id: 42, url: source.pageUrl }; },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    scripting: { async executeScript({ func }) {
      if (func.name.includes('prepare')) return [{ frameId: 0, result: {
        ok: true,
        prepared: {
          sourceKind: 'youtube', requestedStartMs: 5_000, requestedEndMs: 20_000,
          requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
          mediaDurationMs: 120_000, pageUrl: source.pageUrl,
          geometry: {
            viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
            boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
            videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
            fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
          },
        },
      } }];
      return [{ frameId: 0, result: { ok: true, acknowledgedAtMs: 1, currentTimeMs: 5_000 } }];
    } },
    tabCapture: { async getMediaStreamId() { return 'stream'; } },
    offscreen: { async createDocument() {} },
  };
  installMediaCapture(fakeChrome);
  const started = await new Promise((resolve) => {
    assert.equal(onMessage({ target: 'background', type: MEDIA_CAPTURE_START, request: nextRequest }, {}, resolve), true);
  });
  assert.equal(started.ok, true);
  assert.equal(started.snapshot.captureId, nextRequest.captureId);
  assert.equal(removals, 1);
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

test('TikTok watch capture uses video identity and accepts a prepared tiktok page', () => {
  const tiktokSource = {
    kind: 'tiktok',
    pageUrl: 'https://www.tiktok.com/@abcnews/video/7682104834304036110',
    sourceKey: '7682104834304036110',
    playerIdentity: 'video:1:f8443fef',
  };
  const tiktokRequest = { ...request, source: tiktokSource };
  assert.equal(isCaptureStartRequest(tiktokRequest), true);
  assert.equal(sourceIdentityMatchesUrl(tiktokSource, tiktokSource.pageUrl), true);
  assert.equal(sourceIdentityMatchesUrl(tiktokSource, `${tiktokSource.pageUrl}?is_from_webapp=1`), true);
  assert.equal(sourceIdentityMatchesUrl(tiktokSource, 'https://www.tiktok.com/@cnn/video/7550999999999999999'), false);
  const prepared = {
    sourceKind: 'tiktok',
    requestedStartMs: 5_000,
    requestedEndMs: 20_000,
    requestedDurationMs: 15_000,
    playerCurrentTimeBeforeRecordingMs: 5_000,
    mediaDurationMs: 70_000,
    pageUrl: tiktokSource.pageUrl,
    geometry: {
      viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
      boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
      videoWidth: 1080, videoHeight: 1920, objectFit: 'contain', objectPosition: '50% 50%',
      fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
    },
  };
  assert.equal(isCapturePreparedPage(prepared), true);
  assert.equal(isOffscreenStartMessage({
    target: 'offscreen',
    type: 'annotated.mediaCapture.offscreenStart.v1',
    captureId: request.captureId,
    streamId: 'stream',
    request: tiktokRequest,
    prepared,
  }), true);
});

test('Spotify episode capture uses episode identity and now-playing player identity', () => {
  const spotifySource = {
    kind: 'spotify',
    pageUrl: 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ?si=share',
    sourceKey: '7makk4oTQel546B0P8lOOJ',
    playerIdentity: 'spotify-now-playing:1:abcd1234',
  };
  const spotifyRequest = { ...request, source: spotifySource };
  assert.equal(isCaptureStartRequest(spotifyRequest), true);
  assert.equal(sourceIdentityMatchesUrl(spotifySource, spotifySource.pageUrl), true);
  assert.equal(sourceIdentityMatchesUrl(spotifySource, 'https://open.spotify.com/intl-en/episode/7makk4oTQel546B0P8lOOJ'), true);
  assert.equal(sourceIdentityMatchesUrl(spotifySource, 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'), false);
  assert.equal(isCaptureStartRequest({
    ...spotifyRequest,
    source: { ...spotifySource, playerIdentity: 'audio:1:abcd1234' },
  }), false);
  const prepared = {
    sourceKind: 'spotify',
    requestedStartMs: 5_000,
    requestedEndMs: 20_000,
    requestedDurationMs: 15_000,
    playerCurrentTimeBeforeRecordingMs: 5_000,
    mediaDurationMs: 70_000,
    pageUrl: 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
    geometry: {
      viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
      boundingClientRect: null, videoWidth: null, videoHeight: null,
      objectFit: null, objectPosition: null, fullscreen: false,
      fullscreenElement: null, scrollX: 0, scrollY: 0, frameMapping: null,
    },
  };
  assert.equal(isCapturePreparedPage(prepared), true);
  assert.equal(isAudioOnlyCaptureSourceKind(prepared.sourceKind), true);
  assert.equal(isOffscreenStartMessage({
    target: 'offscreen',
    type: 'annotated.mediaCapture.offscreenStart.v1',
    captureId: request.captureId,
    streamId: 'stream',
    request: spotifyRequest,
    prepared,
  }), true);
  const metadata = buildCaptureMetadataV2({
    prepared,
    endGeometry: null,
    selectedMimeType: 'audio/webm;codecs=opus',
    tracks: [],
    audioTrackCount: 1,
    videoTrackCount: 0,
    loopbackEnabled: true,
    leadInMs: 20,
    recorderElapsedMs: 15_020,
    playerStartMs: 5_000,
    playerEndMs: 20_000,
  });
  assert.equal(metadata.version, 2);
  assert.equal('viewport' in metadata, false);
  assert.equal('video_element' in metadata, false);
});

test('watch-page audio capture kinds are not part of the capture contract', () => {
  for (const kind of ['youtube-audio', 'tiktok-audio', 'web-video-audio']) {
    assert.equal(isCaptureStartRequest({
      ...request,
      source: {
        kind,
        pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        sourceKey: 'abcdefghijk',
        playerIdentity: 'video:1:f8443fef',
      },
    }), false);
    assert.equal(isCapturePreparedPage({
      sourceKind: kind,
      requestedStartMs: 5_000,
      requestedEndMs: 20_000,
      requestedDurationMs: 15_000,
      playerCurrentTimeBeforeRecordingMs: 5_000,
      mediaDurationMs: 120_000,
      pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      geometry: {
        viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
        boundingClientRect: null, videoWidth: null, videoHeight: null,
        objectFit: null, objectPosition: null, fullscreen: false,
        fullscreenElement: null, scrollX: 0, scrollY: 0, frameMapping: null,
      },
    }), false);
  }
});

test('generic webpage video capture binds normalized article and frame/player identity', () => {
  const webSource = {
    kind: 'web-video',
    pageUrl: 'https://www.foxnews.com/politics/story?utm_source=mail#player',
    sourceKey: 'https://www.foxnews.com/politics/story',
    playerIdentity: 'web-video:1.2:2:1234abcd',
  };
  const webRequest = { ...request, source: webSource };
  assert.equal(isCaptureStartRequest(webRequest), true);
  assert.equal(sourceIdentityMatchesUrl(webSource, 'https://www.foxnews.com/politics/story?utm_medium=social'), true);
  assert.equal(sourceIdentityMatchesUrl(webSource, 'https://www.foxnews.com/politics/other'), false);
  assert.equal(isCaptureStartRequest({ ...webRequest, source: {
    ...webSource,
    playerIdentity: 'web-video:1.2:2:https://secret.example/video.m3u8',
  } }), false);
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
    captureId: request.captureId,
    streamId: 'stream',
    request,
    prepared,
  };
  assert.equal(isOffscreenStartMessage(message), true);
  assert.equal(isOffscreenStartMessage({ ...message, prepared: { ...prepared, requestedEndMs: 20_001 } }), false);
  assert.equal(isOffscreenStartMessage({ ...message, captureId: '55555555-5555-4555-8555-555555555555' }), false);
});

test('capture metadata v2 requires video end geometry and uses monotonic lead-in', () => {
  const geometry = {
    viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
    boundingClientRect: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
    videoWidth: 1920, videoHeight: 1080, objectFit: 'contain', objectPosition: '50% 50%',
    fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0,
  };
  const prepared = {
    sourceKind: 'youtube', requestedStartMs: 5_000, requestedEndMs: 20_000,
    requestedDurationMs: 15_000, playerCurrentTimeBeforeRecordingMs: 5_000,
    mediaDurationMs: 120_000, pageUrl: source.pageUrl, geometry,
  };
  const input = {
    prepared, endGeometry: geometry, selectedMimeType: 'video/webm;codecs=vp9,opus',
    tracks: [], audioTrackCount: 1, videoTrackCount: 1, loopbackEnabled: true,
    leadInMs: 37, recorderElapsedMs: 15_037, playerStartMs: 5_000, playerEndMs: 20_000,
  };
  assert.equal(isAudioOnlyCaptureSourceKind('youtube'), false);
  assert.equal(isAudioOnlyCaptureSourceKind('tiktok'), false);
  assert.equal(isAudioOnlyCaptureSourceKind('audio'), true);
  assert.equal(isAudioOnlyCaptureSourceKind('spotify'), true);
  assert.equal(isAudioOnlyCaptureSourceKind('youtube-audio'), false);
  assert.equal(isAudioOnlyCaptureSourceKind('tiktok-audio'), false);
  assert.equal(isAudioOnlyCaptureSourceKind('web-video-audio'), false);
  const result = buildCaptureMetadataV2(input);
  assert.equal(result.version, 2);
  assert.equal(result.timing.lead_in_clock, 'offscreen_monotonic');
  assert.equal(result.timing.lead_in_ms, 37);
  assert.deepEqual(result.viewport.start, result.viewport.end);
  assert.throws(() => buildCaptureMetadataV2({ ...input, endGeometry: null }), /recapture-required/);
});

test('generic webpage video capture rejects changed frame mapping before upload metadata is built', () => {
  const frameMapping = {
    path: '1.2', origin: 'https://www.foxnews.com', viewportWidth: 640, viewportHeight: 360,
    borderLeft: 0, borderRight: 0, borderTop: 0, borderBottom: 0,
  };
  const geometry = {
    viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1,
    boundingClientRect: { x: 100, y: 50, width: 640, height: 360, top: 50, right: 740, bottom: 410, left: 100 },
    videoWidth: 1280, videoHeight: 720, objectFit: 'contain', objectPosition: '50% 50%',
    fullscreen: false, fullscreenElement: null, scrollX: 0, scrollY: 0, frameMapping,
  };
  const prepared = {
    sourceKind: 'web-video', requestedStartMs: 1_000, requestedEndMs: 5_000,
    requestedDurationMs: 4_000, playerCurrentTimeBeforeRecordingMs: 1_000,
    mediaDurationMs: 120_000, pageUrl: 'https://www.foxnews.com/politics/story', geometry,
  };
  const input = { prepared, endGeometry: structuredClone(geometry), selectedMimeType: 'video/webm',
    tracks: [], audioTrackCount: 1, videoTrackCount: 1, loopbackEnabled: true,
    leadInMs: 10, recorderElapsedMs: 4_010, playerStartMs: 1_000, playerEndMs: 5_000 };
  assert.equal(buildCaptureMetadataV2(input).version, 2);
  input.endGeometry.frameMapping.path = '2.1';
  assert.throws(() => buildCaptureMetadataV2(input), /recapture-required/);
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

test('audio-only captures authorize and store audio/webm even if MediaRecorder labels codecs', () => {
  assert.equal(hostedRawUploadMimeType('audio'), 'audio/webm');
  assert.equal(hostedRawUploadMimeType('spotify'), 'audio/webm');
  assert.equal(hostedRawUploadMimeType('youtube'), 'video/webm');
});

test('upload completion retries a lost first handshake before failing', async () => {
  let attempts = 0;
  await completeHostedMediaUpload(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('UPLOAD_COMPLETION_FAILED');
  }, 3, async () => undefined);
  assert.equal(attempts, 3);
  await assert.rejects(completeHostedMediaUpload(async () => {
    throw new Error('UPLOAD_COMPLETION_FAILED');
  }, 2, async () => undefined), /UPLOAD_COMPLETION_FAILED/);
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
  const [config, background, serviceWorker, offscreen] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('./media-capture-background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/offscreen/main.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.match(background, /getContexts/);
  assert.match(background, /createDocument/);
  assert.match(background, /getMediaStreamId/);
  const beginBody = background.slice(background.indexOf('async function begin'));
  assert.ok(beginBody.indexOf('takeReservedTabCaptureStreamId') < beginBody.indexOf('validateAndPrepare(captureId'));
  assert.ok(beginBody.indexOf('getMediaStreamId') < beginBody.indexOf('validateAndPrepare(captureId'));
  assert.match(beginBody, /raceTabCaptureStreamId/);
  assert.match(background, /shouldReuseReservedTabCaptureStream/);
  assert.match(
    background.slice(background.indexOf('async function takeReservedTabCaptureStreamId')),
    /shouldReuseReservedTabCaptureStream/,
  );
  assert.match(beginBody, /request\.source\.pageUrl/);
  assert.match(beginBody, /isTabCaptureStreamId\(callerStreamId\)/);
  assert.ok(beginBody.indexOf('isTabCaptureStreamId(callerStreamId)') < beginBody.indexOf('takeReservedTabCaptureStreamId'));
  assert.match(beginBody, /validateAndPrepare\(captureId, request\)/);
  assert.match(serviceWorker, /openPanelOnActionClick: false/);
  const clickBody = serviceWorker.slice(serviceWorker.indexOf('chrome.action.onClicked'));
  assert.ok(clickBody.indexOf('sidePanel.open') < clickBody.indexOf('reserveTabCaptureStreamIdFromInvoke'));
  assert.ok(clickBody.indexOf('reserveTabCaptureStreamIdFromInvoke') < clickBody.indexOf('followBrowsingTab'));
  const panel = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const hosted = await readFile(new URL('./hosted-media.ts', import.meta.url), 'utf8');
  assert.match(panel, /hostedMediaProgressCopy/);
  assert.match(hosted, /userFacingCaptureMessage\(snapshot\)/);
  assert.match(hosted, /isPreparingCaptureStatus\(snapshot\.status\)/);
  assert.match(panel, /beginTabCaptureStreamIdFromUserGesture/);
  assert.match(panel, /resolvePanelTabCaptureStreamId/);
  assert.match(panel, /beginPublishTabCaptureStreamId/);
  assert.match(panel, /raceHostedCaptureStart/);
  assert.match(panel, /raceHostedCaptureCancel/);
  assert.match(panel, /mapTabCaptureStartFailure/);
  assert.match(panel, /shouldReplaceHostedCaptureSnapshot/);
  assert.match(panel, /canClearHostedAttentionWithoutLiveCancel/);
  assert.match(panel, /hostedCancelClearsLocalAttention/);
  assert.match(background, /if \(active && !await hasOffscreenDocument\(\)\)/);
  assert.match(offscreen, /raceTabCaptureStreamId\(mediaPromise\)/);
  assert.equal(
    background.match(/world: usesMainWorldCapture\((?:capture\.request|request)\.source\.kind\) \? 'MAIN' : 'ISOLATED'/g)?.length,
    3,
  );
  assert.match(background, /tabs\.onRemoved/);
  assert.match(background, /tabs\.onUpdated/);
  assert.match(offscreen, /new Blob\(/);
  assert.match(offscreen, /XMLHttpRequest/);
  assert.match(offscreen, /xhr\.open\('PUT', signedUrl\)/);
  assert.doesNotMatch(offscreen, /xhr\.open\('POST', signedUrl\)/);
  assert.match(offscreen, /xhr\.upload\.addEventListener\('progress'/);
  assert.match(offscreen, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(offscreen, /hostedRawUploadMimeType\(upload\.prepared\.sourceKind\)/);
  assert.match(offscreen, /hostedRawUploadMimeType\(active\.message\.prepared\.sourceKind\)/);
  assert.match(offscreen, /completeHostedMediaUpload\(\(\) => complete\(upload\)\)/);
  assert.match(offscreen, /sendResponse\(\{ ok: true, snapshot \}\)/);
  assert.match(offscreen, /expectVideo = !isAudioOnlyCaptureSourceKind\(message\.prepared\.sourceKind\)/);
  assert.match(offscreen, /!isAudioOnlyCaptureSourceKind\(upload\.prepared\.sourceKind\) &&/);
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
