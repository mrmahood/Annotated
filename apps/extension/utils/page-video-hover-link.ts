import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applyPageVideoHoverHighlightOnPage,
  clearPageVideoHoverHighlightOnPage,
  normalizePageVideoHoverPageUrl,
  type PageVideoHoverPageRequest,
  type PageVideoHoverPageResult,
  type PageVideoHoverStrength,
} from './page-video-hover-page.ts';
import { classifySourceUrl } from './social-helpers.ts';

export const PAGE_VIDEO_HOVER_LEAVE_MS = 120;
export const PAGE_VIDEO_HOVER_OPEN_IDLE_MS = 12_000;

export type PageVideoHoverApplyResult =
  | { status: 'matched' }
  | { status: 'source-mismatch' }
  | { status: 'unavailable' };

export type PageVideoHoverResultListener = (result: PageVideoHoverApplyResult) => void;

export type PageVideoHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type PageVideoHoverAnnotationRef = {
  kind?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  source?: {
    type?: string | null;
    canonicalUrl?: string | null;
    normalizedUrl?: string | null;
  } | null;
};

export type PageVideoHoverTarget = {
  canonicalUrl: string;
  normalizedUrl: string;
  strength: PageVideoHoverStrength;
  startMs?: number | null;
  endMs?: number | null;
};

export type PageVideoHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyPageVideoHoverHighlightOnPage | typeof clearPageVideoHoverHighlightOnPage;
      args?: [PageVideoHoverPageRequest];
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

function tryNormalizePageVideoUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube') return null;
    return normalizePageVideoHoverPageUrl(value);
  } catch {
    return null;
  }
}

