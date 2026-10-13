import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANNOTATION_FACT_CHECK_VERDICT_REQUIRED,
  ANNOTATION_NOTE_TYPE_LABELS,
  ANNOTATION_NOTE_TYPE_REQUIRED,
  ANNOTATION_SOURCE_LINKS_REQUIRED,
  ANNOTATION_SOURCE_URL_INVALID,
  ANNOTATION_VERDICT_LABELS,
  annotationNoteRpcArguments,
  getAnnotationNoteError,
  helpfulSourceCount,
  parseAnnotationConsensus,
  parseHelpfulRatingResult,
  isMissingAnnotationNoteSchema,
  parseStoredAnnotationNote,
  readAnnotationNoteForPublish,
} from './annotation-note.ts';

const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('fact check and receipts require source links, and fact check requires a verdict', () => {
  assert.equal(getAnnotationNoteError({ noteType: '', verdict: '', sourceUrls: [''] }), ANNOTATION_NOTE_TYPE_REQUIRED);
  assert.equal(getAnnotationNoteError({
    noteType: 'fact_check',
    verdict: '',
    sourceUrls: ['https://example.test/source'],
  }), ANNOTATION_FACT_CHECK_VERDICT_REQUIRED);
  assert.equal(getAnnotationNoteError({
    noteType: 'receipts',
    verdict: '',
    sourceUrls: ['  '],
  }), ANNOTATION_SOURCE_LINKS_REQUIRED);
  assert.equal(getAnnotationNoteError({
    noteType: 'context',
    verdict: '',
    sourceUrls: ['notaurl'],
  }), ANNOTATION_SOURCE_URL_INVALID);
  assert.equal(getAnnotationNoteError({
    noteType: 'hot_take',
    verdict: 'true',
    sourceUrls: [''],
  }), null);
  assert.equal(ANNOTATION_NOTE_TYPE_LABELS.steelman, 'Steelman');
  assert.equal(ANNOTATION_VERDICT_LABELS.needs_context, 'Needs context');
});

test('publish arguments keep only distinct valid source links', () => {
  const parsed = readAnnotationNoteForPublish({
    noteType: 'fact_check',
    verdict: 'misleading',
    sourceUrls: [
      ' https://example.test/a ',
      'https://example.test/a',
      '',
      'https://example.test/b',
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(annotationNoteRpcArguments(parsed.note), {
    p_note_type: 'fact_check',
    p_verdict: 'misleading',
    p_source_urls: ['https://example.test/a', 'https://example.test/b'],
  });
});

test('stored notes ignore unknown types and unsafe source links', () => {
  assert.deepEqual(parseStoredAnnotationNote('nope', 'true', []), {
    noteType: null,
    verdict: null,
    sourceLinks: [],
  });
  const parsed = parseStoredAnnotationNote('receipts', 'false', [
    { id: SOURCE_ID, url: 'https://example.test/receipt', position: 1 },
    { id: SOURCE_ID, url: 'javascript:alert(1)', position: 2 },
  ]);
  assert.equal(parsed.noteType, 'receipts');
  assert.equal(parsed.verdict, 'false');
  assert.deepEqual(parsed.sourceLinks, [{
    id: SOURCE_ID,
    url: 'https://example.test/receipt',
    position: 1,
  }]);
});

test('consensus and helpful results stay bounded', () => {
  const consensus = parseAnnotationConsensus({
    agree_count: '2',
    disagree_count: 1,
    viewer_agreement: null,
    sources: [{
      id: SOURCE_ID,
      url: 'https://example.test/receipt',
      position: 1,
      helpful_count: 4,
      viewer_helpful: false,
    }],
  });
  assert.equal(consensus?.agreeCount, 2);
  assert.equal(helpfulSourceCount(consensus?.sources ?? []), 4);
  assert.equal(parseAnnotationConsensus({ agree_count: -1, disagree_count: 0, viewer_agreement: null, sources: [] }), null);
  assert.equal(parseHelpfulRatingResult({
    result_code: 'RATE_LIMITED',
    helpful_count: 1,
    viewer_helpful: true,
    retry_after_seconds: 12,
  })?.retryAfterSeconds, 12);
  assert.equal(parseHelpfulRatingResult({
    result_code: 'CREATED',
    helpful_count: 1,
    viewer_helpful: true,
    retry_after_seconds: 12,
  }), null);
});

test('a missing classification column is the only schema error that falls back', () => {
  assert.equal(isMissingAnnotationNoteSchema({
    code: 'PGRST204',
    message: "Could not find the 'note_type' column of 'annotations' in the schema cache",
  }), true);
  assert.equal(isMissingAnnotationNoteSchema({
    code: 'PGRST200',
    message: "Could not find a relationship between 'annotations' and 'annotation_sources' in the schema cache",
  }), true);
  assert.equal(isMissingAnnotationNoteSchema({
    code: '42501',
    message: 'permission denied for table annotation_sources',
  }), false);
  assert.equal(isMissingAnnotationNoteSchema({
    code: 'PGRST204',
    message: "Could not find the 'title' column of 'annotations' in the schema cache",
  }), false);
});
