import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateYouTubePageMetadata,
  validateYouTubePlayerState,
} from './youtube-page.ts';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('accepts safe public metadata only for the expected video', () => {
  assert.deepEqual(validateYouTubePageMetadata(URL, {
    pageUrl: `${URL}&t=42`,
    title: '  Video   title ',
    channelName: ' Channel name ',
  }), {
    videoId: 'dQw4w9WgXcQ',
    normalizedUrl: URL,
    canonicalUrl: URL,
    title: 'Video title',
    channelName: 'Channel name',
  });
  assert.equal(validateYouTubePageMetadata(URL, {
    pageUrl: 'https://youtu.be/9bZkp7q19f0', title: 'Other', channelName: null,
  }), null);
});

test('validates one-shot player state responses', () => {
  assert.deepEqual(validateYouTubePlayerState({ currentTime: 42.25, duration: 180, paused: false }), {
    currentTime: 42.25, duration: 180, paused: false,
  });
  assert.equal(validateYouTubePlayerState({ currentTime: -1, duration: 180, paused: true }), null);
  assert.equal(validateYouTubePlayerState({ currentTime: 200, duration: 180, paused: true }), null);
  assert.equal(validateYouTubePlayerState({ currentTime: 0, duration: Infinity, paused: true }), null);
});
