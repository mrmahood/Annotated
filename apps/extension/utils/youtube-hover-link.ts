import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applyYouTubeHoverHighlightOnPage,
  clearYouTubeHoverHighlightOnPage,
  type YouTubeHoverPageRequest,
  type YouTubeHoverStrength,
} from './youtube-hover-page.ts';

export const YOUTUBE_HOVER_LEAVE_MS = 120;

export type YouTubeHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type YouTubeHoverTarget = {
  videoId: string;
  strength: YouTubeHoverStrength;
  startMs?: number | null;
  endMs?: number | null;
  seekMs?: number | null;
};

export type YouTubeHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyYouTubeHoverHighlightOnPage | typeof clearYouTubeHoverHighlightOnPage;
      args?: [YouTubeHoverPageRequest];
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

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export function youtubeWatchVideoIdFromUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !WATCH_HOSTS.has(url.hostname.toLowerCase()) ||
      url.pathname !== '/watch'
    ) {
      return null;
    }
    return getYouTubeVideoIdentity(value).videoId;
  } catch {
    return null;
  }
}

export function annotationMatchesConnectedYouTubeWatch(
  annotationVideoId: string | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (typeof annotationVideoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(annotationVideoId)) {
    return false;
  }
  return youtubeWatchVideoIdFromUrl(tabUrl) === annotationVideoId;
}

export function createYouTubeHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? YOUTUBE_HOVER_LEAVE_MS;
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

function resolveChrome(override?: YouTubeHoverChrome): YouTubeHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: YouTubeHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedWatchUrl(
  connection: YouTubeHoverConnection,
  chromeApi: YouTubeHoverChrome,
  expectedVideoId: string,
): Promise<string | null> {
  if (!annotationMatchesConnectedYouTubeWatch(expectedVideoId, connection.tabUrl)) {
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
    return annotationMatchesConnectedYouTubeWatch(expectedVideoId, liveUrl) ? liveUrl : null;
  } catch {
    return null;
  }
}

export async function applyYouTubeHoverOnConnectedTab(
  connection: YouTubeHoverConnection,
  target: YouTubeHoverTarget,
  chromeApi?: YouTubeHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  const liveUrl = await connectedWatchUrl(connection, chrome, target.videoId);
  if (!liveUrl) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: applyYouTubeHoverHighlightOnPage,
      args: [{
        expectedVideoId: target.videoId,
        strength: target.strength,
        startMs: target.startMs ?? null,
        endMs: target.endMs ?? null,
        seekMs: target.strength === 'soft' ? null : target.seekMs ?? null,
      }],
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearYouTubeHoverOnConnectedTab(
  connection: YouTubeHoverConnection,
  chromeApi?: YouTubeHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(context) && context.tabId !== connection.tabId) return false;
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearYouTubeHoverHighlightOnPage,
    });
    return true;
  } catch {
    return false;
  }
}

export function createYouTubeHoverSession(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leave = createYouTubeHoverLeaveController(options);
  return {
    enter(
      connection: YouTubeHoverConnection | null,
      target: YouTubeHoverTarget,
      chromeApi?: YouTubeHoverChrome,
    ) {
      leave.enter(() => {
        if (!connection) return;
        void applyYouTubeHoverOnConnectedTab(connection, target, chromeApi);
      });
    },
    leave(connection: YouTubeHoverConnection | null, chromeApi?: YouTubeHoverChrome) {
      leave.leave(() => {
        if (!connection) return;
        void clearYouTubeHoverOnConnectedTab(connection, chromeApi);
      });
    },
    cancel() {
      leave.cancel();
    },
  };
}

const sharedHover = createYouTubeHoverSession();

export function enterYouTubeHoverLink(
  connection: YouTubeHoverConnection | null,
  target: YouTubeHoverTarget,
  chromeApi?: YouTubeHoverChrome,
) {
  sharedHover.enter(connection, target, chromeApi);
}

export function leaveYouTubeHoverLink(
  connection: YouTubeHoverConnection | null,
  chromeApi?: YouTubeHoverChrome,
) {
  sharedHover.leave(connection, chromeApi);
}

export function cancelYouTubeHoverLink() {
  sharedHover.cancel();
}

export function youtubeHoverRegionHandlers(
  connection: YouTubeHoverConnection | null,
  target: YouTubeHoverTarget | null,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterYouTubeHoverLink(connection, target);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      leaveYouTubeHoverLink(connection);
    },
  };
}

export function youtubeHoverNestedChipHandlers(
  connection: YouTubeHoverConnection | null,
  target: Omit<YouTubeHoverTarget, 'strength'> | null,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterYouTubeHoverLink(connection, { ...target, strength: 'strong' });
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      enterYouTubeHoverLink(connection, { ...target, strength: 'soft', seekMs: null });
    },
  };
}
