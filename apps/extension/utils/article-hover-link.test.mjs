import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedArticle,
  applyArticleHoverOnConnectedTab,
  articleHoverApplyResultFromPage,
  articleHoverConnectionForTab,
  ARTICLE_HOVER_LEAVE_MS,
  ARTICLE_HOVER_OPEN_IDLE_MS,
  ARTICLE_PASSAGE_MISS_OPEN_HINT,
  ARTICLE_PASSAGE_MISS_STATUS,
  cancelArticleHoverLink,
  clearArticleHoverOnConnectedTab,
  createArticleHoverLeaveController,
  createArticleHoverSession,
  openArticleSourceOnConnectedTab,
} from './article-hover-link.ts';
import { applyArticleHoverHighlightOnPage } from './article-hover-page.ts';

afterEach(() => {
  cancelArticleHoverLink();
});

const ARTICLE = 'https://example.com/story';
const ARTICLE_TRACKED = 'https://Example.com/story/?utm_source=feed#quote';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SELECTED = 'The unique passage on this page.';

function articleAnnotation(overrides = {}) {
  return {
    kind: 'article',
    selectedText: SELECTED,
    source: {
      type: 'article',
      canonicalUrl: ARTICLE,
      normalizedUrl: ARTICLE,
    },
    ...overrides,
  };
}

function connectedContext(overrides = {}) {
  return {
    tabId: 17,
    windowId: 1,
    title: 'Story',
    url: ARTICLE,
    capturedAt: 1,
    ...overrides,
  };
}

function fakeChrome(options = {}) {
  const calls = [];
  const tabUpdates = [];
  return {
    calls,
    tabUpdates,
    scripting: {
      executeScript: async (injection) => {
        calls.push(injection);
        if (options.scriptingError) throw new Error('scripting failed');
        return [{ result: options.pageResult ?? { ok: true } }];
      },
    },
    storage: {
      session: {
        get: async (key) => {
          assert.equal(key, ACTIVE_TAB_CONTEXT_KEY);
          return { [ACTIVE_TAB_CONTEXT_KEY]: options.context === undefined ? connectedContext() : options.context };
        },
      },
    },
    tabs: {
      get: async (tabId) => {
        if (options.tabError) throw new Error('tab missing');
        return { id: tabId, url: options.liveUrl ?? ARTICLE };
      },
      update: async (tabId, update) => {
        tabUpdates.push({ tabId, update });
        if (options.updateError) throw new Error('tab update failed');
        return { id: tabId, active: true };
      },
    },
  };
}

test('article hover connects Web page and Podcast sources but not YouTube', () => {
  assert.deepEqual(articleHoverConnectionForTab('Web page', 17, ARTICLE), {
    tabId: 17,
    tabUrl: ARTICLE,
  });
  assert.deepEqual(articleHoverConnectionForTab('Podcast / web audio', 17, ARTICLE), {
    tabId: 17,
    tabUrl: ARTICLE,
  });
  assert.equal(articleHoverConnectionForTab('YouTube', 17, YOUTUBE), null);
  assert.equal(articleHoverConnectionForTab('Web page', 17, 'chrome://extensions'), null);
  assert.equal(articleHoverConnectionForTab('Web page', -1, ARTICLE), null);
});

test('matches only the annotation article URL and fails closed otherwise', () => {
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), ARTICLE), true);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), ARTICLE_TRACKED), true);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({
    source: { type: 'article', canonicalUrl: ARTICLE_TRACKED, normalizedUrl: ARTICLE },
  }), ARTICLE), true);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), OTHER), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), YOUTUBE), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), 'https://youtu.be/dQw4w9WgXcQ'), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({ kind: 'youtube' }), ARTICLE), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({ kind: 'audio' }), ARTICLE), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({
    audio: { storagePath: 'owners/example/commentary.webm', durationMs: 4000 },
  }), ARTICLE), true);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({
    source: { type: 'youtube', canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
  }), ARTICLE), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation({ selectedText: '   ' }), ARTICLE), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), 'not-a-url'), false);
  assert.equal(annotationMatchesConnectedArticle(articleAnnotation(), null), false);
  assert.equal(annotationMatchesConnectedArticle(null, ARTICLE), false);
});

test('debounces leave by 120 ms and cancels clear when another region is entered', () => {
  const timers = [];
  let now = 0;
  const controller = createArticleHoverLeaveController({
    leaveMs: ARTICLE_HOVER_LEAVE_MS,
    setTimeoutFn: (fn, delay) => {
      const id = timers.length + 1;
      timers.push({ id, fn, delay, at: now + delay });
      return id;
    },
    clearTimeoutFn: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  const events = [];

  controller.enter(() => events.push('soft'));
  controller.leave(() => events.push('clear'));
  assert.equal(controller.pending, true);
  assert.equal(timers[0]?.delay, 120);
  assert.deepEqual(events, ['soft']);

  now = 80;
  controller.enter(() => events.push('strong'));
  assert.equal(controller.pending, false);
  assert.equal(timers.length, 0);
  assert.deepEqual(events, ['soft', 'strong']);

  controller.leave(() => events.push('clear'));
  now = 200;
  timers[0].fn();
  assert.deepEqual(events, ['soft', 'strong', 'clear']);
});

test('injects APPLY only for the explicitly connected matching article tab', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 17, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: ARTICLE,
    selectedText: SELECTED,
    strength: 'soft',
  });

  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'strong' },
    fakeChrome(),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: YOUTUBE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ liveUrl: YOUTUBE, context: connectedContext({ url: YOUTUBE }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ context: connectedContext({ tabId: 99 }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ liveUrl: OTHER }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ tabError: true }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ scriptingError: true }),
  ), { status: 'unavailable' });
});

