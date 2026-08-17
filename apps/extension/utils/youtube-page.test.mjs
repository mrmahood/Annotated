import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractYouTubePageMetadata,
  normalizeYouTubeVideoTitle,
  validateYouTubePageMetadata,
  validateYouTubePlayerState,
} from './youtube-page.ts';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('accepts safe public metadata only for the expected video', () => {
  assert.deepEqual(validateYouTubePageMetadata(URL, {
    pageUrl: `${URL}&t=42`,
    videoId: 'dQw4w9WgXcQ',
    title: '  Video   title ',
    channelName: ' Channel name ',
    hostname: 'youtube.com',
  }), {
    videoId: 'dQw4w9WgXcQ',
    normalizedUrl: URL,
    canonicalUrl: URL,
    title: 'Video title',
    channelName: 'Channel name',
    hostname: 'youtube.com',
  });
  assert.equal(validateYouTubePageMetadata(URL, {
    pageUrl: 'https://youtu.be/9bZkp7q19f0', videoId: '9bZkp7q19f0', title: 'Other', channelName: null, hostname: 'youtube.com',
  }), null);
});

test('extracts title, channel, hostname, and video ID from representative watch metadata', async () => {
  const previous = new Map(['document','location','window'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const selectors = new Map([
    ['h1.ytd-watch-metadata yt-formatted-string', { textContent: 'Actual video title' }],
    ['ytd-channel-name a', { textContent: 'Actual channel' }],
    ['meta[property="og:title"]', { content: 'Metadata title' }],
  ]);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    title: 'Actual video title - YouTube', querySelector: (selector) => selectors.get(selector) ?? null,
  } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: URL } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout } });
  try {
    assert.deepEqual(await extractYouTubePageMetadata(), {
      pageUrl: URL, videoId: 'dQw4w9WgXcQ', title: 'Actual video title',
      channelName: 'Actual channel', hostname: 'youtube.com',
    });
  } finally {
    for (const [name, descriptor] of previous) descriptor
      ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
});

test('cleans document-title suffix and treats generic YouTube labels as final fallback only', () => {
  assert.equal(normalizeYouTubeVideoTitle('A useful title - YouTube'), 'A useful title');
  assert.equal(normalizeYouTubeVideoTitle('YouTube.com'), '');
  assert.equal(validateYouTubePageMetadata(URL, {
    pageUrl: URL, videoId: 'dQw4w9WgXcQ', title: 'YouTube.com', channelName: null, hostname: 'youtube.com',
  }).title, 'youtube.com');
});

test('validates one-shot player state responses', () => {
  assert.deepEqual(validateYouTubePlayerState({ currentTime: 42.25, duration: 180, paused: false }), {
    currentTime: 42.25, duration: 180, paused: false,
  });
  assert.equal(validateYouTubePlayerState({ currentTime: -1, duration: 180, paused: true }), null);
  assert.equal(validateYouTubePlayerState({ currentTime: 200, duration: 180, paused: true }), null);
  assert.equal(validateYouTubePlayerState({ currentTime: 0, duration: Infinity, paused: true }), null);
});
