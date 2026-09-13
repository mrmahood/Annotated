import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnnotationQueryPlan,
  classifySourceUrl,
  getCommentPageRange,
  getPublicAnnotationPath,
  mergeCommentPages,
  parsePublicAnnotationRoute,
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
  assert.deepEqual(plan.normalizedUrls, ['https://example.com/story?a=1&b=2']);
  assert.equal(plan.status, PUBLIC_ANNOTATION_STATUS);
  assert.deepEqual(plan.orders.map(({ column }) => column), ['published_at', 'id']);
});

test('page listings include both article and audio identities for the same URL', () => {
  const plan = buildAnnotationQueryPlan({
    sourceUrl: 'https://example.com/story?t=20',
  });
  assert.equal(plan.normalizedUrl, 'https://example.com/story?t=20');
  assert.deepEqual(plan.normalizedUrls, [
    'https://example.com/story?t=20',
    'https://example.com/story',
  ]);
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
  assert.deepEqual(plan.normalizedUrls, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.equal(plan.status, PUBLIC_ANNOTATION_STATUS);
  assert.equal(classifySourceUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(classifySourceUrl('https://example.com/watch?v=dQw4w9WgXcQ'), 'article');
});

test('context source discrimination normalizes supported TikTok videos by watch identity', () => {
  const plan = buildAnnotationQueryPlan({
    sourceUrl: 'https://m.tiktok.com/@bbcnews/video/7550123456789012345?is_from_webapp=1',
  });
  assert.equal(plan.normalizedUrl, 'https://www.tiktok.com/@bbcnews/video/7550123456789012345');
  assert.deepEqual(plan.normalizedUrls, ['https://www.tiktok.com/@bbcnews/video/7550123456789012345']);
  assert.equal(classifySourceUrl('https://www.tiktok.com/@bbcnews/video/7550123456789012345'), 'tiktok');
  assert.equal(classifySourceUrl('https://www.tiktok.com/foryou'), 'article');
});

test('profile plans validate UUIDs', () => {
  assert.equal(buildAnnotationQueryPlan({ profileId: PROFILE_ID }).profileId, PROFILE_ID);
  assert.throws(() => buildAnnotationQueryPlan({ profileId: 'not-a-uuid' }));
});

test('public annotation paths prefer validated canonical identity with UUID fallback only', () => {
  assert.deepEqual(
    parsePublicAnnotationRoute('reader-one', 'source-title'),
    { creatorHandle: 'reader-one', annotationSlug: 'source-title' },
  );
  assert.equal(parsePublicAnnotationRoute(null, null), null);
  assert.equal(parsePublicAnnotationRoute('../admin', 'source-title'), undefined);
  assert.equal(parsePublicAnnotationRoute('reader-one', null), undefined);
  assert.equal(
    getPublicAnnotationPath(
      { creatorHandle: 'reader-one', annotationSlug: 'source-title' },
      PROFILE_ID,
    ),
    '/reader-one/source-title',
  );
  assert.equal(getPublicAnnotationPath(null, PROFILE_ID), `/a/${PROFILE_ID}`);
  assert.throws(
    () => getPublicAnnotationPath(
      { creatorHandle: '../admin', annotationSlug: 'source-title' },
      PROFILE_ID,
    ),
    /route identity/i,
  );
  for (const creatorHandle of ['api', 'auth', '_next', 'privacy', 'terms', 'legal']) {
    assert.equal(parsePublicAnnotationRoute(creatorHandle, 'source-title'), undefined);
    assert.throws(
      () => getPublicAnnotationPath({ creatorHandle, annotationSlug: 'source-title' }, PROFILE_ID),
      /route identity/i,
    );
  }
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
