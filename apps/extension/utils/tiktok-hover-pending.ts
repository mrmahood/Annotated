import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import {
  applyTikTokHoverOnConnectedTab,
  annotationMatchesConnectedTikTokWatch,
  type TikTokHoverChrome,
  type TikTokHoverConnection,
  type TikTokHoverTarget,
} from './tiktok-hover-link.ts';
import { applyTikTokHoverHighlightOnPage } from './tiktok-hover-page.ts';

export const TIKTOK_HOVER_PENDING_KEY = 'annotatedTikTokHoverPending';
export const TIKTOK_HOVER_PENDING_TTL_MS = 12 * 60 * 1000;
export const TIKTOK_PENDING_CONNECT_HINT =
  'Player highlight applies when the video finishes loading.';

export type TikTokHoverPendingTarget = {
  videoId: string;
  canonicalUrl: string;
  startMs: number | null;
  endMs: number | null;
  strength: 'strong';
  setAt: number;
};

export type TikTokPendingChrome = TikTokHoverChrome & {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
  tabs: TikTokHoverChrome['tabs'] & {
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

export type TikTokSourceOpenOutcome = {
  applied: boolean;
  awaitingConnection: boolean;
};

function tryTikTokVideoId(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return getTikTokVideoIdentity(value).videoId;
  } catch {
    return null;
  }
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolvePendingChrome(override?: TikTokPendingChrome): TikTokPendingChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: TikTokPendingChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

export function isTikTokHoverPendingTarget(value: unknown): value is TikTokHoverPendingTarget {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<TikTokHoverPendingTarget>;
  return (
    typeof pending.videoId === 'string' &&
    /^\d{10,25}$/.test(pending.videoId) &&
    typeof pending.canonicalUrl === 'string' &&
    pending.canonicalUrl.trim().length > 0 &&
    pending.strength === 'strong' &&
    (pending.startMs === null || finiteMs(pending.startMs) !== null) &&
    (pending.endMs === null || finiteMs(pending.endMs) !== null) &&
    typeof pending.setAt === 'number' &&
    Number.isFinite(pending.setAt)
  );
}

export function tiktokHoverPendingIsExpired(
  pending: Pick<TikTokHoverPendingTarget, 'setAt'>,
  now = Date.now(),
): boolean {
  return now - pending.setAt > TIKTOK_HOVER_PENDING_TTL_MS;
}

export function tiktokHoverPendingMatchesUrl(
  pending: Pick<TikTokHoverPendingTarget, 'videoId'>,
  tabUrl: string | null | undefined,
): boolean {
  return tryTikTokVideoId(tabUrl) === pending.videoId;
}

export function tiktokHoverPendingMatchesTarget(
  pending: Pick<TikTokHoverPendingTarget, 'videoId' | 'startMs' | 'endMs'>,
  target: Pick<TikTokHoverTarget, 'videoId' | 'startMs' | 'endMs'>,
): boolean {
  if (pending.videoId !== target.videoId) return false;
  if ((pending.startMs ?? null) !== (target.startMs ?? null)) return false;
  if ((pending.endMs ?? null) !== (target.endMs ?? null)) return false;
  return true;
}

export async function clearTikTokHoverPending(chromeApi?: TikTokPendingChrome): Promise<void> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return;
  try {
    await chrome.storage.session.remove(TIKTOK_HOVER_PENDING_KEY);
  } catch { /* Session clear is best-effort. */ }
}

export async function readTikTokHoverPending(
  chromeApi?: TikTokPendingChrome,
  now = Date.now(),
): Promise<TikTokHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return null;
  try {
    const stored = await chrome.storage.session.get(TIKTOK_HOVER_PENDING_KEY);
    const value = stored[TIKTOK_HOVER_PENDING_KEY];
    if (!isTikTokHoverPendingTarget(value)) {
      if (value !== undefined) await chrome.storage.session.remove(TIKTOK_HOVER_PENDING_KEY);
      return null;
    }
    if (tiktokHoverPendingIsExpired(value, now)) {
      await chrome.storage.session.remove(TIKTOK_HOVER_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writeTikTokHoverPending(
  target: Pick<TikTokHoverTarget, 'videoId' | 'startMs' | 'endMs'> & { canonicalUrl: string },
  chromeApi?: TikTokPendingChrome,
  now = Date.now(),
): Promise<TikTokHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !/^\d{10,25}$/.test(target.videoId)) return null;
  const pending: TikTokHoverPendingTarget = {
    videoId: target.videoId,
    canonicalUrl: target.canonicalUrl,
    startMs: finiteMs(target.startMs),
    endMs: finiteMs(target.endMs),
    strength: 'strong',
    setAt: now,
  };
  try {
    await chrome.storage.session.set({ [TIKTOK_HOVER_PENDING_KEY]: pending });
    return pending;
  } catch {
    return null;
  }
}

export async function applyPendingTikTokHoverOnConnection(
  connection: TikTokHoverConnection,
  chromeApi?: TikTokPendingChrome,
  now = Date.now(),
): Promise<boolean> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return false;
  const pending = await readTikTokHoverPending(chrome, now);
  if (!pending || !tiktokHoverPendingMatchesUrl(pending, connection.tabUrl)) {
    return false;
  }
  const applied = await applyTikTokHoverOnConnectedTab(
    connection,
    {
      videoId: pending.videoId,
      strength: pending.strength,
      startMs: pending.startMs,
      endMs: pending.endMs,
    },
    chrome,
  );
  if (applied) await clearTikTokHoverPending(chrome);
  return applied;
}

export async function applyPendingTikTokHoverOnTab(
  tab: { tabId: number; tabUrl: string },
  chromeApi?: TikTokPendingChrome,
  now = Date.now(),
): Promise<boolean> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !Number.isInteger(tab.tabId) || tab.tabId < 0) return false;
  const pending = await readTikTokHoverPending(chrome, now);
  if (!pending || !tiktokHoverPendingMatchesUrl(pending, tab.tabUrl)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      func: applyTikTokHoverHighlightOnPage,
      args: [{
        expectedVideoId: pending.videoId,
        strength: pending.strength,
        startMs: pending.startMs,
        endMs: pending.endMs,
      }],
    });
    await clearTikTokHoverPending(chrome);
    return true;
  } catch {
    return false;
  }
}

