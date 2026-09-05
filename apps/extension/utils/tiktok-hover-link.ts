import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applyTikTokHoverHighlightOnPage,
  clearTikTokHoverHighlightOnPage,
  tiktokWatchVideoIdFromHref,
  type TikTokHoverPageRequest,
  type TikTokHoverStrength,
} from './tiktok-hover-page.ts';

export const TIKTOK_HOVER_LEAVE_MS = 120;

export type TikTokHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type TikTokHoverTarget = {
  videoId: string;
  strength: TikTokHoverStrength;
  startMs?: number | null;
  endMs?: number | null;
};

export type TikTokHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyTikTokHoverHighlightOnPage | typeof clearTikTokHoverHighlightOnPage;
      args?: [TikTokHoverPageRequest];
    }) => Promise<unknown>;
  };
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
  tabs: {
    get: (tabId: number) => Promise<{ id?: number; url?: string }>;
  };
};

export function tiktokWatchVideoIdFromUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return getTikTokVideoIdentity(value).videoId;
  } catch {
    return tiktokWatchVideoIdFromHref(value);
  }
}

export function annotationMatchesConnectedTikTokWatch(
  annotationVideoId: string | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (typeof annotationVideoId !== 'string' || !/^\d{10,25}$/.test(annotationVideoId)) {
    return false;
  }
  return tiktokWatchVideoIdFromUrl(tabUrl) === annotationVideoId;
}

export function tiktokHoverConnectionForTab(
  classification: string | null | undefined,
  tabId: number | null | undefined,
  tabUrl: string | null | undefined,
): TikTokHoverConnection | null {
  if (classification !== 'TikTok') return null;
  if (!Number.isInteger(tabId) || (tabId ?? -1) < 0) return null;
  if (!tiktokWatchVideoIdFromUrl(tabUrl)) return null;
  return { tabId: tabId as number, tabUrl: tabUrl as string };
}

export function createTikTokHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? TIKTOK_HOVER_LEAVE_MS;
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

function resolveChrome(override?: TikTokHoverChrome): TikTokHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: TikTokHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedWatchUrl(
  connection: TikTokHoverConnection,
  chromeApi: TikTokHoverChrome,
  expectedVideoId: string,
): Promise<string | null> {
  if (!annotationMatchesConnectedTikTokWatch(expectedVideoId, connection.tabUrl)) {
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
    return annotationMatchesConnectedTikTokWatch(expectedVideoId, liveUrl) ? liveUrl : null;
  } catch {
    return null;
  }
}

export async function applyTikTokHoverOnConnectedTab(
  connection: TikTokHoverConnection,
  target: TikTokHoverTarget,
  chromeApi?: TikTokHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  const liveUrl = await connectedWatchUrl(connection, chrome, target.videoId);
  if (!liveUrl) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: applyTikTokHoverHighlightOnPage,
      args: [{
        expectedVideoId: target.videoId,
        strength: target.strength,
        startMs: target.startMs ?? null,
        endMs: target.endMs ?? null,
      }],
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearTikTokHoverOnConnectedTab(
  connection: TikTokHoverConnection,
  chromeApi?: TikTokHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(context) && context.tabId !== connection.tabId) return false;
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearTikTokHoverHighlightOnPage,
    });
    return true;
  } catch {
    return false;
  }
}

export function createTikTokHoverSession(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leave = createTikTokHoverLeaveController(options);
  return {
    enter(
      connection: TikTokHoverConnection | null,
      target: TikTokHoverTarget,
      chromeApi?: TikTokHoverChrome,
    ) {
      leave.enter(() => {
        if (!connection) return;
        void applyTikTokHoverOnConnectedTab(connection, target, chromeApi);
      });
    },
    leave(connection: TikTokHoverConnection | null, chromeApi?: TikTokHoverChrome) {
      leave.leave(() => {
        if (!connection) return;
        void clearTikTokHoverOnConnectedTab(connection, chromeApi);
      });
    },
    cancel() {
      leave.cancel();
    },
  };
}

const sharedHover = createTikTokHoverSession();

export function enterTikTokHoverLink(
  connection: TikTokHoverConnection | null,
  target: TikTokHoverTarget,
  chromeApi?: TikTokHoverChrome,
) {
  sharedHover.enter(connection, target, chromeApi);
}

export function leaveTikTokHoverLink(
  connection: TikTokHoverConnection | null,
  chromeApi?: TikTokHoverChrome,
) {
  sharedHover.leave(connection, chromeApi);
}

export function cancelTikTokHoverLink() {
  sharedHover.cancel();
}

export function tiktokHoverRegionHandlers(
  connection: TikTokHoverConnection | null,
  target: TikTokHoverTarget | null,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterTikTokHoverLink(connection, target);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      leaveTikTokHoverLink(connection);
    },
  };
}

export function tiktokHoverNestedChipHandlers(
  connection: TikTokHoverConnection | null,
  target: Omit<TikTokHoverTarget, 'strength'> | null,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterTikTokHoverLink(connection, { ...target, strength: 'strong' });
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      enterTikTokHoverLink(connection, { ...target, strength: 'soft' });
    },
  };
}
