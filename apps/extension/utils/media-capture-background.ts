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
  isMediaCaptureCancelMessage,
  isMediaCaptureStartMessage,
  isCurrentCaptureId,
  mapTabCaptureStartFailure,
  RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS,
  TAB_CAPTURE_STREAM_ID_TIMEOUT_MS,
  raceTabCaptureStreamId,
  shouldReuseReservedTabCaptureStream,
  tabCaptureStreamIdTimeoutError,
  sourceIdentityMatchesUrl,
  usesMainWorldCapture,
  type CaptureErrorSnapshot,
  type CaptureFailureCode,
  type CaptureSnapshot,
  type CaptureStartRequest,
  type CaptureStartResponse,
  type PreparationDiagnosticCode,
} from './media-capture.ts';

type ExtensionChrome = typeof browser;
type ActiveCapture = { captureId: string; request: CaptureStartRequest };
type ReservedTabCaptureStream = {
  tabId: number;
  streamId: string;
  reservedAt: number;
  pageUrl?: string;
};
const OFFSCREEN_URL = 'offscreen.html';
export const ACTIVE_CAPTURE_KEY = 'annotated.mediaCapture.active.v1';

let reservedTabCaptureStream: ReservedTabCaptureStream | null = null;
let reserveTabCaptureInFlight: Promise<ReservedTabCaptureStream | null> | null = null;
let reserveTabCaptureGeneration = 0;
let activeStreamIdTimeoutMs = TAB_CAPTURE_STREAM_ID_TIMEOUT_MS;
let activeReservedStreamMaxAgeMs = RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS;
const cancelledCaptureIds = new Set<string>();
const CANCELLED_CAPTURE_ID_LIMIT = 32;

function isCapturablePageUrl(url: string | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

export function reserveTabCaptureStreamIdFromInvoke(
  chrome: Pick<ExtensionChrome, 'tabCapture'>,
  tabId: number,
  pageUrl?: string,
): Promise<ReservedTabCaptureStream | null> {
  if (!Number.isInteger(tabId) || tabId < 0 || (pageUrl !== undefined && !isCapturablePageUrl(pageUrl))) {
    reservedTabCaptureStream = null;
    reserveTabCaptureInFlight = null;
    return Promise.resolve(null);
  }
  if (
    reservedTabCaptureStream &&
    shouldReuseReservedTabCaptureStream(
      reservedTabCaptureStream,
      tabId,
      pageUrl,
      Date.now(),
      activeReservedStreamMaxAgeMs,
    )
  ) {
    return Promise.resolve(reservedTabCaptureStream);
  }
  if (reservedTabCaptureStream) invalidateReservedTabCaptureStream();
  const generation = reserveTabCaptureGeneration;
  const pending = raceTabCaptureStreamId(
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }),
    activeStreamIdTimeoutMs,
  ).then((streamId) => {
    if (generation !== reserveTabCaptureGeneration) return null;
    if (!streamId) {
      reservedTabCaptureStream = null;
      return null;
    }
    const reserved = { tabId, streamId, reservedAt: Date.now(), pageUrl };
    reservedTabCaptureStream = reserved;
    return reserved;
  }).catch(() => {
    if (generation !== reserveTabCaptureGeneration) return null;
    reservedTabCaptureStream = null;
    return null;
  }).finally(() => {
    if (reserveTabCaptureInFlight === pending) reserveTabCaptureInFlight = null;
  });
  reserveTabCaptureInFlight = pending;
  return pending;
}

export function invalidateReservedTabCaptureStream(): void {
  reserveTabCaptureGeneration += 1;
  reservedTabCaptureStream = null;
  reserveTabCaptureInFlight = null;
}

function rememberCancelledCaptureId(captureId: string | null): void {
  if (!captureId) return;
  cancelledCaptureIds.add(captureId);
  if (cancelledCaptureIds.size > CANCELLED_CAPTURE_ID_LIMIT) {
    const oldest = cancelledCaptureIds.values().next().value;
    if (oldest) cancelledCaptureIds.delete(oldest);
  }
}

function consumeCancelledCaptureId(captureId: string): boolean {
  const cancelled = cancelledCaptureIds.has(captureId);
  if (cancelled) cancelledCaptureIds.delete(captureId);
  return cancelled;
}

