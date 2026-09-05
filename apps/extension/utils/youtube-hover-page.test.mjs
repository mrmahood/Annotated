import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyYouTubeHoverHighlightOnPage,
  clearYouTubeHoverHighlightOnPage,
  scrubberRangePercent,
  YOUTUBE_HOVER_ROOT_ID,
} from './youtube-hover-page.ts';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

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
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') {
        this.id = String(value);
        nodes.set(String(value), this);
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
      return this.rect ?? { left: 40, top: 20, right: 680, bottom: 380, width: 640, height: 360 };
    }
    getClientRects() { return [{}]; }
  }

  class VideoStub extends ElementStub {
    constructor() {
      super('video');
      this.currentTime = 5;
      this.duration = 180;
    }
  }

  function matchesSelector(node, selector) {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => {
      if (part.startsWith('#')) return node.id === part.slice(1);
      if (part.startsWith('.')) return node.className.split(/\s+/).includes(part.slice(1));
      if (part.includes('#')) {
        const [tag, id] = part.split('#');
        return node.tagName === tag.toUpperCase() && node.id === id;
      }
      if (part.includes('[')) {
        const name = part.slice(part.indexOf('[') + 1, part.indexOf('='));
        const value = part.slice(part.indexOf('"') + 1, part.lastIndexOf('"'));
        return node.attributes[name] === value;
      }
      return node.tagName === part.toUpperCase();
    });
  }

  const player = overrides.noPlayer ? null : new ElementStub('div', 'movie_player');
  const video = overrides.noPlayer ? null : new VideoStub();
  const bar = overrides.noPlayer ? null : new ElementStub('div');
  if (bar) {
    bar.className = 'ytp-progress-bar';
    bar.rect = { left: 40, top: 360, right: 680, bottom: 368, width: 640, height: 8 };
  }
  if (player && video) player.appendChild(video);
  if (player && bar) player.appendChild(bar);

  const documentElement = new ElementStub('html');
  if (player && !overrides.orphanPlayer) documentElement.appendChild(player);

  const values = {
    location: { href: overrides.url ?? WATCH },
    HTMLElement: ElementStub,
    HTMLVideoElement: VideoStub,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement,
      createElement: (tag) => new ElementStub(tag),
      getElementById: (id) => nodes.get(id) ?? (id === 'movie_player' ? player : null),
      querySelector: (selector) => {
        if (selector === '#movie_player') return player;
        if (selector === 'video') return video;
        return documentElement.querySelector(selector);
      },
      querySelectorAll: (selector) => {
        if (selector === 'video') return video ? [video] : [];
        return documentElement.querySelectorAll(selector);
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
    return callback({ player, video, documentElement, listeners, nodes });
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('scrubber range helper maps a clip onto the progress bar', () => {
  assert.deepEqual(scrubberRangePercent(10_000, 20_000, 100_000), {
    leftPercent: 10,
    widthPercent: 10,
  });
  assert.equal(scrubberRangePercent(20_000, 10_000, 100_000), null);
  assert.equal(scrubberRangePercent(0, 1_000, 0), null);
});

test('page injector paints an idempotent ring and dim on the matched watch player', () => {
  withPage(({ documentElement, video }) => {
    const first = applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: null,
    });
    assert.equal(first.ok, true);
    const root = documentElement.querySelector('#annotated-yt-hover-root');
    assert.ok(root);
    assert.equal(root.dataset.strength, 'soft');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.09\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /box-shadow:0 0 0 2px/);
    assert.match(root.querySelector('[data-annotated-hover-range="1"]').style.cssText, /width:10\.6/);

    const second = applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: 2_500,
    });
    assert.equal(second.ok, true);
    assert.equal(documentElement.querySelectorAll('#annotated-yt-hover-root').length, 1);
    assert.equal(root.dataset.strength, 'strong');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.12\)/);
    assert.equal(video.currentTime, 2.5);

    assert.deepEqual(clearYouTubeHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-yt-hover-root'), null);
  });
});

test('page injector fails closed off-source and when no player is present', () => {
  withPage(() => {
    assert.deepEqual(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: '9bZkp7q19f0',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  });
  withPage(() => {
    assert.deepEqual(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }), { ok: false, reason: 'player-unavailable' });
  }, { noPlayer: true });
  withPage(() => {
    assert.deepEqual(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  }, { url: 'https://youtu.be/dQw4w9WgXcQ' });
});

test('page injector seeks only when currentTime is outside the clip and far from seekMs', () => {
  withPage(({ video }) => {
    video.currentTime = 12;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: 2_500,
    }).ok, true);
    assert.equal(video.currentTime, 2.5);

    video.currentTime = 2.6;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: 2_500,
    }).ok, true);
    assert.equal(video.currentTime, 2.6);

    video.currentTime = 3.2;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: 1_000,
    }).ok, true);
    assert.equal(video.currentTime, 3.2);

    video.currentTime = 8;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: null,
    }).ok, true);
    assert.equal(video.currentTime, 8);
  });
});

test('soft hover never seeks even when seekMs is present', () => {
  withPage(({ video }) => {
    video.currentTime = 12;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: 2_500,
    }).ok, true);
    assert.equal(video.currentTime, 12);
  });
});

test('page injector collapses a rapid same-seek re-apply and never calls play', () => {
  assert.doesNotMatch(applyYouTubeHoverHighlightOnPage.toString(), /\.play\s*\(/);
  withPage(({ video, documentElement }) => {
    video.currentTime = 20;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 10_000,
      endMs: 14_000,
      seekMs: 10_000,
    }).ok, true);
    assert.equal(video.currentTime, 10);
    const root = documentElement.querySelector('#annotated-yt-hover-root');
    assert.equal(root.dataset.annotatedSeekMs, '10000');

    video.currentTime = 40;
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'strong',
      startMs: 10_000,
      endMs: 14_000,
      seekMs: 10_000,
    }).ok, true);
    assert.equal(video.currentTime, 40);
  });
});

test('serialized hover functions stay closure-free and do not throw', () => {
  const apply = Function(`return (${applyYouTubeHoverHighlightOnPage.toString()})`)();
  const clear = Function(`return (${clearYouTubeHoverHighlightOnPage.toString()})`)();
  assert.doesNotMatch(applyYouTubeHoverHighlightOnPage.toString(), /getYouTubeVideoIdentity|chrome\.|import /);
  withPage(() => {
    assert.equal(apply({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }).ok, true);
    assert.equal(clear().ok, true);
  });
  withPage(() => {
    assert.equal(apply(null).ok, false);
  });
  assert.equal(YOUTUBE_HOVER_ROOT_ID, 'annotated-yt-hover-root');
});
