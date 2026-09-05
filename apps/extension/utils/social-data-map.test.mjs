import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnotationSelect, mapPublicAnnotation } from './social-data.ts';

const ANNOTATION_ID = '0ce69bb9-1264-4e45-9793-08a243127739';
const PROFILE_ID = '3e3882b6-1111-4111-8111-111111111111';
const NYT_URL =
  'https://www.nytimes.com/2026/09/05/us/politics/judge-orders-trump-officials-to-divulge-names-of-those-who-set-up-1-8-billion-fund.html';
const NYT_SLUG =
  'judge-orders-trump-officials-to-divulge-names-of-those-who-set-up-1-8-billion-fund-0ce69bb9';

function baseRow(overrides = {}) {
  return {
    id: ANNOTATION_ID,
    slug: NYT_SLUG,
    commentary_text: 'testing audio annotation on page with existing text annotation',
    published_at: '2026-09-05T18:00:00.000Z',
    creator: {
      id: PROFILE_ID,
      username: 'matt-mahood-3e3882b6',
      display_name: 'Matt',
      avatar_url: null,
    },
    source: {
      canonical_url: NYT_URL,
      normalized_url: NYT_URL,
      source_type: 'podcast',
      title: 'Judge Orders Trump Officials to Divulge Names of Those Who Set Up $1.8 Billion Fund',
      author: null,
      publisher: 'The New York Times',
      metadata: {},
    },
    target: {
      target_type: 'time_range',
      selected_text: null,
      start_ms: 0,
      end_ms: 16_000,
    },
    annotation_type: 'audio_clip',
    audio: [],
    ...overrides,
  };
}

test('global feed select uses the annotation source FK and inner-joins only for URL listings', () => {
  const globalSelect = buildAnnotationSelect();
  const listingSelect = buildAnnotationSelect({ innerSource: true });
  assert.match(globalSelect, /source:sources!annotations_source_id_fkey\(/);
  assert.doesNotMatch(globalSelect, /sources!inner/);
  assert.match(listingSelect, /source:sources!annotations_source_id_fkey!inner\(/);
  assert.match(globalSelect, /annotation_type/);
  assert.match(globalSelect, /source_type/);
  assert.doesNotMatch(globalSelect, /createSignedUrl|processed_storage_path|service_role/);
});

test('maps the Staging NYT hosted audio fixture as an Audio feed card', () => {
  const mapped = mapPublicAnnotation(baseRow());
  assert.equal(mapped?.kind, 'audio');
  assert.equal(mapped?.id, ANNOTATION_ID);
  assert.equal(mapped?.startMs, 0);
  assert.equal(mapped?.endMs, 16_000);
  assert.equal(mapped?.source.type, 'podcast');
  assert.equal(mapped?.source.canonicalUrl, NYT_URL);
  assert.equal(mapped?.hosted, null);
  assert.equal(mapped?.route?.creatorHandle, 'matt-mahood-3e3882b6');
  assert.equal(mapped?.route?.annotationSlug, NYT_SLUG);
});

test('keeps published audio when the public route is missing instead of dropping the card', () => {
  const mapped = mapPublicAnnotation(baseRow({ slug: null }));
  assert.equal(mapped?.kind, 'audio');
  assert.equal(mapped?.route, null);
});

test('the same NYT URL can project article text and podcast audio as separate cards', () => {
  const audio = mapPublicAnnotation(baseRow());
  const article = mapPublicAnnotation(baseRow({
    annotation_type: 'article_text',
    source: {
      ...baseRow().source,
      source_type: 'article',
    },
    target: {
      target_type: 'text',
      selected_text: 'Judge Davis’s order, issued in Federal District Court.',
      start_ms: null,
      end_ms: null,
    },
  }));
  assert.equal(audio?.kind, 'audio');
  assert.equal(article?.kind, 'article');
  assert.equal(article?.selectedText.includes('Judge Davis'), true);
});

test('does not project audio_clip rows that still point at an article source', () => {
  assert.equal(
    mapPublicAnnotation(baseRow({
      source: { ...baseRow().source, source_type: 'article' },
    })),
    null,
  );
});