function readFirstFramePageResult(value: unknown): PageVideoHoverPageResult | null {
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

export function pageVideoHoverApplyResultFromPage(
  value: unknown,
): PageVideoHoverApplyResult {
  const page = readFirstFramePageResult(value);
  if (!page) return { status: 'unavailable' };
  if (page.ok) return { status: 'matched' };
  if (page.reason === 'source-mismatch') return { status: 'source-mismatch' };
  return { status: 'unavailable' };
}

export function pageVideoHoverConnectionForTab(
  classification: string | null | undefined,
  tabId: number | null | undefined,
  tabUrl: string | null | undefined,
): PageVideoHoverConnection | null {
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

export function annotationMatchesConnectedPageVideo(
  annotation: PageVideoHoverAnnotationRef | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (!annotation || annotation.kind !== 'video') return false;
  if (annotation.source?.type && annotation.source.type !== 'article') return false;
  const live = tryNormalizePageVideoUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizePageVideoUrl(annotation.source?.normalizedUrl),
    tryNormalizePageVideoUrl(annotation.source?.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function createPageVideoHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? PAGE_VIDEO_HOVER_LEAVE_MS;
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

function resolveChrome(override?: PageVideoHoverChrome): PageVideoHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: PageVideoHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedPageVideoUrl(
  connection: PageVideoHoverConnection,
  chromeApi: PageVideoHoverChrome,
  target: Pick<PageVideoHoverTarget, 'canonicalUrl' | 'normalizedUrl'>,
): Promise<string | null> {
  if (!annotationMatchesConnectedPageVideo({
    kind: 'video',
    source: {
      type: 'article',
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
    return annotationMatchesConnectedPageVideo({
      kind: 'video',
      source: {
        type: 'article',
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

export async function applyPageVideoHoverOnConnectedTab(
  connection: PageVideoHoverConnection,
  target: PageVideoHoverTarget,
  chromeApi?: PageVideoHoverChrome,
): Promise<PageVideoHoverApplyResult> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) {
    return { status: 'unavailable' };
  }
  const liveUrl = await connectedPageVideoUrl(connection, chrome, target);
  if (!liveUrl) return { status: 'unavailable' };
  const expectedNormalizedUrl = tryNormalizePageVideoUrl(liveUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: applyPageVideoHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        strength: target.strength,
        startMs: target.startMs ?? null,
        endMs: target.endMs ?? null,
      }],
    });
    return pageVideoHoverApplyResultFromPage(injection);
  } catch {
    return { status: 'unavailable' };
  }
}

export async function openPageVideoSourceOnConnectedTab(
  connection: PageVideoHoverConnection,
  target: Omit<PageVideoHoverTarget, 'strength'> & { strength?: PageVideoHoverStrength },
  chromeApi?: PageVideoHoverChrome,
): Promise<PageVideoHoverApplyResult> {
  cancelPageVideoHoverLink();
  const applied = await applyPageVideoHoverOnConnectedTab(
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
  schedulePageVideoHoverOpenIdleClear(connection, chromeApi);
  return applied;
}

export async function clearPageVideoHoverOnConnectedTab(
  connection: PageVideoHoverConnection,
  chromeApi?: PageVideoHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(context) && context.tabId !== connection.tabId) return false;
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearPageVideoHoverHighlightOnPage,
    });
    return true;
  } catch {
    return false;
  }
}

export function createPageVideoHoverSession(options: {
  leaveMs?: number;
  idleMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const timers = {
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
  };
  const leave = createPageVideoHoverLeaveController({
    leaveMs: options.leaveMs ?? PAGE_VIDEO_HOVER_LEAVE_MS,
    ...timers,
  });
  const idle = createPageVideoHoverLeaveController({
    leaveMs: options.idleMs ?? PAGE_VIDEO_HOVER_OPEN_IDLE_MS,
    ...timers,
  });
  return {
    enter(
      connection: PageVideoHoverConnection | null,
      target: PageVideoHoverTarget,
      chromeApi?: PageVideoHoverChrome,
      onResult?: PageVideoHoverResultListener,
    ) {
      idle.cancel();
      leave.enter(() => {
        if (!connection) return;
        void applyPageVideoHoverOnConnectedTab(connection, target, chromeApi).then((result) => {
          onResult?.(result);
        });
      });
    },
    leave(connection: PageVideoHoverConnection | null, chromeApi?: PageVideoHoverChrome) {
      idle.cancel();
      leave.leave(() => {
        if (!connection) return;
        void clearPageVideoHoverOnConnectedTab(connection, chromeApi);
      });
    },
    scheduleIdle(connection: PageVideoHoverConnection | null, chromeApi?: PageVideoHoverChrome) {
      leave.cancel();
      idle.leave(() => {
        if (!connection) return;
        void clearPageVideoHoverOnConnectedTab(connection, chromeApi);
      });
    },
    cancel() {
      leave.cancel();
      idle.cancel();
    },
  };
}

const sharedHover = createPageVideoHoverSession();

export function enterPageVideoHoverLink(
  connection: PageVideoHoverConnection | null,
  target: PageVideoHoverTarget,
  chromeApi?: PageVideoHoverChrome,
  onResult?: PageVideoHoverResultListener,
) {
  sharedHover.enter(connection, target, chromeApi, onResult);
}

export function leavePageVideoHoverLink(
  connection: PageVideoHoverConnection | null,
  chromeApi?: PageVideoHoverChrome,
) {
  sharedHover.leave(connection, chromeApi);
}

export function cancelPageVideoHoverLink() {
  sharedHover.cancel();
}

export function schedulePageVideoHoverOpenIdleClear(
  connection: PageVideoHoverConnection | null,
  chromeApi?: PageVideoHoverChrome,
) {
  sharedHover.scheduleIdle(connection, chromeApi);
}

export function pageVideoHoverRegionHandlers(
  connection: PageVideoHoverConnection | null,
  target: PageVideoHoverTarget | null,
  onResult?: PageVideoHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterPageVideoHoverLink(connection, target, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      leavePageVideoHoverLink(connection);
    },
  };
}

export function pageVideoHoverNestedChipHandlers(
  connection: PageVideoHoverConnection | null,
  target: Omit<PageVideoHoverTarget, 'strength'> | null,
  onResult?: PageVideoHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterPageVideoHoverLink(connection, { ...target, strength: 'strong' }, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      enterPageVideoHoverLink(connection, { ...target, strength: 'soft' }, undefined, onResult);
    },
  };
}
