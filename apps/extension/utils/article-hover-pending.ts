import {
  applyArticleHoverOnConnectedTab,
  articleHoverApplyResultFromPage,
  annotationMatchesConnectedArticle,
  openArticleSourceOnConnectedTab,
  type ArticleHoverApplyResult,
  type ArticleHoverChrome,
  type ArticleHoverConnection,
  type ArticleHoverTarget,
} from './article-hover-link.ts';
import { applyArticleHoverHighlightOnPage } from './article-hover-page.ts';
import { classifySourceUrl, normalizeSourceUrl } from './social-helpers.ts';

export const ARTICLE_HOVER_PENDING_KEY = 'annotatedArticleHoverPending';
export const ARTICLE_HOVER_PENDING_TTL_MS = 12 * 60 * 1000;
export const ARTICLE_PENDING_CONNECT_HINT =
  'Amber highlight applies when Annotated is connected on that tab.';

export type ArticleHoverPendingTarget = {
  normalizedUrl: string;
  selectedText: string;
  canonicalUrl: string;
  strength: 'strong';
  setAt: number;
};

export type ArticlePendingChrome = ArticleHoverChrome & {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
  tabs: ArticleHoverChrome['tabs'] & {
    create?: (createProperties: { url: string; active: true }) => Promise<unknown>;
  };
};

export type ArticleSourceOpenOutcome = {
  applied: ArticleHoverApplyResult | null;
  awaitingConnection: boolean;
};

function tryNormalizeArticleUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube') return null;
    return normalizeSourceUrl(value);
  } catch {
    return null;
  }
}

function resolvePendingChrome(override?: ArticlePendingChrome): ArticlePendingChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: ArticlePendingChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

export function isArticleHoverPendingTarget(value: unknown): value is ArticleHoverPendingTarget {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<ArticleHoverPendingTarget>;
  return (
    typeof pending.normalizedUrl === 'string' &&
    pending.normalizedUrl.trim().length > 0 &&
    typeof pending.selectedText === 'string' &&
    pending.selectedText.trim().length > 0 &&
    typeof pending.canonicalUrl === 'string' &&
    pending.canonicalUrl.trim().length > 0 &&
    pending.strength === 'strong' &&
    typeof pending.setAt === 'number' &&
    Number.isFinite(pending.setAt)
  );
}

export function articleHoverPendingIsExpired(
  pending: Pick<ArticleHoverPendingTarget, 'setAt'>,
  now = Date.now(),
): boolean {
  return now - pending.setAt > ARTICLE_HOVER_PENDING_TTL_MS;
}

export function articleHoverPendingMatchesUrl(
  pending: Pick<ArticleHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl'>,
  tabUrl: string | null | undefined,
): boolean {
  const live = tryNormalizeArticleUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizeArticleUrl(pending.normalizedUrl),
    tryNormalizeArticleUrl(pending.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function articleHoverPendingMatchesTarget(
  pending: ArticleHoverPendingTarget,
  target: Pick<ArticleHoverTarget, 'selectedText' | 'canonicalUrl' | 'normalizedUrl'>,
): boolean {
  if (pending.selectedText.trim() !== target.selectedText.trim()) return false;
  return (
    articleHoverPendingMatchesUrl(pending, target.normalizedUrl) ||
    articleHoverPendingMatchesUrl(pending, target.canonicalUrl)
  );
}

export async function clearArticleHoverPending(
  chromeApi?: ArticlePendingChrome,
): Promise<void> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return;
  try {
    await chrome.storage.session.remove(ARTICLE_HOVER_PENDING_KEY);
  } catch {
    // Session clear is best-effort; expiry also drops stale targets.
  }
}

export async function readArticleHoverPending(
  chromeApi?: ArticlePendingChrome,
  now = Date.now(),
): Promise<ArticleHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return null;
  try {
    const stored = await chrome.storage.session.get(ARTICLE_HOVER_PENDING_KEY);
    const value = stored[ARTICLE_HOVER_PENDING_KEY];
    if (!isArticleHoverPendingTarget(value)) {
      if (value !== undefined) await chrome.storage.session.remove(ARTICLE_HOVER_PENDING_KEY);
      return null;
    }
    if (articleHoverPendingIsExpired(value, now)) {
      await chrome.storage.session.remove(ARTICLE_HOVER_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writeArticleHoverPending(
  target: Pick<ArticleHoverTarget, 'selectedText' | 'canonicalUrl' | 'normalizedUrl'>,
  chromeApi?: ArticlePendingChrome,
  now = Date.now(),
): Promise<ArticleHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  const selectedText = typeof target.selectedText === 'string' ? target.selectedText.trim() : '';
  const normalizedUrl = tryNormalizeArticleUrl(target.normalizedUrl) ??
    tryNormalizeArticleUrl(target.canonicalUrl);
  const canonicalUrl = typeof target.canonicalUrl === 'string' ? target.canonicalUrl.trim() : '';
  if (!chrome || !selectedText || !normalizedUrl || !canonicalUrl) return null;
  const pending: ArticleHoverPendingTarget = {
    normalizedUrl,
    selectedText,
    canonicalUrl,
    strength: 'strong',
    setAt: now,
  };
  try {
    await chrome.storage.session.set({ [ARTICLE_HOVER_PENDING_KEY]: pending });
    return pending;
  } catch {
    return null;
  }
}

async function clearPendingAfterApply(result: ArticleHoverApplyResult, chromeApi?: ArticlePendingChrome) {
  if (result.status === 'matched' || result.status === 'unmatched') {
    await clearArticleHoverPending(chromeApi);
  }
}

export async function applyPendingArticleHoverOnActionTab(
  tab: { tabId: number; tabUrl: string },
  chromeApi?: ArticlePendingChrome,
  now = Date.now(),
): Promise<ArticleHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !Number.isInteger(tab.tabId) || tab.tabId < 0) {
    return { status: 'unavailable' };
  }
  const pending = await readArticleHoverPending(chrome, now);
  if (!pending || !articleHoverPendingMatchesUrl(pending, tab.tabUrl)) {
    return { status: 'unavailable' };
  }
  const expectedNormalizedUrl = tryNormalizeArticleUrl(tab.tabUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      func: applyArticleHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        selectedText: pending.selectedText,
        strength: pending.strength,
      }],
    });
    const result = articleHoverApplyResultFromPage(injection);
    await clearPendingAfterApply(result, chrome);
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}

