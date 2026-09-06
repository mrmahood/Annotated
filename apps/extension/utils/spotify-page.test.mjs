import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSpotifyNowPlayingIdentity,
  normalizeSpotifyEpisodeTitle,
  validateSpotifyPageMetadata,
  validateSpotifyPlayerDiscovery,
  validateSpotifyPlayerState,
} from './spotify-page.ts';

const CANONICAL = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';

test('normalizes Spotify episode titles and rejects the bare player title', () => {
  assert.equal(normalizeSpotifyEpisodeTitle('The Daily | Spotify'), 'The Daily');
  assert.equal(normalizeSpotifyEpisodeTitle('Spotify'), '');
  assert.equal(normalizeSpotifyEpisodeTitle(null), '');
});

test('validates episode metadata against the connected URL and fail-closed blocks', () => {
  const metadata = validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: `${CANONICAL}?si=share`,
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'The Daily | Spotify',
    author: 'The New York Times',
    showName: 'The Daily',
    hostname: 'open.spotify.com',
    pageBlock: null,
  });
  assert.equal(metadata?.episodeId, '7makk4oTQel546B0P8lOOJ');
  assert.equal(metadata?.title, 'The Daily');
  assert.equal(metadata?.pageBlock, null);
  assert.equal(validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'Show',
    author: null,
    showName: null,
    hostname: 'open.spotify.com',
    pageBlock: null,
  }), null);
  assert.equal(validateSpotifyPageMetadata(CANONICAL, {
    pageUrl: CANONICAL,
    episodeId: '7makk4oTQel546B0P8lOOJ',
    title: 'The Daily',
    author: null,
    showName: null,
    hostname: 'open.spotify.com',
    pageBlock: 'login',
  })?.pageBlock, 'login');
});

test('player discovery accepts one now-playing identity and rejects HTML5 audio ids', () => {
  const discovery = validateSpotifyPlayerDiscovery(CANONICAL, {
    pageUrl: CANONICAL,
    mode: 'audio',
    overflow: false,
    candidates: [{
      identity: 'spotify-now-playing:1:abcd1234',
      kind: 'audio',
      label: 'Spotify now playing',
      status: 'playing',
      currentTimeMs: 12_000,
      durationMs: 3_600_000,
    }],
  });
  assert.equal(discovery.status, 'ready');
  assert.equal(isSpotifyNowPlayingIdentity('spotify-now-playing:1:abcd1234'), true);
  assert.equal(isSpotifyNowPlayingIdentity('audio:1:abcd1234'), false);
  assert.equal(validateSpotifyPlayerDiscovery(CANONICAL, {
    pageUrl: CANONICAL,
    mode: 'audio',
    overflow: false,
    candidates: [{
      identity: 'audio:1:abcd1234',
      kind: 'audio',
      label: 'HTML5',
      status: 'ready',
      currentTimeMs: 0,
      durationMs: 1_000,
    }],
  }).status, 'none');
});

test('player state fails closed on unreadable or inverted times', () => {
  assert.deepEqual(validateSpotifyPlayerState({
    currentTime: 12.4, duration: 90, paused: false,
  }), { currentTime: 12.4, duration: 90, paused: false });
  assert.equal(validateSpotifyPlayerState({
    currentTime: 100, duration: 10, paused: true,
  }), null);
  assert.equal(validateSpotifyPlayerState({ currentTime: Number.NaN, paused: true }), null);
});
