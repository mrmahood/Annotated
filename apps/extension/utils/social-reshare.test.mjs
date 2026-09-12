import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  feedItemKey,
  normalizeReshareComment,
  parseCurrentReshareIds,
  parseTimelineRow,
  RESHARE_COMMENT_LIMIT,
} from './social-helpers.ts';

const ANNOTATION_ID = '63000000-0000-4000-8000-000000000001';
const RESHARE_ID = '64000000-0000-4000-8000-000000000001';
const USER_ID = '61000000-0000-4000-8000-000000000002';

test('extension reshare comments match the 1,000-character product norm', () => {
  assert.equal(RESHARE_COMMENT_LIMIT, 1_000);
  assert.equal(normalizeReshareComment(''), null);
  assert.equal(normalizeReshareComment(' Shared note '), 'Shared note');
  assert.throws(() => normalizeReshareComment('x'.repeat(1_001)), /1,000 characters/);
});

test('extension timeline rows accept nested reshares of the same target annotation', () => {
  const row = parseTimelineRow({
    item_kind: 'reshare',
    item_id: RESHARE_ID,
    occurred_at: '2026-09-12T15:00:00.000Z',
    annotation_id: ANNOTATION_ID,
    resharer_user_id: USER_ID,
    reshare_comment: null,
  });
  assert.equal(row?.itemKind, 'reshare');
  assert.equal(row?.annotationId, ANNOTATION_ID);
  assert.equal(row?.resharerUserId, USER_ID);
  assert.deepEqual([...parseCurrentReshareIds([{ annotation_id: ANNOTATION_ID }])], [ANNOTATION_ID]);
  assert.equal(feedItemKey({ annotation: { id: ANNOTATION_ID }, reshare: { id: RESHARE_ID } }), `reshare:${RESHARE_ID}`);
});

test('extension social data uses trusted reshare RPCs instead of table reads', async () => {
  const source = await readFile(new URL('./social-data.ts', import.meta.url), 'utf8');
  assert.match(source, /list_public_timeline_items/);
  assert.match(source, /create_annotation_reshare/);
  assert.match(source, /remove_annotation_reshare/);
  assert.match(source, /get_current_annotation_reshares/);
    assert.doesNotMatch(source, /from\('annotation_reshares'\)/);
});
