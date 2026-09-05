import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPageVideoHoverHighlightOnPage,
  clearPageVideoHoverHighlightOnPage,
  normalizePageVideoHoverPageUrl,
  pageVideoScrubberRangePercent,
  PAGE_VIDEO_HOVER_ROOT_ID,
} from './page-video-hover-page.ts';

const PAGE = 'https://www.foxnews.com/politics/example-story';
const PAGE_TRACKED = `${PAGE}?utm_source=feed&t=30s`;

function withPage(callback, overrides = {}) {
  const names = [
    'location',
    'document',
    'window',
    'HTMLElement',
    'HTMLMediaElement',
    'HTMLAudioElement',
    'HTMLVideoElement',
    'HTMLIFrameElement',
    'HTMLInputElement',
    'HTMLProgressElement',
    'getComputedStyle',
  ];
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
      this.textContent = '';
      this.scrolls = [];
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
      if (child.id) nodes.set(child.id, this.id ? child : child);
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
      return this.rect ?? { left: 40, top: 520, right: 680, bottom: 880, width: 640, height: 360 };
    }
    getClientRects() { return this.hiddenRects ? [] : [{}]; }
    scrollIntoView(options) { this.scrolls.push(options); }
  }

  class MediaStub extends ElementStub {
    constructor(tagName) {
      super(tagName);
      this.controls = true;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = 180;
      this.readyState = 2;
    }
  }

  class AudioStub extends MediaStub {
    constructor() {
      super('audio');
      this.currentTime = 5;
    }
  }

  class VideoStub extends MediaStub {
    constructor() {
      super('video');
      this.controls = true;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = 120;
      this.readyState = 2;
      this.videoWidth = 640;
      this.videoHeight = 360;
    }
  }

  class IFrameStub extends ElementStub {
    constructor() {
      super('iframe');
    }
  }

  class InputStub extends ElementStub {
    constructor() {
      super('input');
      this.type = 'range';
      this.max = '180';
    }
  }

  class ProgressStub extends ElementStub {
    constructor() {
      super('progress');
      this.max = 180;
    }
  }

  function matchesSelector(node, selector) {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => {
      if (part === 'video') return node.tagName === 'VIDEO';
      if (part === 'iframe') return node.tagName === 'IFRAME';
      if (part === 'button, [role="button"]') {
        return node.tagName === 'BUTTON' || node.attributes.role === 'button';
      }
      if (part === 'input[type="range"]') return node.tagName === 'INPUT' && node.type === 'range';
      if (part === '[role="slider"]') return node.attributes.role === 'slider';
      if (part === '[aria-label], [role="region"], [role="group"], [id], [class]') {
        return Boolean(node.attributes['aria-label'] || node.attributes.role === 'region' ||
          node.attributes.role === 'group' || node.id || node.className);
      }
      if (part === '[class], [id]') return Boolean(node.className || node.id);
      if (part.startsWith('#')) return node.id === part.slice(1);
      if (part.startsWith('.')) return node.className.split(/\s+/).includes(part.slice(1));
      if (part.includes('[')) {
        const name = part.slice(part.indexOf('[') + 1, part.indexOf('=') >= 0 ? part.indexOf('=') : part.indexOf(']'));
        if (part.includes('="')) {
          const value = part.slice(part.indexOf('"') + 1, part.lastIndexOf('"'));
          return node.attributes[name] === value;
        }
        return node.attributes[name] != null || (name === 'class' && node.className) ||
          (name === 'id' && node.id);
      }
      return node.tagName === part.toUpperCase();
    });
  }

  const player = overrides.noPlayer ? null : new ElementStub('div', 'page-video-player');
  const video = overrides.noPlayer || overrides.iframeOnly ? null : new VideoStub();
  const iframe = overrides.iframeOnly ? new IFrameStub() : null;
  const bar = overrides.noPlayer ? null : new InputStub();
  const play = overrides.noPlayer ? null : new ElementStub('button');
  if (player) {
    player.className = 'video-player';
    player.setAttribute('aria-label', 'Featured video player');
  }
  if (bar) {
    bar.rect = { left: 80, top: 840, right: 640, bottom: 848, width: 560, height: 8 };
  }
  if (play) play.setAttribute('aria-label', 'Play');
  if (video && overrides.hiddenVideo) {
    video.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    video.hiddenRects = true;
    video.controls = false;
  }
  if (iframe) {
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.rect = { left: 40, top: 520, right: 680, bottom: 880, width: 640, height: 360 };
  }
  if (player && video) player.appendChild(video);
  if (player && iframe) player.appendChild(iframe);
  if (player && bar) player.appendChild(bar);
  if (player && play) player.appendChild(play);

  const documentElement = new ElementStub('html');
  if (player && !overrides.orphanPlayer) documentElement.appendChild(player);

  const values = {
    location: { href: overrides.url ?? PAGE },
    HTMLElement: ElementStub,
    HTMLMediaElement: MediaStub,
    HTMLAudioElement: AudioStub,
    HTMLVideoElement: VideoStub,
    HTMLIFrameElement: IFrameStub,
    HTMLInputElement: InputStub,
    HTMLProgressElement: ProgressStub,
    getComputedStyle: (element) => ({
      display: element?.hiddenRects ? 'none' : 'block',
      visibility: element?.hiddenRects ? 'hidden' : 'visible',
      opacity: element?.hiddenRects ? '0' : '1',
      position: element?.cssPosition ?? 'static',
    }),
    document: {
      documentElement,
      createElement: (tag) => {
        if (tag === 'audio') return new AudioStub();
        if (tag === 'video') return new VideoStub();
        if (tag === 'iframe') return new IFrameStub();
        if (tag === 'input') return new InputStub();
        if (tag === 'progress') return new ProgressStub();
        return new ElementStub(tag);
      },
      getElementById: (id) => nodes.get(id) ?? (id === 'page-video-player' ? player : null),
      querySelector: (selector) => {
        if (selector === 'video') return video;
        if (selector === 'iframe') return iframe;
        return documentElement.querySelector(selector);
      },
      querySelectorAll: (selector) => {
        if (selector === 'video') return video ? [video] : [];
        if (selector === 'iframe') return iframe ? [iframe] : [];
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
    return callback({ player, video, iframe, bar, documentElement, listeners, nodes, ElementStub });
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('page-video hover URL helper strips tracking and playback crumbs and rejects YouTube', () => {
  assert.equal(normalizePageVideoHoverPageUrl(PAGE_TRACKED), PAGE);
  assert.equal(normalizePageVideoHoverPageUrl(`${PAGE}#quote`), PAGE);
  assert.equal(normalizePageVideoHoverPageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(normalizePageVideoHoverPageUrl('not-a-url'), null);
});

test('scrubber range helper maps a clip onto the progress bar', () => {
  assert.deepEqual(pageVideoScrubberRangePercent(10_000, 20_000, 100_000), {
    leftPercent: 10,
    widthPercent: 10,
  });
  assert.equal(pageVideoScrubberRangePercent(20_000, 10_000, 100_000), null);
  assert.equal(pageVideoScrubberRangePercent(0, 1_000, 0), null);
});

test('page injector paints an idempotent ring, dim, range, and scrolls the player', () => {
  withPage(({ documentElement, player, video }) => {
    const first = applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
    });
    assert.equal(first.ok, true);
    const root = documentElement.querySelector('#annotated-page-video-hover-root');
    assert.ok(root);
    assert.equal(root.dataset.strength, 'soft');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.09\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /box-shadow:0 0 0 2px/);
    assert.match(root.querySelector('[data-annotated-hover-range="1"]').style.cssText, /width:/);
    assert.equal(player.scrolls.length, 1);
    assert.deepEqual(player.scrolls[0], { block: 'center', inline: 'nearest', behavior: 'smooth' });
    assert.equal(video.currentTime, 0);
    assert.equal(video.paused, true);

    const second = applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
    });
    assert.equal(second.ok, true);
    assert.equal(documentElement.querySelectorAll('#annotated-page-video-hover-root').length, 1);
    assert.equal(root.dataset.strength, 'strong');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.12\)/);
    assert.equal(video.currentTime, 0);

    assert.deepEqual(clearPageVideoHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-page-video-hover-root'), null);
  });
});

