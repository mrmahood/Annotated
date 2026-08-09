import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getYouTubeTimestampUrl,
  getYouTubeVideoIdentity,
  isYouTubeVideoUrl,
  normalizeYouTubeUrl,
  YouTubeUrlError,
} from './youtube.ts';

const VIDEO_ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

test('normalizes a standard YouTube watch URL to a stable video identity', () => {
  assert.deepEqual(getYouTubeVideoIdentity(CANONICAL), {
    videoId: VIDEO_ID,
    normalizedUrl: CANONICAL,
    canonicalUrl: CANONICAL,
  });
});

test('normalizes a youtu.be URL to the same watch URL identity', () => {
  assert.equal(normalizeYouTubeUrl(`https://youtu.be/${VIDEO_ID}`), CANONICAL);
});

test('removes timestamps and unrelated tracking parameters from video identity', () => {
  assert.equal(
    normalizeYouTubeUrl(`${CANONICAL}&t=42&start=8&feature=share&utm_source=test`),
    CANONICAL,
  );
  assert.equal(
    normalizeYouTubeUrl(`https://youtu.be/${VIDEO_ID}?t=90&si=tracking`),
    CANONICAL,
  );
});

test('rejects invalid YouTube and non-YouTube URLs', () => {
  assert.throws(() => normalizeYouTubeUrl('https://www.youtube.com/watch?v=short'), YouTubeUrlError);
  assert.throws(() => normalizeYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), YouTubeUrlError);
  assert.throws(() => normalizeYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), YouTubeUrlError);
  assert.equal(isYouTubeVideoUrl(CANONICAL), true);
  assert.equal(isYouTubeVideoUrl('https://example.com/article'), false);
});

test('builds a timestamped source link from the canonical video URL', () => {
  assert.equal(getYouTubeTimestampUrl(CANONICAL, 42_999), `${CANONICAL}&t=42s`);
});
