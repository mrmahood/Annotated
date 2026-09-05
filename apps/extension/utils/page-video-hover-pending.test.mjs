import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import { cancelPageVideoHoverLink } from './page-video-hover-link.ts';
import { applyPageVideoHoverHighlightOnPage } from './page-video-hover-page.ts';
import {
  PAGE_VIDEO_HOVER_PENDING_KEY,
  PAGE_VIDEO_HOVER_PENDING_TTL_MS,
  PAGE_VIDEO_PENDING_CONNECT_HINT,
  applyPendingPageVideoHoverOnTab,
  applyPendingPageVideoHoverOnConnection,
  pageVideoHoverPendingIsExpired,
  pageVideoHoverPendingMatchesTarget,
  pageVideoHoverPendingMatchesUrl,
  clearPageVideoHoverPending,
  findExistingPageVideoTab,
  isPageVideoHoverPendingTarget,
  openPageVideoSourceFromPanel,
  readPageVideoHoverPending,
  writePageVideoHoverPending,
} from './page-video-hover-pending.ts';

afterEach(() => {
  cancelPageVideoHoverLink();
});

const PAGE = 'https://www.foxnews.com/politics/example-story';
const PAGE_TRACKED = 'https://www.foxnews.com/politics/example-story/?utm_source=feed&t=30s';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const NOW = 1_700_000_000_000;

function pendingTarget(overrides = {}) {
  return {
    normalizedUrl: PAGE,
    canonicalUrl: PAGE,
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
    title: 'Story',
    url: PAGE,
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
    ...(options.pending === undefined ? {} : { [PAGE_VIDEO_HOVER_PENDING_KEY]: options.pending }),
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
        return { id: tabId, url: options.liveUrl ?? PAGE };
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

test('pending target guard and URL match use the same page-video normalization as hover', () => {
  assert.equal(isPageVideoHoverPendingTarget(pendingTarget()), true);
  assert.equal(isPageVideoHoverPendingTarget({ ...pendingTarget(), strength: 'soft' }), false);
  assert.equal(isPageVideoHoverPendingTarget({ ...pendingTarget(), setAt: Number.NaN }), false);
  assert.equal(isPageVideoHoverPendingTarget(null), false);
  assert.equal(isPageVideoHoverPendingTarget({ ...pendingTarget(), startMs: null, endMs: null }), true);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget(), PAGE), true);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget(), PAGE_TRACKED), true);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget({
    canonicalUrl: PAGE_TRACKED,
  }), PAGE), true);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget(), OTHER), false);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget(), YOUTUBE), false);
  assert.equal(pageVideoHoverPendingMatchesUrl(pendingTarget(), 'not-a-url'), false);
  assert.equal(pageVideoHoverPendingMatchesTarget(pendingTarget(), {
    canonicalUrl: PAGE,
    normalizedUrl: PAGE,
    startMs: 1_000,
    endMs: 4_000,
  }), true);
  assert.equal(pageVideoHoverPendingMatchesTarget(pendingTarget(), {
    canonicalUrl: PAGE,
    normalizedUrl: PAGE,
    startMs: 2_000,
    endMs: 4_000,
  }), false);
});

test('pending page-video targets expire after the long idle TTL', () => {
  assert.equal(pageVideoHoverPendingIsExpired(pendingTarget(), NOW + PAGE_VIDEO_HOVER_PENDING_TTL_MS), false);
  assert.equal(pageVideoHoverPendingIsExpired(pendingTarget(), NOW + PAGE_VIDEO_HOVER_PENDING_TTL_MS + 1), true);
});

test('write and read pending page-video targets, dropping expired or invalid rows', async () => {
  const chrome = fakeChrome({ pending: null });
  const written = await writePageVideoHoverPending({
    canonicalUrl: PAGE,
    normalizedUrl: PAGE_TRACKED,
    startMs: 1_000,
    endMs: 4_000,
  }, chrome, NOW);
  assert.deepEqual(written, pendingTarget({
    normalizedUrl: PAGE,
    canonicalUrl: PAGE,
  }));
  assert.deepEqual(await readPageVideoHoverPending(chrome, NOW), written);

  const stale = fakeChrome({ pending: pendingTarget({ setAt: NOW - PAGE_VIDEO_HOVER_PENDING_TTL_MS - 1 }) });
  assert.equal(await readPageVideoHoverPending(stale, NOW), null);
  assert.equal(stale.store[PAGE_VIDEO_HOVER_PENDING_KEY], undefined);

  const invalid = fakeChrome({ pending: { ...pendingTarget(), strength: 'soft' } });
  assert.equal(await readPageVideoHoverPending(invalid, NOW), null);
  await clearPageVideoHoverPending(chrome);
  assert.equal(chrome.store[PAGE_VIDEO_HOVER_PENDING_KEY], undefined);
});

