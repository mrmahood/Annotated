import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedVideoPlayerLayout } from './hosted-video-layout.ts';

test('uses stored width/height for portrait and landscape hosted video', () => {
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: 144,
      height: 240,
    }),
    { orientation: 'portrait', aspectRatio: '144 / 240' },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: 426,
      height: 240,
      sourceType: 'youtube',
    }),
    { orientation: 'landscape', aspectRatio: '426 / 240' },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: 240,
      height: 240,
    }),
    { orientation: 'landscape', aspectRatio: '240 / 240' },
  );
});

test('falls back to a 9:16 TikTok shell when dimensions are missing', () => {
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: null,
      height: null,
      sourceType: 'tiktok',
    }),
    { orientation: 'portrait', aspectRatio: '9 / 16' },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      sourceType: 'tiktok',
    }),
    { orientation: 'portrait', aspectRatio: '9 / 16' },
  );
});

test('stored landscape dimensions win over a TikTok source fallback', () => {
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: 426,
      height: 240,
      sourceType: 'tiktok',
    }),
    { orientation: 'landscape', aspectRatio: '426 / 240' },
  );
});

test('audio and missing dims stay landscape so YouTube and audio cards are unchanged', () => {
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'audio/mp4',
      width: null,
      height: null,
      sourceType: 'podcast',
    }),
    { orientation: 'landscape', aspectRatio: null },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'audio/mp4',
      width: 144,
      height: 240,
    }),
    { orientation: 'landscape', aspectRatio: null },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: null,
      height: null,
      sourceType: 'youtube',
    }),
    { orientation: 'landscape', aspectRatio: null },
  );
  assert.deepEqual(
    hostedVideoPlayerLayout({
      mimeType: 'video/mp4',
      width: 0,
      height: 240,
    }),
    { orientation: 'landscape', aspectRatio: null },
  );
});
