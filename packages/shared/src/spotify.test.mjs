import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSpotifyEpisodeIdentity,
  isSpotifyEpisodeUrl,
  normalizeSpotifyEpisodeUrl,
  SpotifyUrlError,
} from './spotify.ts';

const EPISODE_ID = '7makk4oTQel546B0P8lOOJ';
const CANONICAL = `https://open.spotify.com/episode/${EPISODE_ID}`;

test('normalizes a desktop Spotify episode URL to a stable identity', () => {
  assert.deepEqual(getSpotifyEpisodeIdentity(CANONICAL), {
    episodeId: EPISODE_ID,
    normalizedUrl: CANONICAL,
    canonicalUrl: CANONICAL,
  });
});

test('normalizes embed, locale, trailing-slash, and share-parameter variants', () => {
  assert.equal(
    normalizeSpotifyEpisodeUrl(`https://open.spotify.com/embed/episode/${EPISODE_ID}`),
    CANONICAL,
  );
  assert.equal(
    normalizeSpotifyEpisodeUrl(`https://open.spotify.com/intl-en/episode/${EPISODE_ID}`),
    CANONICAL,
  );
  assert.equal(
    normalizeSpotifyEpisodeUrl(`https://open.spotify.com/intl-es-419/embed/episode/${EPISODE_ID}/`),
    CANONICAL,
  );
  assert.equal(
    normalizeSpotifyEpisodeUrl(`${CANONICAL}?si=abcd1234&utm_source=share&t=90`),
    CANONICAL,
  );
  assert.equal(normalizeSpotifyEpisodeUrl(`${CANONICAL}/`), CANONICAL);
  assert.equal(isSpotifyEpisodeUrl(CANONICAL), true);
});

test('rejects home, search, show-only, login, short links, and non-Spotify URLs', () => {
  assert.throws(() => normalizeSpotifyEpisodeUrl('https://open.spotify.com/'), SpotifyUrlError);
  assert.throws(() => normalizeSpotifyEpisodeUrl('https://open.spotify.com/search/news'), SpotifyUrlError);
  assert.throws(
    () => normalizeSpotifyEpisodeUrl('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'),
    SpotifyUrlError,
  );
  assert.throws(() => normalizeSpotifyEpisodeUrl('https://accounts.spotify.com/login'), SpotifyUrlError);
  assert.throws(() => normalizeSpotifyEpisodeUrl('https://open.spotify.com/login'), SpotifyUrlError);
  assert.throws(() => normalizeSpotifyEpisodeUrl('https://spotify.link/abcdef'), SpotifyUrlError);
  assert.throws(() => normalizeSpotifyEpisodeUrl(`spotify:episode:${EPISODE_ID}`), SpotifyUrlError);
  assert.throws(
    () => normalizeSpotifyEpisodeUrl('https://play.spotify.com/episode/7makk4oTQel546B0P8lOOJ'),
    SpotifyUrlError,
  );
  assert.throws(
    () => normalizeSpotifyEpisodeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    SpotifyUrlError,
  );
  assert.equal(isSpotifyEpisodeUrl('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'), false);
  assert.equal(isSpotifyEpisodeUrl('https://example.com/podcast/episode-42'), false);
});
