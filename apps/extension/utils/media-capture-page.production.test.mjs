import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  }
  const video = overrides.noPlayer ? null : new Video();
  const values = {
    location: { href: overrides.url ?? pageUrl },
    document: { querySelector: () => video, querySelectorAll: () => video ? [video] : [], fullscreenElement: null },
    window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0, setTimeout },
    HTMLAudioElement: Audio,
    HTMLMediaElement: Media,
    HTMLVideoElement: Video,
    getComputedStyle: () => ({ objectFit: 'contain', objectPosition: '50% 50%' }),
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
