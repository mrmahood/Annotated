import assert from 'node:assert/strict';
import test from 'node:test';
import { beginHostedTikTokAnnotation, parseHostedTikTokBeginResponse } from './tiktok-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const CANONICAL = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
const beginRow = {
  annotation_id: ANNOTATION_ID, media_id: MEDIA_ID, creator_handle: 'creator',
  annotation_slug: 'tiktok-33333333', processing_status: 'capture_pending',
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

test('begins a hosted normalized millisecond TikTok time range', async () => {
  const client = fakeClient();
  assert.deepEqual(await beginHostedTikTokAnnotation(client, {
    sourceUrl: `${CANONICAL}?is_from_webapp=1&sender_device=pc`,
    title: 'BBC clip', author: 'bbcnews', startMs: 1_000, endMs: 8_000,
    commentaryText: 'Required commentary', videoDurationMs: 20_000,
  }), {
    annotationId: ANNOTATION_ID, mediaId: MEDIA_ID, creatorHandle: 'creator',
    annotationSlug: 'tiktok-33333333', processingStatus: 'capture_pending',
  });
  assert.equal(client.calls[0][0], 'begin_hosted_tiktok_annotation');
  assert.equal(client.calls[0][1].p_normalized_url, CANONICAL);
  assert.equal(client.calls[0][1].p_video_id, '7550123456789012345');
  assert.equal(Object.hasOwn(client.calls[0][1], 'user_id'), false);
});

test('rejects invalid or oversized ranges before calling the RPC', async () => {
  const client = fakeClient();
  await assert.rejects(beginHostedTikTokAnnotation(client, {
    sourceUrl: CANONICAL, title: 'Clip', author: null, startMs: 0, endMs: 90_001,
    commentaryText: 'Commentary',
  }), /90 seconds/);
  assert.equal(client.calls.length, 0);
});

test('rejects For You and malformed begin responses', async () => {
  const client = fakeClient();
  await assert.rejects(beginHostedTikTokAnnotation(client, {
    sourceUrl: 'https://www.tiktok.com/foryou', title: 'Feed', author: null,
    startMs: 0, endMs: 5_000, commentaryText: 'Commentary',
  }), /TikTok video URL/);
  assert.throws(() => parseHostedTikTokBeginResponse({ annotation_id: ANNOTATION_ID }), /invalid draft/);
});

test('allows empty typed commentary when a recorded voice clip is present', async () => {
  const client = fakeClient();
  await beginHostedTikTokAnnotation(client, {
    sourceUrl: CANONICAL, title: 'BBC clip', author: 'bbcnews',
    startMs: 1_000, endMs: 8_000, commentaryText: '', hasRecordedCommentary: true,
  });
  assert.equal(client.calls[0][1].p_commentary_text, '');
  assert.equal(client.calls[0][1].p_title, null);
  await assert.rejects(
    beginHostedTikTokAnnotation(client, {
      sourceUrl: CANONICAL, title: 'BBC clip', author: 'bbcnews',
      startMs: 1_000, endMs: 8_000, commentaryText: '',
    }),
    /typed commentary, a voice clip, or both/,
  );
});
