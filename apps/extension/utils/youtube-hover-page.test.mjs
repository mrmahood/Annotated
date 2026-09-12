import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyYouTubeHoverHighlightOnPage,
  clearYouTubeHoverHighlightOnPage,
  scrubberRangePercent,
  YOUTUBE_HOVER_ROOT_ID,
} from './youtube-hover-page.ts';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const PLAYER_RECT = { left: 40, top: 20, right: 680, bottom: 380, width: 640, height: 360 };

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
  const frames = [];
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
      return this.rect ?? overrides.playerRect ?? PLAYER_RECT;
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

  const playerRect = overrides.playerRect ?? PLAYER_RECT;
  const player = overrides.noPlayer ? null : new ElementStub('div', 'movie_player');
  if (player) player.rect = playerRect;
  const video = overrides.noPlayer ? null : new VideoStub();
  if (video) video.rect = playerRect;
  const bar = overrides.noPlayer ? null : new ElementStub('div');
  if (bar) {
    bar.className = 'ytp-progress-bar';
    bar.rect = {
      left: playerRect.left,
      top: playerRect.bottom - 20,
      right: playerRect.right,
      bottom: playerRect.bottom - 12,
      width: playerRect.width,
      height: 8,
    };
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
      innerWidth: overrides.innerWidth ?? 1280,
      innerHeight: overrides.innerHeight ?? 720,
      addEventListener: (name, fn) => { listeners[name]?.push(fn); },
      removeEventListener: (name, fn) => {
        if (!listeners[name]) return;
        listeners[name] = listeners[name].filter((entry) => entry !== fn);
      },
      requestAnimationFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: (handle) => {
        if (handle >= 1 && handle <= frames.length) frames[handle - 1] = null;
      },
    },
  };

  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return callback({ player, video, documentElement, listeners, nodes, frames });
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
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.1\)/);
    const softRing = root.querySelector('[data-annotated-hover-ring="1"]');
    const softBox = parseBox(softRing.style.cssText);
    assert.equal(softBox.left, PLAYER_RECT.left + 5);
    assert.equal(softBox.top, PLAYER_RECT.top + 5);
    assert.equal(softBox.width, PLAYER_RECT.width - 10);
    assert.equal(softBox.height, PLAYER_RECT.height - 10);
    assert.match(softRing.style.cssText, /rgba\(255, 184, 40/);
    assert.match(softRing.style.cssText, /box-shadow:0 0 0 3px/);
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
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.14\)/);
    const strongRing = root.querySelector('[data-annotated-hover-ring="1"]');
    const strongBox = parseBox(strongRing.style.cssText);
    assert.equal(strongBox.left, PLAYER_RECT.left + 6);
    assert.equal(strongBox.top, PLAYER_RECT.top + 6);
    assert.equal(strongBox.width, PLAYER_RECT.width - 12);
    assert.equal(strongBox.height, PLAYER_RECT.height - 12);
    assert.match(strongRing.style.cssText, /rgba\(255, 196, 56/);
    assert.match(strongRing.style.cssText, /box-shadow:0 0 0 4px/);
    assert.equal(video.currentTime, 2.5);

    assert.deepEqual(clearYouTubeHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-yt-hover-root'), null);
  });
});

test('range strength paints the scrubber cue without dimming the page', () => {
  withPage(({ documentElement }) => {
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'range',
      startMs: 1_000,
      endMs: 4_000,
      seekMs: null,
    }).ok, true);
    const root = documentElement.querySelector('#annotated-yt-hover-root');
    assert.equal(root.dataset.strength, 'range');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /display:none/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /display:none/);
    assert.match(root.querySelector('[data-annotated-hover-range="1"]').style.cssText, /width:10\.6/);
  });
});

test('inset amber ring stays inside a flush laptop-width player on all four sides', () => {
  const flush = { left: 0, top: 56, right: 800, bottom: 506, width: 800, height: 450 };
  withPage(({ documentElement }) => {
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }).ok, true);
    const ring = documentElement.querySelector('[data-annotated-hover-ring="1"]');
    const box = parseBox(ring.style.cssText);
    assert.equal(box.left, 5);
    assert.equal(box.top, 61);
    assert.equal(box.width, 790);
    assert.equal(box.height, 440);
    assert.ok(box.left > 0);
    assert.ok(box.top > flush.top);
    assert.ok(box.left + box.width < 800);
    assert.ok(box.top + box.height < flush.bottom);
    assert.match(ring.style.cssText, /rgba\(255, 184, 40/);
    assert.match(ring.style.cssText, /rgba\(20, 16, 8/);
    assert.doesNotMatch(ring.style.cssText, /154, 167, 181/);
  }, { playerRect: flush, innerWidth: 800, innerHeight: 600 });
});

test('YouTube hover ring tokens stay locked to the TikTok amber inset grammar', async () => {
  const youtube = await readFile(new URL('./youtube-hover-page.ts', import.meta.url), 'utf8');
  const tiktok = await readFile(new URL('./tiktok-hover-page.ts', import.meta.url), 'utf8');
  for (const source of [youtube, tiktok]) {
    assert.match(source, /rgba\(255, 196, 56, 0\.96\)/);
    assert.match(source, /rgba\(255, 184, 40, 0\.92\)/);
    assert.match(source, /rgba\(20, 16, 8, 0\.72\)/);
    assert.match(source, /const dimOpacity = strong \? 0\.14 : 0\.1;/);
    assert.match(source, /const ringWidth = strong \? 4 : 3;/);
    assert.match(source, /const ringInset = strong \? 6 : 5;/);
    assert.match(source, /box-shadow:0 0 0 \$\{ringWidth\}px \$\{ringColor\},0 0 0 \$\{ringWidth \+ 2\}px \$\{ringContrast\}/);
    assert.doesNotMatch(source, /rgba\(236, 241, 246/);
    assert.doesNotMatch(source, /rgba\(154, 167, 181, 0\.78\)/);
  }
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

test('scroll and resize coalesce onto one animation frame and skip identical css writes', () => {
  withPage(({ player, documentElement, listeners, frames }) => {
    assert.equal(applyYouTubeHoverHighlightOnPage({
      expectedVideoId: 'dQw4w9WgXcQ',
      strength: 'soft',
      startMs: null,
      endMs: null,
      seekMs: null,
    }).ok, true);
    const ring = documentElement.querySelector('[data-annotated-hover-ring="1"]');
    const firstCss = ring.style.cssText;
    assert.equal(listeners.scroll.length, 1);
    assert.equal(frames.length, 0);

    listeners.scroll[0]();
    listeners.scroll[0]();
    listeners.resize[0]();
    assert.equal(frames.length, 1);
    assert.equal(ring.style.cssText, firstCss);

    player.rect = { left: 80, top: 60, right: 720, bottom: 420, width: 640, height: 360 };
    frames[0](0);
    const moved = parseBox(ring.style.cssText);
    assert.equal(moved.left, 85);
    assert.equal(moved.top, 65);

    const afterMove = ring.style.cssText;
    listeners.scroll[0]();
    frames[1](0);
    assert.equal(ring.style.cssText, afterMove);
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
