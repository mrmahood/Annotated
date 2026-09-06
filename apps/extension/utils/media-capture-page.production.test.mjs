import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finishMediaCaptureOnPage,
  playMediaForCaptureOnPage,
  prepareMediaCaptureOnPage,
  readTopFramePreparationResult,
} from './media-capture-page.ts';

const pageUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
const source = { kind: 'youtube', pageUrl, sourceKey: 'abcdefghijk', playerIdentity: 'video:1:f8443fef' };

async function withFakeVideo(callback, overrides = {}) {
  const names = ['location','document','window','HTMLMediaElement','HTMLAudioElement','HTMLVideoElement','getComputedStyle'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class Media {}
  class Audio extends Media {}
  class Video extends Media {
    constructor() {
      super();
      this.currentTime = overrides.currentTime ?? 5;
      this.duration = overrides.duration ?? 120;
      this.readyState = overrides.readyState ?? 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.paused = false;
      this.ended = false;
      this.currentSrc = 'blob:test';
    }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    addEventListener(_name, fn) {
      queueMicrotask(() => {
        if (overrides.navigateOnSeek) values.location.href = overrides.navigateOnSeek;
        fn();
      });
    }
    removeEventListener() {}
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 };
    }
    getClientRects() { return [{}]; }
  }
  const video = overrides.noPlayer ? null : new Video();
  const inlinePreview = overrides.inlinePreview ? new Video() : null;
  if (inlinePreview) inlinePreview.currentSrc = 'blob:inline-preview';
  const players = [video, inlinePreview].filter(Boolean);
  const values = {
    location: { href: overrides.url ?? pageUrl },
    document: {
      querySelector: () => video,
      querySelectorAll: () => players,
      elementsFromPoint: () => video ? [video] : [],
      fullscreenElement: null,
    },
    window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0, setTimeout },
    HTMLAudioElement: Audio,
    HTMLMediaElement: Media,
    HTMLVideoElement: Video,
    getComputedStyle: () => ({
      objectFit: 'contain', objectPosition: '50% 50%',
      display: 'block', visibility: 'visible', opacity: '1',
    }),
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return await callback();
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('prepares only the selected range and seeks the top-level player', async () => {
  const result = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 10_000, endMs: 25_000,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.prepared.requestedDurationMs, 15_000);
  assert.equal(result.prepared.playerCurrentTimeBeforeRecordingMs, 10_000);
  assert.equal(result.prepared.geometry.videoWidth, 1920);
});

test('serialized injected function is closure-free, awaited, and serializable', async () => {
  const injected = Function(`return (${prepareMediaCaptureOnPage.toString()})`)();
  const result = await withFakeVideo(() => injected({
    source, startMs: 10_000, endMs: 25_000,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.prepared.playerCurrentTimeBeforeRecordingMs, 10_000);
  assert.doesNotThrow(() => structuredClone(result));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('hidden YouTube inline preview cannot displace the selected player during capture actions', async () => {
  await withFakeVideo(async () => {
    const prepared = await prepareMediaCaptureOnPage({ source, startMs: 5_000, endMs: 20_000 });
    assert.equal(prepared.ok, true);
    assert.equal((await playMediaForCaptureOnPage(source, 5_000)).ok, true);
    assert.equal(finishMediaCaptureOnPage(source, true).sourceMatches, true);
  }, { inlinePreview: true });
});

test('selects frameId 0 and distinguishes missing from malformed results', async () => {
  const success = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 0, endMs: 1_000,
  }));
  assert.equal(readTopFramePreparationResult([
    { frameId: 7, result: { ok: false, code: 'PLAYER_NOT_FOUND', message: 'iframe' } },
    { frameId: 0, result: success },
  ]).ok, true);
  assert.equal(readTopFramePreparationResult([]).code, 'PREPARATION_RESULT_MISSING');
  assert.equal(readTopFramePreparationResult([{ frameId: 0, result: { ok: true } }]).code, 'PREPARATION_RESULT_INVALID');
  assert.equal(readTopFramePreparationResult([{ frameId: 1, result: success }]).code, 'PREPARATION_RESULT_MISSING');
});

test('rejects a changed source and unavailable player', async () => {
  const changed = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 0, endMs: 1_000,
  }), { url: 'https://www.youtube.com/watch?v=otherother1' });
  assert.equal(changed.code, 'SOURCE_CHANGED');
  const missing = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 0, endMs: 1_000,
  }), { noPlayer: true });
  assert.equal(missing.code, 'PLAYER_NOT_FOUND');
  const replaced = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source: { ...source, playerIdentity: 'video:1:ffffffff' }, startMs: 0, endMs: 1_000,
  }));
  assert.equal(replaced.code, 'PLAYER_NOT_FOUND');
});

