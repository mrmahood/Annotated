import assert from 'node:assert/strict';
import test from 'node:test';
import { publishYouTubeAnnotation } from './youtube-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';

function fakeClient() {
  const calls = [];
  return {
    calls,
    auth: {
      async getSession() { return { data: { session: { user: { id: USER_ID } } }, error: null }; },
      async getUser() { return { data: { user: { id: USER_ID } }, error: null }; },
    },
    async rpc(name, args) { calls.push([name, args]); return { data: ANNOTATION_ID, error: null }; },
  };
}

test('publishes a normalized millisecond YouTube time range', async () => {
  const client = fakeClient();
  assert.equal(await publishYouTubeAnnotation(client, {
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=42&si=tracking',
    title: 'Video', channelName: 'Channel', startMs: 42_000, endMs: 73_000,
    commentaryText: 'Required commentary', videoDurationMs: 100_000,
  }), ANNOTATION_ID);
  assert.equal(client.calls[0][0], 'publish_youtube_annotation');
  assert.equal(client.calls[0][1].p_normalized_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(Object.hasOwn(client.calls[0][1], 'user_id'), false);
});

test('rejects invalid or oversized ranges before calling the RPC', async () => {
  const client = fakeClient();
  await assert.rejects(publishYouTubeAnnotation(client, {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Video', channelName: null, startMs: 0, endMs: 300_001,
    commentaryText: 'Commentary',
  }), /5 minutes/);
  assert.equal(client.calls.length, 0);
});
