import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedPageVideo,
  applyPageVideoHoverOnConnectedTab,
  pageVideoHoverApplyResultFromPage,
  pageVideoHoverConnectionForTab,
  PAGE_VIDEO_HOVER_LEAVE_MS,
  PAGE_VIDEO_HOVER_OPEN_IDLE_MS,
  cancelPageVideoHoverLink,
  clearPageVideoHoverOnConnectedTab,
  createPageVideoHoverLeaveController,
  createPageVideoHoverSession,
  openPageVideoSourceOnConnectedTab,
} from './page-video-hover-link.ts';
import { applyPageVideoHoverHighlightOnPage } from './page-video-hover-page.ts';

afterEach(() => {
  cancelPageVideoHoverLink();
});

const PAGE = 'https://www.foxnews.com/politics/example-story';
const PAGE_TRACKED = 'https://www.foxnews.com/politics/example-story/?utm_source=feed&t=30s';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const ARTICLE = 'https://example.com/story';

function videoAnnotation(overrides = {}) {
  return {
    kind: 'video',
    startMs: 1_000,
    endMs: 4_000,
    source: {
      type: 'article',
      canonicalUrl: PAGE,
      normalizedUrl: PAGE,
    },
    ...overrides,
  };
}

function connectedContext(overrides = {}) {
  return {
    tabId: 17,
    windowId: 1,
    title: 'Story',
    url: PAGE,
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
        return { id: tabId, url: options.liveUrl ?? PAGE };
      },
      update: async (tabId, update) => {
        tabUpdates.push({ tabId, update });
        if (options.updateError) throw new Error('tab update failed');
        return { id: tabId, active: true };
      },
    },
  };
}

test('page-video hover connects Web page and Podcast sources but not YouTube', () => {
  assert.deepEqual(pageVideoHoverConnectionForTab('Web page', 17, PAGE), {
    tabId: 17,
    tabUrl: PAGE,
  });
  assert.deepEqual(pageVideoHoverConnectionForTab('Podcast / web audio', 17, PAGE), {
    tabId: 17,
    tabUrl: PAGE,
  });
  assert.equal(pageVideoHoverConnectionForTab('YouTube', 17, YOUTUBE), null);
  assert.equal(pageVideoHoverConnectionForTab('Web page', 17, 'chrome://extensions'), null);
  assert.equal(pageVideoHoverConnectionForTab('Web page', -1, PAGE), null);
});

test('matches only the annotation webpage-video URL and source_type and fails closed otherwise', () => {
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), PAGE), true);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), PAGE_TRACKED), true);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({
    source: { type: 'article', canonicalUrl: PAGE_TRACKED, normalizedUrl: PAGE },
  }), PAGE), true);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), OTHER), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), YOUTUBE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), ARTICLE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({ kind: 'article' }), PAGE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({ kind: 'youtube' }), PAGE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({ kind: 'audio' }), PAGE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({
    source: { type: 'youtube', canonicalUrl: PAGE, normalizedUrl: PAGE },
  }), PAGE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation({
    source: { type: 'podcast', canonicalUrl: PAGE, normalizedUrl: PAGE },
  }), PAGE), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), 'not-a-url'), false);
  assert.equal(annotationMatchesConnectedPageVideo(videoAnnotation(), null), false);
  assert.equal(annotationMatchesConnectedPageVideo(null, PAGE), false);
});

test('debounces leave by 120 ms and cancels clear when another region is entered', () => {
  const timers = [];
  let now = 0;
  const controller = createPageVideoHoverLeaveController({
    leaveMs: PAGE_VIDEO_HOVER_LEAVE_MS,
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

test('injects APPLY only for the explicitly connected matching page-video tab', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft', startMs: 1_000, endMs: 4_000 },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 17, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyPageVideoHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: PAGE,
    strength: 'soft',
    startMs: 1_000,
    endMs: 4_000,
  });

  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'strong' },
    fakeChrome(),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: YOUTUBE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ liveUrl: YOUTUBE, context: connectedContext({ url: YOUTUBE }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ context: connectedContext({ tabId: 99 }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ liveUrl: OTHER }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ tabError: true }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ scriptingError: true }),
  ), { status: 'unavailable' });
});

