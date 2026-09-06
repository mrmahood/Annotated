import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  actOnSpotifyPlayer,
  isSpotifyNowPlayingIdentity,
  normalizeSpotifyEpisodeTitle,
  validateSpotifyPageMetadata,
  validateSpotifyPlayerDiscovery,
  validateSpotifyPlayerState,
} from './spotify-page.ts';

const CANONICAL = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';

test('normalizes Spotify episode titles and rejects the bare player title', () => {
  assert.equal(normalizeSpotifyEpisodeTitle('The Daily | Spotify'), 'The Daily');
  assert.equal(normalizeSpotifyEpisodeTitle('Spotify'), '');
  assert.equal(normalizeSpotifyEpisodeTitle(null), '');
});

test('validates episode metadata against the connected URL and fail-closed blocks', () => {
  const metadata = validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: `${CANONICAL}?si=share`,
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'The Daily | Spotify',
    author: 'The New York Times',
    showName: 'The Daily',
    hostname: 'open.spotify.com',
    pageBlock: null,
  });
  assert.equal(metadata?.episodeId, '7makk4oTQel546B0P8lOOJ');
  assert.equal(metadata?.title, 'The Daily');
  assert.equal(metadata?.pageBlock, null);
  assert.equal(validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'Show',
    author: null,
    showName: null,
    hostname: 'open.spotify.com',
    pageBlock: null,
  }), null);
  assert.equal(validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: CANONICAL,
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'The Daily',
    author: null,
    showName: null,
    hostname: 'open.spotify.com',
    pageBlock: 'login',
  })?.pageBlock, 'login');
});

test('player discovery accepts one now-playing identity and rejects HTML5 audio ids', () => {
  const discovery = validateSpotifyPlayerDiscovery(CANONICAL, {
    pageUrl: CANONICAL,
    mode: 'audio',
    overflow: false,
    candidates: [{
      identity: 'spotify-now-playing:1:abcd1234',
      kind: 'audio',
      label: 'Spotify now playing',
      status: 'playing',
      currentTimeMs: 12_000,
      durationMs: 3_600_000,
    }],
  });
  assert.equal(discovery.status, 'ready');
  assert.equal(isSpotifyNowPlayingIdentity('spotify-now-playing:1:abcd1234'), true);
  assert.equal(isSpotifyNowPlayingIdentity('audio:1:abcd1234'), false);
  assert.equal(validateSpotifyPlayerDiscovery(CANONICAL, {
    pageUrl: CANONICAL,
    mode: 'audio',
    overflow: false,
    candidates: [{
      identity: 'audio:1:abcd1234',
      kind: 'audio',
      label: 'HTML5',
      status: 'ready',
      currentTimeMs: 0,
      durationMs: 1_000,
    }],
  }).status, 'none');
});

