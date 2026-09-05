import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deserializeTikTokClipDraft,
  serializeTikTokClipDraft,
  tiktokClipDraftBelongsToSource,
} from './tiktok-draft.ts';

const WATCH = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';

test('persists clip identity, time range, and commentary', () => {
  const draft = serializeTikTokClipDraft(`${WATCH}?t=12`, 1_000, 8_000, 'Commentary', 123);
  assert.equal(draft.source.normalizedUrl, WATCH);
  assert.equal(draft.source.handle, 'bbcnews');
  assert.deepEqual(deserializeTikTokClipDraft(structuredClone(draft)), draft);
});

test('restores only onto the same normalized TikTok video', () => {
  const draft = serializeTikTokClipDraft(WATCH, 0, 10_000, 'Draft');
  assert.equal(tiktokClipDraftBelongsToSource(draft, `https://m.tiktok.com/@bbcnews/video/7550123456789012345`), true);
  assert.equal(tiktokClipDraftBelongsToSource(draft, 'https://www.tiktok.com/@bbcnews/video/7550999999999999999'), false);
  assert.equal(tiktokClipDraftBelongsToSource(draft, 'https://example.com/article'), false);
});

test('rejects malformed source identity and commentary', () => {
  const draft = serializeTikTokClipDraft(WATCH, null, null, 'Draft');
  assert.equal(deserializeTikTokClipDraft({
    ...draft,
    source: { ...draft.source, videoId: '7550999999999999999' },
  }), null);
  assert.throws(() => serializeTikTokClipDraft(WATCH, 0, 1_000, 'x'.repeat(2_001)));
});