test('apply helper surfaces page results and maps missing players to unavailable', async () => {
  assert.deepEqual(
    pageVideoHoverApplyResultFromPage([{ result: { ok: false, reason: 'player-unavailable' } }]),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    pageVideoHoverApplyResultFromPage([{ result: { ok: false, reason: 'source-mismatch' } }]),
    { status: 'source-mismatch' },
  );
  assert.deepEqual(
    pageVideoHoverApplyResultFromPage([{ result: { ok: true } }]),
    { status: 'matched' },
  );
  assert.deepEqual(pageVideoHoverApplyResultFromPage([]), { status: 'unavailable' });
  assert.deepEqual(pageVideoHoverApplyResultFromPage([{ result: { ok: false } }]), { status: 'unavailable' });

  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    fakeChrome({ pageResult: { ok: false, reason: 'player-unavailable' } }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'strong' },
    fakeChrome({ pageResult: { ok: false, reason: 'source-mismatch' } }),
  ), { status: 'source-mismatch' });
});

test('session leave waits 120 ms before CLEAR and stays on the connected tab', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const timers = [];
  const chrome = fakeChrome();
  const session = createPageVideoHoverSession({
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
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, strength: 'soft' },
    chrome,
  );
  await drain();
  session.leave({ tabId: 17, tabUrl: PAGE }, chrome);
  assert.equal(timers[0]?.delay, 120);
  assert.equal(chrome.calls.length, 1);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 2);
  assert.equal(chrome.calls[1].func.name, 'clearPageVideoHoverHighlightOnPage');
  assert.deepEqual(chrome.calls[1].target, { tabId: 17, frameIds: [0] });
});

test('CLEAR fails closed when the stored tab is no longer the connected tab', async () => {
  assert.equal(await clearPageVideoHoverOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    fakeChrome({ context: connectedContext({ tabId: 4 }) }),
  ), false);
});

test('Open source on a connected page-video page focuses the tab and applies highlight', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await openPageVideoSourceOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE, startMs: 1_000, endMs: 4_000 },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyPageVideoHoverHighlightOnPage);
  assert.equal(chrome.calls[0].args[0].strength, 'strong');
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);

  assert.deepEqual(await openPageVideoSourceOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { canonicalUrl: PAGE, normalizedUrl: PAGE },
    fakeChrome(),
  ), { status: 'unavailable' });
});

test('Open source does not use the 120 ms hover leave window after apply', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const chrome = fakeChrome();
  assert.deepEqual(await openPageVideoSourceOnConnectedTab(
    { tabId: 17, tabUrl: PAGE },
    { canonicalUrl: PAGE, normalizedUrl: PAGE },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyPageVideoHoverHighlightOnPage);
});

test('Open source idle clear uses a long TTL separate from hover leave', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  assert.equal(PAGE_VIDEO_HOVER_OPEN_IDLE_MS, 12_000);
  assert.ok(PAGE_VIDEO_HOVER_OPEN_IDLE_MS !== PAGE_VIDEO_HOVER_LEAVE_MS);
  const timers = [];
  const chrome = fakeChrome();
  const session = createPageVideoHoverSession({
    idleMs: PAGE_VIDEO_HOVER_OPEN_IDLE_MS,
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
  session.scheduleIdle({ tabId: 17, tabUrl: PAGE }, chrome);
  assert.equal(timers[0]?.delay, 12_000);
  assert.equal(chrome.calls.length, 0);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func.name, 'clearPageVideoHoverHighlightOnPage');
});

test('Sprint 5 hover linking keeps one-shot scripting and no persistent content scripts', async () => {
  const [config, background, link, page, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./page-video-hover-link.ts', import.meta.url), 'utf8'),
    readFile(new URL('./page-video-hover-page.ts', import.meta.url), 'utf8'),
    readFile(new URL('./page-video-hover-pending.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(link, /frameIds: \[0\]/);
  assert.match(link, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.match(link, /normalizePageVideoHoverPageUrl/);
  assert.match(link, /PAGE_VIDEO_HOVER_OPEN_IDLE_MS = 12_000/);
  assert.doesNotMatch(link, /leavePageVideoHoverLink\(connection, chromeApi\);\s*return applied/);
  assert.doesNotMatch(link, /host_permissions|defineContentScript/);
  assert.match(page, /Serialized into the explicitly connected top-level tab/);
  assert.doesNotMatch(page, /chrome\.|host_permissions|defineContentScript/);
  assert.doesNotMatch(page, /foxnews|brightcove|jwplayer/i);
  assert.match(pending, /PAGE_VIDEO_HOVER_PENDING_KEY/);
  assert.match(background, /applyPendingPageVideoHoverOnTab/);
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
