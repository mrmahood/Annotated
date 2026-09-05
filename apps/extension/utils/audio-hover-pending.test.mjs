import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import { cancelAudioHoverLink } from './audio-hover-link.ts';
import { applyAudioHoverHighlightOnPage } from './audio-hover-page.ts';
import {
  AUDIO_HOVER_PENDING_KEY,
  AUDIO_HOVER_PENDING_TTL_MS,
  AUDIO_PENDING_CONNECT_HINT,
  applyPendingAudioHoverOnTab,
  applyPendingAudioHoverOnConnection,
  audioHoverPendingIsExpired,
  audioHoverPendingMatchesTarget,
  audioHoverPendingMatchesUrl,
  clearAudioHoverPending,
  findExistingAudioTab,
  isAudioHoverPendingTarget,
  openAudioSourceFromPanel,
  readAudioHoverPending,
  writeAudioHoverPending,
} from './audio-hover-pending.ts';

afterEach(() => {
  cancelAudioHoverLink();
});

const EPISODE = 'https://example.com/podcast/episode-42';
const EPISODE_TRACKED = 'https://Example.com/podcast/episode-42/?utm_source=feed&t=30s';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const NOW = 1_700_000_000_000;

function pendingTarget(overrides = {}) {
  return {
    normalizedUrl: EPISODE,
    canonicalUrl: EPISODE,
    startMs: 1_000,
    endMs: 4_000,
    strength: 'strong',
    setAt: NOW,
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
  const tabCreates = [];
  const tabUpdates = [];
  const windowUpdates = [];
  const store = {
    [ACTIVE_TAB_CONTEXT_KEY]: options.context === undefined ? connectedContext() : options.context,
    ...(options.pending === undefined ? {} : { [AUDIO_HOVER_PENDING_KEY]: options.pending }),
  };
  return {
    calls,
    tabCreates,
    tabUpdates,
    windowUpdates,
    store,
    scripting: {
      executeScript: async (injection) => {
        calls.push(injection);
        if (options.scriptingError) throw new Error('scripting failed');
        return [{ result: options.pageResult ?? { ok: true } }];
      },
    },
    storage: {
      session: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (items) => {
          Object.assign(store, items);
        },
        remove: async (key) => {
          delete store[key];
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
        return { id: tabId, active: true };
      },
      create: async (createProperties) => {
        tabCreates.push(createProperties);
        if (options.createError) throw new Error('tab create failed');
        return { id: 44, status: options.createdStatus, ...createProperties };
      },
      query: async () => options.existingTabs ?? [],
    },
    windows: {
      update: async (windowId, update) => {
        windowUpdates.push({ windowId, update });
        return { id: windowId, focused: true };
      },
    },
  };
}

test('pending target guard and URL match use the same audio normalization as hover', () => {
  assert.equal(isAudioHoverPendingTarget(pendingTarget()), true);
  assert.equal(isAudioHoverPendingTarget({ ...pendingTarget(), strength: 'soft' }), false);
  assert.equal(isAudioHoverPendingTarget({ ...pendingTarget(), setAt: Number.NaN }), false);
  assert.equal(isAudioHoverPendingTarget(null), false);
  assert.equal(isAudioHoverPendingTarget({ ...pendingTarget(), startMs: null, endMs: null }), true);

  assert.equal(audioHoverPendingMatchesUrl(pendingTarget(), EPISODE), true);
  assert.equal(audioHoverPendingMatchesUrl(pendingTarget(), EPISODE_TRACKED), true);
  assert.equal(audioHoverPendingMatchesUrl(pendingTarget({
    canonicalUrl: EPISODE_TRACKED,
    normalizedUrl: EPISODE,
  }), EPISODE), true);
  assert.equal(audioHoverPendingMatchesUrl(pendingTarget(), OTHER), false);
  assert.equal(audioHoverPendingMatchesUrl(pendingTarget(), YOUTUBE), false);
  assert.equal(audioHoverPendingMatchesUrl(pendingTarget(), 'not-a-url'), false);

  assert.equal(audioHoverPendingMatchesTarget(pendingTarget(), {
    canonicalUrl: EPISODE,
    normalizedUrl: EPISODE,
    startMs: 1_000,
    endMs: 4_000,
  }), true);
  assert.equal(audioHoverPendingMatchesTarget(pendingTarget(), {
    canonicalUrl: EPISODE,
    normalizedUrl: EPISODE,
    startMs: 2_000,
    endMs: 4_000,
  }), false);
});

test('pending set/clear/expiry drop stale or invalid session values', async () => {
  const chrome = fakeChrome({ pending: null, context: null });
  const written = await writeAudioHoverPending({
    canonicalUrl: EPISODE_TRACKED,
    normalizedUrl: EPISODE,
    startMs: 1_000,
    endMs: 4_000,
  }, chrome, NOW);
  assert.deepEqual(written, pendingTarget({ canonicalUrl: EPISODE_TRACKED }));
  assert.deepEqual(chrome.store[AUDIO_HOVER_PENDING_KEY], pendingTarget({ canonicalUrl: EPISODE_TRACKED }));
  assert.deepEqual(await readAudioHoverPending(chrome, NOW + 1_000), pendingTarget({ canonicalUrl: EPISODE_TRACKED }));

  assert.equal(audioHoverPendingIsExpired(pendingTarget(), NOW + AUDIO_HOVER_PENDING_TTL_MS), false);
  assert.equal(audioHoverPendingIsExpired(pendingTarget(), NOW + AUDIO_HOVER_PENDING_TTL_MS + 1), true);
  assert.equal(await readAudioHoverPending(chrome, NOW + AUDIO_HOVER_PENDING_TTL_MS + 1), null);
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);

  chrome.store[AUDIO_HOVER_PENDING_KEY] = { strength: 'strong' };
  assert.equal(await readAudioHoverPending(chrome, NOW), null);
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);

  await writeAudioHoverPending({
    canonicalUrl: EPISODE,
    normalizedUrl: EPISODE,
    startMs: 1_000,
    endMs: 4_000,
  }, chrome, NOW);
  await clearAudioHoverPending(chrome);
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);
});

