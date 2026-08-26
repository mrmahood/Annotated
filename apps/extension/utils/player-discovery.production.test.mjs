import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actOnTopFramePlayer,
  readTopFramePlayerDiscovery,
} from './player-discovery.ts';

const pageUrl = 'https://www.youtube.com/watch?v=abcdefghijk';

async function withPlayers(players, callback, url = pageUrl) {
  const names = [
    'location', 'document', 'HTMLMediaElement', 'HTMLAudioElement', 'HTMLVideoElement', 'getComputedStyle',
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
    getBoundingClientRect() { return { width: 640, height: 360 }; }
    getClientRects() { return [{}]; }
    async play() { this.paused = false; }
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
    document: { querySelectorAll: () => instances },
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

test('hidden paused audio-only video is excluded from discovery', async () => {
  await withPlayers([
    { kind: 'video', source: 'blob:hidden-audio', label: 'Hidden vendor media', width: 0, height: 0 },
  ], async (instances) => {
    instances[0].controls = false;
    instances[0].getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(readTopFramePlayerDiscovery('audio').candidates, []);
  }, 'https://www.foxnews.com/us/article');
});
