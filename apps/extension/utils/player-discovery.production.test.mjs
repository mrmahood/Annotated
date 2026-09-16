import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actOnTopFramePlayer,
  readTopFramePlayerDiscovery,
} from './player-discovery.ts';

const pageUrl = 'https://www.youtube.com/watch?v=abcdefghijk';

async function withPlayers(players, callback, url = pageUrl, moviePlayer = null) {
  const names = [
    'location', 'document', 'window', 'HTMLMediaElement', 'HTMLAudioElement', 'HTMLVideoElement', 'getComputedStyle',
  ];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class Media {
    constructor(source, label) {
      this.currentSrc = source;
      this.currentTime = 5;
      this.duration = 120;
      this.readyState = 4;
      this.paused = true;
      this.ended = false;
      this.controls = true;
      this.label = label;
    }
    getAttribute(name) { return name === 'aria-label' ? this.label : null; }
    querySelector() { return null; }
    closest() { return null; }
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0 };
    }
    getClientRects() { return [{}]; }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    addEventListener(name, listener) {
      this.listeners ??= {};
      (this.listeners[name] ??= []).push(listener);
    }
    removeEventListener(name, listener) {
      if (!this.listeners?.[name]) return;
      this.listeners[name] = this.listeners[name].filter((entry) => entry !== listener);
    }
  }
  class Audio extends Media {}
  class Video extends Media {
    constructor(source, label, width = 1280, height = 720) {
      super(source, label); this.videoWidth = width; this.videoHeight = height;
    }
  }
  const instances = players.map((player) => player.kind === 'audio'
    ? new Audio(player.source, player.label)
    : new Video(player.source, player.label, player.width, player.height));
  const values = {
    location: { href: url },
    document: {
      querySelector: (selector) => {
        if (selector === '#movie_player' || selector === '.html5-video-player') {
          return moviePlayer;
        }
        return null;
      },
      querySelectorAll: () => instances,
      elementsFromPoint: () => instances.filter((instance) => instance.exposed !== false),
    },
    window: { innerWidth: 1280, innerHeight: 720 },
    HTMLMediaElement: Media,
    HTMLAudioElement: Audio,
    HTMLVideoElement: Video,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return await callback(instances);
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('serialized discovery is closure-free, ordered, bounded, and exposes no source URLs', async () => {
  const injected = Function(`return (${readTopFramePlayerDiscovery.toString()})`)();
  await withPlayers([
    { kind: 'video', source: 'blob:first-secret', label: 'Main video' },
    { kind: 'video', source: 'blob:second-secret', label: 'Preview video' },
  ], async () => {
    const result = injected('video');
    assert.equal(result.overflow, false);
    assert.deepEqual(result.candidates.map((candidate) => candidate.label), ['Main video', 'Preview video']);
    assert.equal(JSON.stringify(result).includes('blob:'), false);
  });
  await withPlayers(Array.from({ length: 20 }, (_, index) => ({
    kind: 'video', source: `blob:${index}`, label: `Video ${index + 1}`,
  })), async (instances) => {
    let sourceReads = 0;
    for (const [index, instance] of instances.entries()) {
      Object.defineProperty(instance, 'currentSrc', {
        configurable: true,
        get() { sourceReads += 1; return `blob:${index}`; },
      });
    }
    const result = injected('video');
    assert.deepEqual(result.candidates, []);
    assert.equal(result.overflow, true);
    assert.equal(sourceReads, 6);
  });
});

test('action-time revalidation rejects source, fingerprint, and ordinal changes', async () => {
  const discover = Function(`return (${readTopFramePlayerDiscovery.toString()})`)();
  const act = Function(`return (${actOnTopFramePlayer.toString()})`)();
  await withPlayers([
    { kind: 'video', source: 'blob:first', label: 'First' },
    { kind: 'video', source: 'blob:second', label: 'Second' },
  ], async (instances) => {
    const identity = discover('video').candidates[1].identity;
    assert.equal((await act('video', identity, 'abcdefghijk', 'read', null)).ok, true);
    instances[1].currentSrc = 'blob:replaced';
    assert.deepEqual(await act('video', identity, 'abcdefghijk', 'read', null), {
      ok: false, reason: 'player-mismatch',
    });
    instances[1].currentSrc = 'blob:second';
    instances.reverse();
    assert.deepEqual(await act('video', identity, 'abcdefghijk', 'read', null), {
      ok: false, reason: 'player-mismatch',
    });
    assert.deepEqual(await act('video', discover('video').candidates[0].identity, 'other-video', 'read', null), {
      ok: false, reason: 'source-mismatch',
    });
  });
});

test('YouTube inline-preview video hidden behind the main player is never a candidate', async () => {
  const act = Function(`return (${actOnTopFramePlayer.toString()})`)();
  await withPlayers([
    { kind: 'video', source: 'blob:main', label: 'YouTube Video Player' },
    { kind: 'video', source: 'blob:inline-preview', label: 'YouTube Video Player' },
  ], async (instances) => {
    instances[1].exposed = false;
    const discovery = readTopFramePlayerDiscovery('video');
    assert.equal(discovery.candidates.length, 1);
    assert.equal(discovery.candidates[0].label, 'YouTube Video Player');
    assert.equal((await act('video', discovery.candidates[0].identity, 'abcdefghijk', 'read', null)).ok, true);
  });
});

test('hidden paused audio-only video is excluded from discovery', async () => {
  await withPlayers([
    { kind: 'video', source: 'blob:hidden-audio', label: 'Hidden vendor media', width: 0, height: 0 },
  ], async (instances) => {
    instances[0].controls = false;
    instances[0].getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(readTopFramePlayerDiscovery('audio').candidates, []);
  }, 'https://www.foxnews.com/us/article');
});

test('preview plays the selected range and pauses at the end', async () => {
  const discover = Function(`return (${readTopFramePlayerDiscovery.toString()})`)();
  const act = Function(`return (${actOnTopFramePlayer.toString()})`)();
  await withPlayers([
    { kind: 'video', source: 'blob:main', label: 'YouTube Video Player' },
  ], async (instances) => {
    const identity = discover('video').candidates[0].identity;
    const video = instances[0];
    const started = await act('video', identity, 'abcdefghijk', 'preview', 5, false, 8);
    assert.equal(started.ok, true);
    assert.equal(video.paused, false);
    assert.equal(video.currentTime, 5);
    video.currentTime = 7.96;
    for (const listener of video.listeners.timeupdate ?? []) listener();
    assert.equal(video.paused, true);
    assert.equal((video.listeners.timeupdate ?? []).length, 0);
  });
});

test('preview stop-at-end watcher releases if the user pauses earlier', async () => {
  const discover = Function(`return (${readTopFramePlayerDiscovery.toString()})`)();
  const act = Function(`return (${actOnTopFramePlayer.toString()})`)();
  await withPlayers([
    { kind: 'video', source: 'blob:main', label: 'YouTube Video Player' },
  ], async (instances) => {
    const identity = discover('video').candidates[0].identity;
    const video = instances[0];
    const started = await act('video', identity, 'abcdefghijk', 'preview', 5, false, 8);
    assert.equal(started.ok, true);
    video.currentTime = 6;
    video.paused = true;
    for (const listener of [...(video.listeners.pause ?? [])]) listener();
    assert.equal((video.listeners.timeupdate ?? []).length, 0);
    video.paused = false;
    video.currentTime = 9;
    for (const listener of video.listeners.timeupdate ?? []) listener();
    assert.equal(video.paused, false);
  });
});

test('YouTube linear ads are reported and block play and preview seeks', async () => {
  const discover = Function(`return (${readTopFramePlayerDiscovery.toString()})`)();
  const act = Function(`return (${actOnTopFramePlayer.toString()})`)();
  const moviePlayer = {
    className: 'html5-video-player ad-showing',
    classList: {
      contains: (name) => name === 'ad-showing' || name === 'ad-interrupting',
      value: 'html5-video-player ad-showing',
    },
    querySelector: () => null,
  };
  await withPlayers([
    { kind: 'video', source: 'blob:main', label: 'YouTube Video Player' },
  ], async (instances) => {
    const discovery = discover('video');
    assert.equal(discovery.adShowing, true);
    const identity = discovery.candidates[0].identity;
    assert.deepEqual(await act('video', identity, 'abcdefghijk', 'read', null), {
      ok: true,
      identity,
      currentTimeMs: 5_000,
      durationMs: 120_000,
      adShowing: true,
    });
    assert.deepEqual(await act('video', identity, 'abcdefghijk', 'play', 5), {
      ok: false, reason: 'ad-showing',
    });
    assert.deepEqual(await act('video', identity, 'abcdefghijk', 'preview', 5, false, 8), {
      ok: false, reason: 'ad-showing',
    });
    assert.equal(instances[0].currentTime, 5);
  }, pageUrl, moviePlayer);
});
