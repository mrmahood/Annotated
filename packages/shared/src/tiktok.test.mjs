import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTikTokVideoIdentity,
  isTikTokVideoUrl,
  normalizeTikTokUrl,
  TikTokUrlError,
} from './tiktok.ts';

const VIDEO_ID = '7550123456789012345';
const HANDLE = 'bbcnews';
const CANONICAL = `https://www.tiktok.com/@${HANDLE}/video/${VIDEO_ID}`;

test('normalizes a desktop TikTok watch URL to a stable video identity', () => {
  assert.deepEqual(getTikTokVideoIdentity(CANONICAL), {
    videoId: VIDEO_ID,
    handle: HANDLE,
    normalizedUrl: CANONICAL,
    canonicalUrl: CANONICAL,
  });
});

test('normalizes mobile and bare-host watch URLs to the same identity', () => {
  assert.equal(
    normalizeTikTokUrl(`https://m.tiktok.com/@${HANDLE}/video/${VIDEO_ID}`),
    CANONICAL,
  );
  assert.equal(
    normalizeTikTokUrl(`https://tiktok.com/@BBCNews/video/${VIDEO_ID}`),
    CANONICAL,
  );
});

test('removes tracking, share, and playback parameters from video identity', () => {
  assert.equal(
    normalizeTikTokUrl(
      `${CANONICAL}?is_from_webapp=1&sender_device=pc&utm_source=share&t=12`,
    ),
    CANONICAL,
  );
});

test('accepts locale prefixes and trailing slashes on an otherwise canonical watch path', () => {
  assert.equal(
    normalizeTikTokUrl(`https://www.tiktok.com/en/@${HANDLE}/video/${VIDEO_ID}`),
    CANONICAL,
  );
  assert.equal(normalizeTikTokUrl(`${CANONICAL}/`), CANONICAL);
  assert.equal(
    isTikTokVideoUrl('https://www.tiktok.com/@abcnews/video/7682104834304036110'),
    true,
  );
});

test('rejects For You, live, photos, short links, and non-TikTok URLs', () => {
  assert.throws(() => normalizeTikTokUrl('https://www.tiktok.com/foryou'), TikTokUrlError);
  assert.throws(() => normalizeTikTokUrl('https://www.tiktok.com/'), TikTokUrlError);
  assert.throws(() => normalizeTikTokUrl(`https://www.tiktok.com/@${HANDLE}/live`), TikTokUrlError);
  assert.throws(
    () => normalizeTikTokUrl(`https://www.tiktok.com/@${HANDLE}/photo/${VIDEO_ID}`),
    TikTokUrlError,
  );
  assert.throws(() => normalizeTikTokUrl('https://vm.tiktok.com/ZMabcdefg/'), TikTokUrlError);
  assert.throws(() => normalizeTikTokUrl('https://www.tiktok.com/t/ZTabcdefg/'), TikTokUrlError);
  assert.throws(() => normalizeTikTokUrl('https://vt.tiktok.com/ZSabcdefg/'), TikTokUrlError);
  assert.throws(
    () => normalizeTikTokUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    TikTokUrlError,
  );
  assert.equal(isTikTokVideoUrl(CANONICAL), true);
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/foryou'), false);
});