test('visible embed chrome still highlights when native video is hidden', () => {
  withPage(({ documentElement, player, video }) => {
    assert.equal(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
    }).ok, true);
    assert.ok(documentElement.querySelector('#annotated-page-video-hover-root'));
    assert.equal(player.scrolls.length, 1);
    assert.equal(video.scrolls.length, 0);
  }, { hiddenVideo: true });
});

test('generic embed iframe chrome is a safe player target', () => {
  withPage(({ documentElement, player, iframe }) => {
    assert.equal(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }).ok, true);
    assert.ok(documentElement.querySelector('#annotated-page-video-hover-root'));
    assert.equal(player.scrolls.length, 1);
    assert.equal(iframe.scrolls.length, 0);
  }, { iframeOnly: true });
});

test('page injector scrolls laid-out chrome even when the player starts off-viewport', () => {
  withPage(({ documentElement, player, video, bar, ElementStub }) => {
    const belowFold = { left: 40, top: 1800, right: 680, bottom: 2160, width: 640, height: 360 };
    player.rect = belowFold;
    bar.rect = { left: 80, top: 2120, right: 640, bottom: 2128, width: 560, height: 8 };
    const decoy = new ElementStub('div', 'watch-promo');
    decoy.className = 'watch';
    decoy.setAttribute('aria-label', 'Watch more videos');
    decoy.rect = { left: 40, top: 80, right: 280, bottom: 200, width: 240, height: 120 };
    const decoyPlay = new ElementStub('button');
    decoyPlay.setAttribute('aria-label', 'Play');
    decoy.appendChild(decoyPlay);
    documentElement.appendChild(decoy);

    assert.equal(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: 1_000,
      endMs: 4_000,
    }).ok, true);
    const root = documentElement.querySelector('#annotated-page-video-hover-root');
    assert.ok(root);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /top:1800px/);
    assert.equal(player.scrolls.length, 1);
    assert.deepEqual(player.scrolls[0], { block: 'center', inline: 'nearest', behavior: 'smooth' });
    assert.equal(video.scrolls.length, 0);
    assert.equal(decoy.scrolls.length, 0);
    const ring = root.querySelector('[data-annotated-hover-ring="1"]');
    assert.equal(ring.scrolls.length, 1);
  });
});