test('reports player readiness, navigation, and exact range boundaries', async () => {
  const notReady = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 0, endMs: 1_000,
  }), { currentTime: Number.NaN, duration: Number.NaN, readyState: 0 });
  assert.equal(notReady.code, 'PLAYER_NOT_READY');
  const navigated = await withFakeVideo(() => prepareMediaCaptureOnPage({
    source, startMs: 10_000, endMs: 11_000,
  }), { navigateOnSeek: 'https://www.youtube.com/watch?v=otherother1' });
  assert.equal(navigated.code, 'NAVIGATION_CHANGED');
  for (const [startMs, endMs] of [[0, 1_000], [0, 90_000]]) {
    assert.equal((await withFakeVideo(() => prepareMediaCaptureOnPage({ source, startMs, endMs }), { duration: 120 })).ok, true);
  }
  for (const [startMs, endMs] of [[0, 999], [0, 90_001]]) {
    assert.equal((await withFakeVideo(() => prepareMediaCaptureOnPage({ source, startMs, endMs }), { duration: 120 })).code, 'RANGE_INVALID');
  }
});

const spotifyUrl = 'https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2';
const spotifySource = {
  kind: 'spotify',
  pageUrl: spotifyUrl,
  sourceKey: '6EMoFpxEsLelogfZz8eAC2',
  playerIdentity: 'spotify-now-playing:1:abcd1234',
};

async function withFakeSpotify(callback, overrides = {}) {
  const names = ['location', 'document', 'window', 'HTMLElement'];
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
  }
  const bar = new FakeElement();
  const position = new FakeElement(overrides.position ?? '0:08');
  const duration = new FakeElement(overrides.duration ?? '1:00:06');
  const playButton = new FakeElement('', overrides.playLabel ?? 'Pause');
  const nodes = {
    'now-playing-bar': bar,
    'playback-position': position,
    'playback-duration': duration,
    'control-button-playpause': playButton,
  };
  const values = {
    location: { href: overrides.url ?? spotifyUrl },
    document: {
      querySelector(selector) {
        if (selector.includes('now-playing-bar')) return bar;
        if (selector.includes('playback-position')) return position;
        if (selector.includes('playback-duration')) return duration;
        if (selector.includes('control-button-playpause')) return playButton;
        return nodes[selector] ?? null;
      },
    },
    window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    HTMLElement: FakeElement,
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return await callback({ playButton });
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('Spotify prepare uses now-playing clocks and keeps the 2s start gate', async () => {
  const prepared = await withFakeSpotify(() => prepareMediaCaptureOnPage({
    source: spotifySource, startMs: 8_000, endMs: 90_000,
  }));
  assert.equal(prepared.ok, true);
  assert.equal(prepared.prepared.sourceKind, 'spotify');
  assert.equal(prepared.prepared.playerCurrentTimeBeforeRecordingMs, 8_000);
  assert.equal(prepared.prepared.mediaDurationMs, 3_606_000);
  const offStart = await withFakeSpotify(() => prepareMediaCaptureOnPage({
    source: spotifySource, startMs: 8_000, endMs: 90_000,
  }), { position: '0:57' });
  assert.equal(offStart.ok, false);
  assert.equal(offStart.code, 'PLAYER_NOT_READY');
  assert.match(offStart.message, /Seek the Spotify player to the clip start/);
  const unreadable = await withFakeSpotify(() => prepareMediaCaptureOnPage({
    source: spotifySource, startMs: 8_000, endMs: 90_000,
  }), { position: '' });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.code, 'PLAYER_NOT_READY');
  assert.match(unreadable.message, /now-playing time could not be read/);
});

test('Spotify play acknowledgement stays on the now-playing path', async () => {
  await withFakeSpotify(async ({ playButton }) => {
    const playback = await playMediaForCaptureOnPage(spotifySource, 8_000);
    assert.equal(playback.ok, true);
    assert.equal(playback.currentTimeMs, 8_000);
    assert.equal(playButton.clicked, undefined);
    const finished = finishMediaCaptureOnPage(spotifySource, true);
    assert.equal(finished.sourceMatches, true);
    assert.equal(finished.currentTimeMs, 8_000);
    assert.equal(playButton.clicked, true);
  });
  const tooFar = await withFakeSpotify(() => playMediaForCaptureOnPage(spotifySource, 8_000), {
    position: '0:57',
  });
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.message, 'playback-failed');
});
