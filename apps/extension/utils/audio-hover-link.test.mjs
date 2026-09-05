import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import {
  annotationMatchesConnectedAudio,
  applyAudioHoverOnConnectedTab,
  audioHoverApplyResultFromPage,
  audioHoverConnectionForTab,
  AUDIO_HOVER_LEAVE_MS,
  AUDIO_HOVER_OPEN_IDLE_MS,
  cancelAudioHoverLink,
  clearAudioHoverOnConnectedTab,
  createAudioHoverLeaveController,
  createAudioHoverSession,
  openAudioSourceOnConnectedTab,
} from './audio-hover-link.ts';
import { applyAudioHoverHighlightOnPage } from './audio-hover-page.ts';

afterEach(() => {
  cancelAudioHoverLink();
});

const EPISODE = 'https://example.com/podcast/episode-42';
const EPISODE_TRACKED = 'https://Example.com/podcast/episode-42/?utm_source=feed&t=30s';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const ARTICLE = 'https://example.com/story';

function audioAnnotation(overrides = {}) {
  return {
    kind: 'audio',
    startMs: 1_000,
    endMs: 4_000,
    source: {
      type: 'podcast',
      canonicalUrl: EPISODE,
      normalizedUrl: EPISODE,
    },
    ...overrides,
  };
}

function connectedContext(overrides = {}) {
  return {
    tabId: 17,
    windowId: 1,
    title: 'Episode',
    url: EPISODE,
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
        return { id: tabId, url: options.liveUrl ?? EPISODE };
      },
      update: async (tabId, update) => {
        tabUpdates.push({ tabId, update });
        if (options.updateError) throw new Error('tab update failed');
        return { id: tabId, active: true };
      },
    },
  };
}

test('audio hover connects Web page and Podcast sources but not YouTube', () => {
  assert.deepEqual(audioHoverConnectionForTab('Web page', 17, EPISODE), {
    tabId: 17,
    tabUrl: EPISODE,
  });
  assert.deepEqual(audioHoverConnectionForTab('Podcast / web audio', 17, EPISODE), {
    tabId: 17,
    tabUrl: EPISODE,
  });
  assert.equal(audioHoverConnectionForTab('YouTube', 17, YOUTUBE), null);
  assert.equal(audioHoverConnectionForTab('Web page', 17, 'chrome://extensions'), null);
  assert.equal(audioHoverConnectionForTab('Web page', -1, EPISODE), null);
});

test('matches only the annotation podcast URL and source_type and fails closed otherwise', () => {
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), EPISODE), true);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), EPISODE_TRACKED), true);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation({
    source: { type: 'podcast', canonicalUrl: EPISODE_TRACKED, normalizedUrl: EPISODE },
  }), EPISODE), true);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), OTHER), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), YOUTUBE), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), ARTICLE), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation({ kind: 'article' }), EPISODE), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation({ kind: 'youtube' }), EPISODE), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation({
    source: { type: 'article', canonicalUrl: EPISODE, normalizedUrl: EPISODE },
  }), EPISODE), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), 'not-a-url'), false);
  assert.equal(annotationMatchesConnectedAudio(audioAnnotation(), null), false);
  assert.equal(annotationMatchesConnectedAudio(null, EPISODE), false);
});

test('debounces leave by 120 ms and cancels clear when another region is entered', () => {
  const timers = [];
  let now = 0;
  const controller = createAudioHoverLeaveController({
    leaveMs: AUDIO_HOVER_LEAVE_MS,
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

test('injects APPLY only for the explicitly connected matching audio tab', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft', startMs: 1_000, endMs: 4_000 },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 17, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyAudioHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: EPISODE,
    strength: 'soft',
    startMs: 1_000,
    endMs: 4_000,
  });

  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'strong' },
    fakeChrome(),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: YOUTUBE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ liveUrl: YOUTUBE, context: connectedContext({ url: YOUTUBE }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ context: connectedContext({ tabId: 99 }) }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ liveUrl: OTHER }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ tabError: true }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ scriptingError: true }),
  ), { status: 'unavailable' });
});

