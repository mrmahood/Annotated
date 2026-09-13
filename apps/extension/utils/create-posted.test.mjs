import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createPostedConfirmation,
  createPostedKindFromMediaType,
  isCreatePostedConfirmation,
  queryPostedAnnotationRoute,
} from './create-posted.ts';

const ANNOTATION_ID = '11111111-1111-4111-8111-111111111111';

test('Posted confirmation prefers handle/slug and falls back to /a/{id}', () => {
  assert.deepEqual(createPostedConfirmation({
    annotationId: ANNOTATION_ID,
    kind: 'video',
    creatorHandle: 'reader-one',
    annotationSlug: 'source-title',
  }), {
    annotationId: ANNOTATION_ID,
    kind: 'video',
    publicPath: '/reader-one/source-title',
  });
  assert.deepEqual(createPostedConfirmation({
    annotationId: ANNOTATION_ID,
    kind: 'audio',
  }), {
    annotationId: ANNOTATION_ID,
    kind: 'audio',
    publicPath: `/a/${ANNOTATION_ID}`,
  });
  assert.equal(createPostedKindFromMediaType('audio'), 'audio');
  assert.equal(createPostedKindFromMediaType('video'), 'video');
});

test('Posted confirmation rejects reserved handles and malformed storage', () => {
  assert.equal(createPostedConfirmation({
    annotationId: ANNOTATION_ID,
    kind: 'text',
    creatorHandle: 'api',
    annotationSlug: 'source-title',
  }).publicPath, `/a/${ANNOTATION_ID}`);
  assert.equal(isCreatePostedConfirmation({
    annotationId: ANNOTATION_ID,
    kind: 'text',
    publicPath: '/reader-one/source-title',
  }), true);
  assert.equal(isCreatePostedConfirmation({
    annotationId: 'bad',
    kind: 'text',
    publicPath: '/reader-one/source-title',
  }), false);
});

test('Posted route lookup uses the annotation slug and creator username', async () => {
  const client = {
    from(name) {
      assert.equal(name, 'annotations');
      return {
        select(columns) {
          assert.match(columns, /slug/);
          assert.match(columns, /username/);
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, ANNOTATION_ID);
              return {
                async maybeSingle() {
                  return {
                    data: { slug: 'source-title', creator: { username: 'reader-one' } },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await queryPostedAnnotationRoute(client, ANNOTATION_ID), {
    creatorHandle: 'reader-one',
    annotationSlug: 'source-title',
  });
});

test('Create uses one Posted panel for text, video, and audio', async () => {
  const [app, panel, style] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/create-posted.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
  ]);
  assert.match(panel, /<strong>Posted<\/strong>/);
  assert.match(panel, /create-posted-mark/);
  assert.match(panel, /Open posted annotation/);
  assert.match(panel, /Create another/);
  assert.doesNotMatch(panel, /hosted-media-spinner/);
  assert.match(style, /\.create-posted-mark[^}]*background: var\(--success\)/);
  assert.match(app, /kind: 'text'/);
  assert.match(app, /showCreatePosted\(result\.confirmation\)/);
  assert.match(app, /queryPostedAnnotationRoute\(supabase, annotationId\)/);
  assert.match(app, /postedConfirmation === null/);
  assert.match(app, /hostedMediaProgressCopy/);
  assert.doesNotMatch(app, /getPostPublishNavigation/);
  assert.doesNotMatch(app, /chrome\.notifications/);
});
