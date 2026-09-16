import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actOnTopFramePlayer,
  playerDiscoveryMakesModeAvailable,
  readTopFramePlayerDiscovery,
  validatePlayerDiscovery,
} from './player-discovery.ts';
import {
  finishMediaCaptureOnPage,
  playMediaForCaptureOnPage,
  prepareMediaCaptureOnPage,
} from './media-capture-page.ts';

const pageUrl = 'https://www.foxnews.com/politics/example-story?utm_source=test#video';
const sourceKey = 'https://www.foxnews.com/politics/example-story';

async function withGenericPage(setup, callback) {
  const names = ['location', 'document', 'window', 'HTMLMediaElement', 'HTMLAudioElement', 'HTMLVideoElement', 'getComputedStyle'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

  class Media {
    constructor(source, rect, label = 'News video') {
      this.currentSrc = source; this.currentTime = 3; this.duration = 120; this.readyState = 4;
      this.paused = true; this.ended = false; this.controls = true; this.label = label;
      this.rect = rect; this.mediaKeys = null; this.webkitKeys = null; this.srcObject = null;
      this.style = { display: 'block', visibility: 'visible', opacity: '1', transform: 'none',
        objectFit: 'contain', objectPosition: '50% 50%' };
    }
    getAttribute(name) { return name === 'aria-label' ? this.label : null; }
    querySelector() { return null; }
    closest() { return null; }
    getBoundingClientRect() { return this.rect; }
    getClientRects() { return this.exposed === false ? [] : [{}]; }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    addEventListener(_name, listener) { queueMicrotask(listener); }
    removeEventListener() {}
  }
  class Audio extends Media {
    constructor(...args) { super(...args); this.localName = 'audio'; }
  }
  class Video extends Media {
    constructor(source, rect, label) {
      super(source, rect, label); this.localName = 'video'; this.videoWidth = 1280; this.videoHeight = 720;
    }
  }
  const foreignVideoPrototype = Object.create(null);
  Object.defineProperties(foreignVideoPrototype, Object.getOwnPropertyDescriptors(Media.prototype));
  const rect = (left, top, width, height) => ({ x: left, y: top, width, height,
    left, top, right: left + width, bottom: top + height });
  const styleFor = (element) => ({ borderLeftWidth: '0px', borderRightWidth: '0px',
    borderTopWidth: '0px', borderBottomWidth: '0px', ...element.style });
  const makeDocument = (origin, width, height) => {
    const doc = {
      videos: [], audios: [], frames: [], fullscreenElement: null,
      querySelectorAll(selector) {
        if (selector === 'video') return this.videos;
        if (selector === 'audio, video') return [...this.audios, ...this.videos];
        if (selector === 'iframe, frame') return this.frames;
        return [];
      },
      elementsFromPoint(x) { return [...this.frames, ...this.videos, ...this.audios].filter((entry) =>
        entry.exposed !== false && !(entry.clipped && x < entry.rect.left + entry.rect.width / 3)); },
    };
    const win = { innerWidth: width, innerHeight: height, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
      location: { origin }, setTimeout, getComputedStyle: styleFor };
    doc.defaultView = win;
    return { doc, win };
  };
  const top = makeDocument('https://www.foxnews.com', 1280, 720);
  const helpers = {
    rect,
    top,
    addVideo(target, source = 'blob:ephemeral-secret', videoRect = rect(0, 0, target.win.innerWidth, target.win.innerHeight), label) {
      const video = new Video(source, videoRect, label);
      if (target !== top) Object.setPrototypeOf(video, foreignVideoPrototype);
      video.ownerDocument = target.doc; target.doc.videos.push(video); return video;
    },
    addAudio(target, source = 'https://media.example/audio.mp3') {
      const audio = new Audio(source, rect(0, 0, 0, 0), 'Hidden audio'); audio.ownerDocument = target.doc; target.doc.audios.push(audio); return audio;
    },
    addFrame(parent, child, frameRect, { crossOrigin = false, transformed = false, clipped = false } = {}) {
      const frame = { rect: frameRect, exposed: true, clipped,
        style: { display: 'block', visibility: 'visible', opacity: '1', transform: transformed ? 'matrix(1,0,0,1,0,0)' : 'none' },
        getBoundingClientRect() { return this.rect; } };
      if (crossOrigin) {
        Object.defineProperty(frame, 'contentWindow', { get() { throw new Error('cross-origin'); } });
        Object.defineProperty(frame, 'contentDocument', { get() { throw new Error('cross-origin'); } });
      } else { frame.contentWindow = child.win; frame.contentDocument = child.doc; }
      parent.doc.frames.push(frame); return frame;
    },
    makeDocument,
  };
  setup(helpers);
  try {
    Object.defineProperties(globalThis, {
      location: { configurable: true, value: { href: pageUrl } },
      document: { configurable: true, value: top.doc },
      window: { configurable: true, value: top.win },
      HTMLMediaElement: { configurable: true, value: Media },
      HTMLAudioElement: { configurable: true, value: Audio },
      HTMLVideoElement: { configurable: true, value: Video },
      getComputedStyle: { configurable: true, value: styleFor },
    });
    return await callback(helpers);
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
}

test('Fox-shaped page exposes visible video, ignores hidden audio, and leaks no delivery URL', async () => {
  await withGenericPage(({ top, addVideo, addAudio, rect }) => {
    const advertisingVideo = addVideo(top, 'blob:transient-ad', rect(50, 20, 960, 540), 'Advertisement');
    advertisingVideo.parentElement = {
      id: 'preroll-ad-container', className: 'vpaid-player advertisement', parentElement: null,
      getAttribute() { return null; },
    };
    addVideo(top, 'blob:fox-signed-secret', rect(50, 20, 960, 540), 'Fox News video');
    const audio = addAudio(top); audio.controls = false; audio.exposed = false;
  }, async () => {
    const raw = readTopFramePlayerDiscovery('video', true);
    const discovery = validatePlayerDiscovery(pageUrl, 'video', raw, true);
    assert.equal(discovery.status, 'ready');
    assert.equal(discovery.candidates.length, 1);
    assert.match(discovery.candidates[0].identity, /^web-video:top:1:[0-9a-f]{8}$/);
    assert.equal(JSON.stringify(raw).includes('blob:'), false);
    assert.equal((await actOnTopFramePlayer('video', discovery.candidates[0].identity, sourceKey, 'read', null, true)).ok, true);
    const source = { kind: 'web-video', pageUrl, sourceKey, playerIdentity: discovery.candidates[0].identity };
    assert.equal((await prepareMediaCaptureOnPage({ source, startMs: 2_000, endMs: 8_000 })).ok, true);
    assert.equal((await playMediaForCaptureOnPage(source, 2_000)).ok, true);
    assert.equal(finishMediaCaptureOnPage(source, true).sourceMatches, true);
  });
});

test('a visible advertising or preroll element never becomes generic Video by itself', async () => {
  await withGenericPage(({ top, addVideo, rect }) => {
    const advertisingVideo = addVideo(top, 'blob:transient-ad', rect(50, 20, 960, 540), 'Advertisement');
    advertisingVideo.parentElement = {
      id: 'media-ad-slot', className: 'sponsored vpaid-player', parentElement: null,
      getAttribute() { return null; },
    };
  }, async () => {
    const discovery = validatePlayerDiscovery(pageUrl, 'video', readTopFramePlayerDiscovery('video', true), true);
    assert.deepEqual(discovery, { status: 'none', candidates: [], adShowing: false });
  });
});

test('same-origin frame identity maps capture geometry into the top viewport and revalidates at finish', async () => {
  await withGenericPage(({ top, makeDocument, addFrame, addVideo, rect }) => {
    const child = makeDocument('https://www.foxnews.com', 640, 360);
    addFrame(top, child, rect(100, 50, 640, 360));
    addVideo(child, 'https://media.foxnews.com/tokenized/video.m3u8', rect(10, 20, 620, 320), 'Article video');
  }, async () => {
    const candidate = readTopFramePlayerDiscovery('video', true).candidates[0];
    assert.match(candidate.identity, /^web-video:1:1:[0-9a-f]{8}$/);
    const source = { kind: 'web-video', pageUrl, sourceKey, playerIdentity: candidate.identity };
    const prepared = await prepareMediaCaptureOnPage({ source, startMs: 2_000, endMs: 8_000 });
    assert.equal(prepared.ok, true);
    assert.deepEqual(prepared.prepared.geometry.boundingClientRect, {
      x: 110, y: 70, width: 620, height: 320, top: 70, right: 730, bottom: 390, left: 110,
    });
    assert.equal(prepared.prepared.geometry.frameMapping.path, '1');
    const finished = finishMediaCaptureOnPage(source, true);
    assert.equal(finished.sourceMatches, true);
    assert.deepEqual(finished.geometry.boundingClientRect, prepared.prepared.geometry.boundingClientRect);
    assert.equal(finished.geometry.frameMapping.origin, 'https://www.foxnews.com');
  });
});

test('cross-origin, transformed-frame, DRM, hidden, and canvas-only cases fail closed', async () => {
  await withGenericPage(({ top, makeDocument, addFrame, addVideo, rect }) => {
    const cross = makeDocument('https://vendor.example', 640, 360);
    addVideo(cross); addFrame(top, cross, rect(0, 0, 640, 360), { crossOrigin: true });
    const transformed = makeDocument('https://www.foxnews.com', 640, 360);
    addVideo(transformed); addFrame(top, transformed, rect(0, 360, 640, 360), { transformed: true });
    const clipped = makeDocument('https://www.foxnews.com', 320, 180);
    addVideo(clipped); addFrame(top, clipped, rect(640, 0, 320, 180), { clipped: true });
    const drm = addVideo(top, 'blob:drm', rect(0, 0, 320, 180)); drm.mediaKeys = {};
    const hidden = addVideo(top, 'blob:hidden', rect(0, 0, 320, 180)); hidden.exposed = false;
    addVideo(top, 'blob:partial', rect(-2, 0, 320, 180));
    addVideo(top, 'javascript:unsafe', rect(0, 0, 320, 180));
    top.doc.canvas = {}; // Canvas-only renderers are never queried as candidates.
  }, async () => {
    assert.deepEqual(readTopFramePlayerDiscovery('video', true).candidates, []);
  });
});

test('frame reorder, source replacement, and more than five candidates invalidate selection', async () => {
  await withGenericPage(({ top, makeDocument, addFrame, addVideo, rect }) => {
    const first = makeDocument('https://www.foxnews.com', 320, 180);
    const second = makeDocument('https://www.foxnews.com', 320, 180);
    addFrame(top, first, rect(0, 0, 320, 180)); addFrame(top, second, rect(320, 0, 320, 180));
    addVideo(first, 'blob:first'); addVideo(second, 'blob:second');
  }, async ({ top, addVideo, rect }) => {
    const discovery = readTopFramePlayerDiscovery('video', true);
    const identity = discovery.candidates[1].identity;
    const selected = top.doc.frames[1].contentDocument.videos[0];
    selected.currentSrc = 'blob:replaced';
    assert.deepEqual(await actOnTopFramePlayer('video', identity, sourceKey, 'read', null, true), {
      ok: false, reason: 'player-mismatch',
    });
    selected.currentSrc = 'blob:second';
    top.doc.frames.reverse();
    assert.deepEqual(await actOnTopFramePlayer('video', identity, sourceKey, 'read', null, true), {
      ok: false, reason: 'player-mismatch',
    });
    top.doc.frames.length = 0; top.doc.videos.length = 0;
    for (let index = 0; index < 6; index += 1) addVideo(top, `blob:${index}`, rect(index * 10, 0, 100, 100));
    const overflow = validatePlayerDiscovery(pageUrl, 'video', readTopFramePlayerDiscovery('video', true), true);
    assert.equal(overflow.status, 'overflow');
    assert.equal(playerDiscoveryMakesModeAvailable(overflow), true);
  });
});

test('only ready and overflow discovery make generic Video available', () => {
  assert.equal(playerDiscoveryMakesModeAvailable({ status: 'ready', candidates: [{
    identity: 'web-video:top:1:12345678', kind: 'video', label: 'Video', status: 'ready',
    currentTimeMs: 0, durationMs: 10_000,
  }] }), true);
  assert.equal(playerDiscoveryMakesModeAvailable({ status: 'overflow', candidates: [] }), true);
  assert.equal(playerDiscoveryMakesModeAvailable({ status: 'none', candidates: [] }), false);
});