test('action-tab apply injects highlight for a matching pending URL and clears on match', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingAudioHoverOnTab(
    { tabId: 9, tabUrl: EPISODE_TRACKED },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 9, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyAudioHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: EPISODE,
    strength: 'strong',
    startMs: 1_000,
    endMs: 4_000,
  });
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);
});

test('action-tab apply ignores missing, mismatched, expired, or failed pending', async () => {
  assert.deepEqual(await applyPendingAudioHoverOnTab(
    { tabId: 9, tabUrl: EPISODE },
    fakeChrome({ pending: null }),
    NOW,
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPendingAudioHoverOnTab(
    { tabId: 9, tabUrl: OTHER },
    fakeChrome({ pending: pendingTarget() }),
    NOW,
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPendingAudioHoverOnTab(
    { tabId: 9, tabUrl: EPISODE },
    fakeChrome({ pending: pendingTarget({ setAt: NOW - AUDIO_HOVER_PENDING_TTL_MS - 1 }) }),
    NOW,
  ), { status: 'unavailable' });
  assert.deepEqual(await applyPendingAudioHoverOnTab(
    { tabId: 9, tabUrl: EPISODE },
    fakeChrome({ pending: pendingTarget(), scriptingError: true }),
    NOW,
  ), { status: 'unavailable' });
});

test('connection apply uses the live hover path and clears pending on match', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingAudioHoverOnConnection(
    { tabId: 17, tabUrl: EPISODE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);

  assert.deepEqual(await applyPendingAudioHoverOnConnection(
    { tabId: 17, tabUrl: OTHER },
    fakeChrome({ pending: pendingTarget() }),
    NOW,
  ), { status: 'unavailable' });
});

test('Open source from the panel writes pending and applies on a connected matching tab', async () => {
  const chrome = fakeChrome();
  const outcome = await openAudioSourceFromPanel({
    target: { canonicalUrl: EPISODE, normalizedUrl: EPISODE, startMs: 1_000, endMs: 4_000 },
    connection: { tabId: 17, tabUrl: EPISODE },
    href: EPISODE,
    chromeApi: chrome,
    now: NOW,
  });
  assert.deepEqual(outcome, { applied: { status: 'matched' }, awaitingConnection: false });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.store[AUDIO_HOVER_PENDING_KEY], undefined);
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);
});

