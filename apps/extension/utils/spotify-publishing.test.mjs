import assert from 'node:assert/strict';
import test from 'node:test';
import { beginHostedSpotifyAnnotation, parseHostedSpotifyBeginResponse } from './spotify-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const CANONICAL = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';
const beginRow = {
  annotation_id: ANNOTATION_ID, media_id: MEDIA_ID, creator_handle: 'creator',
  annotation_slug: 'spotify-33333333', processing_status: 'capture_pending',
};

function fakeClient() {
  const calls = [];
  return {
    calls,
    auth: {
      async getSession() { return { data: { session: { user: { id: USER_ID } } }, error: null }; },
      async getUser() { return { data: { user: { id: USER_ID } }, error: null }; },
    },
    async rpc(name, args) { calls.push([name, args]); return { data: [beginRow], error: null }; },
  };
}

test('begins a hosted normalized millisecond Spotify time range', async () => {
  const client = fakeClient();
  assert.deepEqual(await beginHostedSpotifyAnnotation(client, {
    sourceUrl: `${CANONICAL}?si=share`,
    title: 'The Daily', author: 'The New York Times', showName: 'The Daily',
    startMs: 1_000, endMs: 8_000, commentaryText: 'Required commentary',
    mediaDurationMs: 20_000,
  }), {
    annotationId: ANNOTATION_ID, mediaId: MEDIA_ID, creatorHandle: 'creator',
    annotationSlug: 'spotify-33333333', processingStatus: 'capture_pending',
  });
  assert.equal(client.calls[0][0], 'begin_hosted_spotify_annotation');
  assert.equal(client.calls[0][1].p_normalized_url, CANONICAL);
  assert.equal(client.calls[0][1].p_episode_id, '7makk4oTQel546B0P8lOOJ');
  assert.equal(Object.hasOwn(client.calls[0][1], 'user_id'), false);
});

test('rejects invalid or oversized ranges before calling the RPC', async () => {
  const client = fakeClient();
  await assert.rejects(beginHostedSpotifyAnnotation(client, {
    sourceUrl: CANONICAL, title: 'Clip', author: null, showName: null,
    startMs: 0, endMs: 90_001, commentaryText: 'Commentary',
  }), /90 seconds/);
  assert.equal(client.calls.length, 0);
});

test('rejects show-only and malformed begin responses', async () => {
  const client = fakeClient();
  await assert.rejects(beginHostedSpotifyAnnotation(client, {
    sourceUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
    title: 'Show', author: null, showName: null,
    startMs: 0, endMs: 5_000, commentaryText: 'Commentary',
  }), /Spotify episode URL/);
  assert.throws(() => parseHostedSpotifyBeginResponse({ annotation_id: ANNOTATION_ID }), /invalid draft/);
});

test('allows empty typed commentary when a recorded voice clip is present', async () => {
  const client = fakeClient();
  await beginHostedSpotifyAnnotation(client, {
    sourceUrl: CANONICAL, title: 'The Daily', author: 'The New York Times',
    showName: 'The Daily', startMs: 1_000, endMs: 8_000,
    commentaryText: '', hasRecordedCommentary: true,
  });
  assert.equal(client.calls[0][1].p_commentary_text, '');
  assert.equal(client.calls[0][1].p_title, null);
  await assert.rejects(
    beginHostedSpotifyAnnotation(client, {
      sourceUrl: CANONICAL, title: 'The Daily', author: 'The New York Times',
      showName: 'The Daily', startMs: 1_000, endMs: 8_000, commentaryText: '',
    }),
    /typed commentary, a voice clip, or both/,
  );
});
