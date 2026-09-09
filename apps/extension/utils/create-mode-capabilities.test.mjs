import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectedAudioSource,
  createAudioIdentity,
  getModeCapabilities,
} from './create-mode-capabilities.ts';

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const TIKTOK_URL = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
const ARTICLE_URL = 'https://example.test/story';
const AUDIO_URL = 'https://example.test/episode/42';
const SPOTIFY_URL = 'https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2';

function youtubeSource(overrides = {}) {
  return {
    title: 'Watch title',
    hostname: 'youtube.com',
    url: YOUTUBE_URL,
    classification: 'YouTube',
    videoId: 'dQw4w9WgXcQ',
    normalizedUrl: YOUTUBE_URL,
    canonicalUrl: YOUTUBE_URL,
    channelName: 'Channel',
    metadataResolved: true,
    ...overrides,
  };
}

function tiktokSource(overrides = {}) {
  return {
    title: 'TikTok title',
    hostname: 'tiktok.com',
    url: TIKTOK_URL,
    classification: 'TikTok',
    videoId: '7550123456789012345',
    handle: 'bbcnews',
    normalizedUrl: TIKTOK_URL,
    canonicalUrl: TIKTOK_URL,
    author: '@bbcnews',
    metadataResolved: true,
    ...overrides,
  };
}

function articleSource(overrides = {}) {
  return {
    title: 'Article',
    hostname: 'example.test',
    url: ARTICLE_URL,
    classification: 'Web page',
    audioDetectionResolved: true,
    audioAvailable: false,
    audioIdentity: null,
    exclusivePodcast: false,
    videoDetectionResolved: true,
    videoAvailable: false,
    ...overrides,
  };
}

function podcastSource(overrides = {}) {
  return {
    title: 'Episode',
    hostname: 'example.test',
    url: AUDIO_URL,
    normalizedUrl: AUDIO_URL,
    canonicalUrl: AUDIO_URL,
    classification: 'Podcast / web audio',
    author: 'Host',
    publisher: 'Example FM',
    showName: 'Show',
    playerId: 'audio:1:abcd1234',
    playerStatus: 'ready',
    videoDetectionResolved: true,
    videoAvailable: false,
    ...overrides,
  };
}

function spotifySource(overrides = {}) {
  return {
    title: 'Spotify episode',
    hostname: 'open.spotify.com',
    url: SPOTIFY_URL,
    classification: 'Spotify',
    episodeId: '6EMoFpxEsLelogfZz8eAC2',
    normalizedUrl: SPOTIFY_URL,
    canonicalUrl: SPOTIFY_URL,
    author: 'Host',
    showName: 'Show',
    metadataResolved: true,
    pageBlock: null,
    ...overrides,
  };
}

test('YouTube and TikTok offer Text and Video, and grey Audio media', () => {
  const youtube = getModeCapabilities({ status: 'connected', source: youtubeSource() });
  assert.equal(youtube.text.status, 'available');
  assert.equal(youtube.video.status, 'available');
  assert.equal(youtube.audio.status, 'unavailable');
  assert.match(youtube.audio.reason, /not YouTube video/);
  const tiktok = getModeCapabilities({ status: 'connected', source: tiktokSource() });
  assert.equal(tiktok.text.status, 'available');
  assert.equal(tiktok.video.status, 'available');
  assert.equal(tiktok.audio.status, 'unavailable');
  assert.match(tiktok.audio.reason, /not TikTok video/);
  assert.equal(createAudioIdentity(youtubeSource()), null);
  assert.equal(createAudioIdentity(tiktokSource()), null);
});

test('Spotify keeps Audio and continues to fail-closed for login-gated tabs', () => {
  const playing = getModeCapabilities({ status: 'connected', source: spotifySource() });
  assert.equal(playing.text.status, 'available');
  assert.equal(playing.video.status, 'unavailable');
  assert.equal(playing.audio.status, 'available');
  const gated = getModeCapabilities({
    status: 'connected',
    source: spotifySource({ pageBlock: 'login' }),
  });
  assert.equal(gated.audio.status, 'unavailable');
  assert.match(gated.audio.reason, /preview|sign in/i);
});

test('article pages keep Audio only when page audio exists, not because video exists', () => {
  const textOnly = getModeCapabilities({ status: 'connected', source: articleSource() });
  assert.equal(textOnly.text.status, 'available');
  assert.equal(textOnly.video.status, 'unavailable');
  assert.equal(textOnly.audio.status, 'unavailable');
  const pageAudio = getModeCapabilities({
    status: 'connected',
    source: articleSource({
      audioAvailable: true,
      audioIdentity: podcastSource({
        classification: 'Podcast / web audio',
        url: ARTICLE_URL,
        normalizedUrl: ARTICLE_URL,
        canonicalUrl: ARTICLE_URL,
        videoDetectionResolved: undefined,
        videoAvailable: undefined,
      }),
    }),
  });
  assert.equal(pageAudio.audio.status, 'available');
  assert.equal(pageAudio.video.status, 'unavailable');
  const videoOnly = getModeCapabilities({
    status: 'connected',
    source: articleSource({ videoAvailable: true }),
  });
  assert.equal(videoOnly.video.status, 'available');
  assert.equal(videoOnly.audio.status, 'unavailable');
  const checkingAudio = getModeCapabilities({
    status: 'connected',
    source: articleSource({ audioDetectionResolved: false }),
  });
  assert.equal(checkingAudio.audio.status, 'checking');
});

test('podcast pages keep Audio and only offer Video when a safe webpage video exists', () => {
  const audioOnly = getModeCapabilities({ status: 'connected', source: podcastSource() });
  assert.equal(audioOnly.audio.status, 'available');
  assert.equal(audioOnly.video.status, 'unavailable');
  const both = getModeCapabilities({
    status: 'connected',
    source: podcastSource({ videoAvailable: true }),
  });
  assert.equal(both.audio.status, 'available');
  assert.equal(both.video.status, 'available');
  assert.equal(connectedAudioSource(podcastSource())?.normalizedUrl, AUDIO_URL);
});

test('Create Audio identity prefers page audio or Spotify and never uses watch-page video sound', () => {
  assert.equal(createAudioIdentity(youtubeSource()), null);
  assert.equal(createAudioIdentity(tiktokSource()), null);
  assert.equal(createAudioIdentity(spotifySource())?.episodeId, '6EMoFpxEsLelogfZz8eAC2');
  const hybrid = articleSource({
    audioAvailable: true,
    videoAvailable: true,
    audioIdentity: podcastSource({
      url: ARTICLE_URL,
      normalizedUrl: ARTICLE_URL,
      canonicalUrl: ARTICLE_URL,
      videoDetectionResolved: undefined,
      videoAvailable: undefined,
    }),
  });
  assert.equal(createAudioIdentity(hybrid)?.classification, 'Podcast / web audio');
});

test('disconnected tabs fail closed for every mode', () => {
  const disconnected = getModeCapabilities({ status: 'not-connected' });
  assert.equal(disconnected.text.status, 'unavailable');
  assert.equal(disconnected.video.status, 'unavailable');
  assert.equal(disconnected.audio.status, 'unavailable');
});