test('Open source focuses an existing matching tab or creates one and applies when complete', async () => {
  const existing = fakeChrome({
    context: null,
    existingTabs: [{ id: 22, url: EPISODE_TRACKED, status: 'complete', windowId: 1 }],
  });
  const existingOutcome = await openAudioSourceFromPanel({
    target: { canonicalUrl: EPISODE, normalizedUrl: EPISODE, startMs: 1_000, endMs: 4_000 },
    connection: null,
    href: EPISODE,
    chromeApi: existing,
    now: NOW,
  });
  assert.equal(existingOutcome.awaitingConnection, false);
  assert.deepEqual(existingOutcome.applied, { status: 'matched' });
  assert.equal(existing.calls[0].target.tabId, 22);
  assert.equal(existing.store[AUDIO_HOVER_PENDING_KEY], undefined);

  const created = fakeChrome({ context: null, createdStatus: 'loading' });
  const createdOutcome = await openAudioSourceFromPanel({
    target: { canonicalUrl: EPISODE, normalizedUrl: EPISODE, startMs: 1_000, endMs: 4_000 },
    connection: null,
    href: EPISODE,
    chromeApi: created,
    now: NOW,
  });
  assert.deepEqual(createdOutcome, { applied: null, awaitingConnection: true });
  assert.deepEqual(created.tabCreates, [{ url: EPISODE, active: true }]);
  assert.ok(created.store[AUDIO_HOVER_PENDING_KEY]);
});

test('findExistingAudioTab matches the pending episode URL among open tabs', () => {
  assert.deepEqual(findExistingAudioTab([
    { id: 8, url: OTHER },
    { id: 22, url: EPISODE_TRACKED, status: 'complete', windowId: 1 },
  ], pendingTarget()), {
    id: 22,
    url: EPISODE_TRACKED,
    status: 'complete',
    windowId: 1,
  });
  assert.equal(findExistingAudioTab([{ id: 8, url: OTHER }], pendingTarget()), null);
});

test('pending audio highlight wiring applies on tab complete and matching sidepanel connection', async () => {
  const [config, background, app, social, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./audio-hover-pending.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);

  assert.match(background, /applyPendingAudioHoverOnTab/);
  assert.match(background, /installSurfFollow/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);

  assert.match(app, /applyPendingAudioHoverOnConnection/);
  assert.match(app, /audioHoverConnectionForTab/);
  assert.match(app, /leaveAudioHoverLink/);
  assert.match(app, /clearAudioHoverOnConnectedTab\(previous\)/);
  assert.match(pending, /scheduleAudioHoverOpenIdleClear/);
  assert.doesNotMatch(pending, /leaveAudioHoverLink/);
  assert.doesNotMatch(app, /host_permissions|defineContentScript/);

  assert.match(social, /openAudioSourceFromPanel/);
  assert.match(social, /AUDIO_PENDING_CONNECT_HINT/);
  assert.match(social, /handleAudioSourceOpenClick/);
  assert.match(social, /audioHoverRegionHandlers/);
  assert.match(social, /audioHoverNestedChipHandlers/);
  assert.match(social, /audioClipHoverTarget/);

  assert.match(pending, /chrome\.storage\.session/);
  assert.match(pending, /AUDIO_HOVER_PENDING_TTL_MS = 12 \* 60 \* 1000/);
  assert.match(pending, /findExistingAudioTab/);
  assert.equal(AUDIO_PENDING_CONNECT_HINT, 'Player highlight applies when the episode finishes loading.');
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
