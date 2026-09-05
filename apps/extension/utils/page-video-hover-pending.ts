import {
  applyPageVideoHoverOnConnectedTab,
  pageVideoHoverApplyResultFromPage,
  annotationMatchesConnectedPageVideo,
  openPageVideoSourceOnConnectedTab,
  schedulePageVideoHoverOpenIdleClear,
  type PageVideoHoverApplyResult,
  type PageVideoHoverChrome,
  type PageVideoHoverConnection,
  type PageVideoHoverTarget,
} from './page-video-hover-link.ts';
import {
  applyPageVideoHoverHighlightOnPage,
  normalizePageVideoHoverPageUrl,
} from './page-video-hover-page.ts';
import { classifySourceUrl } from './social-helpers.ts';

export const PAGE_VIDEO_HOVER_PENDING_KEY = 'annotatedPageVideoHoverPending';
export const PAGE_VIDEO_HOVER_PENDING_TTL_MS = 12 * 60 * 1000;
export const PAGE_VIDEO_PENDING_CONNECT_HINT =
  'Player highlight applies when the video finishes loading.';

export type PageVideoHoverPendingTarget = {
  normalizedUrl: string;
  canonicalUrl: string;
  startMs: number | null;
  endMs: number | null;
  strength: 'strong';
  setAt: number;
};

export type PageVideoPendingChrome = PageVideoHoverChrome & {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
  tabs: PageVideoHoverChrome['tabs'] & {
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
  };
  windows?: {
    update?: (windowId: number, update: { focused: true }) => Promise<unknown>;
  };
};

export type PageVideoSourceOpenOutcome = {
  applied: PageVideoHoverApplyResult | null;
  awaitingConnection: boolean;
};

function tryNormalizePageVideoUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube' || classifySourceUrl(value) === 'tiktok') return null;
    return normalizePageVideoHoverPageUrl(value);
  } catch {
    return null;
  }
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolvePendingChrome(override?: PageVideoPendingChrome): PageVideoPendingChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: PageVideoPendingChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

export function isPageVideoHoverPendingTarget(value: unknown): value is PageVideoHoverPendingTarget {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<PageVideoHoverPendingTarget>;
  const startOk = pending.startMs === null || finiteMs(pending.startMs) !== null;
  const endOk = pending.endMs === null || finiteMs(pending.endMs) !== null;
  return (
    typeof pending.normalizedUrl === 'string' &&
    pending.normalizedUrl.trim().length > 0 &&
    typeof pending.canonicalUrl === 'string' &&
    pending.canonicalUrl.trim().length > 0 &&
    pending.strength === 'strong' &&
    startOk &&
    endOk &&
    typeof pending.setAt === 'number' &&
    Number.isFinite(pending.setAt)
  );
}

export function pageVideoHoverPendingIsExpired(
  pending: Pick<PageVideoHoverPendingTarget, 'setAt'>,
  now = Date.now(),
): boolean {
  return now - pending.setAt > PAGE_VIDEO_HOVER_PENDING_TTL_MS;
}

