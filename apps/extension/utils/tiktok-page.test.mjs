import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractTikTokPageMetadata,
  normalizeTikTokVideoTitle,
  validateTikTokPageMetadata,
  validateTikTokPlayerState,
} from './tiktok-page.ts';

const URL = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';

test('accepts safe public metadata only for the expected video', () => {
  assert.deepEqual(validateTikTokPageMetadata(URL, {
    pageUrl: `${URL}?is_from_webapp=1`,
    videoId: '7550123456789012345',
    handle: 'bbcnews',
    title: '  Clip   title ',
    author: ' bbcnews ',
    hostname: 'tiktok.com',
  }), {
    videoId: '7550123456789012345',
    handle: 'bbcnews',
    normalizedUrl: URL,
    canonicalUrl: URL,
    title: 'Clip title',
    author: 'bbcnews',
    hostname: 'tiktok.com',
  });
  assert.equal(validateTikTokPageMetadata(URL, {
    pageUrl: 'https://www.tiktok.com/@cnn/video/7550999999999999999',
    videoId: '7550999999999999999',
    title: 'Other',
    author: null,
    hostname: 'tiktok.com',
  }), null);
});

test('extracts title, handle, and video ID from representative watch metadata', async () => {
  const previous = new Map(['document', 'location', 'window'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const selectors = new Map([
    ['meta[property="og:title"]', { content: 'Actual clip title' }],
    ['[data-e2e="browse-username"]', { textContent: '@bbcnews' }],
  ]);
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      title: 'Actual clip title | TikTok',
      querySelector: (selector) => selectors.get(selector) ?? null,
    },
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: URL } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout } });
  try {
    assert.deepEqual(await extractTikTokPageMetadata(), {
      pageUrl: URL,
      videoId: '7550123456789012345',
      handle: 'bbcnews',
      title: 'Actual clip title',
      author: 'bbcnews',
      hostname: 'tiktok.com',
    });
  } finally {
    for (const [name, descriptor] of previous) descriptor
      ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
});

test('cleans document-title suffix and treats generic TikTok labels as fallback only', () => {
  assert.equal(normalizeTikTokVideoTitle('A useful title | TikTok'), 'A useful title');
  assert.equal(normalizeTikTokVideoTitle('TikTok.com'), '');
  assert.equal(validateTikTokPageMetadata(URL, {
    pageUrl: URL, videoId: '7550123456789012345', title: 'TikTok.com', author: null, hostname: 'tiktok.com',
  }).title, '@bbcnews');
});

test('validates one-shot player state responses', () => {
  assert.deepEqual(validateTikTokPlayerState({ currentTime: 12.5, duration: 45, paused: false }), {
    currentTime: 12.5, duration: 45, paused: false,
  });
  assert.equal(validateTikTokPlayerState({ currentTime: -1, duration: 45, paused: true }), null);
});
