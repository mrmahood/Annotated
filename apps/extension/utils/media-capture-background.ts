import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  finishMediaCaptureOnPage,
  playMediaForCaptureOnPage,
  prepareMediaCaptureOnPage,
  readTopFramePreparationResult,
  type PrepareCapturePageResult,
} from './media-capture-page.ts';
import {
  MEDIA_CAPTURE_CANCEL,
  MEDIA_CAPTURE_EVENT,
  MEDIA_CAPTURE_OFFSCREEN_CANCEL,
  MEDIA_CAPTURE_OFFSCREEN_EVENT,
  MEDIA_CAPTURE_OFFSCREEN_NEEDS_END,
  MEDIA_CAPTURE_OFFSCREEN_PLAYBACK,
  MEDIA_CAPTURE_OFFSCREEN_RETRY,
  MEDIA_CAPTURE_OFFSCREEN_START,
  MEDIA_CAPTURE_OFFSCREEN_STATUS,
  MEDIA_CAPTURE_RETRY,
  MEDIA_CAPTURE_START,
  MEDIA_CAPTURE_STATUS,
  isMediaCaptureStartMessage,
  isCurrentCaptureId,
  sourceIdentityMatchesUrl,
  type CaptureFailureCode,
  type CaptureSnapshot,
  type CaptureStartRequest,
  type CaptureStartResponse,
  type PreparationDiagnosticCode,
} from './media-capture.ts';

type ExtensionChrome = typeof browser;
type ActiveCapture = { captureId: string; request: CaptureStartRequest };
const OFFSCREEN_URL = 'offscreen.html';
const ACTIVE_CAPTURE_KEY = 'annotated.mediaCapture.active.v1';

