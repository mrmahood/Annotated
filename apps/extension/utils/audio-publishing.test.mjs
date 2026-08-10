import assert from 'node:assert/strict';
import test from 'node:test';
import { publishAudioClipAnnotation } from './audio-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const input = {
  sourceUrl: 'https://example.test/episode/42?t=20&utm_source=x',
  canonicalUrl: 'https://example.test/episode/42',
  title: 'Episode 42', author: 'Host', publisher: 'Example FM', showName: 'Example Show',
  startMs: 20_000, endMs: 50_000, commentaryText: 'Required commentary', mediaDurationMs: 120_000,
};

function fakeClient() {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        async getSession() { return { data: { session: { user: { id: USER_ID } } }, error: null }; },
        async getUser() { return { data: { user: { id: USER_ID } }, error: null }; },
      },
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: ANNOTATION_ID, error: null };
      },
    },
  };
}

test('publishes normalized episode identity with no ownership argument', async () => {
  const fake = fakeClient();
  assert.equal(await publishAudioClipAnnotation(fake.client, input), ANNOTATION_ID);
  assert.equal(fake.calls[0][0], 'publish_audio_clip_annotation');
  assert.equal(fake.calls[0][1].p_normalized_url, 'https://example.test/episode/42');
  assert.equal('p_user_id' in fake.calls[0][1], false);
});

test('rejects ranges outside the known player duration before RPC', async () => {
  const fake = fakeClient();
  await assert.rejects(
    publishAudioClipAnnotation(fake.client, { ...input, endMs: 121_000 }),
    /media duration/,
  );
  assert.equal(fake.calls.length, 0);
});
