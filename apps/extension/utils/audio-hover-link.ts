import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applyAudioHoverHighlightOnPage,
  clearAudioHoverHighlightOnPage,
  type AudioHoverPageRequest,
  type AudioHoverPageResult,
  type AudioHoverStrength,
} from './audio-hover-page.ts';
import { classifySourceUrl } from './social-helpers.ts';

export const AUDIO_HOVER_LEAVE_MS = 120;
export const AUDIO_HOVER_OPEN_IDLE_MS = 12_000;

export type AudioHoverApplyResult =
  | { status: 'matched' }
  | { status: 'source-mismatch' }
  | { status: 'unavailable' };

export type AudioHoverResultListener = (result: AudioHoverApplyResult) => void;

export type AudioHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type AudioHoverAnnotationRef = {
  kind?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  source?: {
    type?: string | null;
    canonicalUrl?: string | null;
    normalizedUrl?: string | null;
  } | null;
};

export type AudioHoverTarget = {
  canonicalUrl: string;
  normalizedUrl: string;
  strength: AudioHoverStrength;
  startMs?: number | null;
  endMs?: number | null;
};

export type AudioHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyAudioHoverHighlightOnPage | typeof clearAudioHoverHighlightOnPage;
      args?: [AudioHoverPageRequest];
    }) => Promise<unknown>;
  };
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
  tabs: {
    get: (tabId: number) => Promise<{ id?: number; url?: string }>;
    update?: (tabId: number, update: { active: true }) => Promise<unknown>;
  };
};

function tryNormalizeAudioUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube') return null;
    return normalizeAudioSourceUrl(value);
  } catch {
    return null;
  }
}

function readFirstFramePageResult(value: unknown): AudioHoverPageResult | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entry = value[0];
  if (typeof entry !== 'object' || entry === null || !('result' in entry)) return null;
  const result = entry.result;
  if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
    return null;
  }
  const ok = (result as { ok: boolean }).ok;
  const reason = (result as { reason?: unknown }).reason;
  if (reason === undefined) return { ok };
  if (
    reason === 'cleared' ||
    reason === 'source-mismatch' ||
    reason === 'player-unavailable' ||
    reason === 'invalid-request'
  ) {
    return { ok, reason };
  }
  return { ok };
}

export function audioHoverApplyResultFromPage(
  value: unknown,
): AudioHoverApplyResult {
  const page = readFirstFramePageResult(value);
  if (!page) return { status: 'unavailable' };
  if (page.ok) return { status: 'matched' };
  if (page.reason === 'source-mismatch') return { status: 'source-mismatch' };
  return { status: 'unavailable' };
}

export function audioHoverConnectionForTab(
  classification: string | null | undefined,
  tabId: number | null | undefined,
  tabUrl: string | null | undefined,
): AudioHoverConnection | null {
  if (classification === 'YouTube') return null;
  if (classification !== 'Web page' && classification !== 'Podcast / web audio') {
    return null;
  }
  if (!Number.isInteger(tabId) || (tabId ?? -1) < 0) return null;
  if (typeof tabUrl !== 'string' || !tabUrl.trim()) return null;
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { tabId: tabId as number, tabUrl };
}

export function annotationMatchesConnectedAudio(
  annotation: AudioHoverAnnotationRef | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (!annotation || annotation.kind !== 'audio') return false;
  if (annotation.source?.type && annotation.source.type !== 'podcast') return false;
  const live = tryNormalizeAudioUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizeAudioUrl(annotation.source?.normalizedUrl),
    tryNormalizeAudioUrl(annotation.source?.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function createAudioHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? AUDIO_HOVER_LEAVE_MS;
  const schedule = options.setTimeoutFn ?? setTimeout;
  const cancelTimer = options.clearTimeoutFn ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    enter(apply: () => void) {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
      apply();
    },
    leave(clear: () => void) {
      if (timer !== null) cancelTimer(timer);
      timer = schedule(() => {
        timer = null;
        clear();
      }, leaveMs);
    },
    cancel() {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
    },
    get pending() {
      return timer !== null;
    },
  };
}

function resolveChrome(override?: AudioHoverChrome): AudioHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: AudioHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedAudioUrl(
  connection: AudioHoverConnection,
  chromeApi: AudioHoverChrome,
  target: Pick<AudioHoverTarget, 'canonicalUrl' | 'normalizedUrl'>,
): Promise<string | null> {
  if (!annotationMatchesConnectedAudio({
    kind: 'audio',
    source: {
      type: 'podcast',
      canonicalUrl: target.canonicalUrl,
      normalizedUrl: target.normalizedUrl,
    },
  }, connection.tabUrl)) {
    return null;
  }
  try {
    const stored = await chromeApi.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (!isActiveTabContext(context) || context.tabId !== connection.tabId) {
      return null;
    }
    const tab = await chromeApi.tabs.get(connection.tabId);
    const liveUrl = typeof tab?.url === 'string' && tab.url ? tab.url : context.url;
    return annotationMatchesConnectedAudio({
      kind: 'audio',
      source: {
        type: 'podcast',
        canonicalUrl: target.canonicalUrl,
        normalizedUrl: target.normalizedUrl,
      },
    }, liveUrl)
      ? liveUrl
      : null;
  } catch {
    return null;
  }
}