function failure(code: CaptureFailureCode, message: string, captureId: string | null = null, diagnosticCode?: PreparationDiagnosticCode): CaptureSnapshot {
  return { status: 'error', code, message, captureId, ...(diagnosticCode ? { diagnosticCode } : {}) };
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

function captureFailureCode(code: PreparationDiagnosticCode): CaptureFailureCode {
  if (code === 'RANGE_INVALID') return 'invalid-request';
  if (code === 'SOURCE_CHANGED' || code === 'NAVIGATION_CHANGED' || code === 'STALE_CAPTURE') {
    return 'connected-source-changed';
  }
  if (code === 'PLAYER_NOT_FOUND' || code === 'PLAYER_NOT_READY') return 'player-unavailable';
  return 'unexpected';
}

export function installMediaCapture(chrome: ExtensionChrome) {
  let active: ActiveCapture | null = null;
  let lastSnapshot: CaptureSnapshot = { status: 'idle' };
  let creatingOffscreen: Promise<void> | null = null;
  const offscreenUrl = (chrome.runtime.getURL as (path: string) => string)(OFFSCREEN_URL);
  const restoreActive = chrome.storage.session.get(ACTIVE_CAPTURE_KEY).then((stored) => {
    const value = stored[ACTIVE_CAPTURE_KEY] as {
      captureId?: unknown;
      request?: Partial<CaptureStartRequest>;
    } | undefined;
    if (
      value && typeof value.captureId === 'string' && value.request &&
      typeof value.request.tabId === 'number' && value.request.source &&
      typeof value.request.startMs === 'number' && typeof value.request.endMs === 'number' &&
      value.request.operation && typeof value.request.apiOrigin === 'string'
    ) {
      active = {
        captureId: value.captureId,
        request: { ...value.request, accessToken: '' } as CaptureStartRequest,
      };
    }
  }).catch(() => undefined);

  async function persistActive(value: ActiveCapture | null) {
    active = value;
    if (!value) return chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
    const { accessToken: _accessToken, ...safeRequest } = value.request;
    return chrome.storage.session.set({
      [ACTIVE_CAPTURE_KEY]: { captureId: value.captureId, request: safeRequest },
    });
  }

  async function hasOffscreenDocument() {
    return (await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    })).length > 0;
  }

  async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    if (!creatingOffscreen) {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
        justification: 'Capture an explicitly selected connected-tab media range and upload it privately.',
      }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
  }

  function emit(snapshot: CaptureSnapshot, operation = active?.request.operation ?? null) {
    lastSnapshot = snapshot;
    void chrome.runtime.sendMessage({ target: 'panel', type: MEDIA_CAPTURE_EVENT, snapshot, operation })
      .catch((error: unknown) => {
        if (!errorText(error).includes('Receiving end does not exist')) {
          console.warn('Unable to notify the Annotated side panel:', error);
        }
      });
  }

  async function finishPage(capture: ActiveCapture) {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: capture.request.tabId, frameIds: [0] },
        func: finishMediaCaptureOnPage,
        args: [capture.request.source, true],
      });
      return result[0]?.result ?? null;
    } catch { return null; }
  }

  async function cancelActive(code: CaptureFailureCode, message: string) {
    const capture = active;
    if (!capture) return false;
    try {
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_CANCEL,
        captureId: capture.captureId,
        code,
        message,
      });
    } catch { /* The offscreen document may already have stopped. */ }
    await finishPage(capture);
    await persistActive(null);
    emit({ status: 'cancelled', captureId: capture.captureId, code, message }, capture.request.operation);
    return true;
  }

  async function validateAndPrepare(captureId: string, request: CaptureStartRequest): Promise<PrepareCapturePageResult> {
    if (!isCurrentCaptureId(active?.captureId ?? null, captureId)) {
      return { ok: false, code: 'STALE_CAPTURE', message: 'This capture request is no longer active.' };
    }
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (!isActiveTabContext(context) || context.tabId !== request.tabId ||
        context.url !== request.source.pageUrl ||
        !sourceIdentityMatchesUrl(request.source, context.url)) {
      return { ok: false, code: 'SOURCE_CHANGED', message: 'The request no longer matches the explicitly connected tab.' };
    }
    if (!isCurrentCaptureId(active?.captureId ?? null, captureId)) {
      return { ok: false, code: 'STALE_CAPTURE', message: 'This capture request is no longer active.' };
    }
    let tab: Browser.tabs.Tab;
    try { tab = await chrome.tabs.get(request.tabId); }
    catch { return { ok: false, code: 'NAVIGATION_CHANGED', message: 'The connected tab was closed.' }; }
    if (typeof tab.url !== 'string' || !sourceIdentityMatchesUrl(request.source, tab.url)) {
      return { ok: false, code: 'NAVIGATION_CHANGED', message: 'The connected tab navigated to another source.' };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        func: prepareMediaCaptureOnPage,
        args: [{ source: request.source, startMs: request.startMs, endMs: request.endMs }],
      });
      if (!isCurrentCaptureId(active?.captureId ?? null, captureId)) {
        return { ok: false, code: 'STALE_CAPTURE', message: 'This capture request is no longer active.' };
      }
      let currentTab: Browser.tabs.Tab;
      try { currentTab = await chrome.tabs.get(request.tabId); }
      catch { return { ok: false, code: 'NAVIGATION_CHANGED', message: 'The connected tab was closed.' }; }
      if (typeof currentTab.url !== 'string' || !sourceIdentityMatchesUrl(request.source, currentTab.url)) {
        return { ok: false, code: 'NAVIGATION_CHANGED', message: 'The connected tab navigated during preparation.' };
      }
      return readTopFramePreparationResult(results);
    } catch {
      return { ok: false, code: 'SCRIPT_INJECTION_FAILED', message: 'The connected player could not be prepared.' };
    }
  }

  async function begin(request: CaptureStartRequest): Promise<CaptureStartResponse> {
    await restoreActive;
    if (active && !await hasOffscreenDocument()) await persistActive(null);
    if (active) return { ok: false, snapshot: failure('busy', 'Another media capture is already active.', active.captureId) };
    const captureId = crypto.randomUUID();
    const capture = { captureId, request };
    await persistActive(capture);
    emit({ status: 'preparing', captureId });
    try {
      const prepared = await validateAndPrepare(captureId, request);
      if (!prepared.ok) {
        await persistActive(null);
        console.warn('[Annotated capture preparation]', {
          code: prepared.code,
          captureId,
          tabId: request.tabId,
        });
        const snapshot = failure(captureFailureCode(prepared.code), prepared.message, captureId, prepared.code);
        emit(snapshot);
        return { ok: false, snapshot };
      }
      await ensureOffscreenDocument();
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: request.tabId });
      if (!streamId) throw failure('stream-id-unavailable', 'Chrome returned an empty tab capture stream ID.', captureId);
      const started = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_START,
        captureId,
        streamId,
        request,
        prepared: prepared.prepared,
      }) as CaptureSnapshot;
      if (started.status === 'error') {
        await persistActive(null);
        emit(started);
        return { ok: false, snapshot: started };
      }
      const playback = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        func: playMediaForCaptureOnPage,
        args: [request.source, request.startMs],
      });
      const acknowledgement = playback[0]?.result;
      if (!acknowledgement?.ok) {
        await cancelActive('player-unavailable', 'The connected player did not begin playback for capture.');
        const snapshot = failure('player-unavailable', 'The connected player did not begin playback for capture.', captureId);
        return { ok: false, snapshot };
      }
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_PLAYBACK,
        captureId,
        acknowledgedAtMs: acknowledgement.acknowledgedAtMs,
        playerStartMs: acknowledgement.currentTimeMs,
      });
      return { ok: true, snapshot: started };
    } catch (error) {
      await cancelActive(
        /permission|denied/i.test(errorText(error)) ? 'tab-capture-denied' : 'unexpected',
        `Capture could not start: ${errorText(error)}`,
      );
      const snapshot = typeof error === 'object' && error && 'status' in error
        ? error as CaptureSnapshot
        : failure('unexpected', `Capture could not start: ${errorText(error)}`, captureId);
      return { ok: false, snapshot };
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isMediaCaptureStartMessage(message)) {
      void begin(message.request).then(sendResponse);
      return true;
    }
    if (typeof message !== 'object' || message === null || !('target' in message)) return undefined;
    const row = message as Record<string, unknown>;
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_CANCEL) {
      void cancelActive('unexpected', 'Capture cancelled by the user.').then(sendResponse);
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_RETRY) {
      if (typeof row.captureId !== 'string' || typeof row.accessToken !== 'string' ||
          row.accessToken.length < 20) {
        sendResponse({ ok: false, error: 'Malformed upload retry request.' });
        return undefined;
      }
      void ensureOffscreenDocument().then(() => chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_RETRY,
        captureId: row.captureId,
        accessToken: row.accessToken,
      })).then(sendResponse);
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_STATUS) {
      void (async () => {
        if (await hasOffscreenDocument()) {
          try {
            const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: MEDIA_CAPTURE_OFFSCREEN_STATUS });
            if (response?.snapshot) lastSnapshot = response.snapshot;
          } catch { /* Use last known safe snapshot. */ }
        }
        sendResponse({ ok: true, snapshot: lastSnapshot, operation: active?.request.operation ?? null });
      })();
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_OFFSCREEN_EVENT) {
      const snapshot = row.snapshot as CaptureSnapshot;
      const capture = active;
      if (snapshot?.status === 'verifying-upload' || snapshot?.status === 'processing' ||
          snapshot?.status === 'cancelled' || snapshot?.status === 'error') {
        if (capture && (!('captureId' in snapshot) || snapshot.captureId === capture.captureId)) {
          void finishPage(capture).then((end) => {
            if (end) void chrome.runtime.sendMessage({
              target: 'offscreen',
              type: 'annotated.mediaCapture.offscreenPlayerEnd.v1',
              captureId: capture.captureId,
              playerEndMs: end.currentTimeMs,
              geometry: end.geometry,
            }).catch(() => undefined);
          });
          if (snapshot.status !== 'error' || snapshot.code !== 'upload-failed') void persistActive(null);
        }
      }
      emit(snapshot, capture?.request.operation ?? null);
      sendResponse({ ok: true });
      return undefined;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_OFFSCREEN_NEEDS_END) {
      const capture = active;
      if (!capture || row.captureId !== capture.captureId) {
        sendResponse({ ok: false, error: 'Stale capture identifier.' });
        return undefined;
      }
      void finishPage(capture).then((end) => chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'annotated.mediaCapture.offscreenPlayerEnd.v1',
        captureId: capture.captureId,
        playerEndMs: end?.currentTimeMs ?? null,
        geometry: end?.geometry ?? null,
      })).then(sendResponse);
      return true;
    }
    return undefined;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (active?.request.tabId === tabId) void cancelActive('connected-tab-closed', 'The connected tab closed during capture.');
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const capture = active;
    if (!capture || capture.request.tabId !== tabId || typeof changeInfo.url !== 'string') return;
    if (!sourceIdentityMatchesUrl(capture.request.source, changeInfo.url)) {
      void cancelActive('connected-source-changed', 'The connected source changed during capture.');
    }
  });
}
