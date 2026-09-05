import { ACTIVE_TAB_CONTEXT_KEY, isActiveTabContext } from './active-tab-context.ts';
import {
  applyArticleHoverHighlightOnPage,
  clearArticleHoverHighlightOnPage,
  type ArticleHoverPageRequest,
  type ArticleHoverPageResult,
  type ArticleHoverStrength,
} from './article-hover-page.ts';
import { classifySourceUrl, normalizeSourceUrl } from './social-helpers.ts';

export const ARTICLE_HOVER_LEAVE_MS = 120;
export const ARTICLE_HOVER_OPEN_IDLE_MS = 12_000;

export const ARTICLE_PASSAGE_MISS_STATUS =
  'This passage isn’t on the live page anymore (it may have been edited).';
export const ARTICLE_PASSAGE_MISS_OPEN_HINT = 'Open source still opens the article.';

export type ArticleHoverApplyResult =
  | { status: 'matched' }
  | { status: 'unmatched' }
  | { status: 'source-mismatch' }
  | { status: 'unavailable' };

export type ArticleHoverResultListener = (result: ArticleHoverApplyResult) => void;

export type ArticleHoverConnection = {
  tabId: number;
  tabUrl: string;
};

export type ArticleHoverAnnotationRef = {
  kind?: string | null;
  selectedText?: string | null;
  source?: {
    type?: string | null;
    canonicalUrl?: string | null;
    normalizedUrl?: string | null;
  } | null;
};

export type ArticleHoverTarget = {
  selectedText: string;
  canonicalUrl: string;
  normalizedUrl: string;
  strength: ArticleHoverStrength;
};

export type ArticleHoverChrome = {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyArticleHoverHighlightOnPage | typeof clearArticleHoverHighlightOnPage;
      args?: [ArticleHoverPageRequest];
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

function tryNormalizeArticleUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube' || classifySourceUrl(value) === 'tiktok') return null;
    return normalizeSourceUrl(value);
  } catch {
    return null;
  }
}

function readFirstFramePageResult(value: unknown): ArticleHoverPageResult | null {
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
    reason === 'text-unmatched' ||
    reason === 'invalid-request'
  ) {
    return { ok, reason };
  }
  return { ok };
}

export function articleHoverApplyResultFromPage(
  value: unknown,
): ArticleHoverApplyResult {
  const page = readFirstFramePageResult(value);
  if (!page) return { status: 'unavailable' };
  if (page.ok) return { status: 'matched' };
  if (page.reason === 'text-unmatched') return { status: 'unmatched' };
  if (page.reason === 'source-mismatch') return { status: 'source-mismatch' };
  return { status: 'unavailable' };
}

