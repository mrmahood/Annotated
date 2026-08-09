import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnnotationQueryPlan,
  classifySourceUrl,
  getCommentPageRange,
  mergeCommentPages,
  PUBLIC_ANNOTATION_STATUS,
  RequestRevision,
  requireParticipation,
  sortComments,
} from './social-helpers.ts';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

test('context annotation plan normalizes its source and remains published-only', () => {
  const plan = buildAnnotationQueryPlan({
    sourceUrl: 'HTTPS://Example.com/story/?utm_source=x&b=2&a=1#passage',
  });
  assert.equal(plan.normalizedUrl, 'https://example.com/story?a=1&b=2');
  assert.equal(plan.status, PUBLIC_ANNOTATION_STATUS);
  assert.deepEqual(plan.orders.map(({ column }) => column), ['published_at', 'id']);
});

test('global feed plan explicitly remains published-only', () => {
  const plan = buildAnnotationQueryPlan();
  assert.equal(plan.status, PUBLIC_ANNOTATION_STATUS);
  assert.equal(plan.normalizedUrl, undefined);
  assert.equal(plan.profileId, undefined);
});

test('context source discrimination normalizes supported YouTube videos by video identity', () => {
  const plan = buildAnnotationQueryPlan({
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=90&si=tracking',
  });
  assert.equal(plan.normalizedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(plan.status, PUBLIC_ANNOTATION_STATUS);
  assert.equal(classifySourceUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(classifySourceUrl('https://example.com/watch?v=dQw4w9WgXcQ'), 'article');
});

test('profile plans validate UUIDs', () => {
  assert.equal(buildAnnotationQueryPlan({ profileId: PROFILE_ID }).profileId, PROFILE_ID);
  assert.throws(() => buildAnnotationQueryPlan({ profileId: 'not-a-uuid' }));
});

test('comments are oldest first with ID ascending ties', () => {
  const comments = sortComments([
    { id: 'b', createdAt: '2026-08-08T12:00:00Z' },
    { id: 'c', createdAt: '2026-08-08T13:00:00Z' },
    { id: 'a', createdAt: '2026-08-08T12:00:00Z' },
  ]);
  assert.deepEqual(comments.map(({ id }) => id), ['a', 'b', 'c']);
});

test('comment pages merge without duplicates', () => {
  const merged = mergeCommentPages(
    [{ id: 'b', createdAt: '2026-08-08T12:00:00Z' }],
    [
      { id: 'b', createdAt: '2026-08-08T12:00:00Z' },
      { id: 'c', createdAt: '2026-08-08T13:00:00Z' },
    ],
  );
  assert.deepEqual(merged.map(({ id }) => id), ['b', 'c']);
});

test('comment pagination creates bounded inclusive ranges', () => {
  assert.deepEqual(getCommentPageRange(0), { from: 0, to: 19 });
  assert.deepEqual(getCommentPageRange(20), { from: 20, to: 39 });
  assert.throws(() => getCommentPageRange(-1));
});

test('request revisions reject stale source results', () => {
  const revisions = new RequestRevision();
  const first = revisions.begin();
  const second = revisions.begin();
  assert.equal(revisions.isCurrent(first), false);
  assert.equal(revisions.isCurrent(second), true);
});

test('participation guard requires an authenticated UUID', () => {
  assert.equal(requireParticipation(PROFILE_ID), PROFILE_ID);
  assert.throws(() => requireParticipation(null), /Authentication/);
  assert.throws(() => requireParticipation('invalid'), /Authentication/);
});
