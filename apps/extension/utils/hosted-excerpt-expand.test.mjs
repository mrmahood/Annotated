import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  hostedExcerptExpandSessionKey,
  hostedExcerptStatusAfterLoad,
} from './hosted-excerpt-expand.ts';

const ANNOTATION = '41000000-0000-4000-8000-000000000001';

test('expand session key ignores loading status so the effect cannot self-cancel', () => {
  const expandedYoutube = {
    expanded: true,
    annotationId: ANNOTATION,
    kind: 'youtube',
  };
  assert.equal(hostedExcerptExpandSessionKey(expandedYoutube), `${ANNOTATION}:youtube`);
  assert.equal(
    hostedExcerptExpandSessionKey(expandedYoutube),
    hostedExcerptExpandSessionKey({ ...expandedYoutube }),
  );
  assert.equal(
    hostedExcerptExpandSessionKey({ ...expandedYoutube, expanded: false }),
    null,
  );
  assert.equal(
    hostedExcerptExpandSessionKey({ ...expandedYoutube, kind: 'article' }),
    null,
  );
  assert.equal(
    hostedExcerptExpandSessionKey({ ...expandedYoutube, kind: 'video' }),
    null,
  );
  assert.notEqual(
    hostedExcerptExpandSessionKey(expandedYoutube),
    hostedExcerptExpandSessionKey({ ...expandedYoutube, annotationId: '42000000-0000-4000-8000-000000000001' }),
  );
  assert.equal(
    Object.hasOwn(expandedYoutube, 'hostedStatus'),
    false,
  );
});

test('a completed load leaves the card ready or quietly unavailable, never spinning', () => {
  assert.equal(
    hostedExcerptStatusAfterLoad({
      status: 'ready',
      media: {
        id: '42000000-0000-4000-8000-000000000001',
        mimeType: 'video/mp4',
        durationMs: 9_000,
        width: 426,
        height: 240,
      },
      transcript: null,
    }),
    'ready',
  );
  assert.equal(hostedExcerptStatusAfterLoad({ status: 'removed' }), 'unavailable');
  assert.equal(hostedExcerptStatusAfterLoad(null), 'unavailable');
});

test('AnnotationCard fetch effect depends on expand identity, not hostedStatus', async () => {
  const source = await readFile(
    new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url),
    'utf8',
  );
  const card = source.slice(
    source.indexOf('function AnnotationCard'),
    source.indexOf('export function AnnotationCollection'),
  );

  assert.match(card, /hostedExcerptExpandSessionKey\(\{/);
  assert.match(card, /annotationId: annotation\.id/);
  assert.match(card, /kind: annotation\.kind/);
  assert.match(card, /\[expandSessionKey, supabase\]/);
  assert.doesNotMatch(card, /hostedStatus !== 'idle'/);
  assert.doesNotMatch(card, /\[annotation, expanded, hostedStatus, supabase\]/);
  assert.match(card, /Excerpt unavailable/);
  assert.match(card, /hasHostedExcerptTranscript/);
});