export async function applyPendingArticleHoverOnConnection(
  connection: ArticleHoverConnection,
  chromeApi?: ArticlePendingChrome,
  now = Date.now(),
): Promise<ArticleHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return { status: 'unavailable' };
  const pending = await readArticleHoverPending(chrome, now);
  if (!pending || !articleHoverPendingMatchesUrl(pending, connection.tabUrl)) {
    return { status: 'unavailable' };
  }
  const result = await applyArticleHoverOnConnectedTab(
    connection,
    {
      selectedText: pending.selectedText,
      canonicalUrl: pending.canonicalUrl,
      normalizedUrl: pending.normalizedUrl,
      strength: pending.strength,
    },
    chrome,
  );
  await clearPendingAfterApply(result, chrome);
  return result;
}

async function openSourceHref(
  href: string,
  chromeApi: ArticlePendingChrome,
  openFallback?: (href: string) => void,
): Promise<void> {
  try {
    if (chromeApi.tabs.create) {
      await chromeApi.tabs.create({ url: href, active: true });
      return;
    }
  } catch {
    // Fall through to the window.open path when tabs.create is unavailable.
  }
  openFallback?.(href);
}

export async function openArticleSourceFromPanel(input: {
  target: Pick<ArticleHoverTarget, 'selectedText' | 'canonicalUrl' | 'normalizedUrl'>;
  connection: ArticleHoverConnection | null;
  href: string;
  chromeApi?: ArticlePendingChrome;
  now?: number;
  openFallback?: (href: string) => void;
}): Promise<ArticleSourceOpenOutcome> {
  const chrome = resolvePendingChrome(input.chromeApi);
  if (!chrome) {
    input.openFallback?.(input.href);
    return { applied: null, awaitingConnection: true };
  }

  await writeArticleHoverPending(input.target, chrome, input.now ?? Date.now());

  if (
    input.connection &&
    annotationMatchesConnectedArticle({
      kind: 'article',
      selectedText: input.target.selectedText,
      source: {
        type: 'article',
        canonicalUrl: input.target.canonicalUrl,
        normalizedUrl: input.target.normalizedUrl,
      },
    }, input.connection.tabUrl)
  ) {
    const applied = await openArticleSourceOnConnectedTab(
      input.connection,
      { ...input.target, strength: 'strong' },
      chrome,
    );
    if (applied.status === 'matched' || applied.status === 'unmatched') {
      await clearArticleHoverPending(chrome);
      return { applied, awaitingConnection: false };
    }
    await openSourceHref(input.href, chrome, input.openFallback);
    return { applied, awaitingConnection: true };
  }

  await openSourceHref(input.href, chrome, input.openFallback);
  return { applied: null, awaitingConnection: true };
}
