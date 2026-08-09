import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANNOTATION_DRAFT_STORAGE_KEY,
  annotationDraftBelongsToContext,
  deserializeAnnotationDraft,
  serializeAnnotationDraft,
  shouldApplyDraftRestoration,
  shouldClearAnnotationDraft,
  updateAnnotationDraftCommentary,
} from './annotation-draft.ts';

const CONTEXT = {
  tabId: 42,
  windowId: 7,
  title: 'An article',
  url: 'https://Example.test/article/?utm_source=mail#selection',
  capturedAt: 1_786_291_200_000,
};

const CAPTURE = {
  selectedText: 'A captured passage',
  textPrefix: 'Text before the passage',
  textSuffix: 'Text after the passage',
  pageTitle: 'An article',
  sourceUrl: 'https://example.test/article',
  canonicalUrl: 'https://example.test/article',
  hostname: 'example.test',
  author: 'Author Name',
  publisher: 'Example Publisher',
  capturedAt: '2026-08-09T12:00:00.000Z',
};

test('serializes and deserializes a valid text-only draft', () => {
  const draft = serializeAnnotationDraft(CONTEXT, CAPTURE, 'Draft commentary', 123);
  assert.equal(ANNOTATION_DRAFT_STORAGE_KEY, 'annotated.annotationDraft.v1');
  assert.deepEqual(deserializeAnnotationDraft(structuredClone(draft)), draft);
  assert.equal(draft.source.normalizedUrl, 'https://example.test/article');
  assert.equal(JSON.stringify(draft).includes('Blob'), false);
  assert.equal(Object.hasOwn(draft, 'audio'), false);
});

test('commentary updates preserve captured passage and source identity', () => {
  const draft = serializeAnnotationDraft(CONTEXT, CAPTURE, '', 123);
  const updated = updateAnnotationDraftCommentary(draft, 'New commentary', 456);
  assert.equal(updated.commentary, 'New commentary');
  assert.equal(updated.updatedAt, 456);
  assert.deepEqual(updated.capture, CAPTURE);
  assert.deepEqual(updated.source, draft.source);
});

test('a draft belongs only to the same connected tab and normalized source', () => {
  const draft = serializeAnnotationDraft(CONTEXT, CAPTURE, 'Commentary', 123);
  assert.equal(annotationDraftBelongsToContext(draft, {
    ...CONTEXT,
    url: 'https://example.test/article?utm_campaign=again#another-fragment',
  }), true);
  assert.equal(annotationDraftBelongsToContext(draft, { ...CONTEXT, tabId: 43 }), false);
  assert.equal(annotationDraftBelongsToContext(draft, {
    ...CONTEXT,
    url: 'https://example.test/unrelated-article',
  }), false);
});

test('mismatched and malformed drafts are not restored as current', () => {
  const draft = serializeAnnotationDraft(CONTEXT, CAPTURE, 'Commentary', 123);
  assert.equal(shouldApplyDraftRestoration(0, 0, draft, {
    ...CONTEXT,
    url: 'https://unrelated.test/article',
  }), false);
  assert.equal(deserializeAnnotationDraft({ ...draft, version: 2 }), null);
  assert.equal(deserializeAnnotationDraft({ ...draft, commentary: 'x'.repeat(2_001) }), null);
});

test('a stale asynchronous restoration cannot overwrite newer draft state', () => {
  const draft = serializeAnnotationDraft(CONTEXT, CAPTURE, 'Old commentary', 123);
  assert.equal(shouldApplyDraftRestoration(4, 5, draft, CONTEXT), false);
  assert.equal(shouldApplyDraftRestoration(5, 5, draft, CONTEXT), true);
});

test('only publish, explicit clear, and source invalidation clear the text draft', () => {
  assert.equal(shouldClearAnnotationDraft('publish-succeeded'), true);
  assert.equal(shouldClearAnnotationDraft('explicit-clear'), true);
  assert.equal(shouldClearAnnotationDraft('source-invalidated'), true);
  assert.equal(shouldClearAnnotationDraft('unmount'), false);
  assert.equal(shouldClearAnnotationDraft('navigation'), false);
  assert.equal(shouldClearAnnotationDraft('audio-discard'), false);
  assert.equal(shouldClearAnnotationDraft('audio-failure'), false);
});
