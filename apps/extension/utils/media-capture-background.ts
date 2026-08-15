import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
} from './active-tab-context';
import {
  createPrepareCapturePageRequest,
  finishMediaCaptureOnPage,
  playMediaForCaptureOnPage,
  prepareMediaCaptureOnPage,
  type PrepareCapturePageRequest,
  type PrepareCapturePageResult,
} from './media-capture-page';
import {
  MEDIA_CAPTURE_CANCEL,
  MEDIA_CAPTURE_CLEAR,
  MEDIA_CAPTURE_EVENT,
  MEDIA_CAPTURE_MAX_DURATION_MS,
  MEDIA_CAPTURE_OFFSCREEN_CANCEL,
  MEDIA_CAPTURE_OFFSCREEN_CLEAR,
  MEDIA_CAPTURE_OFFSCREEN_EVENT,
  MEDIA_CAPTURE_OFFSCREEN_START,
  MEDIA_CAPTURE_OFFSCREEN_STATUS,
  MEDIA_CAPTURE_START,
  MEDIA_CAPTURE_STATUS,
  isCaptureStartRequest,
  isMediaCaptureStartMessage,
  getCaptureIntentDiagnostic,
  sourceIdentityMatchesUrl,
  type CaptureFailure,
  type CaptureProtocolDiagnostics,
  type CaptureResult,
  type CaptureSnapshot,
  type CaptureStartRequest,
  type CaptureStartResponse,
} from './media-capture-spike';

type ExtensionChrome = typeof browser;

type ActiveBackgroundCapture = {
  captureId: string;
  request: CaptureStartRequest;
};

const OFFSCREEN_URL = 'offscreen.html';
const ACTIVE_CAPTURE_SESSION_KEY = 'annotated.mediaCaptureSpike.active.v1';