export function articleHoverConnectionForTab(
  classification: string | null | undefined,
  tabId: number | null | undefined,
  tabUrl: string | null | undefined,
): ArticleHoverConnection | null {
  if (classification === 'YouTube' || classification === 'TikTok') return null;
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

export function annotationMatchesConnectedArticle(
  annotation: ArticleHoverAnnotationRef | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  if (!annotation || annotation.kind !== 'article') return false;
  if (annotation.source?.type && annotation.source.type !== 'article') return false;
  if (typeof annotation.selectedText !== 'string' || !annotation.selectedText.trim()) {
    return false;
  }
  const live = tryNormalizeArticleUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizeArticleUrl(annotation.source?.normalizedUrl),
    tryNormalizeArticleUrl(annotation.source?.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function createArticleHoverLeaveController(options: {
  leaveMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const leaveMs = options.leaveMs ?? ARTICLE_HOVER_LEAVE_MS;
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

function resolveChrome(override?: ArticleHoverChrome): ArticleHoverChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: ArticleHoverChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

async function connectedArticleUrl(
  connection: ArticleHoverConnection,
  chromeApi: ArticleHoverChrome,
  target: Pick<ArticleHoverTarget, 'selectedText' | 'canonicalUrl' | 'normalizedUrl'>,
): Promise<string | null> {
  if (!annotationMatchesConnectedArticle({
    kind: 'article',
    selectedText: target.selectedText,
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
    return annotationMatchesConnectedArticle({
      kind: 'article',
      selectedText: target.selectedText,
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

export async function applyArticleHoverOnConnectedTab(
  connection: ArticleHoverConnection,
  target: ArticleHoverTarget,
  chromeApi?: ArticleHoverChrome,
): Promise<ArticleHoverApplyResult> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) {
    return { status: 'unavailable' };
  }
  const liveUrl = await connectedArticleUrl(connection, chrome, target);
  if (!liveUrl) return { status: 'unavailable' };
  const expectedNormalizedUrl = tryNormalizeArticleUrl(liveUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: applyArticleHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        selectedText: target.selectedText,
        strength: target.strength,
      }],
    });
    return articleHoverApplyResultFromPage(injection);
  } catch {
    return { status: 'unavailable' };
  }
}

export async function openArticleSourceOnConnectedTab(
  connection: ArticleHoverConnection,
  target: Omit<ArticleHoverTarget, 'strength'> & { strength?: ArticleHoverStrength },
  chromeApi?: ArticleHoverChrome,
): Promise<ArticleHoverApplyResult> {
  cancelArticleHoverLink();
  const applied = await applyArticleHoverOnConnectedTab(
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
    // Focus is best-effort; matched highlight or unmatched honesty already ran.
  }
  scheduleArticleHoverOpenIdleClear(connection, chromeApi);
  return applied;
}

export async function clearArticleHoverOnConnectedTab(
  connection: ArticleHoverConnection,
  chromeApi?: ArticleHoverChrome,
): Promise<boolean> {
  const chrome = resolveChrome(chromeApi);
  if (!chrome || !Number.isInteger(connection.tabId) || connection.tabId < 0) return false;
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(context) && context.tabId !== connection.tabId) return false;
    await chrome.scripting.executeScript({
      target: { tabId: connection.tabId, frameIds: [0] },
      func: clearArticleHoverHighlightOnPage,
    });
    return true;
  } catch {
    return false;
  }
}

export function createArticleHoverSession(options: {
  leaveMs?: number;
  idleMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}) {
  const timers = {
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
  };
  const leave = createArticleHoverLeaveController({
    leaveMs: options.leaveMs ?? ARTICLE_HOVER_LEAVE_MS,
    ...timers,
  });
  const idle = createArticleHoverLeaveController({
    leaveMs: options.idleMs ?? ARTICLE_HOVER_OPEN_IDLE_MS,
    ...timers,
  });
  return {
    enter(
      connection: ArticleHoverConnection | null,
      target: ArticleHoverTarget,
      chromeApi?: ArticleHoverChrome,
      onResult?: ArticleHoverResultListener,
    ) {
      idle.cancel();
      leave.enter(() => {
        if (!connection) return;
        void applyArticleHoverOnConnectedTab(connection, target, chromeApi).then((result) => {
          onResult?.(result);
        });
      });
    },
    leave(connection: ArticleHoverConnection | null, chromeApi?: ArticleHoverChrome) {
      idle.cancel();
      leave.leave(() => {
        if (!connection) return;
        void clearArticleHoverOnConnectedTab(connection, chromeApi);
      });
    },
    scheduleIdle(connection: ArticleHoverConnection | null, chromeApi?: ArticleHoverChrome) {
      leave.cancel();
      idle.leave(() => {
        if (!connection) return;
        void clearArticleHoverOnConnectedTab(connection, chromeApi);
      });
    },
    cancel() {
      leave.cancel();
      idle.cancel();
    },
  };
}

const sharedHover = createArticleHoverSession();

export function enterArticleHoverLink(
  connection: ArticleHoverConnection | null,
  target: ArticleHoverTarget,
  chromeApi?: ArticleHoverChrome,
  onResult?: ArticleHoverResultListener,
) {
  sharedHover.enter(connection, target, chromeApi, onResult);
}

export function leaveArticleHoverLink(
  connection: ArticleHoverConnection | null,
  chromeApi?: ArticleHoverChrome,
) {
  sharedHover.leave(connection, chromeApi);
}

export function cancelArticleHoverLink() {
  sharedHover.cancel();
}

export function scheduleArticleHoverOpenIdleClear(
  connection: ArticleHoverConnection | null,
  chromeApi?: ArticleHoverChrome,
) {
  sharedHover.scheduleIdle(connection, chromeApi);
}

export function articleHoverRegionHandlers(
  connection: ArticleHoverConnection | null,
  target: ArticleHoverTarget | null,
  onResult?: ArticleHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterArticleHoverLink(connection, target, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      leaveArticleHoverLink(connection);
    },
  };
}

export function articleHoverNestedChipHandlers(
  connection: ArticleHoverConnection | null,
  target: Omit<ArticleHoverTarget, 'strength'> | null,
  onResult?: ArticleHoverResultListener,
) {
  return {
    onPointerEnter: () => {
      if (!connection || !target) return;
      enterArticleHoverLink(connection, { ...target, strength: 'strong' }, undefined, onResult);
    },
    onPointerLeave: () => {
      if (!connection || !target) return;
      enterArticleHoverLink(connection, { ...target, strength: 'soft' }, undefined, onResult);
    },
  };
}