export async function openTikTokSourceFromPanel(input: {
  target: { videoId: string; canonicalUrl: string; startMs?: number | null; endMs?: number | null };
  connection: TikTokHoverConnection | null;
  href: string;
  chromeApi?: TikTokPendingChrome;
  now?: number;
  openFallback?: (href: string) => void;
}): Promise<TikTokSourceOpenOutcome> {
  const chrome = resolvePendingChrome(input.chromeApi);
  if (!chrome) {
    input.openFallback?.(input.href);
    return { applied: false, awaitingConnection: true };
  }

  await writeTikTokHoverPending(
    {
      videoId: input.target.videoId,
      canonicalUrl: input.target.canonicalUrl,
      startMs: input.target.startMs ?? null,
      endMs: input.target.endMs ?? null,
    },
    chrome,
    input.now ?? Date.now(),
  );

  if (
    input.connection &&
    annotationMatchesConnectedTikTokWatch(input.target.videoId, input.connection.tabUrl)
  ) {
    const applied = await applyTikTokHoverOnConnectedTab(
      input.connection,
      {
        videoId: input.target.videoId,
        strength: 'strong',
        startMs: input.target.startMs ?? null,
        endMs: input.target.endMs ?? null,
      },
      chrome,
    );
    if (applied) {
      await clearTikTokHoverPending(chrome);
      return { applied: true, awaitingConnection: false };
    }
  }

  input.openFallback?.(input.href);
  return { applied: false, awaitingConnection: true };
}
