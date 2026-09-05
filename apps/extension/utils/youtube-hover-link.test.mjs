import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedYouTubeWatch,
  applyYouTubeHoverOnConnectedTab,
  clearYouTubeHoverOnConnectedTab,
  createYouTubeHoverLeaveController,
  createYouTubeHoverSession,
  YOUTUBE_HOVER_LEAVE_MS,
  youtubeWatchVideoIdFromUrl,
} from './youtube-hover-link.ts';
import { applyYouTubeHoverHighlightOnPage } from './youtube-hover-page.ts';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIDEO_ID = 'dQw4w9WgXcQ';
const OTHER = 'https://www.youtube.com/watch?v=9bZkp7q19f0';

function connectedContext(overrides = {}) {
  return {
    tabId: 17,
    windowId: 1,
    title: 'Video',
    url: WATCH,
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
        return { id: tabId, url: options.liveUrl ?? WATCH };
      },
    },
  };
}

test('matches only the annotation YouTube /watch video id and fails closed otherwise', () => {
  assert.equal(youtubeWatchVideoIdFromUrl(WATCH), VIDEO_ID);
  assert.equal(youtubeWatchVideoIdFromUrl(`${WATCH}&t=42s`), VIDEO_ID);
  assert.equal(youtubeWatchVideoIdFromUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), VIDEO_ID);
  assert.equal(youtubeWatchVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), null);
  assert.equal(youtubeWatchVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), null);
  assert.equal(youtubeWatchVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), null);
  assert.equal(youtubeWatchVideoIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeWatchVideoIdFromUrl('not-a-url'), null);
  assert.equal(youtubeWatchVideoIdFromUrl(null), null);

  assert.equal(annotationMatchesConnectedYouTubeWatch(VIDEO_ID, WATCH), true);
  assert.equal(annotationMatchesConnectedYouTubeWatch(VIDEO_ID, OTHER), false);
  assert.equal(annotationMatchesConnectedYouTubeWatch(VIDEO_ID, 'https://example.com/article'), false);
  assert.equal(annotationMatchesConnectedYouTubeWatch('9bZkp7q19f0', WATCH), false);
  assert.equal(annotationMatchesConnectedYouTubeWatch('bad', WATCH), false);
  assert.equal(annotationMatchesConnectedYouTubeWatch(VIDEO_ID, null), false);
  assert.equal(annotationMatchesConnectedYouTubeWatch(null, WATCH), false);
});

test('debounces leave by 120 ms and cancels clear when another region is entered', () => {
  const timers = [];
  let now = 0;
  const controller = createYouTubeHoverLeaveController({
    leaveMs: YOUTUBE_HOVER_LEAVE_MS,
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

test('injects APPLY only for the explicitly connected matching /watch tab', async () => {
  const chrome = fakeChrome();
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft', startMs: 1_000, endMs: 4_000 },
    chrome,
  ), true);
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 17, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyYouTubeHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedVideoId: VIDEO_ID,
    strength: 'soft',
    startMs: 1_000,
    endMs: 4_000,
    seekMs: null,
  });

  const withSeek = fakeChrome();
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft', startMs: 1_000, endMs: 4_000, seekMs: 1_000 },
    withSeek,
  ), true);
  assert.equal(withSeek.calls[0].args[0].seekMs, null);

  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { videoId: VIDEO_ID, strength: 'strong' },
    fakeChrome(),
  ), false);
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft' },
    fakeChrome({ context: connectedContext({ tabId: 99 }) }),
  ), false);
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft' },
    fakeChrome({ liveUrl: OTHER }),
  ), false);
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft' },
    fakeChrome({ tabError: true }),
  ), false);
  assert.equal(await applyYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft' },
    fakeChrome({ scriptingError: true }),
  ), false);
});

test('session leave waits 120 ms before CLEAR and stays on the connected tab', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const timers = [];
  const chrome = fakeChrome();
  const session = createYouTubeHoverSession({
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

  session.enter({ tabId: 17, tabUrl: WATCH }, { videoId: VIDEO_ID, strength: 'soft' }, chrome);
  await drain();
  session.leave({ tabId: 17, tabUrl: WATCH }, chrome);
  assert.equal(timers[0]?.delay, 120);
  assert.equal(chrome.calls.length, 1);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 2);
  assert.equal(chrome.calls[1].func.name, 'clearYouTubeHoverHighlightOnPage');
  assert.deepEqual(chrome.calls[1].target, { tabId: 17, frameIds: [0] });
});

test('CLEAR fails closed when the stored tab is no longer the connected tab', async () => {
  assert.equal(await clearYouTubeHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    fakeChrome({ context: connectedContext({ tabId: 4 }) }),
  ), false);
});

test('Sprint 2 hover linking keeps one-shot scripting and no persistent content scripts', async () => {
  const [config, background, link, page] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./youtube-hover-link.ts', import.meta.url), 'utf8'),
    readFile(new URL('./youtube-hover-page.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(link, /frameIds: \[0\]/);
  assert.match(link, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.match(link, /getYouTubeVideoIdentity/);
  assert.doesNotMatch(link, /host_permissions|defineContentScript/);
  assert.match(page, /Serialized into the explicitly connected top-level tab/);
  assert.doesNotMatch(page, /chrome\.|host_permissions|defineContentScript/);
});
