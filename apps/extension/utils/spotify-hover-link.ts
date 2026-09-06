import { getSpotifyEpisodeIdentity } from '@annotated/shared/spotify';
import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applySpotifyHoverHighlightOnPage,
  clearSpotifyHoverHighlightOnPage,
  spotifyEpisodeIdFromHref,
  type SpotifyHoverPageRequest,
  type SpotifyHoverStrength,
} from './spotify-hover-page.ts';

export const SPOTIFY_HOVER_LEAVE_MS = 120;

export type SpotifyHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type SpotifyHoverTarget = {
  episodeId: string;
  strength: SpotifyHoverStrength;
  startMs?: number | null;
  endMs?: number | null;
};

export type SpotifyHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applySpotifyHoverHighlightOnPage | typeof clearSpotifyHoverHighlightOnPage;
      args?: [SpotifyHoverPageRequest];
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

export function spotifyEpisodeIdFromUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return getSpotifyEpisodeIdentity(value).episodeId;
  } catch {
    return spotifyEpisodeIdFromHref(value);
  }
}

export function annotationMatchesConnectedSpotifyEpisode(
  annotationEpisodeId: string | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (typeof annotationEpisodeId !== 'string' || !/^[A-Za-z0-9]{22}$/.test(annotationEpisodeId)) {
    return false;
  }
  return spotifyEpisodeIdFromUrl(tabUrl) === annotationEpisodeId;
}

export function spotifyHoverConnectionForTab(
  classification: string | null | undefined,
  tabId: number | null | undefined,
  tabUrl: string | null | undefined,
): SpotifyHoverConnection | null {
  if (classification !== 'Spotify') return null;
  if (!Number.isInteger(tabId) || (tabId ?? -1) < 0) return null;
  if (!spotifyEpisodeIdFromUrl(tabUrl)) return null;
  return { tabId: tabId as number, tabUrl: tabUrl as string };
}

export function createSpotifyHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? SPOTIFY_HOVER_LEAVE_MS;
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

function resolveChrome(override?: SpotifyHoverChrome): SpotifyHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: SpotifyHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedEpisodeUrl(
  connection: SpotifyHoverConnection,
  chromeApi: SpotifyHoverChrome,
  expectedEpisodeId: string,
): Promise<string | null> {
  const stored = await chromeApi.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
  const context = stored[ACTIVE_TAB_CONTEXT_KEY];
  if (!isActiveTabContext(context) || context.tabId !== connection.tabId) return null;
  const tab = await chromeApi.tabs.get(connection.tabId);
  const liveUrl = typeof tab.url === 'string' ? tab.url : connection.tabUrl;
  if (spotifyEpisodeIdFromUrl(liveUrl) !== expectedEpisodeId) return null;
  return liveUrl;
}

export async function applySpotifyHoverOnConnectedTab(
  connection: SpotifyHoverConnection,
  target: SpotifyHoverTarget,
  override?: SpotifyHoverChrome,
): Promise<boolean> {
  const chromeApi = resolveChrome(override);
  if (!chromeApi) return false;
  if (!annotationMatchesConnectedSpotifyEpisode(target.episodeId, connection.tabUrl)) return false;
  const liveUrl = await connectedEpisodeUrl(connection, chromeApi, target.episodeId);
  if (!liveUrl) return false;
  const result = await chromeApi.scripting.executeScript({
    target: { tabId: connection.tabId, frameIds: [0] },
    func: applySpotifyHoverHighlightOnPage,
    args: [{
      expectedEpisodeId: target.episodeId,
      strength: target.strength,
      startMs: target.startMs ?? null,
      endMs: target.endMs ?? null,
    }],
  });
  const page = Array.isArray(result) ? (result[0] as { result?: { ok?: boolean } } | undefined)?.result : null;
  return page?.ok === true;
}

export async function clearSpotifyHoverOnConnectedTab(
  connection: SpotifyHoverConnection,
  override?: SpotifyHoverChrome,
): Promise<void> {
  const chromeApi = resolveChrome(override);
  if (!chromeApi) return;
  try {
    await chromeApi.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearSpotifyHoverHighlightOnPage,
    });
  } catch {
    // Clearing a closed or navigated tab is best-effort.
  }
}

const leaveController = createSpotifyHoverLeaveController();

export function enterSpotifyHoverLink(
  connection: SpotifyHoverConnection,
  target: SpotifyHoverTarget,
) {
  leaveController.enter(() => {
    void applySpotifyHoverOnConnectedTab(connection, target);
  });
}

export function leaveSpotifyHoverLink(connection: SpotifyHoverConnection) {
  leaveController.leave(() => {
    void clearSpotifyHoverOnConnectedTab(connection);
  });
}

export function cancelSpotifyHoverLink() {
  leaveController.cancel();
}

export function spotifyHoverRegionHandlers(
  connection: SpotifyHoverConnection | null,
  target: SpotifyHoverTarget | null,
) {
  if (!connection || !target) return {};
  return {
    onMouseEnter: () => enterSpotifyHoverLink(connection, target),
    onMouseLeave: () => leaveSpotifyHoverLink(connection),
  };
}

export function spotifyHoverNestedChipHandlers(
  connection: SpotifyHoverConnection | null,
  target: Omit<SpotifyHoverTarget, 'strength'> | null,
) {
  if (!connection || !target) return {};
  return spotifyHoverRegionHandlers(connection, { ...target, strength: 'soft' });
}
