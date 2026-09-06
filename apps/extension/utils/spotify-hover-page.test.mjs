import assert from 'node:assert/strict';
import test from 'node:test';
import { applySpotifyHoverHighlightOnPage, spotifyEpisodeIdFromHref } from './spotify-hover-page.ts';

test('Spotify hover page helpers stay fail-closed on identity', () => {
  assert.equal(
    spotifyEpisodeIdFromHref('https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ?si=x'),
    '7makk4oTQel546B0P8lOOJ',
  );
  assert.equal(spotifyEpisodeIdFromHref('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'), null);
  assert.deepEqual(
    applySpotifyHoverHighlightOnPage({
      expectedEpisodeId: 'not-an-id',
      strength: 'soft',
      startMs: null,
      endMs: null,
    }),
    { ok: false, reason: 'invalid-request' },
  );
});
