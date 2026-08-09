import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deserializeYouTubeClipDraft,
  serializeYouTubeClipDraft,
  youtubeClipDraftBelongsToSource,
} from './youtube-draft.ts';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('persists clip identity, time range, and commentary', () => {
  const draft = serializeYouTubeClipDraft(`${WATCH}&t=42`, 42_000, 73_000, 'Commentary', 123);
  assert.equal(draft.source.normalizedUrl, WATCH);
  assert.deepEqual(deserializeYouTubeClipDraft(structuredClone(draft)), draft);
});

test('restores only onto the same normalized YouTube video', () => {
  const draft = serializeYouTubeClipDraft(WATCH, 0, 10_000, 'Draft');
  assert.equal(youtubeClipDraftBelongsToSource(draft, `https://youtu.be/dQw4w9WgXcQ?t=90`), true);
  assert.equal(youtubeClipDraftBelongsToSource(draft, 'https://youtu.be/9bZkp7q19f0'), false);
  assert.equal(youtubeClipDraftBelongsToSource(draft, 'https://example.com/article'), false);
});

test('rejects malformed source identity and commentary', () => {
  const draft = serializeYouTubeClipDraft(WATCH, null, null, 'Draft');
  assert.equal(deserializeYouTubeClipDraft({ ...draft, source: { ...draft.source, videoId: '9bZkp7q19f0' } }), null);
  assert.throws(() => serializeYouTubeClipDraft(WATCH, 0, 1_000, 'x'.repeat(2_001)));
});
