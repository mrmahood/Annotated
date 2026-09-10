import assert from 'node:assert/strict';
import test from 'node:test';
import { beginHostedYouTubeAnnotation, parseHostedYouTubeBeginResponse } from './youtube-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const beginRow = {
  annotation_id: ANNOTATION_ID, media_id: MEDIA_ID, creator_handle: 'creator',
  annotation_slug: 'video-33333333', processing_status: 'capture_pending',
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

test('begins a hosted normalized millisecond YouTube time range', async () => {
  const client = fakeClient();
  assert.deepEqual(await beginHostedYouTubeAnnotation(client, {
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=42&si=tracking',
    title: 'Video', channelName: 'Channel', startMs: 42_000, endMs: 73_000,
    commentaryText: 'Required commentary', videoDurationMs: 100_000,
  }), {
    annotationId: ANNOTATION_ID, mediaId: MEDIA_ID, creatorHandle: 'creator',
    annotationSlug: 'video-33333333', processingStatus: 'capture_pending',
  });
  assert.equal(client.calls[0][0], 'begin_hosted_youtube_annotation');
  assert.equal(client.calls[0][1].p_normalized_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(client.calls[0][1].p_video_title, 'Video');
  assert.equal(client.calls[0][1].p_channel_name, 'Channel');
  assert.equal(client.calls[0][1].p_title, null);
  assert.equal(Object.hasOwn(client.calls[0][1], 'user_id'), false);
});

test('rejects invalid or oversized ranges before calling the RPC', async () => {
  const client = fakeClient();
  await assert.rejects(beginHostedYouTubeAnnotation(client, {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Video', channelName: null, startMs: 0, endMs: 90_001,
    commentaryText: 'Commentary',
  }), /90 seconds/);
  assert.equal(client.calls.length, 0);
});

test('rejects malformed begin RPC responses', () => {
  assert.throws(() => parseHostedYouTubeBeginResponse({ annotation_id: ANNOTATION_ID }), /invalid draft/);
});

test('allows empty typed commentary when a recorded voice clip is present', async () => {
  const client = fakeClient();
  await beginHostedYouTubeAnnotation(client, {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Video', channelName: 'Channel', startMs: 1_000, endMs: 8_000,
    commentaryText: '', hasRecordedCommentary: true, annotationTitle: '  Voice take  ',
  });
  assert.equal(client.calls[0][1].p_commentary_text, '');
  assert.equal(client.calls[0][1].p_title, 'Voice take');
  await assert.rejects(
    beginHostedYouTubeAnnotation(client, {
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Video', channelName: 'Channel', startMs: 1_000, endMs: 8_000,
      commentaryText: '',
    }),
    /typed commentary, a voice clip, or both/,
  );
});
