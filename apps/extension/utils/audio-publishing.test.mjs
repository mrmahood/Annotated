import assert from 'node:assert/strict';
import test from 'node:test';
import { beginHostedAudioClipAnnotation, parseHostedAudioBeginResponse } from './audio-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const beginRow = {
  annotation_id: ANNOTATION_ID, media_id: MEDIA_ID, creator_handle: 'creator',
  annotation_slug: 'audio-33333333', processing_status: 'capture_pending',
};
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
        return { data: [beginRow], error: null };
      },
    },
  };
}

test('begins hosted normalized episode identity with no ownership argument', async () => {
  const fake = fakeClient();
  assert.deepEqual(await beginHostedAudioClipAnnotation(fake.client, input), {
    annotationId: ANNOTATION_ID, mediaId: MEDIA_ID, creatorHandle: 'creator',
    annotationSlug: 'audio-33333333', processingStatus: 'capture_pending',
  });
  assert.equal(fake.calls[0][0], 'begin_hosted_audio_annotation');
  assert.equal(fake.calls[0][1].p_normalized_url, 'https://example.test/episode/42');
  assert.equal('p_user_id' in fake.calls[0][1], false);
});

test('rejects ranges outside the known player duration before RPC', async () => {
  const fake = fakeClient();
  await assert.rejects(
    beginHostedAudioClipAnnotation(fake.client, { ...input, mediaDurationMs: 49_000 }),
    /media duration/,
  );
  assert.equal(fake.calls.length, 0);
});

test('rejects malformed hosted audio begin responses', () => {
  assert.throws(() => parseHostedAudioBeginResponse([]), /invalid draft/);
});
