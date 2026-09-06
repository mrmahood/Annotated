import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotationMatchesConnectedSpotifyEpisode,
  spotifyHoverConnectionForTab,
  spotifyEpisodeIdFromUrl,
} from './spotify-hover-link.ts';

const CANONICAL = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';

test('Spotify hover matches episode identity and fails closed off-source', () => {
  assert.equal(spotifyEpisodeIdFromUrl(CANONICAL), '7makk4oTQel546B0P8lOOJ');
  assert.equal(
    annotationMatchesConnectedSpotifyEpisode('7makk4oTQel546B0P8lOOJ', `${CANONICAL}?si=x`),
    true,
  );
  assert.equal(
    annotationMatchesConnectedSpotifyEpisode('7makk4oTQel546B0P8lOOJ', 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'),
    false,
  );
  assert.deepEqual(
    spotifyHoverConnectionForTab('Spotify', 3, CANONICAL),
    { tabId: 3, tabUrl: CANONICAL },
  );
  assert.equal(spotifyHoverConnectionForTab('Web page', 3, CANONICAL), null);
  assert.equal(spotifyHoverConnectionForTab('Spotify', 3, 'https://open.spotify.com/'), null);
});
