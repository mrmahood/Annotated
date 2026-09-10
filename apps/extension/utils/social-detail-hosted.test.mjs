import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('detail mapping keeps youtube/audio kinds and loads hosted media only through public RPCs', async () => {
  const source = await readFile(new URL('./social-data.ts', import.meta.url), 'utf8');

  assert.match(source, /kind: 'youtube'/);
  assert.match(source, /kind: 'video'/);
  assert.match(source, /kind: 'audio'/);
  assert.match(source, /hosted: null/);
  assert.match(source, /sources!annotations_source_id_fkey/);
  assert.match(source, /sources!annotations_source_id_fkey!inner/);
  assert.doesNotMatch(source, /source:sources!inner\(/);
  assert.match(source, /get_public_annotation_media_state/);
  assert.match(source, /get_public_annotation_transcript/);
  assert.match(source, /parsePublicHostedExcerpt/);
  assert.match(source, /annotation\.hosted = await loadHostedExcerpt/);
  assert.match(source, /if \(!transcriptError && transcriptData\)/);
  assert.doesNotMatch(source, /if \(transcriptError \|\| !transcriptData\) return null/);
  assert.doesNotMatch(source, /\.from\(['"]annotation_(?:media|transcripts)['"]\)/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug|warn)/);
  assert.doesNotMatch(source, /An annotation response was malformed/);
});

test('detail UI prefers the hosted player and transcript for ready media', async () => {
  const [detail, styles, app] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(detail, /function HostedExcerptPlayer/);
  assert.match(detail, /hostedVideoPlayerLayout/);
  assert.match(detail, /data-orientation=\{layout\.orientation\}/);
  assert.match(detail, /sourceType=\{annotation\.kind\}/);
  assert.match(styles, /\.detail-hosted-media\[data-orientation="portrait"\] video/);
  assert.match(styles, /aspect-ratio: var\(--hosted-video-aspect, 9 \/ 16\)/);
  assert.match(detail, /getMediaPlaybackPath\(annotationId, attempt\)/);
  assert.match(detail, /getPublicUrl\(getMediaPlaybackPath/);
  assert.match(detail, /resolveHostedPlaybackSrc/);
  assert.match(detail, /src=\{mediaSrc\}/);
  assert.match(detail, /controlsList="nodownload"/);
  assert.match(detail, /<video/);
  assert.match(detail, /<audio/);
  assert.match(detail, /Excerpt transcript/);
  assert.match(detail, /function ExcerptTranscript/);
  assert.doesNotMatch(detail.slice(detail.indexOf('function ExcerptTranscript'), detail.indexOf('function Avatar')), /seekMs/);
  const annotationDetail = detail.slice(
    detail.indexOf('export function AnnotationDetailView'),
    detail.indexOf('export function ProfileView'),
  );
  assert.match(annotationDetail, /className="annotation-title"/);
  assert.ok(
    annotationDetail.indexOf('className="annotation-title"') < annotationDetail.indexOf('className="detail-audio"'),
    "creator title leads the annotation block when present",
  );
  assert.ok(
    annotationDetail.indexOf('className="detail-commentary"') < annotationDetail.indexOf('className="detail-audio"'),
    "typed commentary must precede voice commentary",
  );
  assert.ok(
    annotationDetail.indexOf('className="detail-audio"') < annotationDetail.indexOf("</section>"),
    "voice player stays inside the single annotation block",
  );
  assert.ok(
    annotationDetail.indexOf('className="detail-commentary"') < annotationDetail.indexOf('className="detail-source"'),
    "annotation block must precede source article, clip, and transcript blocks",
  );
  assert.doesNotMatch(annotationDetail, />Commentary</);
  assert.doesNotMatch(annotationDetail, />Voice commentary</);
  assert.doesNotMatch(annotationDetail, />Audio commentary</);
  assert.doesNotMatch(annotationDetail, />The annotation</);
  assert.ok(
    annotationDetail.indexOf('className="detail-source"') < annotationDetail.indexOf('hostedReady && <HostedExcerptPlayer'),
    "source passage or clip range must precede hosted excerpt player",
  );
  assert.match(detail, /hostedReady && <HostedExcerptPlayer/);
  assert.match(detail, /hostedTranscript && <ExcerptTranscript/);
  assert.match(detail, /hasHostedExcerptTranscript/);
  assert.match(detail, /This archived excerpt is no longer available/);
  assert.match(detail, /canPlayConnectedClip = !hostedReady &&\s*\(annotation\.kind === 'youtube' \|\| annotation\.kind === 'tiktok'\)/);
  assert.match(detail, /canPlayConnectedAudioClip = !hostedReady && \(annotation\.kind === 'audio' \|\| annotation\.kind === 'spotify'\)/);
  assert.match(detail, /canPlayConnectedClip \|\| hostedReady \? 'button button-secondary'/);
  assert.match(detail, /ArticlePassageMissStatus/);
  assert.match(detail, /onArticleHoverResult/);
  assert.match(detail, /handleArticleSourceOpenClick\(event, annotation, articleHover, sourceOpenUrl, onArticleHoverResult, onAwaitingConnection\)/);
  assert.match(detail, /handleAudioSourceOpenClick\(event, annotation, audioHover, sourceOpenUrl, onAudioAwaitingConnection\)/);
  assert.match(detail, /handlePageVideoSourceOpenClick\(event, annotation, pageVideoHover, sourceOpenUrl, onPageVideoAwaitingConnection\)/);
  assert.match(detail, /ArticlePendingConnectHint/);
  assert.match(detail, /AudioPendingConnectHint/);
  assert.match(detail, /PageVideoPendingConnectHint/);
  assert.match(detail, /ARTICLE_PENDING_CONNECT_HINT/);
  assert.match(detail, /openArticleSourceFromPanel/);
  assert.match(detail, /openAudioSourceFromPanel/);
  assert.match(detail, /openPageVideoSourceFromPanel/);
  assert.match(detail, /articleHoverRegionHandlers\(articleHover, \{ \.\.\.articleTarget, strength: 'soft' \}, onArticleHoverResult\)/);
  assert.match(detail, /audioHoverRegionHandlers\(audioHover, \{ \.\.\.audioTarget, strength: 'soft' \}\)/);
  assert.match(detail, /pageVideoHoverRegionHandlers\(pageVideoHover, \{ \.\.\.pageVideoTarget, strength: 'soft' \}\)/);
  assert.match(styles, /\.article-passage-miss/);
  assert.doesNotMatch(detail, /download=/);
  assert.doesNotMatch(detail, /src=\{playbackUrl\}/);
  assert.doesNotMatch(detail, /createObjectURL|createSignedUrl|processed_storage_path|console\.(?:log|info|debug|warn)/);
  assert.doesNotMatch(styles, /annotation-media-raw|signedUrl/);

  assert.match(app, /Uploaded and queued\. Processing is in progress\./);
  assert.match(app, /youtubeHover=\{youtubeHover\} articleHover=\{articleHover\} audioHover=\{audioHover\} pageVideoHover=\{pageVideoHover\} tiktokHover=\{tiktokHover\} spotifyHover=\{spotifyHover\}/);
  assert.match(app, /articleHoverConnectionForTab/);
  assert.match(app, /audioHoverConnectionForTab/);
  assert.match(app, /pageVideoHoverConnectionForTab/);
  assert.match(app, /tiktokHoverConnectionForTab/);
  assert.match(detail, /handleTikTokSourceOpenClick/);
  assert.match(detail, /TikTokPendingConnectHint/);
  assert.doesNotMatch(app, /until the media worker ships/);
});
