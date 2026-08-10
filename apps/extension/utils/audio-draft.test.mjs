import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioClipDraftBelongsToSource,
  deserializeAudioClipDraft,
  serializeAudioClipDraft,
} from './audio-draft.ts';

test('audio drafts persist only normalized source identity, range, and commentary', () => {
  const draft = serializeAudioClipDraft(
    'https://example.com/episode/42?t=30&utm_source=x',
    'https://example.com/episode/42',
    12_000,
    25_000,
    'A useful moment',
    123,
  );
  assert.equal(draft.source.normalizedUrl, 'https://example.com/episode/42');
  assert.deepEqual(deserializeAudioClipDraft(draft), draft);
});

test('same-source restoration ignores tracking and playback timestamps', () => {
  const draft = serializeAudioClipDraft(
    'https://example.com/listen?episode=42',
    'https://example.com/listen?episode=42',
    1_000,
    2_000,
    'Note',
  );
  assert.equal(audioClipDraftBelongsToSource(
    draft,
    'https://example.com/listen?utm_campaign=x&episode=42&t=90#player',
  ), true);
  assert.equal(audioClipDraftBelongsToSource(
    draft,
    'https://example.com/listen?episode=43',
  ), false);
});

test('malformed drafts and commentary over the limit are rejected', () => {
  assert.equal(deserializeAudioClipDraft({ version: 1 }), null);
  assert.throws(() => serializeAudioClipDraft(
    'https://example.com/episode',
    'https://example.com/episode',
    0,
    1_000,
    'x'.repeat(2_001),
  ));
});
