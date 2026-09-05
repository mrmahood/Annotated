import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY } from './active-tab-context.ts';
import { cancelArticleHoverLink } from './article-hover-link.ts';
import { applyArticleHoverHighlightOnPage } from './article-hover-page.ts';
import {
  ARTICLE_HOVER_LAST_APPLY_KEY,
  ARTICLE_HOVER_PENDING_KEY,
  ARTICLE_HOVER_PENDING_TTL_MS,
  ARTICLE_PENDING_CONNECT_HINT,
  applyPendingArticleHoverOnTab,
  applyPendingArticleHoverOnConnection,
  articleHoverPendingIsExpired,
  articleHoverPendingMatchesTarget,
  articleHoverPendingMatchesUrl,
  clearArticleHoverPending,
  findExistingArticleTab,
  isArticleHoverPendingTarget,
  openArticleSourceFromPanel,
  readArticleHoverPending,
  writeArticleHoverPending,
} from './article-hover-pending.ts';

afterEach(() => {
  cancelArticleHoverLink();
});

const ARTICLE = 'https://example.com/story';
const ARTICLE_TRACKED = 'https://Example.com/story/?utm_source=feed#:~:text=quote';
const OTHER = 'https://example.com/other';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SELECTED = 'The unique passage on this page.';
const HREF = ARTICLE;
const NOW = 1_700_000_000_000;

function pendingTarget(overrides = {}) {
  return {
    normalizedUrl: ARTICLE,
    selectedText: SELECTED,
    canonicalUrl: ARTICLE,
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
    url: ARTICLE,
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
    ...(options.pending === undefined ? {} : { [ARTICLE_HOVER_PENDING_KEY]: options.pending }),
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
        return { id: tabId, url: options.liveUrl ?? ARTICLE };
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

test('pending target guard and URL match use the same article normalization as hover', () => {
  assert.equal(isArticleHoverPendingTarget(pendingTarget()), true);
  assert.equal(isArticleHoverPendingTarget({ ...pendingTarget(), strength: 'soft' }), false);
  assert.equal(isArticleHoverPendingTarget({ ...pendingTarget(), selectedText: '   ' }), false);
  assert.equal(isArticleHoverPendingTarget({ ...pendingTarget(), setAt: Number.NaN }), false);
  assert.equal(isArticleHoverPendingTarget(null), false);

  assert.equal(articleHoverPendingMatchesUrl(pendingTarget(), ARTICLE), true);
  assert.equal(articleHoverPendingMatchesUrl(pendingTarget(), ARTICLE_TRACKED), true);
  assert.equal(articleHoverPendingMatchesUrl(pendingTarget({
    canonicalUrl: ARTICLE_TRACKED,
    normalizedUrl: ARTICLE,
  }), ARTICLE), true);
  assert.equal(articleHoverPendingMatchesUrl(pendingTarget(), OTHER), false);
  assert.equal(articleHoverPendingMatchesUrl(pendingTarget(), YOUTUBE), false);
  assert.equal(articleHoverPendingMatchesUrl(pendingTarget(), 'not-a-url'), false);

  assert.equal(articleHoverPendingMatchesTarget(pendingTarget(), {
    selectedText: SELECTED,
    canonicalUrl: ARTICLE,
    normalizedUrl: ARTICLE,
  }), true);
  assert.equal(articleHoverPendingMatchesTarget(pendingTarget(), {
    selectedText: 'A different passage.',
    canonicalUrl: ARTICLE,
    normalizedUrl: ARTICLE,
  }), false);
});

test('pending set/clear/expiry drop stale or invalid session values', async () => {
  const chrome = fakeChrome({ pending: null, context: null });
  const written = await writeArticleHoverPending({
    selectedText: `  ${SELECTED}  `,
    canonicalUrl: ARTICLE_TRACKED,
    normalizedUrl: ARTICLE,
  }, chrome, NOW);
  assert.deepEqual(written, pendingTarget({ canonicalUrl: ARTICLE_TRACKED }));
  assert.deepEqual(chrome.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget({ canonicalUrl: ARTICLE_TRACKED }));
  assert.deepEqual(await readArticleHoverPending(chrome, NOW + 1_000), pendingTarget({ canonicalUrl: ARTICLE_TRACKED }));

  assert.equal(articleHoverPendingIsExpired(pendingTarget(), NOW + ARTICLE_HOVER_PENDING_TTL_MS), false);
  assert.equal(articleHoverPendingIsExpired(pendingTarget(), NOW + ARTICLE_HOVER_PENDING_TTL_MS + 1), true);
  assert.equal(await readArticleHoverPending(chrome, NOW + ARTICLE_HOVER_PENDING_TTL_MS + 1), null);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);

  chrome.store[ARTICLE_HOVER_PENDING_KEY] = { strength: 'strong' };
  assert.equal(await readArticleHoverPending(chrome, NOW), null);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);

  await writeArticleHoverPending({
    selectedText: SELECTED,
    canonicalUrl: ARTICLE,
    normalizedUrl: ARTICLE,
  }, chrome, NOW);
  await clearArticleHoverPending(chrome);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);

  assert.equal(await writeArticleHoverPending({
    selectedText: '   ',
    canonicalUrl: ARTICLE,
    normalizedUrl: ARTICLE,
  }, chrome, NOW), null);
});

