import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ACTIVE_TAB_CONTEXT_KEY, ACTIVE_TAB_CONTEXT_MESSAGE } from './active-tab-context.ts';
import { ACTIVE_CAPTURE_KEY } from './media-capture-background.ts';
import {
  activeCaptureHoldsContext,
  followBrowsingTab,
  installSurfFollow,
  shouldFollowTabChange,
  tabIsActiveInFollowedWindow,
  tabIsReadyForPendingApply,
} from './surf-follow.ts';

const ARTICLE = 'https://example.com/story';
const OTHER = 'https://example.com/other';
const NOW = 1_700_000_000_000;

function tab(overrides = {}) {
  return {
    id: 17,
    windowId: 1,
    title: 'Story',
    url: ARTICLE,
    active: true,
    status: 'complete',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    tabId: 17,
    windowId: 1,
    title: 'Story',
    url: ARTICLE,
    capturedAt: NOW,
    ...overrides,
  };
}

function fakeChrome(options = {}) {
  const store = {
    ...(options.context === undefined ? {} : { [ACTIVE_TAB_CONTEXT_KEY]: options.context }),
    ...(options.capture === undefined ? {} : { [ACTIVE_CAPTURE_KEY]: options.capture }),
  };
  const messages = [];
  const listeners = {
    activated: [],
    updated: [],
    focus: [],
  };
  return {
    store,
    messages,
    listeners,
    storage: {
      session: {
        get: async (key) => {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((item) => [item, store[item]]));
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        return undefined;
      },
    },
    tabs: {
      get: async (tabId) => {
        const found = (options.tabs ?? [tab()]).find((item) => item.id === tabId);
        if (!found) throw new Error('tab missing');
        return found;
      },
      query: async (queryInfo = {}) => {
        return (options.tabs ?? [tab()]).filter((item) => {
          if (queryInfo.active === true && item.active !== true) return false;
          if (typeof queryInfo.windowId === 'number' && item.windowId !== queryInfo.windowId) return false;
          return true;
        });
      },
      onActivated: {
        addListener: (listener) => listeners.activated.push(listener),
      },
      onUpdated: {
        addListener: (listener) => listeners.updated.push(listener),
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: {
        addListener: (listener) => listeners.focus.push(listener),
      },
    },
  };
}

test('surf-follow helpers keep context updates on activate/complete and skip idle loading noise', () => {
  assert.equal(shouldFollowTabChange({ status: 'complete' }), true);
  assert.equal(shouldFollowTabChange({ url: OTHER }), true);
  assert.equal(shouldFollowTabChange({ status: 'loading' }), false);
  assert.equal(shouldFollowTabChange({}), false);

  assert.equal(tabIsActiveInFollowedWindow({ active: true, windowId: 1 }, null), true);
  assert.equal(tabIsActiveInFollowedWindow({ active: true, windowId: 1 }, 1), true);
  assert.equal(tabIsActiveInFollowedWindow({ active: true, windowId: 2 }, 1), false);
  assert.equal(tabIsActiveInFollowedWindow({ active: false, windowId: 1 }, 1), false);

  assert.equal(tabIsReadyForPendingApply({ status: 'complete' }, { id: 17, url: ARTICLE, status: 'complete' }), true);
  assert.equal(tabIsReadyForPendingApply({}, { id: 17, url: ARTICLE, status: 'complete' }), true);
  assert.equal(tabIsReadyForPendingApply({ status: 'loading' }, { id: 17, url: ARTICLE, status: 'loading' }), false);
  assert.equal(tabIsReadyForPendingApply({ status: 'complete' }, { id: 17, url: '', status: 'complete' }), false);
  assert.equal(tabIsReadyForPendingApply({ status: 'complete' }, { url: ARTICLE, status: 'complete' }), false);

  assert.equal(activeCaptureHoldsContext({ request: { tabId: 9 } }, 17), true);
  assert.equal(activeCaptureHoldsContext({ request: { tabId: 17 } }, 17), false);
  assert.equal(activeCaptureHoldsContext(null, 17), false);
});

test('followBrowsingTab writes the same context shape as action click and notifies the panel', async () => {
  const chrome = fakeChrome();
  assert.equal(await followBrowsingTab(chrome, tab(), NOW), 'updated');
  assert.deepEqual(chrome.store[ACTIVE_TAB_CONTEXT_KEY], context());
  assert.deepEqual(chrome.messages, [{
    type: ACTIVE_TAB_CONTEXT_MESSAGE,
    context: context(),
  }]);

  assert.equal(await followBrowsingTab(chrome, tab(), NOW + 10), 'unchanged');
  assert.equal(chrome.messages.length, 1);

  assert.equal(await followBrowsingTab(chrome, tab({ title: 'Updated story' }), NOW + 20), 'updated');
  assert.equal(chrome.store[ACTIVE_TAB_CONTEXT_KEY].title, 'Updated story');
});

test('followBrowsingTab holds context when a capture is active on another tab', async () => {
  const chrome = fakeChrome({
    context: context(),
    capture: { captureId: 'cap-1', request: { tabId: 17 } },
  });
  assert.equal(await followBrowsingTab(chrome, tab({ id: 44, url: OTHER, title: 'Other' }), NOW), 'held');
  assert.deepEqual(chrome.store[ACTIVE_TAB_CONTEXT_KEY], context());
  assert.deepEqual(chrome.messages, []);
});

test('installSurfFollow updates context and applies pending on activate/complete without an action click', async () => {
  const chrome = fakeChrome({
    tabs: [tab(), tab({ id: 44, windowId: 1, title: 'Other', url: OTHER, active: true })],
  });
  const pendingApplies = [];
  installSurfFollow(chrome, {
    applyPending: async (target) => {
      pendingApplies.push(target);
    },
  });

  chrome.listeners.activated[0]({ tabId: 44, windowId: 1 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(chrome.store[ACTIVE_TAB_CONTEXT_KEY].tabId, 44);
  assert.equal(chrome.store[ACTIVE_TAB_CONTEXT_KEY].url, OTHER);
  assert.deepEqual(pendingApplies, [{ tabId: 44, tabUrl: OTHER }]);

  chrome.listeners.updated[0](44, { status: 'complete', url: OTHER }, tab({
    id: 44,
    title: 'Other',
    url: OTHER,
    active: true,
  }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(pendingApplies[1], { tabId: 44, tabUrl: OTHER });
});

test('surf-follow wiring uses tabs listeners and does not add persistent content scripts', async () => {
  const [config, background, follow] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('./surf-follow.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);

  assert.match(background, /installSurfFollow/);
  assert.match(background, /chrome\.tabs\.onActivated|installSurfFollow/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /applyPendingArticleHoverOnTab/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);

  assert.match(follow, /tabs\.onActivated/);
  assert.match(follow, /tabs\.onUpdated/);
  assert.match(follow, /ACTIVE_TAB_CONTEXT_MESSAGE/);
  assert.match(follow, /applyPendingArticleHoverOnTab/);
  assert.doesNotMatch(follow, /defineContentScript|content_scripts/);
});
