import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANNOTATION_TITLE_ERROR,
  ANNOTATION_TITLE_MAX_LENGTH,
  getAnnotationTitleError,
  normalizeAnnotationTitle,
  parseStoredAnnotationTitle,
  readDraftAnnotationTitle,
} from './annotation-title.ts';

test('annotation titles are optional one-liners capped at 120 characters', () => {
  assert.equal(ANNOTATION_TITLE_MAX_LENGTH, 120);
  assert.equal(getAnnotationTitleError(''), null);
  assert.equal(getAnnotationTitleError('A'.repeat(120)), null);
  assert.equal(getAnnotationTitleError('A'.repeat(121)), ANNOTATION_TITLE_ERROR);
  assert.equal(normalizeAnnotationTitle('  Quiet take  '), 'Quiet take');
  assert.equal(normalizeAnnotationTitle('   '), null);
  assert.equal(normalizeAnnotationTitle(''), null);
  assert.equal(normalizeAnnotationTitle(null), null);
  assert.equal(parseStoredAnnotationTitle(null), null);
  assert.equal(parseStoredAnnotationTitle('  Headline  '), 'Headline');
  assert.equal(parseStoredAnnotationTitle('A'.repeat(121)), null);
  assert.equal(readDraftAnnotationTitle(undefined), '');
  assert.equal(readDraftAnnotationTitle('Saved title'), 'Saved title');
  assert.equal(readDraftAnnotationTitle('A'.repeat(121)), '');
});

test('title never substitutes for typed or voice commentary', () => {
  assert.equal(normalizeAnnotationTitle('A title alone'), 'A title alone');
  assert.notEqual(normalizeAnnotationTitle('A title alone'), null);
  assert.equal(
    ANNOTATION_TITLE_MAX_LENGTH < 2_000,
    true,
    'title stays a short one-liner, not a second commentary essay',
  );
});
