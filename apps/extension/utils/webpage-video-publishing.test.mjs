import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginHostedWebpageVideoAnnotation,
  parseHostedWebpageVideoBeginResponse,
} from './webpage-video-publishing.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const beginRow = {
  annotation_id: ANNOTATION_ID, media_id: MEDIA_ID, creator_handle: 'creator',
  annotation_slug: 'webpage-video-33333333', processing_status: 'capture_pending',
};
const input = {
  sourceUrl: 'https://Example.test/news/clip/?utm_source=share&b=2#player',
  title: 'News clip', author: null, publisher: 'Example News',
  startMs: 1_000, endMs: 8_000, commentaryText: 'Required commentary',
  videoDurationMs: 60_000,
};

function fakeClient() {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        async getSession() {
          return { data: { session: { user: { id: USER_ID } } }, error: null };
        },
        async getUser() {
          return { data: { user: { id: USER_ID } }, error: null };
        },
      },
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: [beginRow], error: null };
      },
    },
  };
}

test('begins hosted article-page identity and strips tracking before RPC', async () => {
  const fake = fakeClient();
  assert.deepEqual(await beginHostedWebpageVideoAnnotation(fake.client, input), {
    annotationId: ANNOTATION_ID, mediaId: MEDIA_ID, creatorHandle: 'creator',
    annotationSlug: 'webpage-video-33333333', processingStatus: 'capture_pending',
  });
  assert.equal(fake.calls[0][0], 'begin_hosted_webpage_video_annotation');
  assert.equal(fake.calls[0][1].p_normalized_url, 'https://example.test/news/clip?b=2');
  assert.equal(fake.calls[0][1].p_canonical_url, 'https://example.test/news/clip?b=2');
  assert.equal(fake.calls[0][1].p_page_title, 'News clip');
  assert.equal(fake.calls[0][1].p_publisher, 'Example News');
  assert.equal('p_user_id' in fake.calls[0][1], false);
});

test('rejects TikTok watch URLs before calling the webpage-video RPC', async () => {
  const fake = fakeClient();
  await assert.rejects(
    beginHostedWebpageVideoAnnotation(fake.client, {
      ...input,
      sourceUrl: 'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
    }),
    /TikTok watch URL/,
  );
  assert.equal(fake.calls.length, 0);
});

test('rejects YouTube watch URLs before calling the webpage-video RPC', async () => {
  const fake = fakeClient();
  await assert.rejects(
    beginHostedWebpageVideoAnnotation(fake.client, {
      ...input,
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    }),
    /YouTube watch URL/,
  );
  assert.equal(fake.calls.length, 0);
});

test('rejects ranges outside the known player duration before RPC', async () => {
  const fake = fakeClient();
  await assert.rejects(
    beginHostedWebpageVideoAnnotation(fake.client, { ...input, videoDurationMs: 7_000 }),
    /media duration/,
  );
  assert.equal(fake.calls.length, 0);
});

test('rejects malformed hosted webpage-video begin responses', () => {
  assert.throws(() => parseHostedWebpageVideoBeginResponse([]), /invalid draft/);
});

test('allows empty typed commentary when a recorded voice clip is present', async () => {
  const fake = fakeClient();
  await beginHostedWebpageVideoAnnotation(fake.client, {
    ...input,
    commentaryText: '',
    hasRecordedCommentary: true,
  });
  assert.equal(fake.calls[0][1].p_commentary_text, '');
  assert.equal(fake.calls[0][1].p_title, null);
  await assert.rejects(
    beginHostedWebpageVideoAnnotation(fake.client, { ...input, commentaryText: '' }),
    /typed commentary, a voice clip, or both/,
  );
});

test('does not remap begin errors into a YouTube or article conflict', async () => {
  const fake = fakeClient();
  fake.client.rpc = async () => ({
    data: null,
    error: { message: 'The article source could not be created or reused.', code: 'P0001' },
  });
  await assert.rejects(
    beginHostedWebpageVideoAnnotation(fake.client, input),
    (error) => error instanceof Error && error.message === 'The article source could not be created or reused.',
  );
});
