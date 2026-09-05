import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedArticle,
  applyArticleHoverOnConnectedTab,
  ARTICLE_HOVER_LEAVE_MS,
  clearArticleHoverOnConnectedTab,
  createArticleHoverLeaveController,
  createArticleHoverSession,
} from './article-hover-link.ts';
import { applyArticleHoverHighlightOnPage } from './article-hover-page.ts';

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
  return {
    calls,
    scripting: {
      executeScript: async (injection) => {
        calls.push(injection);
        if (options.scriptingError) throw new Error('scripting failed');
        return [{ result: { ok: true } }];
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
    },
  };
}

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
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    chrome,
  ), true);
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 17, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: ARTICLE,
    selectedText: SELECTED,
    strength: 'soft',
  });

  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'strong' },
    fakeChrome(),
  ), false);
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: YOUTUBE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ liveUrl: YOUTUBE, context: connectedContext({ url: YOUTUBE }) }),
  ), false);
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ context: connectedContext({ tabId: 99 }) }),
  ), false);
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ liveUrl: OTHER }),
  ), false);
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ tabError: true }),
  ), false);
  assert.equal(await applyArticleHoverOnConnectedTab(
    { tabId: 17, tabUrl: ARTICLE },
    { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE, strength: 'soft' },
    fakeChrome({ scriptingError: true }),
  ), false);
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

test('Sprint 3 hover linking does not add permissions or persistent content scripts', async () => {
  const [config, background, link, page] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-link.ts', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-page.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen'\]/);
  assert.doesNotMatch(config, /host_permissions|content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(link, /frameIds: \[0\]/);
  assert.match(link, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.match(link, /normalizeSourceUrl|classifySourceUrl/);
  assert.doesNotMatch(link, /host_permissions|defineContentScript/);
  assert.match(page, /Serialized into the explicitly connected top-level tab/);
  assert.doesNotMatch(page, /chrome\.|host_permissions|defineContentScript/);
});
