import assert from 'node:assert/strict';
import test from 'node:test';
import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';
import {
  detectYouTubeLinearAdShowing,
  freezeYouTubeMediaTimesWhileAd,
  isYouTubeAdBlockedCopy,
  readYouTubeAdShowingOnPage,
  youtubeClipRangeAfterAdCleared,
  YOUTUBE_AD_BLOCKED_COPY,
  YOUTUBE_AD_CAPTURE_ABORT_COPY,
  YOUTUBE_AD_HEADING,
} from './youtube-ad.ts';

function classListFrom(className) {
  const tokens = className.split(/\s+/).filter(Boolean);
  return {
    contains: (name) => tokens.includes(name),
    value: className,
  };
}

function fakeRoot({ className = '', overlay = null, overlayStyle = null } = {}) {
  const player = {
    className,
    classList: classListFrom(className),
    querySelector: () => overlay,
  };
  return {
    querySelector: (selector) => {
      if (selector === '#movie_player' || selector === '.html5-video-player'
          || selector.includes('movie_player')) {
        return player;
      }
      return null;
    },
  };
}

test('detects linear ads from movie_player ad-showing and ad-interrupting', () => {
  assert.equal(detectYouTubeLinearAdShowing(fakeRoot()), false);
  assert.equal(detectYouTubeLinearAdShowing(fakeRoot({ className: 'html5-video-player' })), false);
  assert.equal(detectYouTubeLinearAdShowing(fakeRoot({
    className: 'html5-video-player ad-showing ytp-transparent',
  })), true);
  assert.equal(detectYouTubeLinearAdShowing(fakeRoot({
    className: 'html5-video-player ad-interrupting',
  })), true);
});

test('ignores overlay-only chrome without a linear ad class or visible overlay', () => {
  assert.equal(detectYouTubeLinearAdShowing(fakeRoot({
    className: 'html5-video-player ad-created',
  })), false);
  assert.equal(detectYouTubeLinearAdShowing({
    querySelector: () => null,
  }), false);
});

test('treats a visible Skip Ad overlay as a linear ad even without the class', () => {
  const overlay = { ownerDocument: null };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  });
  try {
    assert.equal(detectYouTubeLinearAdShowing(fakeRoot({ overlay })), true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous);
    else delete globalThis.getComputedStyle;
  }
});

test('ignores a display:none linear overlay leftover in the player', () => {
  const overlay = { ownerDocument: null };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ display: 'none', visibility: 'visible', opacity: '1' }),
  });
  try {
    assert.equal(detectYouTubeLinearAdShowing(fakeRoot({ overlay })), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous);
    else delete globalThis.getComputedStyle;
  }
});

test('serialized page reader is closure-free and matches detect true/false', () => {
  const injected = Function(`return (${readYouTubeAdShowingOnPage.toString()})`)();
  const previous = new Map(['document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const player = {
    className: 'html5-video-player',
    classList: classListFrom('html5-video-player'),
    querySelector: () => null,
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: (selector) => selector === '#movie_player' ? player : null,
    },
  });
  try {
    assert.deepEqual(injected(), { adShowing: false });
    player.className = 'html5-video-player ad-showing';
    player.classList = classListFrom(player.className);
    assert.deepEqual(injected(), { adShowing: true });
    assert.doesNotThrow(() => structuredClone(injected()));
  } finally {
    const descriptor = previous.get('document');
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  }
});

test('freezes duration, playhead, and identity while an ad owns the player', () => {
  const previous = {
    durationMs: 180_000,
    playerTimeMs: 42_000,
    playerIdentity: 'video:1:content1',
  };
  const adClock = {
    durationMs: 15_000,
    playerTimeMs: 1_200,
    playerIdentity: 'video:1:adclock',
  };
  assert.deepEqual(freezeYouTubeMediaTimesWhileAd({
    adShowing: true, previous, next: adClock,
  }), previous);
  assert.deepEqual(freezeYouTubeMediaTimesWhileAd({
    adShowing: false, previous, next: adClock,
  }), adClock);
  assert.deepEqual(freezeYouTubeMediaTimesWhileAd({
    adShowing: true,
    previous: { durationMs: null, playerTimeMs: null, playerIdentity: null },
    next: adClock,
  }), {
    durationMs: null,
    playerTimeMs: null,
    playerIdentity: 'video:1:adclock',
  });
});

test('re-arm validates the saved start/end against content duration', () => {
  assert.equal(youtubeClipRangeAfterAdCleared(10_000, 25_000, 180_000), null);
  assert.match(
    youtubeClipRangeAfterAdCleared(10_000, 25_000, 8_000),
    /cannot exceed the media duration/,
  );
  assert.equal(
    youtubeClipRangeAfterAdCleared(10_000, 25_000, 180_000),
    getNewMediaPublicationRangeError(10_000, 25_000, 180_000),
  );
});

test('user-facing ad copy is proactive and does not skip ads', () => {
  assert.equal(YOUTUBE_AD_HEADING, 'Ad playing');
  assert.equal(YOUTUBE_AD_BLOCKED_COPY, 'Ad playing — wait until it ends, then try again.');
  assert.match(YOUTUBE_AD_CAPTURE_ABORT_COPY, /started during capture/);
  assert.match(YOUTUBE_AD_CAPTURE_ABORT_COPY, /publish again/);
  assert.equal(isYouTubeAdBlockedCopy(YOUTUBE_AD_BLOCKED_COPY), true);
  assert.equal(isYouTubeAdBlockedCopy(YOUTUBE_AD_CAPTURE_ABORT_COPY), true);
  assert.equal(isYouTubeAdBlockedCopy('The selected player changed. Choose it again.'), false);
  assert.doesNotMatch(YOUTUBE_AD_BLOCKED_COPY, /skip/i);
  assert.doesNotMatch(YOUTUBE_AD_CAPTURE_ABORT_COPY, /skip/i);
});
