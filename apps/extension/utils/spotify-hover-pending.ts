import { getSpotifyEpisodeIdentity } from '@annotated/shared/spotify';
import {
  applySpotifyHoverOnConnectedTab,
  annotationMatchesConnectedSpotifyEpisode,
  type SpotifyHoverChrome,
  type SpotifyHoverConnection,
  type SpotifyHoverTarget,
} from './spotify-hover-link.ts';
import { applySpotifyHoverHighlightOnPage } from './spotify-hover-page.ts';

export const SPOTIFY_HOVER_PENDING_KEY = 'annotatedSpotifyHoverPending';
export const SPOTIFY_HOVER_PENDING_TTL_MS = 12 * 60 * 1000;
export const SPOTIFY_PENDING_CONNECT_HINT =
  'Player highlight applies when the episode finishes loading.';

export type SpotifyHoverPendingTarget = {
  episodeId: string;
  canonicalUrl: string;
  startMs: number | null;
  endMs: number | null;
  strength: 'strong';
  setAt: number;
};

export type SpotifyPendingChrome = SpotifyHoverChrome & {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
  tabs: SpotifyHoverChrome['tabs'] & {
    create?: (createProperties: { url: string; active: true }) => Promise<{
      id?: number;
      url?: string;
      status?: string;
      windowId?: number;
    }>;
    query?: (queryInfo?: Record<string, unknown>) => Promise<Array<{
      id?: number;
      url?: string;
      status?: string;
      windowId?: number;
    }>>;
    update?: (tabId: number, update: { active: true }) => Promise<unknown>;
  };
  windows?: {
    update?: (windowId: number, update: { focused: true }) => Promise<unknown>;
  };
};

export type SpotifySourceOpenOutcome = {
  applied: boolean;
  awaitingConnection: boolean;
};

function trySpotifyEpisodeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return getSpotifyEpisodeIdentity(value).episodeId;
  } catch {
    return null;
  }
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolvePendingChrome(override?: SpotifyPendingChrome): SpotifyPendingChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: SpotifyPendingChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

export function isSpotifyHoverPendingTarget(value: unknown): value is SpotifyHoverPendingTarget {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<SpotifyHoverPendingTarget>;
  return (
    typeof pending.episodeId === 'string' &&
    /^[A-Za-z0-9]{22}$/.test(pending.episodeId) &&
    typeof pending.canonicalUrl === 'string' &&
    pending.canonicalUrl.trim().length > 0 &&
    pending.strength === 'strong' &&
    (pending.startMs === null || finiteMs(pending.startMs) !== null) &&
    (pending.endMs === null || finiteMs(pending.endMs) !== null) &&
    typeof pending.setAt === 'number' &&
    Number.isFinite(pending.setAt)
  );
}

export function spotifyHoverPendingIsExpired(
  pending: Pick<SpotifyHoverPendingTarget, 'setAt'>,
  now = Date.now(),
): boolean {
  return now - pending.setAt > SPOTIFY_HOVER_PENDING_TTL_MS;
}

export function spotifyHoverPendingMatchesUrl(
  pending: Pick<SpotifyHoverPendingTarget, 'episodeId'>,
  tabUrl: string | null | undefined,
): boolean {
  return trySpotifyEpisodeId(tabUrl) === pending.episodeId;
}

export function spotifyHoverPendingMatchesTarget(
  pending: Pick<SpotifyHoverPendingTarget, 'episodeId' | 'startMs' | 'endMs'>,
  target: Pick<SpotifyHoverTarget, 'episodeId' | 'startMs' | 'endMs'>,
): boolean {
  if (pending.episodeId !== target.episodeId) return false;
  if ((pending.startMs ?? null) !== (target.startMs ?? null)) return false;
  if ((pending.endMs ?? null) !== (target.endMs ?? null)) return false;
  return true;
}

export async function clearSpotifyHoverPending(chromeApi?: SpotifyPendingChrome): Promise<void> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return;
  try {
    await chrome.storage.session.remove(SPOTIFY_HOVER_PENDING_KEY);
  } catch { /* Session clear is best-effort. */ }
}