function failure(
  code: CaptureFailure['code'],
  message: string,
  captureId: string | null = null,
): CaptureFailure {
  return { captureId, status: 'error', code, message };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function installMediaCaptureSpike(chrome: ExtensionChrome) {
  let active: ActiveBackgroundCapture | null = null;
  let lastSnapshot: CaptureSnapshot = { status: 'idle' };
  let creatingOffscreen: Promise<void> | null = null;
  let cancellingCaptureId: string | null = null;

  // WXT's generated PublicPath union is refreshed after prepare/build discovers
  // this new unlisted page; the runtime API accepts its emitted relative path.
  const offscreenDocumentUrl = (chrome.runtime.getURL as (path: string) => string)(OFFSCREEN_URL);
  const restoreActive = chrome.storage.session.get(ACTIVE_CAPTURE_SESSION_KEY)
    .then((stored) => {
      const value = stored[ACTIVE_CAPTURE_SESSION_KEY];
      if (
        typeof value === 'object' && value !== null &&
        typeof (value as { captureId?: unknown }).captureId === 'string' &&
        isCaptureStartRequest((value as { request?: unknown }).request)
      ) active = value as ActiveBackgroundCapture;
    })
    .catch((error: unknown) => {
      console.warn('Unable to restore transient media capture metadata:', error);
    });

  async function setActiveCapture(capture: ActiveBackgroundCapture) {
    active = capture;
    await chrome.storage.session.set({ [ACTIVE_CAPTURE_SESSION_KEY]: capture });
  }

  async function clearActiveCapture(captureId?: string) {
    if (captureId && active?.captureId !== captureId) return;
    active = null;
    await chrome.storage.session.remove(ACTIVE_CAPTURE_SESSION_KEY).catch(() => undefined);
  }

  async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenDocumentUrl],
    });
    return contexts.length > 0;
  }

  async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    if (!creatingOffscreen) {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
        justification: 'Record an explicitly requested connected-tab media test clip and preserve audible playback.',
      }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
  }

  async function closeOffscreenDocument() {
    if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
  }

  function emitToPanel(snapshot: CaptureSnapshot) {
    lastSnapshot = snapshot;
    void chrome.runtime.sendMessage({
      target: 'panel',
      type: MEDIA_CAPTURE_EVENT,
      snapshot,
    }).catch((error: unknown) => {
      const message = errorText(error);
      if (!message.includes('Receiving end does not exist')) {
        console.warn('Unable to notify the media capture spike UI:', error);
      }
    });
  }

  async function pauseAndReadPlayer(capture: ActiveBackgroundCapture) {
    try {
      const execution = await chrome.scripting.executeScript({
        target: { tabId: capture.request.tabId, frameIds: [0] },
        func: finishMediaCaptureOnPage,
        args: [capture.request.source, true],
      });
      const result = execution[0]?.result;
      return result && typeof result === 'object' &&
        typeof (result as { currentTimeMs?: unknown }).currentTimeMs === 'number'
        ? (result as { currentTimeMs: number }).currentTimeMs
        : null;
    } catch {
      return null;
    }
  }

  async function cancelCapture(
    code: CaptureFailure['code'],
    message: string,
  ) {
    const capture = active;
    if (!capture) return false;
    if (cancellingCaptureId === capture.captureId) return true;
    cancellingCaptureId = capture.captureId;
    try {
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_CANCEL,
        captureId: capture.captureId,
        code,
        message,
      });
    } catch (error) {
      cancellingCaptureId = null;
      await pauseAndReadPlayer(capture);
      await clearActiveCapture(capture.captureId);
      const next = failure(code, `${message} Cleanup message failed: ${errorText(error)}`, capture.captureId);
      emitToPanel(next);
      await closeOffscreenDocument().catch(() => undefined);
    }
    return true;
  }

  async function prepareConnectedTab(
    captureId: string,
    request: CaptureStartRequest,
    prepareRequest: PrepareCapturePageRequest,
  ): Promise<PrepareCapturePageResult> {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (!isActiveTabContext(context) || context.tabId !== request.tabId) {
      return {
        ok: false,
        code: 'connected-source-changed',
        message: 'The capture request does not match Annotated\'s explicitly connected tab.',
      };
    }
    if (
      !sourceIdentityMatchesUrl(request.source, context.url) ||
      request.source.pageUrl !== context.url
    ) {
      return {
        ok: false,
        code: 'connected-source-changed',
        message: 'The capture request no longer belongs to Annotated\'s connected source.',
      };
    }
    let tab: Browser.tabs.Tab;
    try { tab = await chrome.tabs.get(request.tabId); }
    catch {
      return { ok: false, code: 'connected-source-changed', message: 'The connected tab was closed.' };
    }
    if (typeof tab.url !== 'string' || !sourceIdentityMatchesUrl(request.source, tab.url)) {
      return {
        ok: false,
        code: 'connected-source-changed',
        message: 'The connected tab navigated to a different source.',
      };
    }
    try {
      const execution = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        func: prepareMediaCaptureOnPage,
        args: [prepareRequest],
      });
      const result = execution[0]?.result as PrepareCapturePageResult | undefined;
      return result ?? {
        ok: false,
        code: 'player-unavailable',
        message: `The connected player returned no preparation result for ${captureId}.`,
      };
    } catch (error) {
      const message = errorText(error);
      return {
        ok: false,
        code: /cannot access|cannot be scripted|missing host permission|chrome:\/\//i.test(message)
          ? 'player-unavailable'
          : 'player-unavailable',
        message: `The connected page player could not be prepared: ${message}`,
      };
    }
  }

  async function beginCapture(request: CaptureStartRequest) {
    const prepareRequest = createPrepareCapturePageRequest(request, MEDIA_CAPTURE_MAX_DURATION_MS);
    const protocolDiagnostics: CaptureProtocolDiagnostics = {
      backgroundAccepted: getCaptureIntentDiagnostic(request.intent),
      preparePageInput: {
        ...getCaptureIntentDiagnostic(prepareRequest.intent),
        maximumDurationMs: prepareRequest.maximumDurationMs,
      },
    };
    const respond = (
      ok: boolean,
      snapshot: CaptureSnapshot,
    ): CaptureStartResponse => ({ ok, snapshot, protocolDiagnostics });
    console.info(
      '[Annotated media capture spike] background accepted request',
      protocolDiagnostics.backgroundAccepted,
    );
    console.info(
      '[Annotated media capture spike] prepareCapturePage executeScript input',
      protocolDiagnostics.preparePageInput,
    );
    await restoreActive;
    if (active && !await hasOffscreenDocument()) {
      await clearActiveCapture(active.captureId);
    }
    if (active) return respond(
      false,
      failure('busy', 'Another media capture is already active.', active.captureId),
    );
    const captureId = crypto.randomUUID();
    await setActiveCapture({ captureId, request });
    const preparing: CaptureSnapshot = { status: 'preparing', captureId };
    emitToPanel(preparing);

    try {
      const prepared = await prepareConnectedTab(captureId, request, prepareRequest);
      if (prepared.protocolDiagnostic) {
        protocolDiagnostics.preparePageInput = prepared.protocolDiagnostic;
      }
      if (!prepared.ok) {
        await clearActiveCapture(captureId);
        const next = failure(prepared.code, prepared.message, captureId);
        emitToPanel(next);
        return respond(false, next);
      }
      await ensureOffscreenDocument();

      let streamId: string;
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: request.tabId });
      } catch (error) {
        throw failure(
          /denied|permission|activeTab/i.test(errorText(error)) ? 'tab-capture-denied' : 'stream-id-unavailable',
          `Chrome did not provide a tab capture stream ID: ${errorText(error)}`,
          captureId,
        );
      }
      if (!streamId) {
        throw failure('stream-id-unavailable', 'Chrome returned an empty tab capture stream ID.', captureId);
      }

      const offscreenSnapshot = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_START,
        captureId,
        streamId,
        prepared: prepared.prepared,
      }) as CaptureSnapshot | undefined;
      if (!offscreenSnapshot || offscreenSnapshot.status !== 'recording') {
        const next = offscreenSnapshot && (offscreenSnapshot.status === 'error' || offscreenSnapshot.status === 'cancelled')
          ? offscreenSnapshot
          : failure('offscreen-unavailable', 'The offscreen recorder did not start.', captureId);
        await clearActiveCapture(captureId);
        emitToPanel(next);
        await closeOffscreenDocument().catch(() => undefined);
        return respond(false, next);
      }

      const playback = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        func: playMediaForCaptureOnPage,
        args: [request.source, prepared.prepared.requestedStartMs],
      });
      const playbackResult = playback[0]?.result;
      if (!playbackResult?.ok) {
        await cancelCapture(
          playbackResult?.message === 'connected-source-changed'
            ? 'connected-source-changed'
            : 'player-unavailable',
          `Recording was cancelled because player playback did not start${playbackResult?.message ? `: ${playbackResult.message}` : '.'}`,
        );
        return respond(
          false,
          failure('player-unavailable', 'The connected player could not start playback.', captureId),
        );
      }
      emitToPanel(offscreenSnapshot);
      return respond(true, offscreenSnapshot);
    } catch (error) {
      const next = typeof error === 'object' && error !== null &&
        'status' in error && (error as { status: unknown }).status === 'error'
        ? error as CaptureFailure
        : failure('unexpected', `Media capture setup failed: ${errorText(error)}`, captureId);
      await clearActiveCapture(captureId);
      emitToPanel(next);
      await closeOffscreenDocument().catch(() => undefined);
      return respond(false, next);
    }
  }

  async function readStatus(): Promise<CaptureSnapshot> {
    await restoreActive;
    if (!await hasOffscreenDocument()) return active ? lastSnapshot : { status: 'idle' };
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MEDIA_CAPTURE_OFFSCREEN_STATUS,
      }) as { ok?: boolean; snapshot?: CaptureSnapshot } | undefined;
      return response?.ok && response.snapshot ? response.snapshot : lastSnapshot;
    } catch {
      return lastSnapshot;
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isMediaCaptureStartMessage(message)) {
      void beginCapture(message.request).then(sendResponse);
      return true;
    }
    if (typeof message !== 'object' || message === null) return undefined;
    const row = message as Record<string, unknown>;
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_CANCEL) {
      void (async () => {
        await restoreActive;
        if (typeof row.captureId !== 'string' || active?.captureId !== row.captureId) {
          sendResponse({ ok: false, error: 'No matching active capture.' });
          return;
        }
        const cancelled = await cancelCapture('unexpected', 'Capture cancelled by the user.');
        sendResponse({ ok: cancelled });
      })();
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_CLEAR) {
      void (async () => {
        await restoreActive;
        if (active) {
          sendResponse({ ok: false, error: 'Cannot clear an active capture.' });
          return;
        }
        if (await hasOffscreenDocument()) {
          await chrome.runtime.sendMessage({ target: 'offscreen', type: MEDIA_CAPTURE_OFFSCREEN_CLEAR });
          await closeOffscreenDocument();
        }
        lastSnapshot = { status: 'idle' };
        sendResponse({ ok: true });
      })();
      return true;
    }
    if (row.target === 'background' && row.type === MEDIA_CAPTURE_STATUS) {
      void readStatus().then((next) => sendResponse({ ok: true, snapshot: next }));
      return true;
    }
    if (
      row.target === 'background' && row.type === MEDIA_CAPTURE_OFFSCREEN_EVENT &&
      sender.url === offscreenDocumentUrl && typeof row.snapshot === 'object' && row.snapshot !== null
    ) {
      const next = row.snapshot as CaptureSnapshot;
      void (async () => {
        await restoreActive;
        const capture = active;
        if (!capture || !('captureId' in next) || next.captureId !== capture.captureId) {
          sendResponse({ ok: false, error: 'Stale offscreen event.' });
          return;
        }
        if (next.status === 'recorded') {
          const playerCurrentTimeAfterRecordingMs = await pauseAndReadPlayer(capture);
          await clearActiveCapture(capture.captureId);
          cancellingCaptureId = null;
          emitToPanel({ ...next, playerCurrentTimeAfterRecordingMs } satisfies CaptureResult);
        } else if (next.status === 'error' || next.status === 'cancelled') {
          await pauseAndReadPlayer(capture);
          await clearActiveCapture(capture.captureId);
          cancellingCaptureId = null;
          emitToPanel(next);
          await closeOffscreenDocument().catch(() => undefined);
        } else {
          emitToPanel(next);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }
    return undefined;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    void restoreActive.then(() => {
      const capture = active;
      if (
        !capture || tabId !== capture.request.tabId || typeof changeInfo.url !== 'string' ||
        sourceIdentityMatchesUrl(capture.request.source, changeInfo.url)
      ) return;
      void cancelCapture(
        'connected-source-changed',
        'Capture stopped because the connected tab navigated to a different source.',
      );
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void restoreActive.then(() => {
      if (active?.request.tabId !== tabId) return;
      void cancelCapture('connected-tab-closed', 'Capture stopped because the connected tab was closed.');
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !(ACTIVE_TAB_CONTEXT_KEY in changes)) return;
    void restoreActive.then(() => {
      const capture = active;
      if (!capture) return;
      const context = changes[ACTIVE_TAB_CONTEXT_KEY]?.newValue;
      if (
        isActiveTabContext(context) && context.tabId === capture.request.tabId &&
        context.url === capture.request.source.pageUrl
      ) return;
      void cancelCapture(
        'connected-source-changed',
        'Capture stopped because Annotated connected to a different source.',
      );
    });
  });
}
