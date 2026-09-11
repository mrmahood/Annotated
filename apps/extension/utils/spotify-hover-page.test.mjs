import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySpotifyHoverHighlightOnPage,
  clearSpotifyHoverHighlightOnPage,
  spotifyEpisodeIdFromHref,
  SPOTIFY_HOVER_ROOT_ID,
} from './spotify-hover-page.ts';

const EPISODE = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';
const EPISODE_ID = '7makk4oTQel546B0P8lOOJ';
const VIEW = { innerWidth: 1280, innerHeight: 720 };
const PROMO_RECT = { left: 0, top: 540, right: 1280, bottom: 620, width: 1280, height: 80 };
const PLAYER_RECT = { left: 0, top: 620, right: 1280, bottom: 720, width: 1280, height: 100 };
const STACK_RECT = { left: 0, top: 540, right: 1280, bottom: 720, width: 1280, height: 180 };
const CONTROLS_RECT = { left: 400, top: 630, right: 700, bottom: 710, width: 300, height: 80 };
const WIDGET_RECT = { left: 16, top: 630, right: 280, bottom: 710, width: 264, height: 80 };
const PROGRESS_RECT = { left: 400, top: 700, right: 900, bottom: 712, width: 500, height: 12 };

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
  const names = ['location', 'document', 'window', 'HTMLElement', 'getComputedStyle'];
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
      this._textContent = '';
      this.scrolls = [];
    }
    get textContent() {
      if (this._textContent) return this._textContent;
      return this.children.map((child) => child.textContent).join('');
    }
    set textContent(value) {
      this._textContent = String(value);
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
    matches(selector) {
      return matchesSelector(this, selector);
    }
    contains(other) {
      let node = other;
      while (node) {
        if (node === this) return true;
        node = node.parentElement;
      }
      return false;
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

  function matchesSelector(node, selector) {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => {
      if (part.startsWith('#') && !part.includes('[')) return node.id === part.slice(1);
      if (part.startsWith('.') && !part.includes('[')) {
        return node.className.split(/\s+/).includes(part.slice(1));
      }
      if (part.includes('[href*="')) {
        const value = part.slice(part.indexOf('[href*="') + 8, part.lastIndexOf('"'));
        const href = node.attributes.href ?? '';
        const tagOk = !part.startsWith('a[') || node.tagName === 'A';
        return tagOk && href.includes(value);
      }
      if (part.includes('[data-testid="')) {
        const value = part.slice(part.indexOf('[data-testid="') + 14, part.lastIndexOf('"'));
        return node.attributes['data-testid'] === value;
      }
      if (part.includes('[data-annotated-hover-dim="')) {
        return node.attributes['data-annotated-hover-dim'] === '1';
      }
      if (part.includes('[data-annotated-hover-ring="')) {
        return node.attributes['data-annotated-hover-ring'] === '1';
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
  documentElement.rect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };

  const footer = new ElementStub('footer');
  footer.setAttribute('data-testid', 'now-playing-bar');

  const promo = new ElementStub('div');
  promo.setAttribute('data-testid', 'upsell-bar');
  promo.textContent = 'Preview of Spotify. Sign up to get unlimited songs and podcasts. Sign up free';
  const signup = new ElementStub('a');
  signup.setAttribute('href', '/signup');
  signup.setAttribute('data-testid', 'signup-button');
  signup.textContent = 'Sign up free';
  promo.appendChild(signup);
  promo.rect = overrides.promoRect ?? PROMO_RECT;

  const playerRow = new ElementStub('div');
  playerRow.setAttribute('data-testid', 'player-row');
  playerRow.rect = overrides.playerRect ?? PLAYER_RECT;

  const widget = new ElementStub('div');
  widget.setAttribute('data-testid', 'now-playing-widget');
  widget.rect = overrides.widgetRect ?? WIDGET_RECT;

  const controls = new ElementStub('div');
  controls.setAttribute('data-testid', 'player-controls');
  controls.rect = overrides.controlsRect ?? CONTROLS_RECT;

  const progress = new ElementStub('div');
  progress.setAttribute('data-testid', 'playback-progressbar');
  progress.rect = overrides.progressRect ?? PROGRESS_RECT;

  const durationClock = new ElementStub('span');
  durationClock.setAttribute('data-testid', 'playback-duration');
  durationClock.textContent = overrides.durationText ?? '10:00';
  durationClock.rect = { left: 910, top: 698, right: 960, bottom: 714, width: 50, height: 16 };

  const play = new ElementStub('button');
  play.setAttribute('data-testid', 'control-button-playpause');
  play.setAttribute('aria-label', 'Play');
  play.rect = { left: 520, top: 640, right: 560, bottom: 680, width: 40, height: 40 };

  const layout = overrides.layout ?? 'stacked';
  if (layout === 'stacked') {
    footer.rect = STACK_RECT;
    playerRow.appendChild(widget);
    playerRow.appendChild(controls);
    playerRow.appendChild(progress);
    controls.appendChild(play);
    footer.appendChild(promo);
    footer.appendChild(playerRow);
    documentElement.appendChild(footer);
  } else if (layout === 'flat-stack') {
    footer.rect = STACK_RECT;
    footer.appendChild(promo);
    footer.appendChild(widget);
    footer.appendChild(controls);
    footer.appendChild(progress);
    controls.appendChild(play);
    documentElement.appendChild(footer);
  } else if (layout === 'promo-only') {
    footer.rect = PROMO_RECT;
    footer.appendChild(promo);
    documentElement.appendChild(footer);
  } else if (layout === 'promo-as-bar') {
    footer.rect = PROMO_RECT;
    footer.textContent = 'Preview of Spotify. Sign up free';
    footer.appendChild(signup);
    documentElement.appendChild(footer);
  } else if (layout === 'player-only') {
    footer.rect = PLAYER_RECT;
    playerRow.appendChild(widget);
    playerRow.appendChild(controls);
    playerRow.appendChild(progress);
    controls.appendChild(play);
    footer.appendChild(playerRow);
    documentElement.appendChild(footer);
  } else if (layout === 'unlabeled-stack') {
    footer.rect = STACK_RECT;
    const unlabeled = new ElementStub('div');
    unlabeled.textContent = 'Create a free account';
    unlabeled.rect = PROMO_RECT;
    playerRow.appendChild(widget);
    playerRow.appendChild(controls);
    playerRow.appendChild(progress);
    controls.appendChild(play);
    footer.appendChild(unlabeled);
    footer.appendChild(playerRow);
    documentElement.appendChild(footer);
  }

  documentElement.appendChild(durationClock);

  const values = {
    location: { href: overrides.url ?? EPISODE },
    HTMLElement: ElementStub,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement,
      createElement: (tag) => new ElementStub(tag),
      getElementById: (id) => nodes.get(id) ?? documentElement.querySelector(`#${id}`),
      querySelector: (selector) => documentElement.querySelector(selector),
      querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    },
    window: {
      innerWidth: overrides.innerWidth ?? VIEW.innerWidth,
      innerHeight: overrides.innerHeight ?? VIEW.innerHeight,
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
      footer,
      promo,
      playerRow,
      controls,
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

function applySoft() {
  return applySpotifyHoverHighlightOnPage({
    expectedEpisodeId: EPISODE_ID,
    strength: 'soft',
    startMs: null,
    endMs: null,
  });
}

test('Spotify hover page helpers stay fail-closed on identity', () => {
  assert.equal(
    spotifyEpisodeIdFromHref('https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ?si=x'),
    '7makk4oTQel546B0P8lOOJ',
  );
  assert.equal(spotifyEpisodeIdFromHref('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'), null);
  assert.deepEqual(
    applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: 'not-an-id',
      strength: 'soft',
      startMs: null,
      endMs: null,
    }),
    { ok: false, reason: 'invalid-request' },
  );
});

test('hover outlines only the player row when Preview promo is stacked above it', () => {
  withPage(({ documentElement, promo, playerRow }) => {
    assert.equal(applySoft().ok, true);
    const root = documentElement.querySelector('#annotated-sp-hover-root');
    assert.ok(root);
    assert.equal(root.getAttribute('data-annotated-hover-surface'), 'player-bar');
    const ring = root.querySelector('[data-annotated-hover-ring="1"]');
    const box = parseBox(ring.style.cssText);
    assert.equal(box.left, PLAYER_RECT.left);
    assert.equal(box.top, PLAYER_RECT.top);
    assert.equal(box.width, PLAYER_RECT.width);
    assert.equal(box.height, PLAYER_RECT.height);
    assert.notEqual(box.top, STACK_RECT.top);
    assert.notEqual(box.height, STACK_RECT.height);
    assert.ok(box.top >= promo.rect.bottom - 1);
    assert.equal(box.top, playerRow.rect.top);
    const dim = root.querySelector('[data-annotated-hover-dim="1"]').style.cssText;
    assert.match(dim, new RegExp(`${PLAYER_RECT.left}px ${PLAYER_RECT.top}px`));
    assert.doesNotMatch(dim, new RegExp(`${STACK_RECT.left}px ${STACK_RECT.top}px, ${STACK_RECT.right}px ${STACK_RECT.top}px`));
    assert.match(ring.style.cssText, /rgba\(255, 184, 40/);
    assert.equal(playerRow.scrolls.length, 1);
    assert.equal(applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: EPISODE_ID,
      strength: 'strong',
      startMs: null,
      endMs: null,
    }).ok, true);
    assert.equal(playerRow.scrolls.length, 1);
  });
});

test('flat now-playing-bar children still clip the ring to the chrome band', () => {
  withPage(({ documentElement }) => {
    assert.equal(applySoft().ok, true);
    const box = parseBox(
      documentElement.querySelector('[data-annotated-hover-ring="1"]').style.cssText,
    );
    assert.equal(box.left, STACK_RECT.left);
    assert.equal(box.width, STACK_RECT.width);
    assert.ok(box.top >= 620);
    assert.ok(box.height <= 100);
    assert.ok(box.top + box.height <= STACK_RECT.bottom + 1);
    assert.ok(box.top > PROMO_RECT.top + 20);
  }, { layout: 'flat-stack' });
});

test('promo-only footer fails closed and does not outline Preview signup chrome', () => {
  withPage(({ documentElement }) => {
    assert.deepEqual(applySoft(), { ok: false, reason: 'player-unavailable' });
    assert.equal(documentElement.querySelector('#annotated-sp-hover-root'), null);
  }, { layout: 'promo-only' });
  withPage(({ documentElement }) => {
    assert.deepEqual(applySoft(), { ok: false, reason: 'player-unavailable' });
    assert.equal(documentElement.querySelector('#annotated-sp-hover-root'), null);
  }, { layout: 'promo-as-bar' });
});

test('logged-in player bar without promo still gets a tight now-playing outline', () => {
  withPage(({ documentElement }) => {
    assert.equal(applySoft().ok, true);
    const box = parseBox(
      documentElement.querySelector('[data-annotated-hover-ring="1"]').style.cssText,
    );
    assert.equal(box.left, PLAYER_RECT.left);
    assert.equal(box.top, PLAYER_RECT.top);
    assert.equal(box.width, PLAYER_RECT.width);
    assert.equal(box.height, PLAYER_RECT.height);
  }, { layout: 'player-only' });
});

test('unlabeled extra strip above player chrome is excluded from the amber hole', () => {
  withPage(({ documentElement }) => {
    assert.equal(applySoft().ok, true);
    const box = parseBox(
      documentElement.querySelector('[data-annotated-hover-ring="1"]').style.cssText,
    );
    assert.equal(box.top, PLAYER_RECT.top);
    assert.equal(box.height, PLAYER_RECT.height);
    assert.notEqual(box.top, STACK_RECT.top);
  }, { layout: 'unlabeled-stack' });
});

test('soft hover never seeks or plays and clear removes the overlay', () => {
  const source = applySpotifyHoverHighlightOnPage.toString();
  assert.match(source, /Real player chrome only/);
  assert.match(source, /PLAYER_CHROME_TESTIDS/);
  assert.doesNotMatch(source, /const selectors = \[\s*'\[data-testid="now-playing-bar"\]'/);
  assert.doesNotMatch(source, /\.play\s*\(/);
  assert.doesNotMatch(source, /currentTime\s*=/);
  assert.doesNotMatch(source, /\.click\s*\(/);
  withPage(({ documentElement }) => {
    assert.equal(applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: EPISODE_ID,
      strength: 'strong',
      startMs: 1_000,
      endMs: 4_000,
    }).ok, true);
    assert.ok(documentElement.querySelector('#annotated-sp-hover-root'));
    assert.deepEqual(clearSpotifyHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-sp-hover-root'), null);
  });
});

test('page injector fails closed off-source and when no player chrome is present', () => {
  withPage(() => {
    assert.deepEqual(applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: 'aaaaaaaaaaaaaaaaaaaaaa',
      strength: 'soft',
      startMs: null,
      endMs: null,
    }), { ok: false, reason: 'source-mismatch' });
  });
  withPage(() => {
    assert.deepEqual(applySoft(), { ok: false, reason: 'source-mismatch' });
  }, { url: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk' });
  withPage(({ documentElement }) => {
    documentElement.children.length = 0;
    assert.deepEqual(applySoft(), { ok: false, reason: 'player-unavailable' });
    assert.equal(documentElement.querySelector('#annotated-sp-hover-root'), null);
  });
});

test('serialized hover functions stay closure-free and do not throw', () => {
  const apply = Function(`return (${applySpotifyHoverHighlightOnPage.toString()})`)();
  const clear = Function(`return (${clearSpotifyHoverHighlightOnPage.toString()})`)();
  assert.doesNotMatch(applySpotifyHoverHighlightOnPage.toString(), /getSpotifyEpisodeIdentity|chrome\.|import /);
  withPage(() => {
    assert.equal(apply({
      expectedEpisodeId: EPISODE_ID,
      strength: 'soft',
      startMs: null,
      endMs: null,
    }).ok, true);
    assert.equal(clear().ok, true);
  });
  withPage(() => {
    assert.equal(apply(null).ok, false);
  });
  assert.equal(SPOTIFY_HOVER_ROOT_ID, 'annotated-sp-hover-root');
});

test('range strength paints the progress-bar cue without dimming the page', () => {
  withPage(({ documentElement }) => {
    const duration = documentElement.querySelector('[data-testid="playback-duration"]');
    duration.textContent = '1:40';
    assert.equal(applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: EPISODE_ID,
      strength: 'range',
      startMs: 10_000,
      endMs: 40_000,
    }).ok, true);
    const root = documentElement.querySelector('#annotated-sp-hover-root');
    assert.equal(root.dataset.strength, 'range');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /display:none/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /display:none/);
    const cue = parseBox(root.querySelector('[data-annotated-hover-range="1"]').style.cssText);
    assert.equal(cue.left, PROGRESS_RECT.left + PROGRESS_RECT.width * 0.1);
    assert.equal(cue.width, PROGRESS_RECT.width * 0.3);
    assert.equal(cue.top, PROGRESS_RECT.top);
  });
});