export async function readSpotifyHoverPending(
  chromeApi?: SpotifyPendingChrome,
  now = Date.now(),
): Promise<SpotifyHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return null;
  try {
    const stored = await chrome.storage.session.get(SPOTIFY_HOVER_PENDING_KEY);
    const value = stored[SPOTIFY_HOVER_PENDING_KEY];
    if (!isSpotifyHoverPendingTarget(value)) {
      if (value !== undefined) await chrome.storage.session.remove(SPOTIFY_HOVER_PENDING_KEY);
      return null;
    }
    if (spotifyHoverPendingIsExpired(value, now)) {
      await chrome.storage.session.remove(SPOTIFY_HOVER_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writeSpotifyHoverPending(
  target: Pick<SpotifyHoverTarget, 'episodeId' | 'startMs' | 'endMs'> & { canonicalUrl: string },
  chromeApi?: SpotifyPendingChrome,
  now = Date.now(),
): Promise<SpotifyHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !/^[A-Za-z0-9]{22}$/.test(target.episodeId)) return null;
  const pending: SpotifyHoverPendingTarget = {
    episodeId: target.episodeId,
    canonicalUrl: target.canonicalUrl,
    startMs: finiteMs(target.startMs),
    endMs: finiteMs(target.endMs),
    strength: 'strong',
    setAt: now,
  };
  try {
    await chrome.storage.session.set({ [SPOTIFY_HOVER_PENDING_KEY]: pending });
    return pending;
  } catch {
    return null;
  }
}

export async function applyPendingSpotifyHoverOnConnection(
  connection: SpotifyHoverConnection,
  chromeApi?: SpotifyPendingChrome,
  now = Date.now(),
): Promise<boolean> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return false;
  const pending = await readSpotifyHoverPending(chrome, now);
  if (!pending || !spotifyHoverPendingMatchesUrl(pending, connection.tabUrl)) {
    return false;
  }
  const applied = await applySpotifyHoverOnConnectedTab(
    connection,
    {
      episodeId: pending.episodeId,
      strength: pending.strength,
      startMs: pending.startMs,
      endMs: pending.endMs,
    },
    chrome,
  );
  if (applied) await clearSpotifyHoverPending(chrome);
  return applied;
}

export async function applyPendingSpotifyHoverOnTab(
  tab: { tabId: number; tabUrl: string },
  chromeApi?: SpotifyPendingChrome,
  now = Date.now(),
): Promise<boolean> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !Number.isInteger(tab.tabId) || tab.tabId < 0) return false;
  const pending = await readSpotifyHoverPending(chrome, now);
  if (!pending || !spotifyHoverPendingMatchesUrl(pending, tab.tabUrl)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      func: applySpotifyHoverHighlightOnPage,
      args: [{
        expectedEpisodeId: pending.episodeId,
        strength: pending.strength,
        startMs: pending.startMs,
        endMs: pending.endMs,
      }],
    });
    await clearSpotifyHoverPending(chrome);
    return true;
  } catch {
    return false;
  }
}

export async function openSpotifySourceFromPanel(input: {
  target: { episodeId: string; canonicalUrl: string; startMs?: number | null; endMs?: number | null };
  connection: SpotifyHoverConnection | null;
  href: string;
  chromeApi?: SpotifyPendingChrome;
  now?: number;
  openFallback?: (href: string) => void;
}): Promise<SpotifySourceOpenOutcome> {
  const chrome = resolvePendingChrome(input.chromeApi);
  if (!chrome) {
    input.openFallback?.(input.href);
    return { applied: false, awaitingConnection: true };
  }

  await writeSpotifyHoverPending(
    {
      episodeId: input.target.episodeId,
      canonicalUrl: input.target.canonicalUrl,
      startMs: input.target.startMs ?? null,
      endMs: input.target.endMs ?? null,
    },
    chrome,
    input.now ?? Date.now(),
  );

  if (
    input.connection &&
    annotationMatchesConnectedSpotifyEpisode(input.target.episodeId, input.connection.tabUrl)
  ) {
    const applied = await applySpotifyHoverOnConnectedTab(
      input.connection,
      {
        episodeId: input.target.episodeId,
        strength: 'strong',
        startMs: input.target.startMs ?? null,
        endMs: input.target.endMs ?? null,
      },
      chrome,
    );
    if (applied) {
      await clearSpotifyHoverPending(chrome);
      return { applied: true, awaitingConnection: false };
    }
  }

  input.openFallback?.(input.href);
  return { applied: false, awaitingConnection: true };
}