test('applyPendingPageVideoHoverOnTab injects only for a matching complete tab', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingPageVideoHoverOnTab(
    { tabId: 17, tabUrl: PAGE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyPageVideoHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: PAGE,
    strength: 'strong',
    startMs: 1_000,
    endMs: 4_000,
  });
  assert.equal(chrome.store[PAGE_VIDEO_HOVER_PENDING_KEY], undefined);

  assert.deepEqual(await applyPendingPageVideoHoverOnTab(
    { tabId: 17, tabUrl: OTHER },
    fakeChrome({ pending: pendingTarget() }),
    NOW,
  ), { status: 'unavailable' });
});

test('applyPendingPageVideoHoverOnConnection uses the connected tab identity', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingPageVideoHoverOnConnection(
    { tabId: 17, tabUrl: PAGE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.store[PAGE_VIDEO_HOVER_PENDING_KEY], undefined);
});

test('Open source writes pending and applies on an already-connected matching tab', async () => {
  const chrome = fakeChrome();
  const outcome = await openPageVideoSourceFromPanel({
    target: { canonicalUrl: PAGE, normalizedUrl: PAGE, startMs: 1_000, endMs: 4_000 },
    connection: { tabId: 17, tabUrl: PAGE },
    href: PAGE,
    chromeApi: chrome,
    now: NOW,
  });
  assert.deepEqual(outcome, { applied: { status: 'matched' }, awaitingConnection: false });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyPageVideoHoverHighlightOnPage);
  assert.equal(chrome.store[PAGE_VIDEO_HOVER_PENDING_KEY], undefined);
});

test('Open source focuses an existing matching tab or creates one and keeps pending', async () => {
  const existing = fakeChrome({
    existingTabs: [{ id: 22, url: PAGE_TRACKED, status: 'loading', windowId: 3 }],
  });
  const existingOutcome = await openPageVideoSourceFromPanel({
    target: { canonicalUrl: PAGE, normalizedUrl: PAGE, startMs: 1_000, endMs: 4_000 },
    connection: null,
    href: PAGE,
    chromeApi: existing,
    now: NOW,
  });
  assert.deepEqual(existingOutcome, { applied: null, awaitingConnection: true });
  assert.deepEqual(existing.tabUpdates, [{ tabId: 22, update: { active: true } }]);
  assert.deepEqual(existing.windowUpdates, [{ windowId: 3, update: { focused: true } }]);
  assert.ok(existing.store[PAGE_VIDEO_HOVER_PENDING_KEY]);

  const created = fakeChrome({ createdStatus: 'loading' });
  const createdOutcome = await openPageVideoSourceFromPanel({
    target: { canonicalUrl: PAGE, normalizedUrl: PAGE, startMs: 1_000, endMs: 4_000 },
    connection: null,
    href: PAGE,
    chromeApi: created,
    now: NOW,
  });
  assert.deepEqual(createdOutcome, { applied: null, awaitingConnection: true });
  assert.deepEqual(created.tabCreates, [{ url: PAGE, active: true }]);
  assert.ok(created.store[PAGE_VIDEO_HOVER_PENDING_KEY]);
});

test('findExistingPageVideoTab matches the pending page URL among open tabs', () => {
  assert.deepEqual(findExistingPageVideoTab([
    { id: 8, url: OTHER },
    { id: 22, url: PAGE_TRACKED, status: 'complete', windowId: 1 },
  ], pendingTarget()), {
    id: 22,
    url: PAGE_TRACKED,
    status: 'complete',
    windowId: 1,
  });
  assert.equal(findExistingPageVideoTab([{ id: 8, url: OTHER }], pendingTarget()), null);
});

test('pending page-video highlight wiring applies on tab complete and matching sidepanel connection', async () => {
  const [config, background, app, social, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./page-video-hover-pending.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);

  assert.match(background, /applyPendingPageVideoHoverOnTab/);
  assert.match(background, /installSurfFollow/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);

  assert.match(app, /applyPendingPageVideoHoverOnConnection/);
  assert.match(app, /pageVideoHoverConnectionForTab/);
  assert.match(app, /leavePageVideoHoverLink/);
  assert.match(app, /clearPageVideoHoverOnConnectedTab\(previous\)/);
  assert.match(pending, /schedulePageVideoHoverOpenIdleClear/);
  assert.doesNotMatch(pending, /leavePageVideoHoverLink/);
  assert.doesNotMatch(app, /host_permissions|defineContentScript/);

  assert.match(social, /openPageVideoSourceFromPanel/);
  assert.match(social, /PAGE_VIDEO_PENDING_CONNECT_HINT/);
  assert.match(social, /handlePageVideoSourceOpenClick/);
  assert.match(social, /pageVideoHoverRegionHandlers/);
  assert.match(social, /pageVideoHoverNestedChipHandlers/);
  assert.match(social, /pageVideoClipHoverTarget/);

  assert.match(pending, /chrome\.storage\.session/);
  assert.match(pending, /PAGE_VIDEO_HOVER_PENDING_TTL_MS = 12 \* 60 \* 1000/);
  assert.match(pending, /findExistingPageVideoTab/);
  assert.equal(PAGE_VIDEO_PENDING_CONNECT_HINT, 'Player highlight applies when the video finishes loading.');
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