test('action-tab apply injects amber for a matching pending URL and clears on match', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: ARTICLE_TRACKED },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.deepEqual(chrome.calls[0].target, { tabId: 9, frameIds: [0] });
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.deepEqual(chrome.calls[0].args[0], {
    expectedNormalizedUrl: ARTICLE,
    selectedText: SELECTED,
    strength: 'strong',
  });
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);
});

test('action-tab apply ignores missing, mismatched, expired, or failed pending', async () => {
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: ARTICLE },
    fakeChrome({ pending: null }),
    NOW,
  ), { status: 'unavailable' });

  const mismatched = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: OTHER },
    mismatched,
    NOW,
  ), { status: 'unavailable' });
  assert.deepEqual(mismatched.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());

  const expired = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: ARTICLE },
    expired,
    NOW + ARTICLE_HOVER_PENDING_TTL_MS + 1,
  ), { status: 'unavailable' });
  assert.equal(expired.store[ARTICLE_HOVER_PENDING_KEY], undefined);

  const youtube = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: YOUTUBE },
    youtube,
    NOW,
  ), { status: 'unavailable' });

  const failed = fakeChrome({ pending: pendingTarget(), scriptingError: true });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: ARTICLE },
    failed,
    NOW,
  ), { status: 'unavailable' });
  assert.deepEqual(failed.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());
});

test('action-tab apply clears pending after an honest unmatched passage', async () => {
  const chrome = fakeChrome({
    pending: pendingTarget(),
    pageResult: { ok: false, reason: 'text-unmatched' },
  });
  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 9, tabUrl: ARTICLE },
    chrome,
    NOW,
  ), { status: 'unmatched' });
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);
  assert.equal(chrome.store[ARTICLE_HOVER_LAST_APPLY_KEY]?.status, 'unmatched');
  assert.equal(chrome.store[ARTICLE_HOVER_LAST_APPLY_KEY]?.selectedText, SELECTED);
});

test('pending apply does not clear amber in the 120 ms hover leave window', async () => {
  const drain = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnConnection(
    { tabId: 17, tabUrl: ARTICLE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await drain();
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
});

test('connection apply uses the connected-tab helper and clears on match', async () => {
  const chrome = fakeChrome({ pending: pendingTarget() });
  assert.deepEqual(await applyPendingArticleHoverOnConnection(
    { tabId: 17, tabUrl: ARTICLE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.equal(chrome.calls[0].args[0].strength, 'strong');
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);

  assert.deepEqual(await applyPendingArticleHoverOnConnection(
    { tabId: 17, tabUrl: OTHER },
    fakeChrome({ pending: pendingTarget() }),
    NOW,
  ), { status: 'unavailable' });
});

test('Open source always sets pending and applies amber when already connected', async () => {
  const chrome = fakeChrome({ pending: null });
  const opened = [];
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: { tabId: 17, tabUrl: ARTICLE },
    href: HREF,
    chromeApi: chrome,
    now: NOW,
    openFallback: (href) => opened.push(href),
  }), { applied: { status: 'matched' }, awaitingConnection: false });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 17, update: { active: true } }]);
  assert.deepEqual(chrome.tabCreates, []);
  assert.deepEqual(opened, []);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);
});

test('Open source keeps pending and creates a bare-canonical tab when not connected', async () => {
  const chrome = fakeChrome({ pending: null, context: null });
  const opened = [];
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: null,
    href: HREF,
    chromeApi: chrome,
    now: NOW,
    openFallback: (href) => opened.push(href),
  }), { applied: null, awaitingConnection: true });
  assert.deepEqual(chrome.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());
  assert.deepEqual(chrome.tabCreates, [{ url: HREF, active: true }]);
  assert.deepEqual(opened, []);
  assert.equal(chrome.calls.length, 0);

  const wrongTab = fakeChrome({ pending: null });
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: { tabId: 17, tabUrl: OTHER },
    href: HREF,
    chromeApi: wrongTab,
    now: NOW,
  }), { applied: null, awaitingConnection: true });
  assert.deepEqual(wrongTab.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());
  assert.deepEqual(wrongTab.tabCreates, [{ url: HREF, active: true }]);
});

