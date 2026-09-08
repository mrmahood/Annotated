import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyTikTokHoverHighlightOnPage,
  clearTikTokHoverHighlightOnPage,
  tiktokWatchVideoIdFromHref,
  TIKTOK_HOVER_ROOT_ID,
} from './tiktok-hover-page.ts';

const WATCH = 'https://www.tiktok.com/@abcnews/video/7682104834304036110';
const VIDEO_ID = '7682104834304036110';
const PLAYER_RECT = { left: 196, top: 40, right: 556, bottom: 680, width: 360, height: 640 };
const SHELL_RECT = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
const COLUMN_RECT = { left: 0, top: 0, right: 720, bottom: 720, width: 720, height: 720 };
const NAV_RECT = { left: 0, top: 0, right: 72, bottom: 720, width: 72, height: 720 };

function parseBox(cssText) {
  const numberAt = (property) => {
    const match = cssText.match(new RegExp(`${property}:(-?\\d+(?:\\.\\d+)?)px`));
    return match ? Number(match[1]) : null;
  };
  return {
    top: numberAt('top'),
    left: numberAt('left'),
    width: numberAt('width'),
    height: numberAt('height'),
  };
}

function withPage(callback, overrides = {}) {
  const names = ['location', 'document', 'window', 'HTMLElement', 'HTMLVideoElement', 'getComputedStyle'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const listeners = { scroll: [], resize: [] };
  const nodes = new Map();

  class ElementStub {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.children = [];
      this.parentElement = null;
      this.attributes = {};
      this.dataset = {};
      this.hidden = false;
      this.style = { cssText: '' };
      this.className = '';
      this.scrolls = [];
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') {
        this.id = String(value);
        nodes.set(String(value), this);
      }
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.dataset[key] = String(value);
      }
    }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      if (child.id) nodes.set(child.id, child);
      return child;
    }
    remove() {
      if (this.id) nodes.delete(this.id);
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
      }
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        if (matchesSelector(node, selector)) matches.push(node);
        for (const child of node.children) visit(child);
      };
      for (const child of this.children) visit(child);
      return matches;
    }
    closest(selector) {
      let node = this;
      while (node) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    }
    getBoundingClientRect() {
      return this.rect ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    getClientRects() { return this.hiddenRects ? [] : [{}]; }
    scrollIntoView(options) { this.scrolls.push(options); }
  }

  class VideoStub extends ElementStub {
    constructor() {
      super('video');
      this.currentTime = 4;
      this.duration = 15;
      this.paused = false;
    }
  }

  function matchesSelector(node, selector) {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => {
      if (part === 'video') return node.tagName === 'VIDEO';
      if (part.startsWith('#') && !part.includes('[')) return node.id === part.slice(1);
      if (part.startsWith('.') && !part.includes('[')) {
        return node.className.split(/\s+/).includes(part.slice(1));
      }
      if (part.includes('[class*="')) {
        const value = part.slice(part.indexOf('[class*="') + 9, part.lastIndexOf('"'));
        return node.className.includes(value);
      }
      if (part.includes('[role="')) {
        const value = part.slice(part.indexOf('[role="') + 7, part.lastIndexOf('"'));
        return node.attributes.role === value;
      }
      if (part.includes('[data-e2e="')) {
        const value = part.slice(part.indexOf('[data-e2e="') + 11, part.lastIndexOf('"'));
        return node.attributes['data-e2e'] === value;
      }
      if (part.includes('[')) {
        const name = part.slice(part.indexOf('[') + 1, part.indexOf('='));
        const value = part.slice(part.indexOf('"') + 1, part.lastIndexOf('"'));
        return node.attributes[name] === value;
      }
      return node.tagName === part.toUpperCase();
    });
  }

  const documentElement = new ElementStub('html');
  const nav = new ElementStub('div');
  nav.setAttribute('data-e2e', 'nav-side');
  nav.rect = NAV_RECT;
  const shell = new ElementStub('div', 'main-content-video_detail');
  shell.rect = overrides.shellRect ?? SHELL_RECT;
  const column = new ElementStub('div');
  column.setAttribute('data-e2e', 'browse-video');
  column.rect = overrides.columnRect ?? COLUMN_RECT;
  const player = overrides.noPlayer ? null : new ElementStub('div');
  if (player) {
    player.setAttribute('data-e2e', overrides.playerE2e ?? 'video-player');
    player.className = overrides.playerClass ?? 'xgplayer';
    player.rect = overrides.playerRect ?? PLAYER_RECT;
  }
  const video = overrides.noPlayer ? null : new VideoStub();
  if (video) video.rect = overrides.playerRect ?? PLAYER_RECT;
  const bar = overrides.noPlayer ? null : new ElementStub('div');
  if (bar) {
    bar.className = 'xgplayer-progress';
    bar.rect = {
      left: (overrides.playerRect ?? PLAYER_RECT).left + 16,
      top: (overrides.playerRect ?? PLAYER_RECT).bottom - 18,
      right: (overrides.playerRect ?? PLAYER_RECT).right - 16,
      bottom: (overrides.playerRect ?? PLAYER_RECT).bottom - 10,
      width: (overrides.playerRect ?? PLAYER_RECT).width - 32,
      height: 8,
    };
  }
  const related = new ElementStub('div');
  related.setAttribute('data-e2e', 'recommend-list-item');
  related.rect = { left: 900, top: 80, right: 1060, bottom: 280, width: 160, height: 200 };
  const relatedVideo = new VideoStub();
  relatedVideo.rect = related.rect;
  related.appendChild(relatedVideo);

  if (!overrides.omitNav) documentElement.appendChild(nav);
  if (!overrides.noShell) documentElement.appendChild(shell);
  const playerParent = overrides.cinema
    ? column
    : shell;
  if (!overrides.noColumn) {
    (overrides.cinema ? documentElement : shell).appendChild(column);
  }
  if (player && video) {
    player.appendChild(video);
    if (bar) player.appendChild(bar);
    if (overrides.videoOnly) {
      (overrides.noColumn ? playerParent : column).appendChild(video);
    } else {
      (overrides.noColumn ? playerParent : column).appendChild(player);
    }
  }
  if (!overrides.noRelated) {
    (overrides.noShell ? documentElement : shell).appendChild(related);
  }

  const values = {
    location: { href: overrides.url ?? WATCH },
    HTMLElement: ElementStub,
    HTMLVideoElement: VideoStub,
    getComputedStyle: (element) => ({
      display: element?.hiddenRects ? 'none' : 'block',
      visibility: element?.hiddenRects ? 'hidden' : 'visible',
      opacity: element?.hiddenRects ? '0' : '1',
    }),
    document: {
      documentElement,
      createElement: (tag) => new ElementStub(tag),
      getElementById: (id) => nodes.get(id) ?? null,
      querySelector: (selector) => {
        if (matchesSelector(documentElement, selector)) return documentElement;
        return documentElement.querySelector(selector);
      },
      querySelectorAll: (selector) => {
        const matches = [];
        const visit = (node) => {
          if (matchesSelector(node, selector)) matches.push(node);
          for (const child of node.children) visit(child);
        };
        visit(documentElement);
        return matches;
      },
    },
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (name, fn) => { listeners[name]?.push(fn); },
      removeEventListener: (name, fn) => {
        if (!listeners[name]) return;
        listeners[name] = listeners[name].filter((entry) => entry !== fn);
      },
    },
  };

  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return callback({
      documentElement,
      player,
      video,
      column,
      shell,
      nav,
      relatedVideo,
      listeners,
    });
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('watch URL helper accepts @handle/video ids and fails closed elsewhere', () => {
  assert.equal(tiktokWatchVideoIdFromHref(WATCH), VIDEO_ID);
  assert.equal(tiktokWatchVideoIdFromHref(`${WATCH}?is_from_webapp=1&q=1`), VIDEO_ID);
  assert.equal(tiktokWatchVideoIdFromHref('https://www.tiktok.com/foryou'), null);
  assert.equal(tiktokWatchVideoIdFromHref('https://www.tiktok.com/following'), null);
  assert.equal(tiktokWatchVideoIdFromHref('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('hover outlines the watch player, not the left rail or page shell', () => {
  withPage(({ documentElement, player, video, nav, shell, column }) => {
    const result = applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: 1_000,
      endMs: 8_000,
    });
    assert.equal(result.ok, true);
    const root = documentElement.querySelector('#annotated-tt-hover-root');
    assert.ok(root);
    assert.equal(root.dataset.surface, 'video-player');
    const ring = root.querySelector('[data-annotated-hover-ring="1"]');
    const box = parseBox(ring.style.cssText);
    assert.equal(box.left, PLAYER_RECT.left + 5);
    assert.equal(box.top, PLAYER_RECT.top + 5);
    assert.equal(box.width, PLAYER_RECT.width - 10);
    assert.equal(box.height, PLAYER_RECT.height - 10);
    assert.notEqual(box.left, 0);
    assert.notEqual(box.width, SHELL_RECT.width);
    assert.notEqual(box.width, COLUMN_RECT.width);
    assert.notEqual(box.width, NAV_RECT.width);
    assert.match(ring.style.cssText, /rgba\(255, 184, 40/);
    assert.match(ring.style.cssText, /box-shadow:0 0 0 3px/);
    assert.equal(player.scrolls.length, 1);
    assert.deepEqual(player.scrolls[0], { block: 'center', inline: 'nearest', behavior: 'smooth' });
    assert.equal(nav.scrolls.length, 0);
    assert.equal(shell.scrolls.length, 0);
    assert.equal(column.scrolls.length, 0);
    assert.equal(video.currentTime, 4);
    assert.equal(video.paused, false);
  });
});

test('cinema / full-bleed browse-video still targets the inner player surface', () => {
  withPage(({ documentElement, player }) => {
    const result = applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'strong',
      startMs: null,
      endMs: null,
    });
    assert.equal(result.ok, true);
    const root = documentElement.querySelector('#annotated-tt-hover-root');
    assert.equal(root.dataset.surface, 'video-player');
    assert.equal(root.dataset.strength, 'strong');
    const ring = root.querySelector('[data-annotated-hover-ring="1"]');
    const box = parseBox(ring.style.cssText);
    assert.equal(box.left, PLAYER_RECT.left + 6);
    assert.equal(box.top, PLAYER_RECT.top + 6);
    assert.equal(box.width, PLAYER_RECT.width - 12);
    assert.equal(box.height, PLAYER_RECT.height - 12);
    assert.match(ring.style.cssText, /rgba\(255, 196, 56/);
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.14\)/);
    assert.equal(player.scrolls.length, 1);
  }, { cinema: true, columnRect: SHELL_RECT });
});