test('sticky player chrome scrolls an in-flow ancestor instead of no-opping in view', () => {
  withPage(({ documentElement, player }) => {
    player.cssPosition = 'sticky';
    player.rect = { left: 40, top: 200, right: 680, bottom: 560, width: 640, height: 360 };
    assert.equal(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
    }).ok, true);
    assert.equal(player.scrolls.length, 0);
    assert.ok(documentElement.scrolls.length >= 1);
    assert.deepEqual(documentElement.scrolls[0], {
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    });
  });
});

test('page injector fails closed off-source and when no player is present', () => {
  withPage(() => {
    assert.deepEqual(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: 'https://example.com/other',
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  });
  withPage(() => {
    assert.deepEqual(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'player-unavailable' });
  }, { noPlayer: true });
  withPage(() => {
    assert.deepEqual(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  }, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
});

test('soft and strong hover never seek or play the host player', () => {
  assert.doesNotMatch(applyPageVideoHoverHighlightOnPage.toString(), /\.play\s*\(/);
  assert.doesNotMatch(applyPageVideoHoverHighlightOnPage.toString(), /currentTime\s*=/);
  withPage(({ video }) => {
    video.currentTime = 12;
    assert.equal(applyPageVideoHoverHighlightOnPage({
      expectedNormalizedUrl: PAGE,
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
    }).ok, true);
    assert.equal(video.currentTime, 12);
    assert.equal(video.paused, true);
  });
});

test('scroll is not gated on viewport intersection of the painted player', () => {
  assert.doesNotMatch(applyPageVideoHoverHighlightOnPage.toString(), /visibleRect\s*\(\s*player/);
  assert.match(applyPageVideoHoverHighlightOnPage.toString(), /scrollIntoView/);
  assert.match(applyPageVideoHoverHighlightOnPage.toString(), /isLaidOut/);
});

test('serialized hover functions stay closure-free and do not throw', () => {
  const apply = Function(`return (${applyPageVideoHoverHighlightOnPage.toString()})`)();
  const clear = Function(`return (${clearPageVideoHoverHighlightOnPage.toString()})`)();
  assert.doesNotMatch(applyPageVideoHoverHighlightOnPage.toString(), /normalizeArticleUrl|chrome\.|import /);
  withPage(() => {
    assert.equal(apply({
      expectedNormalizedUrl: PAGE,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }).ok, true);
    assert.equal(clear().ok, true);
  });
  withPage(() => {
    assert.equal(apply(null).ok, false);
  });
  assert.equal(PAGE_VIDEO_HOVER_ROOT_ID, 'annotated-page-video-hover-root');
});