export function pageVideoHoverPendingMatchesUrl(
  pending: Pick<PageVideoHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl'>,
  tabUrl: string | null | undefined,
): boolean {
  const live = tryNormalizePageVideoUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizePageVideoUrl(pending.normalizedUrl),
    tryNormalizePageVideoUrl(pending.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function pageVideoHoverPendingMatchesTarget(
  pending: Pick<PageVideoHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl' | 'startMs' | 'endMs'>,
  target: Pick<PageVideoHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>,
): boolean {
  if ((pending.startMs ?? null) !== (target.startMs ?? null)) return false;
  if ((pending.endMs ?? null) !== (target.endMs ?? null)) return false;
  return (
    pageVideoHoverPendingMatchesUrl(pending, target.normalizedUrl) ||
    pageVideoHoverPendingMatchesUrl(pending, target.canonicalUrl)
  );
}

export async function clearPageVideoHoverPending(
  chromeApi?: PageVideoPendingChrome,
): Promise<void> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return;
  try {
    await chrome.storage.session.remove(PAGE_VIDEO_HOVER_PENDING_KEY);
  } catch {
    // Session clear is best-effort; expiry also drops stale targets.
  }
}

export async function readPageVideoHoverPending(
  chromeApi?: PageVideoPendingChrome,
  now = Date.now(),
): Promise<PageVideoHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return null;
  try {
    const stored = await chrome.storage.session.get(PAGE_VIDEO_HOVER_PENDING_KEY);
    const value = stored[PAGE_VIDEO_HOVER_PENDING_KEY];
    if (!isPageVideoHoverPendingTarget(value)) {
      if (value !== undefined) await chrome.storage.session.remove(PAGE_VIDEO_HOVER_PENDING_KEY);
      return null;
    }
    if (pageVideoHoverPendingIsExpired(value, now)) {
      await chrome.storage.session.remove(PAGE_VIDEO_HOVER_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writePageVideoHoverPending(
  target: Pick<PageVideoHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>,
  chromeApi?: PageVideoPendingChrome,
  now = Date.now(),
): Promise<PageVideoHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  const normalizedUrl = tryNormalizePageVideoUrl(target.normalizedUrl) ??
    tryNormalizePageVideoUrl(target.canonicalUrl);
  const canonicalUrl = typeof target.canonicalUrl === 'string' ? target.canonicalUrl.trim() : '';
  if (!chrome || !normalizedUrl || !canonicalUrl) return null;
  const pending: PageVideoHoverPendingTarget = {
    normalizedUrl,
    canonicalUrl,
    startMs: finiteMs(target.startMs),
    endMs: finiteMs(target.endMs),
    strength: 'strong',
    setAt: now,
  };
  try {
    await chrome.storage.session.set({ [PAGE_VIDEO_HOVER_PENDING_KEY]: pending });
    return pending;
  } catch {
    return null;
  }
}

async function clearPendingAfterApply(
  result: PageVideoHoverApplyResult,
  chromeApi?: PageVideoPendingChrome,
) {
  if (result.status === 'matched' || result.status === 'source-mismatch') {
    await clearPageVideoHoverPending(chromeApi);
  }
}

export async function applyPendingPageVideoHoverOnTab(
  tab: { tabId: number; tabUrl: string },
  chromeApi?: PageVideoPendingChrome,
  now = Date.now(),
): Promise<PageVideoHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !Number.isInteger(tab.tabId) || tab.tabId < 0) {
    return { status: 'unavailable' };
  }
  const pending = await readPageVideoHoverPending(chrome, now);
  if (!pending || !pageVideoHoverPendingMatchesUrl(pending, tab.tabUrl)) {
    return { status: 'unavailable' };
  }
  const expectedNormalizedUrl = tryNormalizePageVideoUrl(tab.tabUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      func: applyPageVideoHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        strength: pending.strength,
        startMs: pending.startMs,
        endMs: pending.endMs,
      }],
    });
    const result = pageVideoHoverApplyResultFromPage(injection);
    await clearPendingAfterApply(result, chrome);
    if (result.status === 'matched') {
      schedulePageVideoHoverOpenIdleClear({ tabId: tab.tabId, tabUrl: tab.tabUrl }, chrome);
    }
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}

export type ExistingPageVideoTab = {
  id: number;
  url: string;
  status?: string;
  windowId?: number;
};

export function findExistingPageVideoTab(
  tabs: Array<{ id?: number; url?: string; status?: string; windowId?: number }>,
  pending: Pick<PageVideoHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl'>,
): ExistingPageVideoTab | null {
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || (tab.id ?? -1) < 0 || typeof tab.url !== 'string') continue;
    if (pageVideoHoverPendingMatchesUrl(pending, tab.url)) {
      return {
        id: tab.id as number,
        url: tab.url,
        ...(tab.status ? { status: tab.status } : {}),
        ...(typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {}),
      };
    }
  }
  return null;
}

export async function applyPendingPageVideoHoverOnConnection(
  connection: PageVideoHoverConnection,
  chromeApi?: PageVideoPendingChrome,
  now = Date.now(),
): Promise<PageVideoHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return { status: 'unavailable' };
  const pending = await readPageVideoHoverPending(chrome, now);
  if (!pending || !pageVideoHoverPendingMatchesUrl(pending, connection.tabUrl)) {
    return { status: 'unavailable' };
  }
  const result = await applyPageVideoHoverOnConnectedTab(
    connection,
    {
      canonicalUrl: pending.canonicalUrl,
      normalizedUrl: pending.normalizedUrl,
      strength: pending.strength,
      startMs: pending.startMs,
      endMs: pending.endMs,
    },
    chrome,
  );
  await clearPendingAfterApply(result, chrome);
  if (result.status === 'matched') {
    schedulePageVideoHoverOpenIdleClear(connection, chrome);
  }
  return result;
}

