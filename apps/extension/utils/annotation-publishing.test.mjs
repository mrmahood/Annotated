import assert from 'node:assert/strict';
import test from 'node:test';
import { publishArticleAnnotation, uploadAndAttachOwnerCommentaryAudio } from './annotation-publishing.ts';
import { ATTACH_OWNER_ANNOTATION_AUDIO_RPC } from './audio-commentary.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const INPUT = {
  normalizedUrl: 'https://example.test/article',
  canonicalUrl: 'https://example.test/article',
  pageTitle: 'Article',
  author: null,
  publisher: null,
  selectedText: 'Passage',
  textPrefix: '',
  textSuffix: '',
  commentaryText: 'Required text commentary',
};

function createFakeClient({ rpcError = null, cleanupError = null } = {}) {
  const calls = [];
  const bucket = {
    async upload(path, blob, options) {
      calls.push(['upload', path, blob.size, options]);
      return { data: { path }, error: null };
    },
    async remove(paths) {
      calls.push(['remove', paths]);
      return { data: null, error: cleanupError };
    },
  };
  return {
    calls,
    client: {
      auth: {
        async getSession() { return { data: { session: { user: { id: USER_ID } } }, error: null }; },
        async getUser() { return { data: { user: { id: USER_ID } }, error: null }; },
      },
      storage: {
        from(name) { calls.push(['bucket', name]); return bucket; },
      },
      async rpc(name, args) {
        calls.push(['rpc', name, args]);
        return { data: rpcError ? null : ANNOTATION_ID, error: rpcError };
      },
    },
  };
}

test('text-only publishing remains routed directly to the existing RPC', async () => {
  const fake = createFakeClient();
  assert.equal(await publishArticleAnnotation(fake.client, INPUT), ANNOTATION_ID);
  assert.deepEqual(fake.calls.map(([kind, name]) => [kind, name]), [
    ['rpc', 'publish_article_annotation'],
  ]);
  assert.equal(fake.calls[0][2].p_title, null);
});

test('optional titles are trimmed and sent as p_title', async () => {
  const fake = createFakeClient();
  assert.equal(await publishArticleAnnotation(fake.client, {
    ...INPUT,
    annotationTitle: '  Quiet headline  ',
  }), ANNOTATION_ID);
  assert.equal(fake.calls[0][2].p_title, 'Quiet headline');
});

test('a title cannot substitute for typed or voice commentary', async () => {
  const fake = createFakeClient();
  await assert.rejects(
    publishArticleAnnotation(fake.client, {
      ...INPUT,
      commentaryText: '',
      annotationTitle: 'Not enough',
    }),
    /typed commentary, a voice clip, or both/,
  );
  assert.equal(fake.calls.length, 0);
});

test('audio publishing uploads before calling the audio RPC', async () => {
  const fake = createFakeClient();
  const blob = new Blob(['recording'], { type: 'audio/webm' });
  assert.equal(
    await publishArticleAnnotation(fake.client, INPUT, { blob, durationMs: 1_500 }),
    ANNOTATION_ID,
  );
  assert.deepEqual(fake.calls.map(([kind, name]) => [kind, name]), [
    ['bucket', 'annotation-audio'],
    ['upload', fake.calls[1][1]],
    ['rpc', 'publish_article_annotation_with_audio'],
  ]);
  assert.equal(fake.calls[1][3].upsert, false);
  assert.equal(fake.calls[1][3].contentType, 'audio/webm');
  assert.match(fake.calls[1][1], new RegExp(`^${USER_ID}/.+\\.webm$`));
});

test('an RPC failure removes only the newly uploaded object', async () => {
  const fake = createFakeClient({ rpcError: { message: 'database rejected audio' } });
  const blob = new Blob(['recording'], { type: 'audio/webm' });
  await assert.rejects(
    publishArticleAnnotation(fake.client, INPUT, { blob, durationMs: 1_500 }),
    /database rejected audio/,
  );
  assert.equal(fake.calls.at(-1)[0], 'remove');
  assert.deepEqual(fake.calls.at(-1)[1], [fake.calls[1][1]]);
});

test('voice-only article publishing uploads then calls the audio RPC', async () => {
  const fake = createFakeClient();
  const blob = new Blob(['recording'], { type: 'audio/webm' });
  assert.equal(
    await publishArticleAnnotation(fake.client, { ...INPUT, commentaryText: '' }, { blob, durationMs: 1_500 }),
    ANNOTATION_ID,
  );
  assert.equal(fake.calls.at(-1)[0], 'rpc');
  assert.equal(fake.calls.at(-1)[1], 'publish_article_annotation_with_audio');
  await assert.rejects(
    publishArticleAnnotation(fake.client, { ...INPUT, commentaryText: '' }),
    /typed commentary, a voice clip, or both/,
  );
});

test('hosted follow-up attach uploads then calls attach_owner_annotation_audio', async () => {
  const fake = createFakeClient();
  const blob = new Blob(['recording'], { type: 'audio/webm' });
  await uploadAndAttachOwnerCommentaryAudio(fake.client, ANNOTATION_ID, { blob, durationMs: 1_500 });
  assert.equal(fake.calls.at(-1)[0], 'rpc');
  assert.equal(fake.calls.at(-1)[1], ATTACH_OWNER_ANNOTATION_AUDIO_RPC);
  assert.equal(fake.calls.at(-1)[2].p_annotation_id, ANNOTATION_ID);
});

test('cleanup failure is reported without replacing the primary RPC error', async () => {
  const fake = createFakeClient({
    rpcError: { message: 'primary publication error' },
    cleanupError: { message: 'private cleanup details' },
  });
  const diagnostics = [];
  await assert.rejects(
    publishArticleAnnotation(
      fake.client,
      INPUT,
      { blob: new Blob(['recording'], { type: 'audio/webm' }), durationMs: 1_500 },
      (value) => diagnostics.push(value),
    ),
    /primary publication error/,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message.includes('private cleanup details'), false);
});