test('watch-in-full-screen xgplayer is preferred over #main-content-video_detail', () => {
  const cinemaPlayer = { left: 190, top: 20, right: 1090, bottom: 700, width: 900, height: 680 };
  withPage(({ documentElement, player, shell }) => {
    const result = applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    });
    assert.equal(result.ok, true);
    const root = documentElement.querySelector('#annotated-tt-hover-root');
    assert.equal(root.dataset.surface, 'xgplayer');
    const box = parseBox(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText);
    assert.equal(box.left, cinemaPlayer.left + 5);
    assert.equal(box.width, cinemaPlayer.width - 10);
    assert.notEqual(box.left, 0);
    assert.notEqual(box.width, SHELL_RECT.width);
    assert.equal(player.scrolls.length, 1);
    assert.equal(shell.scrolls.length, 0);
  }, {
    noColumn: true,
    playerE2e: '',
    playerClass: 'xgplayer',
    playerRect: cinemaPlayer,
  });
});

test('related For You-style thumbnails do not steal the watch player outline', () => {
  withPage(({ documentElement, relatedVideo }) => {
    assert.equal(applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }).ok, true);
    const root = documentElement.querySelector('#annotated-tt-hover-root');
    assert.equal(root.dataset.surface, 'video-player');
    const box = parseBox(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText);
    assert.equal(box.left, PLAYER_RECT.left + 5);
    assert.notEqual(box.left, relatedVideo.rect.left + 5);
  });
});

