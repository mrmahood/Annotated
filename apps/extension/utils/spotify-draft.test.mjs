import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deserializeSpotifyClipDraft,
  serializeSpotifyClipDraft,
  spotifyClipDraftBelongsToSource,
} from './spotify-draft.ts';

const CANONICAL = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';

test('serializes a Spotify episode draft and matches locale or embed variants', () => {
  const draft = serializeSpotifyClipDraft(CANONICAL, 1_000, 8_000, 'Commentary');
  assert.equal(draft.source.episodeId, '7makk4oTQel546B0P8lOOJ');
  assert.equal(draft.source.normalizedUrl, CANONICAL);
  assert.equal(spotifyClipDraftBelongsToSource(draft, `${CANONICAL}?si=share`), true);
  assert.equal(
    spotifyClipDraftBelongsToSource(draft, 'https://open.spotify.com/intl-en/episode/7makk4oTQel546B0P8lOOJ'),
    true,
  );
  assert.equal(
    spotifyClipDraftBelongsToSource(draft, 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'),
    false,
  );
  assert.equal(spotifyClipDraftBelongsToSource(draft, 'https://example.com/podcast'), false);
});

test('rejects show-only URLs and malformed stored drafts', () => {
  assert.throws(
    () => serializeSpotifyClipDraft('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk', 0, 5_000, 'x'),
  );
  assert.equal(deserializeSpotifyClipDraft({ version: 1 }), null);
  const draft = serializeSpotifyClipDraft(CANONICAL, 0, 5_000, 'ok');
  assert.deepEqual(deserializeSpotifyClipDraft(draft), draft);
});