async function focusExistingOrCreateTab(
  href: string,
  pending: PageVideoHoverPendingTarget,
  chromeApi: PageVideoPendingChrome,
  openFallback?: (href: string) => void,
): Promise<ExistingPageVideoTab | null> {
  try {
    const listed = chromeApi.tabs.query ? await chromeApi.tabs.query({}) : [];
    const existing = findExistingPageVideoTab(listed, pending);
    if (existing) {
      try {
        await chromeApi.tabs.update?.(existing.id, { active: true });
        if (existing.windowId != null) {
          await chromeApi.windows?.update?.(existing.windowId, { focused: true });
        }
      } catch {
        // Focus is best-effort; pending apply still runs on complete/activate.
      }
      return existing;
    }
  } catch {
    // Query failures fall through to create.
  }

  try {
    if (chromeApi.tabs.create) {
      const created = await chromeApi.tabs.create({ url: href, active: true });
      if (created && Number.isInteger(created.id) && (created.id ?? -1) >= 0) {
        return {
          id: created.id as number,
          url: typeof created.url === 'string' && created.url ? created.url : href,
          ...(created.status ? { status: created.status } : {}),
          ...(typeof created.windowId === 'number' ? { windowId: created.windowId } : {}),
        };
      }
      return null;
    }
  } catch {
    // Fall through to the window.open path when tabs.create is unavailable.
  }
  openFallback?.(href);
  return null;
}

export async function openPageVideoSourceFromPanel(input: {
  target: Pick<PageVideoHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>;
  connection: PageVideoHoverConnection | null;
  href: string;
  chromeApi?: PageVideoPendingChrome;
  now?: number;
  openFallback?: (href: string) => void;
}): Promise<PageVideoSourceOpenOutcome> {
  const chrome = resolvePendingChrome(input.chromeApi);
  if (!chrome) {
    input.openFallback?.(input.href);
    return { applied: null, awaitingConnection: true };
  }

  const pending = await writePageVideoHoverPending(input.target, chrome, input.now ?? Date.now());

  if (
    input.connection &&
    annotationMatchesConnectedPageVideo({
      kind: 'video',
      startMs: input.target.startMs,
      endMs: input.target.endMs,
      source: {
        type: 'article',
        canonicalUrl: input.target.canonicalUrl,
        normalizedUrl: input.target.normalizedUrl,
      },
    }, input.connection.tabUrl)
  ) {
    const applied = await openPageVideoSourceOnConnectedTab(
      input.connection,
      { ...input.target, strength: 'strong' },
      chrome,
    );
    if (applied.status === 'matched') {
      await clearPageVideoHoverPending(chrome);
      return { applied, awaitingConnection: false };
    }
    if (applied.status === 'source-mismatch') {
      await clearPageVideoHoverPending(chrome);
      return { applied, awaitingConnection: false };
    }
  }

  if (!pending) {
    await focusExistingOrCreateTab(input.href, {
      normalizedUrl: input.target.normalizedUrl,
      canonicalUrl: input.target.canonicalUrl,
      startMs: finiteMs(input.target.startMs),
      endMs: finiteMs(input.target.endMs),
      strength: 'strong',
      setAt: input.now ?? Date.now(),
    }, chrome, input.openFallback);
    return { applied: null, awaitingConnection: true };
  }

  const opened = await focusExistingOrCreateTab(input.href, pending, chrome, input.openFallback);
  if (opened?.status === 'complete' && pageVideoHoverPendingMatchesUrl(pending, opened.url)) {
    const applied = await applyPendingPageVideoHoverOnTab(
      { tabId: opened.id, tabUrl: opened.url },
      chrome,
      input.now ?? Date.now(),
    );
    if (applied.status === 'matched') {
      return { applied, awaitingConnection: false };
    }
    return { applied, awaitingConnection: true };
  }

  return { applied: null, awaitingConnection: true };
}
