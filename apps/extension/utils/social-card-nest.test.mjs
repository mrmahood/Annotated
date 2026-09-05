import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Feed cards are commentary-led with a nested source and always-visible Open source', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
  ]);
  const card = source.slice(
    source.indexOf('function AnnotationCard'),
    source.indexOf('export function AnnotationCollection'),
  );

  assert.match(card, /function AnnotationCard/);
  assert.match(card, /className="commentary-lead"/);
  assert.match(card, /className="nested-source"/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(card, /Open source ↗/);
  assert.match(card, /sourceOpenHref\(annotation\)/);
  assert.match(card, /handleArticleSourceOpenClick/);
  assert.match(source, /getSourceOpenUrl/);
  assert.match(card, /queryPublicHostedExcerpt/);
  assert.match(card, /HostedExcerptPlayer/);
  assert.match(card, /compact/);
  assert.match(card, /transcript-peek/);
  assert.match(card, /hostedTranscript &&/);
  assert.match(card, /youtubeHoverRegionHandlers/);
  assert.match(card, /youtubeHoverNestedChipHandlers/);
  assert.match(card, /enterYouTubeHoverLink/);
  assert.match(card, /articleHoverRegionHandlers/);
  assert.match(card, /articleHoverNestedChipHandlers/);
  assert.match(card, /articlePassageHoverTarget/);
  assert.match(card, /onArticleHoverResult/);
  assert.match(card, /ArticlePassageMissStatus/);
  assert.match(card, /handleArticleSourceOpenClick\(event, annotation, articleHover, sourceUrl, onArticleHoverResult\)/);
  assert.match(source, /ARTICLE_PASSAGE_MISS_STATUS/);
  assert.match(source, /ARTICLE_PASSAGE_MISS_OPEN_HINT/);
  assert.match(source, /status === 'unmatched'/);
  assert.match(source, /role="status"/);
  assert.match(source, /annotationMatchesConnectedArticle\(annotation, connection\.tabUrl\)/);
  assert.match(styles, /\.article-passage-miss/);
  assert.match(card, /View annotation/);
  assert.doesNotMatch(card, /className="annotation-card-main"/);
  assert.doesNotMatch(card, /Commentary/);
  assert.doesNotMatch(card, /CLIP&nbsp;/);
  assert.doesNotMatch(card, /YouTube video/);
  assert.doesNotMatch(card, /createSignedUrl|processed_storage_path|console\.(?:log|info|debug|warn)/);

  assert.match(styles, /\.commentary-lead/);
  assert.match(styles, /\.nested-source/);
  assert.match(styles, /\.open-source-link/);
  assert.match(styles, /\.create-mode-segmented/);
  assert.match(styles, /--accent:/);
  assert.match(styles, /--motion-duration: 180ms/);
});

test('in-feed expand loads hosted media only through the public excerpt helper', async () => {
  const [card, data] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./social-data.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(data, /export async function queryPublicHostedExcerpt/);
  assert.match(data, /return loadHostedExcerpt\(supabase, annotation\)/);
  assert.match(card, /queryPublicHostedExcerpt\(supabase, current\)/);
  assert.match(card, /hostedReady && \(/);
  assert.doesNotMatch(card, /\.from\(['"]annotation_(?:media|transcripts)['"]\)/);
});
