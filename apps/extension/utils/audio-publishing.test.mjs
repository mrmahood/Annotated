import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioUnavailableReasonForExistingSource,
  beginHostedAudioClipAnnotation,
  EXISTING_NON_AUDIO_SOURCE_MESSAGE,
  existingSourceLookupUrls,
  lookupExistingSourceType,
  messageForAudioSourceConflict,
  parseHostedAudioBeginResponse,
} from './audio-publishing.ts';

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

test('maps the non-audio source RPC into a readable article-conflict message', () => {
  assert.equal(
    messageForAudioSourceConflict(new Error('The normalized URL belongs to a non-audio source.')),
    EXISTING_NON_AUDIO_SOURCE_MESSAGE,
  );
  assert.equal(
    messageForAudioSourceConflict(new Error('22023: The normalized URL belongs to a non-audio source.')),
    EXISTING_NON_AUDIO_SOURCE_MESSAGE,
  );
  assert.equal(
    messageForAudioSourceConflict({ message: 'The normalized URL belongs to a non-audio source.', code: '22023' }),
    EXISTING_NON_AUDIO_SOURCE_MESSAGE,
  );
  assert.equal(audioUnavailableReasonForExistingSource('article'), EXISTING_NON_AUDIO_SOURCE_MESSAGE);
  assert.equal(audioUnavailableReasonForExistingSource('youtube'), EXISTING_NON_AUDIO_SOURCE_MESSAGE);
  assert.equal(audioUnavailableReasonForExistingSource('podcast'), null);
  assert.equal(audioUnavailableReasonForExistingSource(null), null);
});

test('lookup treats an existing article source as blocking audio publish', async () => {
  const urls = existingSourceLookupUrls(
    'https://www.nytimes.com/2026/09/04/us/politics/trump-administration-fund-compensation-jan-6.html',
  );
  assert.ok(urls.includes('https://www.nytimes.com/2026/09/04/us/politics/trump-administration-fund-compensation-jan-6.html'));

  const calls = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'sources');
      return {
        select(columns) {
          assert.match(columns, /source_type/);
          return {
            in(column, values) {
              calls.push([column, values]);
              return {
                async limit() {
                  return { data: [{ source_type: 'article', normalized_url: urls[0] }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  assert.equal(await lookupExistingSourceType(supabase, urls[0]), 'article');
  assert.equal(calls[0][0], 'normalized_url');
});

test('begin hosted audio remaps a non-audio source RPC error', async () => {
  const fake = fakeClient();
  fake.client.rpc = async () => ({
    data: null,
    error: { message: 'The normalized URL belongs to a non-audio source.', code: '22023' },
  });
  await assert.rejects(
    beginHostedAudioClipAnnotation(fake.client, input),
    (error) => error instanceof Error && error.message === EXISTING_NON_AUDIO_SOURCE_MESSAGE,
  );
});
