import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrepareCapturePageRequest,
  prepareMediaCaptureOnPage,
} from './media-capture-page.ts';
import {
  MEDIA_CAPTURE_FIXED_DURATION_MS,
  MEDIA_CAPTURE_MAX_DURATION_MS,
  isMediaCaptureStartMessage,
} from './media-capture-spike.ts';

const pageUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
const source = {
  kind: 'youtube',
  pageUrl,
  sourceKey: 'abcdefghijk',
};

async function prepareWithVideo({ currentTime, duration, intent, pageRequest }) {
  const globalNames = [
    'location',
    'document',
    'window',
    'HTMLAudioElement',
    'HTMLVideoElement',
    'getComputedStyle',
  ];
  const descriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

  class FakeAudioElement {}
  class FakeVideoElement {
    constructor() {
      this.currentTime = currentTime;
      this.duration = duration;
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.paused = false;
      this.ended = false;
    }

    pause() { this.paused = true; }
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        top: 0,
        right: 1280,
        bottom: 720,
        left: 0,
      };
    }
  }

  const video = new FakeVideoElement();
  const globals = {
    location: { href: pageUrl },
    document: {
      querySelector: () => video,
      querySelectorAll: () => [video],
      fullscreenElement: null,
    },
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      scrollX: 0,
      scrollY: 0,
      setTimeout,
    },
    HTMLAudioElement: FakeAudioElement,
    HTMLVideoElement: FakeVideoElement,
    getComputedStyle: () => ({ objectFit: 'contain', objectPosition: '50% 50%' }),
  };

  try {
    for (const [name, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    return await prepareMediaCaptureOnPage(pageRequest ?? {
      source,
      intent,
      maximumDurationMs: MEDIA_CAPTURE_MAX_DURATION_MS,
    });
  } finally {
    for (const name of globalNames) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('fixed intent survives validator and background preparation, then reaches the fixed page branch', async () => {
  const message = {
    target: 'background',
    type: 'annotated.mediaCaptureSpike.start.v1',
    request: {
      source,
      tabId: 42,
      intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
    },
  };
  assert.equal(isMediaCaptureStartMessage(message), true);
  const pageRequest = createPrepareCapturePageRequest(
    message.request,
    MEDIA_CAPTURE_MAX_DURATION_MS,
  );
  assert.deepEqual(pageRequest.intent, { kind: 'fixed-duration', durationMs: 15_000 });
  const result = await prepareWithVideo({
    currentTime: 12.345,
    duration: 120,
    pageRequest,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.protocolDiagnostic, {
    kind: 'fixed-duration',
    durationMs: 15_000,
    maximumDurationMs: 90_000,
  });
  assert.deepEqual({
    startMs: result.prepared.requestedStartMs,
    endMs: result.prepared.requestedEndMs,
    durationMs: result.prepared.requestedDurationMs,
  }, { startMs: 12_345, endMs: 27_345, durationMs: 15_000 });
});

test('selected intent survives validator and background preparation, then reaches the selected page branch', async () => {
  const message = {
    target: 'background',
    type: 'annotated.mediaCaptureSpike.start.v1',
    request: {
      source,
      tabId: 42,
      intent: { kind: 'selected-range', startMs: 5_000, endMs: 20_000 },
    },
  };
  assert.equal(isMediaCaptureStartMessage(message), true);
  const pageRequest = createPrepareCapturePageRequest(
    message.request,
    MEDIA_CAPTURE_MAX_DURATION_MS,
  );
  assert.deepEqual(pageRequest.intent, {
    kind: 'selected-range',
    startMs: 5_000,
    endMs: 20_000,
  });
  const result = await prepareWithVideo({ currentTime: 5, duration: 120, pageRequest });
  assert.equal(result.ok, true);
  assert.equal(result.prepared.requestedStartMs, 5_000);
  assert.equal(result.prepared.requestedEndMs, 20_000);
  assert.deepEqual(result.protocolDiagnostic, {
    kind: 'selected-range',
    startMs: 5_000,
    endMs: 20_000,
    maximumDurationMs: 90_000,
  });
});

test('fixed capture safely clamps to the known remaining media duration', async () => {
  const result = await prepareWithVideo({
    currentTime: 98,
    duration: 100,
    intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
  });
  assert.equal(result.ok, true);
  assert.equal(result.prepared.requestedStartMs, 98_000);
  assert.equal(result.prepared.requestedEndMs, 100_000);
  assert.equal(result.prepared.requestedDurationMs, 2_000);
});

test('fixed capture treats a zero player duration as unavailable instead of an invalid range', async () => {
  const result = await prepareWithVideo({
    currentTime: 12,
    duration: 0,
    intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
  });
  assert.equal(result.ok, true);
  assert.equal(result.prepared.requestedDurationMs, 15_000);
  assert.equal(result.prepared.mediaDurationMs, null);
});

test('fixed capture rejects when less than one second remains', async () => {
  const result = await prepareWithVideo({
    currentTime: 99.25,
    duration: 100,
    intent: { kind: 'fixed-duration', durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-request');
  assert.equal(result.message, 'Less than one second remains in the media.');
  assert.notEqual(result.message, 'The requested range is unavailable or shorter than one second.');
  assert.equal(result.protocolDiagnostic.kind, 'fixed-duration');
});
