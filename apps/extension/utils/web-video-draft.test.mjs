import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deserializeWebVideoClipDraft,
  serializeWebVideoClipDraft,
  webVideoClipDraftBelongsToSource,
} from './web-video-draft.ts';

test('webpage video drafts retain normalized article identity without media delivery URLs', () => {
  const draft = serializeWebVideoClipDraft(
    'https://News.Example/story/?utm_source=mail&topic=video#player',
    1_000,
    8_000,
    'Commentary',
    42,
  );
  assert.deepEqual(draft.source, {
    pageUrl: 'https://news.example/story?topic=video',
    normalizedUrl: 'https://news.example/story?topic=video',
  });
  assert.equal(JSON.stringify(draft).includes('blob:'), false);
  assert.equal(webVideoClipDraftBelongsToSource(draft, 'https://news.example/story?topic=video#new'), true);
  assert.equal(webVideoClipDraftBelongsToSource(draft, 'https://news.example/other'), false);
});

test('webpage video draft deserialization rejects forged identity and unbounded commentary', () => {
  const draft = serializeWebVideoClipDraft('https://example.test/story', null, null, 'Saved', 10);
  assert.deepEqual(deserializeWebVideoClipDraft(draft), draft);
  assert.equal(deserializeWebVideoClipDraft({
    ...draft,
    source: { ...draft.source, normalizedUrl: 'https://example.test/other' },
  }), null);
  assert.equal(deserializeWebVideoClipDraft({ ...draft, commentary: 'x'.repeat(2_001) }), null);
});