test('apply helper surfaces unmatched from the first-frame page result', async () => {
  assert.deepEqual(
    articleHoverApplyResultFromPage([{ result: { ok: false, reason: 'text-unmatched' } }]),
    { status: 'unmatched' },
  );
  assert.deepEqual(
    articleHoverApplyResultFromPage([{ result: { ok: false, reason: 'source-mismatch' } }]),
    { status: 'source-mismatch' },
  );
  assert.deepEqual(
    articleHoverApplyResultFromPage([{ result: { ok: true } }]),
    { status: 'matched' },
  );
  assert.deepEqual(articleHoverApplyResultFromPage([]), { status: 'unavailable' });
  assert.deepEqual(articleHoverApplyResultFromPage([{ result: { ok: false } }]), { status: 'unavailable' });

  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ pageResult: { ok: false, reason: 'text-unmatched' } }),
  ), { status: 'unmatched' });
  assert.deepEqual(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'strong' },
    fakeChrome({ pageResult: { ok: false, reason: 'source-mismatch' } }),
  ), { status: 'source-mismatch' });
});

test('session enter notifies UI when a connected URL probe is unmatched', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const results = [];
  const session = createArticleHoverSession();
  session.enter(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ pageResult: { ok: false, reason: 'text-unmatched' } }),
    (result) => results.push(result),
  );
  await drain();
  assert.deepEqual(results, [{ status: 'unmatched' }]);
});

test('session leave waits 120 ms before CLEAR and stays on the connected tab', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const timers = [];
  const chrome = fakeChrome();
  const session = createArticleHoverSession({
    setTimeoutFn: (fn, delay) => {
      const id = timers.length + 1;
      timers.push({ id, fn, delay });
      return id;
    },
    clearTimeoutFn: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });

  session.enter(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    chrome,
  );
  await drain();
  session.leave({ tabId: 17, tabUrl: ARTICLE }, chrome);
  assert.equal(timers[0]?.delay, 120);
  assert.equal(chrome.calls.length, 1);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 2);
  assert.equal(chrome.calls[1].func.name, 'clearArticleHoverHighlightOnPage');
  assert.deepEqual(chrome.calls[1].target, { tabId: 17, frameIds: [0] });
});

test('CLEAR fails closed when the stored tab is no longer the connected tab', async () => {
  assert.equal(await clearArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    fakeChrome({ context: connectedContext({ tabId: 4 }) }),
  ), false);
});

test('Open source on a connected article focuses the tab and applies highlight', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.equal(chrome.calls[0].args[0].strength, 'strong');
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);

  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    fakeChrome(),
  ), { status: 'unavailable' });

  const focusFails = fakeChrome({ updateError: true });
  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    focusFails,
  ), { status: 'matched' });
  assert.equal(focusFails.calls.length, 1);
});

test('Open source does not use the 120 ms hover leave window after apply', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const chrome = fakeChrome();
  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
});

test('Open source idle clear uses a long TTL separate from hover leave', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  assert.equal(ARTICLE_HOVER_OPEN_IDLE_MS, 12_000);
  assert.ok(ARTICLE_HOVER_OPEN_IDLE_MS >= 8_000);
  assert.ok(ARTICLE_HOVER_OPEN_IDLE_MS !== ARTICLE_HOVER_LEAVE_MS);
  const timers = [];
  const chrome = fakeChrome();
  const session = createArticleHoverSession({
    idleMs: ARTICLE_HOVER_OPEN_IDLE_MS,
    setTimeoutFn: (fn, delay) => {
      const id = timers.length + 1;
      timers.push({ id, fn, delay });
      return id;
    },
    clearTimeoutFn: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  session.scheduleIdle({ tabId: 17, tabUrl: ARTICLE }, chrome);
  assert.equal(timers[0]?.delay, 12_000);
  assert.equal(chrome.calls.length, 0);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func.name, 'clearArticleHoverHighlightOnPage');
});

test('Open source still focuses the connected tab when the live passage is unmatched', async () => {
  const chrome = fakeChrome({ pageResult: { ok: false, reason: 'text-unmatched' } });
  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    chrome,
  ), { status: 'unmatched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);

  const mismatched = fakeChrome({ pageResult: { ok: false, reason: 'source-mismatch' } });
  assert.deepEqual(await openArticleSourceOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    mismatched,
  ), { status: 'source-mismatch' });
  assert.deepEqual(mismatched.tabUpdates, []);
});

test('article miss copy stays short and does not blame the reader', () => {
  assert.equal(
    ARTICLE_PASSAGE_MISS_STATUS,
    'This passage isn’t on the live page anymore (it may have been edited).',
  );
  assert.equal(ARTICLE_PASSAGE_MISS_OPEN_HINT, 'Open source still opens the article.');
  assert.doesNotMatch(ARTICLE_PASSAGE_MISS_STATUS, /you|your|wrong|failed|error/i);
});

test('Sprint 3 hover linking keeps one-shot scripting and no persistent content scripts', async () => {
  const [config, background, link, page, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-link.ts', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-page.ts', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-pending.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(link, /frameIds: \[0\]/);
  assert.match(link, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.match(link, /normalizeSourceUrl|classifySourceUrl/);
  assert.match(link, /ARTICLE_HOVER_OPEN_IDLE_MS = 12_000/);
  assert.doesNotMatch(link, /leaveArticleHoverLink\(connection, chromeApi\);\s*return applied/);
  assert.doesNotMatch(link, /host_permissions|defineContentScript/);
  assert.match(page, /Serialized into the explicitly connected top-level tab/);
  assert.doesNotMatch(page, /chrome\.|host_permissions|defineContentScript/);
  assert.match(pending, /ARTICLE_HOVER_PENDING_KEY/);
  assert.match(background, /applyPendingArticleHoverOnTab/);
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
