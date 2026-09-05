import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedTikTokWatch,
  applyTikTokHoverOnConnectedTab,
  createTikTokHoverLeaveController,
  TIKTOK_HOVER_LEAVE_MS,
  tiktokHoverConnectionForTab,
  tiktokWatchVideoIdFromUrl,
} from './tiktok-hover-link.ts';
import { applyTikTokHoverHighlightOnPage } from './tiktok-hover-page.ts';

const WATCH = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
const VIDEO_ID = '7550123456789012345';
const OTHER = 'https://www.tiktok.com/@cnn/video/7550999999999999999';

function connectedContext(overrides = {}) {
  return {
    tabId: 17, windowId: 1, title: 'TikTok', url: WATCH, capturedAt: 1, ...overrides,
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

test('matches only the annotation TikTok watch video id and fails closed otherwise', () => {
  assert.equal(tiktokWatchVideoIdFromUrl(WATCH), VIDEO_ID);
  assert.equal(tiktokWatchVideoIdFromUrl(`${WATCH}?is_from_webapp=1`), VIDEO_ID);
  assert.equal(tiktokWatchVideoIdFromUrl(`https://m.tiktok.com/@bbcnews/video/${VIDEO_ID}`), VIDEO_ID);
  assert.equal(tiktokWatchVideoIdFromUrl('https://www.tiktok.com/foryou'), null);
  assert.equal(tiktokWatchVideoIdFromUrl('https://vm.tiktok.com/ZMabcdefg/'), null);
  assert.equal(tiktokWatchVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(annotationMatchesConnectedTikTokWatch(VIDEO_ID, WATCH), true);
  assert.equal(annotationMatchesConnectedTikTokWatch(VIDEO_ID, OTHER), false);
  assert.equal(annotationMatchesConnectedTikTokWatch(VIDEO_ID, null), false);
});

test('connects only TikTok classification on a watch URL', () => {
  assert.deepEqual(tiktokHoverConnectionForTab('TikTok', 17, WATCH), { tabId: 17, tabUrl: WATCH });
  assert.equal(tiktokHoverConnectionForTab('YouTube', 17, WATCH), null);
  assert.equal(tiktokHoverConnectionForTab('Web page', 17, WATCH), null);
  assert.equal(tiktokHoverConnectionForTab('TikTok', 17, 'https://www.tiktok.com/foryou'), null);
});

test('debounces leave by 120 ms and cancels clear when another region is entered', () => {
  const timers = [];
  const controller = createTikTokHoverLeaveController({
    setTimeoutFn: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeoutFn: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  let applied = 0;
  let cleared = 0;
  controller.enter(() => { applied += 1; });
  controller.leave(() => { cleared += 1; });
  assert.equal(timers[0].ms, TIKTOK_HOVER_LEAVE_MS);
  controller.enter(() => { applied += 1; });
  assert.equal(timers.length, 0);
  assert.equal(applied, 2);
  assert.equal(cleared, 0);
});

test('applies hover only when the connected tab still matches the video', async () => {
  const chrome = fakeChrome();
  assert.equal(await applyTikTokHoverOnConnectedTab(
    { tabId: 17, tabUrl: WATCH },
    { videoId: VIDEO_ID, strength: 'soft', startMs: 1_000, endMs: 8_000 },
    chrome,
  ), true);
  assert.equal(chrome.calls[0].func, applyTikTokHoverHighlightOnPage);
  assert.equal(chrome.calls[0].args[0].expectedVideoId, VIDEO_ID);
  assert.equal(await applyTikTokHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { videoId: VIDEO_ID, strength: 'soft' },
    chrome,
  ), false);
});

test('page highlight is self-contained and never seeks or plays', async () => {
  const source = await readFile(new URL('./tiktok-hover-page.ts', import.meta.url), 'utf8');
  assert.match(source, /scrollIntoView/);
  assert.doesNotMatch(source, /\.play\s*\(/);
  assert.doesNotMatch(source, /currentTime\s*=/);
  assert.doesNotMatch(applyTikTokHoverHighlightOnPage.toString(), /getTikTokVideoIdentity|chrome\.|import /);
});