test('login-wall detection yields to a now-playing bar so logged-out previews stay capturable', async () => {
  const source = await readFile(new URL('./spotify-page.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(nowPlaying\) return false;/);
  assert.match(source, /Logged-out limited previews are a valid capture surface/);
  assert.match(source, /playback-progressbar/);
  assert.match(source, /seekNowPlaying/);
  assert.match(source, /assignRange/);
  assert.match(source, /_valueTracker/);
  assert.match(source, /searchParams\.set\('t'/);
});

test('Jump / play seeks the now-playing range input and fails closed without a slider', async () => {
  const episodeId = '6EMoFpxEsLelogfZz8eAC2';
  let hash = 0x811c9dc5;
  for (let index = 0; index < episodeId.length; index += 1) {
    hash ^= episodeId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const identity = `spotify-now-playing:1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  const names = ['location', 'document', 'window', 'HTMLElement', 'HTMLInputElement'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class FakeElement {
    constructor(text, label) {
      this.textContent = text ?? '';
      this.label = label ?? '';
    }
    getAttribute(name) { return name === 'aria-label' ? this.label : null; }
    getBoundingClientRect() {
      return { x: 0, y: 640, width: 1280, height: 80, top: 640, right: 1280, bottom: 720, left: 0 };
    }
    click() { this.clicked = true; }
    querySelector(selector) { return selector.includes('input') ? slider : null; }
  }
  class FakeInput {
    constructor() {
      this.min = '0';
      this.max = '3606000';
      this.type = 'range';
      this.value = '57000';
    }
    dispatchEvent(event) {
      if (event.type === 'input' || event.type === 'change') {
        const seconds = Math.round(Number(this.value) / 1_000);
        const minutes = Math.floor(seconds / 60);
        position.textContent = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return true;
    }
  }
  const position = new FakeElement('0:57');
  const duration = new FakeElement('1:00:06');
  const playButton = new FakeElement('', 'Pause');
  const progress = new FakeElement();
  const slider = new FakeInput();
  const values = {
    location: { href: `https://open.spotify.com/episode/${episodeId}` },
    document: {
      querySelector(selector) {
        if (selector.includes('playback-position')) return position;
        if (selector.includes('playback-duration')) return duration;
        if (selector.includes('control-button-playpause')) return playButton;
        if (selector.includes('playback-progressbar') && selector.includes('input')) return slider;
        if (selector.includes('playback-progressbar')) return progress;
        return null;
      },
      elementFromPoint() { return progress; },
    },
    window: { setTimeout, innerWidth: 1280, innerHeight: 720 },
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    const jumped = await actOnSpotifyPlayer(identity, episodeId, 'play', 8);
    assert.equal(jumped.ok, true);
    assert.equal(jumped.currentTimeMs, 8_000);
    document.querySelector = (selector) => {
      if (selector.includes('playback-position')) return position;
      if (selector.includes('playback-duration')) return duration;
      if (selector.includes('control-button-playpause')) return playButton;
      return null;
    };
    position.textContent = '0:57';
    const stuck = await actOnSpotifyPlayer(identity, episodeId, 'play', 8);
    assert.equal(stuck.ok, false);
    assert.equal(stuck.reason, 'playback-failed');
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('Jump seeks a logged-out preview-window slider from 5:59 to 5:00', async () => {
  const episodeId = '6EMoFpxEsLelogfZz8eAC2';
  let hash = 0x811c9dc5;
  for (let index = 0; index < episodeId.length; index += 1) {
    hash ^= episodeId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const identity = `spotify-now-playing:1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  const names = ['location', 'document', 'window', 'HTMLElement', 'HTMLInputElement'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class FakeElement {
    constructor(text, label) {
      this.textContent = text ?? '';
      this.label = label ?? '';
    }
    getAttribute(name) { return name === 'aria-label' ? this.label : null; }
    getBoundingClientRect() {
      return { x: 0, y: 640, width: 1280, height: 80, top: 640, right: 1280, bottom: 720, left: 0 };
    }
    click() { this.clicked = true; }
    querySelector(selector) { return selector.includes('input') ? slider : null; }
  }
  class FakeInput {
    constructor() {
      this.min = '0';
      this.max = '90000';
      this.type = 'range';
      this.value = '59000';
    }
    dispatchEvent(event) {
      if (event.type === 'input' || event.type === 'change') {
        const seconds = 300 + Math.round(Number(this.value) / 1_000);
        const minutes = Math.floor(seconds / 60);
        position.textContent = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return true;
    }
  }
  const position = new FakeElement('5:59');
  const duration = new FakeElement('1:00:06');
  const playButton = new FakeElement('', 'Pause');
  const progress = new FakeElement();
  const slider = new FakeInput();
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: `https://open.spotify.com/episode/${episodeId}` } });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelector(selector) {
          if (selector.includes('playback-position')) return position;
          if (selector.includes('playback-duration')) return duration;
          if (selector.includes('control-button-playpause')) return playButton;
          if (selector.includes('playback-progressbar') && selector.includes('input')) return slider;
          if (selector.includes('playback-progressbar')) return progress;
          return null;
        },
        elementFromPoint() { return progress; },
      },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, innerWidth: 1280, innerHeight: 720 } });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement });
    Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: FakeInput });
    const jumped = await actOnSpotifyPlayer(identity, episodeId, 'play', 300);
    assert.equal(jumped.ok, true);
    assert.equal(jumped.currentTimeMs, 300_000);
    assert.equal(slider.value, '0');
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('player state fails closed on unreadable or inverted times', () => {
  assert.deepEqual(validateSpotifyPlayerState({
    currentTime: 12.4, duration: 90, paused: false,
  }), { currentTime: 12.4, duration: 90, paused: false });
  assert.equal(validateSpotifyPlayerState({
    currentTime: 100, duration: 10, paused: true,
  }), null);
  assert.equal(validateSpotifyPlayerState({ currentTime: Number.NaN, paused: true }), null);
});