test('page injector fails closed off-source, on For You, and when no player is present', () => {
  withPage(() => {
    assert.deepEqual(applyTikTokHoverHighlightOnPage({
      expectedVideoId: '7550999999999999999',
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  });
  withPage(() => {
    assert.deepEqual(applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  }, { url: 'https://www.tiktok.com/foryou' });
  withPage(() => {
    assert.deepEqual(applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'player-unavailable' });
  }, { noPlayer: true, noRelated: true });
});

test('re-applying hover does not scroll the player again', () => {
  withPage(({ player }) => {
    const target = {
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: 1_000,
      endMs: 8_000,
    };
    assert.equal(applyTikTokHoverHighlightOnPage(target).ok, true);
    assert.equal(player.scrolls.length, 1);
    assert.equal(applyTikTokHoverHighlightOnPage({ ...target, strength: 'strong' }).ok, true);
    assert.equal(player.scrolls.length, 1);
  });
});

test('soft and strong hover never seek or play and clear removes the overlay', () => {
  withPage(({ documentElement, video }) => {
    assert.equal(applyTikTokHoverHighlightOnPage({
      expectedVideoId: VIDEO_ID,
      strength: 'strong',
      startMs: 1_000,
      endMs: 8_000,
    }).ok, true);
    assert.equal(video.currentTime, 4);
    assert.equal(video.paused, false);
    assert.equal(documentElement.querySelectorAll('#annotated-tt-hover-root').length, 1);
    assert.deepEqual(clearTikTokHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-tt-hover-root'), null);
  });
});

test('serialized hover functions stay closure-free and do not throw', async () => {
  const source = await readFile(new URL('./tiktok-hover-page.ts', import.meta.url), 'utf8');
  assert.match(source, /scrollIntoView/);
  assert.match(source, /isPageShell/);
  assert.doesNotMatch(source, /visibleArea\(candidate\) > 0\) return candidate/);
  assert.doesNotMatch(source, /\.play\s*\(/);
  assert.doesNotMatch(source, /currentTime\s*=/);
  assert.doesNotMatch(applyTikTokHoverHighlightOnPage.toString(), /getTikTokVideoIdentity|chrome\.|import /);
  const apply = Function(`return (${applyTikTokHoverHighlightOnPage.toString()})`)();
  const clear = Function(`return (${clearTikTokHoverHighlightOnPage.toString()})`)();
  withPage(() => {
    assert.equal(apply({
      expectedVideoId: VIDEO_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }).ok, true);
    assert.equal(clear().ok, true);
  });
  withPage(() => {
    assert.equal(apply(null).ok, false);
  });
  assert.equal(TIKTOK_HOVER_ROOT_ID, 'annotated-tt-hover-root');
});