test('apply helper surfaces page results and maps missing players to unavailable', async () => {
  assert.deepEqual(
    audioHoverApplyResultFromPage([{ result: { ok: false, reason: 'player-unavailable' } }]),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    audioHoverApplyResultFromPage([{ result: { ok: false, reason: 'source-mismatch' } }]),
    { status: 'source-mismatch' },
  );
  assert.deepEqual(
    audioHoverApplyResultFromPage([{ result: { ok: true } }]),
    { status: 'matched' },
  );
  assert.deepEqual(audioHoverApplyResultFromPage([]), { status: 'unavailable' });
  assert.deepEqual(audioHoverApplyResultFromPage([{ result: { ok: false } }]), { status: 'unavailable' });

  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    fakeChrome({ pageResult: { ok: false, reason: 'player-unavailable' } }),
  ), { status: 'unavailable' });
  assert.deepEqual(await applyAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'strong' },
    fakeChrome({ pageResult: { ok: false, reason: 'source-mismatch' } }),
  ), { status: 'source-mismatch' });
});

test('session leave waits 120 ms before CLEAR and stays on the connected tab', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const timers = [];
  const chrome = fakeChrome();
  const session = createAudioHoverSession({
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
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, strength: 'soft' },
    chrome,
  );
  await drain();
  session.leave({ tabId: 17, tabUrl: EPISODE }, chrome);
  assert.equal(timers[0]?.delay, 120);
  assert.equal(chrome.calls.length, 1);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 2);
  assert.equal(chrome.calls[1].func.name, 'clearAudioHoverHighlightOnPage');
  assert.deepEqual(chrome.calls[1].target, { tabId: 17, frameIds: [0] });
});

test('CLEAR fails closed when the stored tab is no longer the connected tab', async () => {
  assert.equal(await clearAudioHoverOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    fakeChrome({ context: connectedContext({ tabId: 4 }) }),
  ), false);
});

test('Open source on a connected audio page focuses the tab and applies highlight', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await openAudioSourceOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE, startMs: 1_000, endMs: 4_000 },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyAudioHoverHighlightOnPage);
  assert.equal(chrome.calls[0].args[0].strength, 'strong');
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);

  assert.deepEqual(await openAudioSourceOnConnectedTab(
    { tabId: 17, tabUrl: OTHER },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE },
    fakeChrome(),
  ), { status: 'unavailable' });
});

test('Open source does not use the 120 ms hover leave window after apply', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const chrome = fakeChrome();
  assert.deepEqual(await openAudioSourceOnConnectedTab(
    { tabId: 17, tabUrl: EPISODE },
    { canonicalUrl: EPISODE, normalizedUrl: EPISODE },
    chrome,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyAudioHoverHighlightOnPage);
});

test('Open source idle clear uses a long TTL separate from hover leave', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  assert.equal(AUDIO_HOVER_OPEN_IDLE_MS, 12_000);
  assert.ok(AUDIO_HOVER_OPEN_IDLE_MS !== AUDIO_HOVER_LEAVE_MS);
  const timers = [];
  const chrome = fakeChrome();
  const session = createAudioHoverSession({
    idleMs: AUDIO_HOVER_OPEN_IDLE_MS,
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
  session.scheduleIdle({ tabId: 17, tabUrl: EPISODE }, chrome);
  assert.equal(timers[0]?.delay, 12_000);
  assert.equal(chrome.calls.length, 0);
  timers[0].fn();
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func.name, 'clearAudioHoverHighlightOnPage');
});

test('Sprint 4 hover linking keeps one-shot scripting and no persistent content scripts', async () => {
  const [config, background, link, page, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./audio-hover-link.ts', import.meta.url), 'utf8'),
    readFile(new URL('./audio-hover-page.ts', import.meta.url), 'utf8'),
    readFile(new URL('./audio-hover-pending.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(link, /frameIds: \[0\]/);
  assert.match(link, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.match(link, /normalizeAudioSourceUrl/);
  assert.match(link, /AUDIO_HOVER_OPEN_IDLE_MS = 12_000/);
  assert.doesNotMatch(link, /leaveAudioHoverLink\(connection, chromeApi\);\s*return applied/);
  assert.doesNotMatch(link, /host_permissions|defineContentScript/);
  assert.match(page, /Serialized into the explicitly connected top-level tab/);
  assert.doesNotMatch(page, /chrome\.|host_permissions|defineContentScript/);
  assert.match(pending, /AUDIO_HOVER_PENDING_KEY/);
  assert.match(background, /applyPendingAudioHoverOnTab/);
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
