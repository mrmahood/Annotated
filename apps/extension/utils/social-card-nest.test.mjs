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
  assert.match(card, /className="annotation-title"/);
  assert.match(card, /className="commentary-lead"/);
  assert.match(card, /className="commentary-audio"/);
  assert.match(card, /className="nested-source"/);
  assert.ok(
    card.indexOf('className="annotation-title"') < card.indexOf('className="commentary-lead"'),
    "creator title must lead typed commentary when present",
  );
  assert.ok(
    card.indexOf('className="commentary-lead"') < card.indexOf('className="commentary-audio"'),
    "typed commentary must appear before voice commentary",
  );
  assert.ok(
    card.indexOf('className="commentary-audio"') < card.indexOf('className="nested-source"'),
    "voice commentary must appear above nested source clip or passage",
  );
  assert.doesNotMatch(card, /expanded && hasCommentaryAudio && audioUrl &&/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(card, /Open source ↗/);
  assert.match(card, /sourceOpenHref\(annotation\)/);
  assert.match(card, /handleSourceOpenClick/);
  assert.match(source, /getSourceOpenUrl/);
  assert.match(card, /queryPublicHostedExcerpt/);
  assert.match(card, /HostedExcerptPlayer/);
  assert.match(card, /compact/);
  assert.match(card, /transcript-peek/);
  assert.match(card, /hostedTranscript &&/);
  assert.match(card, /youtubeHoverRegionHandlers/);
  assert.match(card, /youtubeHoverNestedChipHandlers/);
  assert.match(card, /enterYouTubeHoverLink/);
  assert.doesNotMatch(card, /seekMs/);
  assert.match(card, /articleHoverRegionHandlers/);
  assert.match(card, /articleHoverNestedChipHandlers/);
  assert.match(card, /articlePassageHoverTarget/);
  assert.match(card, /onArticleHoverResult/);
  assert.match(card, /ArticlePassageMissStatus/);
  assert.match(card, /handleSourceOpenClick\(event, annotation, articleHover, audioHover, pageVideoHover, tiktokHover, spotifyHover, sourceUrl, onArticleHoverResult, annotation\.kind === 'audio' \? onAudioAwaitingConnection : annotation\.kind === 'video' \? onPageVideoAwaitingConnection : annotation\.kind === 'tiktok' \? onTikTokAwaitingConnection : annotation\.kind === 'spotify' \? onSpotifyAwaitingConnection : onAwaitingConnection\)/);
  assert.match(card, /tiktokHoverRegionHandlers/);
  assert.match(card, /tiktokHoverNestedChipHandlers/);
  assert.match(card, /tiktokClipHoverTarget/);
  assert.match(card, /TikTokPendingConnectHint/);
  assert.match(card, /spotifyHoverRegionHandlers/);
  assert.match(card, /spotifyHoverNestedChipHandlers/);
  assert.match(card, /spotifyClipHoverTarget/);
  assert.match(card, /SpotifyPendingConnectHint/);
  assert.match(card, /ArticlePendingConnectHint/);
  assert.match(card, /audioHoverRegionHandlers/);
  assert.match(card, /audioHoverNestedChipHandlers/);
  assert.match(card, /audioClipHoverTarget/);
  assert.match(card, /AudioPendingConnectHint/);
  assert.match(card, /pageVideoHoverRegionHandlers/);
  assert.match(card, /pageVideoHoverNestedChipHandlers/);
  assert.match(card, /pageVideoClipHoverTarget/);
  assert.match(card, /PageVideoPendingConnectHint/);
  assert.match(source, /handleAudioSourceOpenClick/);
  assert.match(source, /ARTICLE_PENDING_CONNECT_HINT/);
  assert.match(source, /ARTICLE_HOVER_LAST_APPLY_KEY/);
  assert.match(source, /readArticleHoverLastApply/);
  assert.match(source, /openArticleSourceFromPanel/);
  assert.match(styles, /\.article-pending-connect-hint/);
  assert.match(source, /ARTICLE_PASSAGE_MISS_STATUS/);
  assert.match(source, /ARTICLE_PASSAGE_MISS_OPEN_HINT/);
  assert.match(source, /status === 'unmatched'/);
  assert.match(source, /role="status"/);
  assert.match(source, /annotationMatchesConnectedArticle\(annotation, connection\.tabUrl\)/);
  assert.match(styles, /\.article-passage-miss/);
  assert.match(card, /View annotation/);
  assert.doesNotMatch(card, /className="annotation-card-main"/);
  assert.doesNotMatch(card, />Commentary</);
  assert.doesNotMatch(card, /hasCommentaryAudio \? 'Voice commentary'/);
  assert.doesNotMatch(card, />Voice commentary</);
  assert.doesNotMatch(card, />Audio commentary</);
  assert.doesNotMatch(card, />The annotation</);
  assert.match(card, /aria-label="Published audio commentary"/);
  assert.doesNotMatch(card, /CLIP&nbsp;/);
  assert.doesNotMatch(card, /YouTube video/);
  assert.doesNotMatch(card, /createSignedUrl|processed_storage_path|console\.(?:log|info|debug|warn)/);

  assert.match(styles, /\.annotation-title/);
  assert.match(styles, /\.commentary-lead/);
  assert.match(styles, /\.commentary-audio/);
  assert.match(styles, /\.nested-source/);
  assert.match(styles, /\.open-source-link/);
  assert.match(styles, /\.card-hosted-media\[data-orientation="portrait"\] video/);
  assert.match(styles, /aspect-ratio: var\(--hosted-video-aspect, 9 \/ 16\)/);
  assert.match(styles, /max-height: none/);
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

test('Feed remount shows cache then revalidates so a newly published audio card can appear', async () => {
  const source = await readFile(
    new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url),
    'utf8',
  );
  const collection = source.slice(
    source.indexOf('export function AnnotationCollection'),
    source.indexOf('function FollowControl'),
  );
  const loader = collection.slice(
    collection.indexOf('const loadInitial'),
    collection.indexOf('}, [cache, cacheKey, profileId, sourceUrl, supabase]);'),
  );
  assert.match(loader, /const cached = !force \? cache\.get\(cacheKey\) : undefined/);
  assert.match(loader, /if \(cached\) \{/);
  assert.match(loader, /setPage\(cached\)/);
  assert.match(loader, /queryAnnotations\(supabase, \{ sourceUrl, profileId \}\)/);
  assert.doesNotMatch(loader, /setStatus\('ready'\);\s*return;/);
});