test('Open source falls back to window.open when tabs.create is unavailable', async () => {
  const chrome = fakeChrome({ pending: null, context: null, createError: true });
  const opened = [];
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: null,
    href: HREF,
    chromeApi: chrome,
    now: NOW,
    openFallback: (href) => opened.push(href),
  }), { applied: null, awaitingConnection: true });
  assert.deepEqual(opened, [HREF]);
  assert.deepEqual(chrome.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());
});

test('Open source applies amber on tab complete without an action click', async () => {
  const chrome = fakeChrome({ pending: null, context: null });
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: null,
    href: HREF,
    chromeApi: chrome,
    now: NOW,
  }), { applied: null, awaitingConnection: true });
  assert.deepEqual(chrome.tabCreates, [{ url: HREF, active: true }]);
  assert.equal(chrome.calls.length, 0);
  assert.deepEqual(chrome.store[ARTICLE_HOVER_PENDING_KEY], pendingTarget());

  assert.deepEqual(await applyPendingArticleHoverOnTab(
    { tabId: 44, tabUrl: ARTICLE },
    chrome,
    NOW,
  ), { status: 'matched' });
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].func, applyArticleHoverHighlightOnPage);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);
});

test('Open source focuses an existing complete tab and applies amber immediately', async () => {
  const chrome = fakeChrome({
    pending: null,
    context: null,
    existingTabs: [{ id: 22, url: ARTICLE, status: 'complete', windowId: 3 }],
  });
  assert.deepEqual(await openArticleSourceFromPanel({
    target: { selectedText: SELECTED, canonicalUrl: ARTICLE, normalizedUrl: ARTICLE },
    connection: null,
    href: HREF,
    chromeApi: chrome,
    now: NOW,
  }), { applied: { status: 'matched' }, awaitingConnection: false });
  assert.deepEqual(chrome.tabCreates, []);
  assert.deepEqual(chrome.tabUpdates, [{ tabId: 22, update: { active: true } }]);
  assert.deepEqual(chrome.windowUpdates, [{ windowId: 3, update: { focused: true } }]);
  assert.equal(chrome.calls.length, 1);
  assert.equal(chrome.calls[0].target.tabId, 22);
  assert.equal(chrome.store[ARTICLE_HOVER_PENDING_KEY], undefined);
});

test('findExistingArticleTab matches the pending article URL among open tabs', () => {
  assert.deepEqual(findExistingArticleTab([
    { id: 8, url: OTHER },
    { id: 22, url: ARTICLE_TRACKED, status: 'complete', windowId: 1 },
  ], pendingTarget()), {
    id: 22,
    url: ARTICLE_TRACKED,
    status: 'complete',
    windowId: 1,
  });
  assert.equal(findExistingArticleTab([{ id: 8, url: OTHER }], pendingTarget()), null);
});

test('pending highlight wiring applies on tab complete and matching sidepanel connection', async () => {
  const [config, background, app, social, pending] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./article-hover-pending.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);

  assert.match(background, /applyPendingArticleHoverOnTab/);
  assert.match(background, /installSurfFollow/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /ACTIVE_TAB_CONTEXT_KEY/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);

  assert.match(app, /applyPendingArticleHoverOnConnection/);
  assert.match(app, /articleHoverConnectionForTab/);
  assert.match(app, /Podcast \/ web audio/);
  assert.match(app, /leaveArticleHoverLink/);
  assert.match(app, /window.addEventListener\('blur'/);
  assert.match(app, /clearArticleHoverOnConnectedTab\(previous\)/);
  assert.match(app, /audioAvailable: true/);
  assert.match(pending, /scheduleArticleHoverOpenIdleClear/);
  assert.doesNotMatch(pending, /leaveArticleHoverLink/);
  assert.doesNotMatch(app, /EXISTING_NON_AUDIO_SOURCE_MESSAGE/);
  assert.doesNotMatch(app, /host_permissions|defineContentScript/);

  assert.match(social, /openArticleSourceFromPanel/);
  assert.match(social, /ARTICLE_PENDING_CONNECT_HINT/);
  assert.match(social, /event\.preventDefault\(\)/);
  assert.match(social, /onAwaitingConnection/);

  assert.match(pending, /chrome\.storage\.session/);
  assert.match(pending, /ARTICLE_HOVER_PENDING_TTL_MS = 12 \* 60 \* 1000/);
  assert.match(pending, /findExistingArticleTab/);
  assert.match(pending, /ARTICLE_HOVER_LAST_APPLY_KEY/);
  assert.equal(ARTICLE_PENDING_CONNECT_HINT, 'Amber highlight applies when the article finishes loading.');
  assert.doesNotMatch(pending, /host_permissions|defineContentScript/);
});
