import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnotationSelect, mapPublicAnnotation } from './social-data.ts';

const ANNOTATION_ID = '0ce69bb9-1264-4e45-9793-08a243127739';
const PROFILE_ID = '3e3882b6-1111-4111-8111-111111111111';
const NYT_URL =
  'https://www.nytimes.com/2026/09/04/us/politics/trump-administration-fund-compensation-jan-6.html';
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
  assert.match(globalSelect, /\btitle,\s*\n\s*commentary_text/);
  assert.match(globalSelect, /source_type/);
  assert.doesNotMatch(globalSelect, /createSignedUrl|processed_storage_path|service_role/);
});

test('maps the Staging NYT hosted audio fixture as an Audio feed card', () => {
  const mapped = mapPublicAnnotation(baseRow());
  assert.equal(mapped?.kind, 'audio');
  assert.equal(mapped?.title, null);
  assert.equal(mapped?.id, ANNOTATION_ID);
  assert.equal(mapped?.startMs, 0);
  assert.equal(mapped?.endMs, 16_000);
  assert.equal(mapped?.source.type, 'podcast');
  assert.equal(mapped?.source.canonicalUrl, NYT_URL);
  assert.equal(mapped?.hosted, null);
  assert.equal(mapped?.route?.creatorHandle, 'matt-mahood-3e3882b6');
  assert.equal(mapped?.route?.annotationSlug, NYT_SLUG);
});

test('projects a creator-entered title without inventing one from the source nest', () => {
  const mapped = mapPublicAnnotation(baseRow({ title: '  Voice-only take  ' }));
  assert.equal(mapped?.title, 'Voice-only take');
  assert.equal(mapped?.source.title, baseRow().source.title);
  assert.notEqual(mapped?.title, mapped?.source.title);
  assert.equal(mapPublicAnnotation(baseRow({ title: '   ' }))?.title, null);
  assert.equal(mapPublicAnnotation(baseRow({ title: 'A'.repeat(121) }))?.title, null);
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

test('maps voice-only commentary when typed text is empty and audio metadata is present', () => {
  const mapped = mapPublicAnnotation(baseRow({
    commentary_text: '',
    audio: {
      storage_path: `${PROFILE_ID}/22222222-2222-4222-8222-222222222222.webm`,
      duration_ms: 4_000,
      mime_type: 'audio/webm',
      byte_size: 2_048,
    },
  }));
  assert.equal(mapped?.kind, 'audio');
  assert.equal(mapped?.commentaryText, '');
  assert.equal(mapped?.audio?.durationMs, 4_000);
});

test('does not project audio_clip rows that still point at an article source', () => {
  assert.equal(
    mapPublicAnnotation(baseRow({
      source: { ...baseRow().source, source_type: 'article' },
    })),
    null,
  );
});

test('projects webpage video_clip rows that use the article page as source identity', () => {
  const mapped = mapPublicAnnotation(baseRow({
    commentary_text: 'this clip on the news player is the claim',
    annotation_type: 'video_clip',
    source: {
      ...baseRow().source,
      source_type: 'article',
    },
    target: {
      target_type: 'time_range',
      selected_text: null,
      start_ms: 1_000,
      end_ms: 8_000,
    },
  }));
  assert.equal(mapped?.kind, 'video');
  assert.equal(mapped?.source.type, 'article');
  assert.equal(mapped?.startMs, 1_000);
  assert.equal(mapped?.endMs, 8_000);
  assert.equal(mapped?.hosted, null);
  assert.equal(mapped?.source.canonicalUrl, NYT_URL);
});

test('projects TikTok video_clip rows as a first-class tiktok Feed kind', () => {
  const watch = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
  const mapped = mapPublicAnnotation(baseRow({
    commentary_text: 'this Reuters clip is the claim',
    annotation_type: 'video_clip',
    source: {
      ...baseRow().source,
      canonical_url: watch,
      normalized_url: watch,
      source_type: 'tiktok',
      title: 'BBC News clip',
      publisher: 'TikTok',
    },
    target: {
      target_type: 'time_range',
      selected_text: null,
      start_ms: 1_000,
      end_ms: 8_000,
    },
  }));
  assert.equal(mapped?.kind, 'tiktok');
  assert.equal(mapped?.source.type, 'tiktok');
  assert.equal(mapped?.source.videoId, '7550123456789012345');
  assert.equal(mapped?.startMs, 1_000);
  assert.equal(mapped?.endMs, 8_000);
  assert.equal(mapped?.hosted, null);
});

test('does not project TikTok watch URLs as webpage video cards', () => {
  const watch = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
  assert.equal(
    mapPublicAnnotation(baseRow({
      annotation_type: 'video_clip',
      source: {
        ...baseRow().source,
        canonical_url: watch,
        normalized_url: watch,
        source_type: 'article',
      },
      target: {
        target_type: 'time_range',
        selected_text: null,
        start_ms: 1_000,
        end_ms: 8_000,
      },
    })),
    null,
  );
});

test('the same URL can project article text, webpage video, and podcast audio as separate cards', () => {
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
  const video = mapPublicAnnotation(baseRow({
    annotation_type: 'video_clip',
    source: {
      ...baseRow().source,
      source_type: 'article',
    },
    target: {
      target_type: 'time_range',
      selected_text: null,
      start_ms: 2_000,
      end_ms: 9_000,
    },
  }));
  const audio = mapPublicAnnotation(baseRow());
  assert.equal(article?.kind, 'article');
  assert.equal(video?.kind, 'video');
  assert.equal(audio?.kind, 'audio');
  assert.equal(article?.source.canonicalUrl, video?.source.canonicalUrl);
  assert.equal(video?.source.canonicalUrl, audio?.source.canonicalUrl);
});