export async function applyAudioHoverOnConnectedTab(
  connection: AudioHoverConnection,
  target: AudioHoverTarget,
  chromeApi?: AudioHoverChrome,
): Promise<AudioHoverApplyResult> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) {
    return { status: 'unavailable' };
  }
  const liveUrl = await connectedAudioUrl(connection, chrome, target);
  if (!liveUrl) return { status: 'unavailable' };
  const expectedNormalizedUrl = tryNormalizeAudioUrl(liveUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: applyAudioHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        strength: target.strength,
        startMs: target.startMs ?? null,
        endMs: target.endMs ?? null,
      }],
    });
    return audioHoverApplyResultFromPage(injection);
  } catch {
    return { status: 'unavailable' };
  }
}

export async function openAudioSourceOnConnectedTab(
  connection: AudioHoverConnection,
  target: Omit<AudioHoverTarget, 'strength'> & { strength?: AudioHoverStrength },
  chromeApi?: AudioHoverChrome,
): Promise<AudioHoverApplyResult> {
  cancelAudioHoverLink();
  const applied = await applyAudioHoverOnConnectedTab(
    connection,
    { ...target, strength: target.strength ?? 'strong' },
    chromeApi,
  );
  if (applied.status === 'unavailable' || applied.status === 'source-mismatch') {
    return applied;
  }
  const chrome = resolveChrome(chromeApi);
  try {
    await chrome?.tabs.update?.(connection.tabId, { active: true });
  } catch {
    // Focus is best-effort; matched highlight already ran.
  }
  scheduleAudioHoverOpenIdleClear(connection, chromeApi);
  return applied;
}

export async function clearAudioHoverOnConnectedTab(
  connection: AudioHoverConnection,
  chromeApi?: AudioHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  try {
    const stored = await chromeApi.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(context) && context.tabId !== connection.tabId) return false;
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearAudioHoverHighlightOnPage,
    });
    return true;
  } catch {
    return false;
  }
}

export function createAudioHoverSession(options: {
  leaveMs?: number;
  idleMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const timers = {
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
  };
  const leave = createAudioHoverLeaveController({
    leaveMs: options.leaveMs ?? AUDIO_HOVER_LEAVE_MS,
    ...timers,
  });
  const idle = createAudioHoverLeaveController({
    leaveMs: options.idleMs ?? AUDIO_HOVER_OPEN_IDLE_MS,
    ...timers,
  });
  return {
    enter(
      connection: AudioHoverConnection | null,
      target: AudioHoverTarget,
      chromeApi?: AudioHoverChrome,
      onResult?: AudioHoverResultListener,
    ) {
      idle.cancel();
      leave.enter(() => {
        if (!connection) return;
        void applyAudioHoverOnConnectedTab(connection, target, chromeApi).then((result) => {
          onResult?.(result);
        });
      });
    },
    leave(connection: AudioHoverConnection | null, chromeApi?: AudioHoverChrome) {
      idle.cancel();
      leave.leave(() => {
        if (!connection) return;
        void clearAudioHoverOnConnectedTab(connection, chromeApi);
      });
    },
    scheduleIdle(connection: AudioHoverConnection | null, chromeApi?: AudioHoverChrome) {
      leave.cancel();
      idle.leave(() => {
        if (!connection) return;
        void clearAudioHoverOnConnectedTab(connection, chromeApi);
      });
    },
    cancel() {
      leave.cancel();
      idle.cancel();
    },
  };
}

const sharedHover = createAudioHoverSession();

export function enterAudioHoverLink(
  connection: AudioHoverConnection | null,
  target: AudioHoverTarget,
  chromeApi?: AudioHoverChrome,
  onResult?: AudioHoverResultListener,
) {
  sharedHover.enter(connection, target, chromeApi, onResult);
}

export function leaveAudioHoverLink(
  connection: AudioHoverConnection | null,
  chromeApi?: AudioHoverChrome,
) {
  sharedHover.leave(connection, chromeApi);
}

export function cancelAudioHoverLink() {
  sharedHover.cancel();
}

export function scheduleAudioHoverOpenIdleClear(
  connection: AudioHoverConnection | null,
  chromeApi?: AudioHoverChrome,
) {
  sharedHover.scheduleIdle(connection, chromeApi);
}

export function audioHoverRegionHandlers(
  connection: AudioHoverConnection | null,
  target: AudioHoverTarget | null,
  onResult?: AudioHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterAudioHoverLink(connection, target, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      leaveAudioHoverLink(connection);
    },
  };
}

export function audioHoverNestedChipHandlers(
  connection: AudioHoverConnection | null,
  target: Omit<AudioHoverTarget, 'strength'> | null,
  onResult?: AudioHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterAudioHoverLink(connection, { ...target, strength: 'strong' }, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      enterAudioHoverLink(connection, { ...target, strength: 'soft' }, undefined, onResult);
    },
  };
}