async function takeReservedTabCaptureStreamId(
  tabId: number,
  pageUrl?: string,
): Promise<string | null> {
  if (reserveTabCaptureInFlight) {
    try {
      await raceTabCaptureStreamId(reserveTabCaptureInFlight, activeStreamIdTimeoutMs);
    } catch {
      if (!reservedTabCaptureStream) throw tabCaptureStreamIdTimeoutError();
    }
  }
  const reserved = reservedTabCaptureStream;
  if (
    !reserved ||
    !shouldReuseReservedTabCaptureStream(
      reserved,
      tabId,
      pageUrl,
      Date.now(),
      activeReservedStreamMaxAgeMs,
    )
  ) {
    // Drop stale or navigated IDs so Publish can re-acquire under the
    // still-valid activeTab grant instead of handing Chrome an expired ID.
    if (reserved && reserved.tabId === tabId) reservedTabCaptureStream = null;
    return null;
  }
  reservedTabCaptureStream = null;
  return reserved.streamId;
}

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

export function installMediaCapture(
  chrome: ExtensionChrome,
  options?: { streamIdTimeoutMs?: number; reservedStreamMaxAgeMs?: number },
) {
  reservedTabCaptureStream = null;
  reserveTabCaptureInFlight = null;
  reserveTabCaptureGeneration += 1;
  cancelledCaptureIds.clear();
  activeStreamIdTimeoutMs = options?.streamIdTimeoutMs ?? TAB_CAPTURE_STREAM_ID_TIMEOUT_MS;
  activeReservedStreamMaxAgeMs = options?.reservedStreamMaxAgeMs ?? RESERVED_TAB_CAPTURE_STREAM_MAX_AGE_MS;
  let active: ActiveCapture | null = null;
  let lastSnapshot: CaptureSnapshot = { status: 'idle' };
  let creatingOffscreen: Promise<void> | null = null;
  let activePersistence: Promise<void> = Promise.resolve();
  const offscreenUrl = (chrome.runtime.getURL as (path: string) => string)(OFFSCREEN_URL);
  const restoreActive = chrome.storage.session.get(ACTIVE_CAPTURE_KEY).then((stored) => {
    const value = stored[ACTIVE_CAPTURE_KEY] as {
      captureId?: unknown;
      request?: Partial<CaptureStartRequest>;
    } | undefined;
    if (
      value && typeof value.captureId === 'string' && value.request &&
      value.request.captureId === value.captureId &&
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
    const persist = async () => {
      if (!value) return chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
      const { accessToken: _accessToken, ...safeRequest } = value.request;
      return chrome.storage.session.set({
        [ACTIVE_CAPTURE_KEY]: { captureId: value.captureId, request: safeRequest },
      });
    };
    const next = activePersistence.then(persist, persist);
    activePersistence = next.then(() => undefined, () => undefined);
    await next;
  }

  async function clearActiveIfCurrent(captureId: string) {
    if (active?.captureId !== captureId) return false;
    await persistActive(null);
    return true;
  }

  function liveCaptureId(): string | null {
    return active?.captureId ?? null;
  }

  async function hasOffscreenDocument() {
    return (await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    })).length > 0;
  }

  function snapshotRetainsCapture(snapshot: CaptureSnapshot, captureId: string) {
    if (!('captureId' in snapshot) || snapshot.captureId !== captureId) return false;
    return ['capturing', 'stopping', 'uploading', 'waiting-to-upload'].includes(snapshot.status) ||
      (snapshot.status === 'error' && snapshot.code === 'upload-failed');
  }

  async function reconcileActiveCapture() {
    await restoreActive;
    const capture = active;
    if (!capture) return;
    if (lastSnapshot.status === 'preparing' && lastSnapshot.captureId === capture.captureId) return;
    if (
      lastSnapshot.status === 'idle' ||
      lastSnapshot.status === 'verifying-upload' ||
      lastSnapshot.status === 'processing' ||
      lastSnapshot.status === 'cancelled'
    ) {
      await clearActiveIfCurrent(capture.captureId);
      return;
    }
    if (!await hasOffscreenDocument()) {
      await clearActiveIfCurrent(capture.captureId);
      return;
    }
    try {
      const response = await raceTabCaptureStreamId(chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_STATUS,
      }), activeStreamIdTimeoutMs);
      const offscreenSnapshot = response?.snapshot as CaptureSnapshot | undefined;
      if (!offscreenSnapshot || typeof offscreenSnapshot !== 'object') return;
      if (
        'captureId' in offscreenSnapshot && typeof offscreenSnapshot.captureId === 'string' &&
        offscreenSnapshot.captureId !== capture.captureId
      ) return;
      lastSnapshot = offscreenSnapshot;
      if (!snapshotRetainsCapture(offscreenSnapshot, capture.captureId)) {
        await clearActiveIfCurrent(capture.captureId);
      }
    } catch { /* Fail closed while the offscreen recorder cannot be reconciled. */ }
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
        // No bearer token or delivery URL is passed into the page world.
        world: usesMainWorldCapture(capture.request.source.kind) ? 'MAIN' : 'ISOLATED',
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
    await clearActiveIfCurrent(capture.captureId);
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
        // Generic-video preparation requires readable same-origin frame traversal.
        world: usesMainWorldCapture(request.source.kind) ? 'MAIN' : 'ISOLATED',
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
    await reconcileActiveCapture();
    if (active) return { ok: false, snapshot: failure('busy', 'Another media capture is already active.', active.captureId) };
    const captureId = request.captureId;
    const capture = { captureId, request };
    const preparing: CaptureSnapshot = { status: 'preparing', captureId };
    // Pair the in-memory identity and snapshot before persistence can yield to status reconciliation.
    lastSnapshot = preparing;
    await persistActive(capture);
    emit(preparing);
    try {
      if (consumeCancelledCaptureId(captureId) || !isCurrentCaptureId(liveCaptureId(), captureId)) {
        await clearActiveIfCurrent(captureId);
        const snapshot = {
          status: 'cancelled' as const,
          captureId,
          code: 'unexpected' as const,
          message: 'Capture cancelled by the user.',
        };
        emit(snapshot, request.operation);
        return { ok: false, snapshot };
      }
      // Chrome gates getMediaStreamId like activeTab. Take a fresh
      // toolbar-reserved ID or obtain one before prepare/offscreen so the
      // grant check is not buried after scripting. A reserved ID older than
      // the freshness window is dropped: Chrome expires unused stream IDs,
      // and Recapture already proves a later getMediaStreamId still works
      // under the toolbar invoke. Re-acquire here so first Publish after
      // commentary prep does not require a manual Recapture.
      const streamId = await takeReservedTabCaptureStreamId(
        request.tabId,
        request.source.pageUrl,
      ) ?? await raceTabCaptureStreamId(
        chrome.tabCapture.getMediaStreamId({ targetTabId: request.tabId }),
        activeStreamIdTimeoutMs,
      );
      if (consumeCancelledCaptureId(captureId) || !isCurrentCaptureId(liveCaptureId(), captureId)) {
        await clearActiveIfCurrent(captureId);
        const snapshot = {
          status: 'cancelled' as const,
          captureId,
          code: 'unexpected' as const,
          message: 'Capture cancelled by the user.',
        };
        emit(snapshot, request.operation);
        return { ok: false, snapshot };
      }
      if (!streamId) {
        const snapshot = failure('stream-id-unavailable', 'Chrome returned an empty tab capture stream ID.', captureId);
        await clearActiveIfCurrent(captureId);
        emit(snapshot);
        return { ok: false, snapshot };
      }
      const prepared = await raceTabCaptureStreamId(
        validateAndPrepare(captureId, request),
        activeStreamIdTimeoutMs,
      );
      if (!prepared.ok) {
        await clearActiveIfCurrent(captureId);
        console.warn('[Annotated capture preparation]', {
          code: prepared.code,
          captureId,
          tabId: request.tabId,
        });
        const snapshot = failure(captureFailureCode(prepared.code), prepared.message, captureId, prepared.code);
        emit(snapshot);
        return { ok: false, snapshot };
      }
      await raceTabCaptureStreamId(ensureOffscreenDocument(), activeStreamIdTimeoutMs);
      const started = await raceTabCaptureStreamId(chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_START,
        captureId,
        streamId,
        request,
        prepared: prepared.prepared,
      }), activeStreamIdTimeoutMs) as CaptureSnapshot | undefined;
      if (!started || typeof started !== 'object' || !('status' in started)) {
        throw new Error('The offscreen recorder did not accept the capture start.');
      }
      if (started.status === 'error') {
        await clearActiveIfCurrent(captureId);
        emit(started);
        return { ok: false, snapshot: started };
      }
      const playback = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        // Keep YouTube and audio isolated; only generic webpage video uses MAIN.
        world: usesMainWorldCapture(request.source.kind) ? 'MAIN' : 'ISOLATED',
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
      const snapshot: CaptureErrorSnapshot = typeof error === 'object' && error && 'status' in error &&
        (error as CaptureSnapshot).status === 'error' && 'code' in error && 'message' in error
        ? error as CaptureErrorSnapshot
        : mapTabCaptureStartFailure(error, captureId);
      try {
        if (await hasOffscreenDocument()) {
          await cancelActive(snapshot.code, snapshot.message);
        } else {
          await clearActiveIfCurrent(captureId);
        }
      } catch { /* Cancellation is best-effort; the start failure is authoritative. */ }
      emit(snapshot, request.operation);
      return { ok: false, snapshot };
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isMediaCaptureStartMessage(message)) {
      void begin(message.request).then(sendResponse, (error: unknown) => {
        sendResponse({
          ok: false,
          snapshot: mapTabCaptureStartFailure(error, message.request.captureId),
        });
      });
      return true;
    }
    if (isMediaCaptureCancelMessage(message)) {
      void (async () => {
        await restoreActive;
        rememberCancelledCaptureId(message.captureId);
        if (active && !await hasOffscreenDocument()) {
          await clearActiveIfCurrent(active.captureId);
        }
        const capture = active;
        const sameOperation = Boolean(
          capture && capture.request.operation.annotationId === message.operation.annotationId &&
          capture.request.operation.mediaId === message.operation.mediaId,
        );
        const sameCapture = message.captureId === null || message.captureId === capture?.captureId;
        if (!capture) {
          invalidateReservedTabCaptureStream();
          lastSnapshot = { status: 'idle' };
          sendResponse({ ok: true, cancelled: true });
          return;
        }
        if (!sameOperation || !sameCapture) {
          sendResponse({ ok: true, cancelled: false });
          return;
        }
        invalidateReservedTabCaptureStream();
        const cancelled = await cancelActive('unexpected', 'Capture cancelled by the user.');
        sendResponse({ ok: true, cancelled });
      })();
      return true;
    }
    if (typeof message !== 'object' || message === null || !('target' in message)) return undefined;
    const row = message as Record<string, unknown>;
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_CANCEL) {
      sendResponse({ ok: false, cancelled: false, error: 'Malformed capture cancellation request.' });
      return undefined;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_RETRY) {
      if (typeof row.captureId !== 'string' || typeof row.accessToken !== 'string' ||
          row.accessToken.length < 20 || !active || row.captureId !== active.captureId) {
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
        await reconcileActiveCapture();
        if (active && await hasOffscreenDocument()) {
          try {
            const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: MEDIA_CAPTURE_OFFSCREEN_STATUS });
            const snapshot = response?.snapshot as CaptureSnapshot | undefined;
            const expectedCaptureId = active?.captureId ??
              ('captureId' in lastSnapshot ? lastSnapshot.captureId : null);
            if (
              snapshot && typeof snapshot === 'object' && 'captureId' in snapshot &&
              snapshot.captureId === expectedCaptureId
            ) lastSnapshot = snapshot;
          } catch { /* Use last known safe snapshot. */ }
        }
        sendResponse({ ok: true, snapshot: lastSnapshot, operation: active?.request.operation ?? null });
      })();
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_OFFSCREEN_EVENT) {
      const snapshot = row.snapshot as CaptureSnapshot | undefined;
      const capture = active;
      if (!capture || !snapshot || typeof snapshot !== 'object' ||
          !('captureId' in snapshot) || snapshot.captureId !== capture.captureId) {
        sendResponse({ ok: false, error: 'Stale capture identifier.' });
        return undefined;
      }
      void (async () => {
        const terminal = snapshot.status === 'verifying-upload' || snapshot.status === 'processing' ||
          snapshot.status === 'cancelled' || snapshot.status === 'error';
        if (terminal) {
          const end = await finishPage(capture);
          if (end) await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'annotated.mediaCapture.offscreenPlayerEnd.v1',
            captureId: capture.captureId,
            playerEndMs: end.currentTimeMs,
            geometry: end.geometry,
          }).catch(() => undefined);
        }
        emit(snapshot, capture.request.operation);
        if (terminal && (snapshot.status !== 'error' || snapshot.code !== 'upload-failed')) {
          await clearActiveIfCurrent(capture.captureId);
        }
        sendResponse({ ok: true });
      })();
      return true;
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
    if (reservedTabCaptureStream?.tabId === tabId && typeof changeInfo.url === 'string') {
      invalidateReservedTabCaptureStream();
    }
    const capture = active;
    if (!capture || capture.request.tabId !== tabId || typeof changeInfo.url !== 'string') return;
    if (!sourceIdentityMatchesUrl(capture.request.source, changeInfo.url)) {
      void cancelActive('connected-source-changed', 'The connected source changed during capture.');
    }
  });
}
