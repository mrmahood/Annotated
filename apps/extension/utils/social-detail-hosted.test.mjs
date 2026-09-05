import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('detail mapping keeps youtube/audio kinds and loads hosted media only through public RPCs', async () => {
  const source = await readFile(new URL('./social-data.ts', import.meta.url), 'utf8');

  assert.match(source, /kind: 'youtube'/);
  assert.match(source, /kind: 'audio'/);
  assert.match(source, /hosted: null/);
  assert.match(source, /get_public_annotation_media_state/);
  assert.match(source, /get_public_annotation_transcript/);
  assert.match(source, /parsePublicHostedExcerpt/);
  assert.match(source, /annotation\.hosted = await loadHostedExcerpt/);
  assert.match(source, /if \(!transcriptError && transcriptData\)/);
  assert.doesNotMatch(source, /if \(transcriptError \|\| !transcriptData\) return null/);
  assert.doesNotMatch(source, /\.from\(['"]annotation_(?:media|transcripts)['"]\)/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug|warn)/);
});

test('detail UI prefers the hosted player and transcript for ready media', async () => {
  const [detail, styles, app] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(detail, /function HostedExcerptPlayer/);
  assert.match(detail, /getMediaPlaybackPath\(annotationId, attempt\)/);
  assert.match(detail, /getPublicUrl\(getMediaPlaybackPath/);
  assert.match(detail, /resolveHostedPlaybackSrc/);
  assert.match(detail, /src=\{mediaSrc\}/);
  assert.match(detail, /controlsList="nodownload"/);
  assert.match(detail, /<video/);
  assert.match(detail, /<audio/);
  assert.match(detail, /Excerpt transcript/);
  assert.match(detail, /function ExcerptTranscript/);
  assert.match(detail, /hostedReady && <HostedExcerptPlayer/);
  assert.match(detail, /hostedTranscript && <ExcerptTranscript/);
  assert.match(detail, /hasHostedExcerptTranscript/);
  assert.match(detail, /This archived excerpt is no longer available/);
  assert.match(detail, /canPlayConnectedClip = !hostedReady && annotation\.kind === 'youtube'/);
  assert.match(detail, /canPlayConnectedAudioClip = !hostedReady && annotation\.kind === 'audio'/);
  assert.match(detail, /canPlayConnectedClip \|\| hostedReady \? 'button button-secondary'/);
  assert.match(detail, /ArticlePassageMissStatus/);
  assert.match(detail, /onArticleHoverResult/);
  assert.match(detail, /handleArticleSourceOpenClick\(event, annotation, articleHover, sourceOpenUrl, onArticleHoverResult\)/);
  assert.match(detail, /articleHoverRegionHandlers\(articleHover, \{ \.\.\.articleTarget, strength: 'soft' \}, onArticleHoverResult\)/);
  assert.match(styles, /\.article-passage-miss/);
  assert.doesNotMatch(detail, /download=/);
  assert.doesNotMatch(detail, /src=\{playbackUrl\}/);
  assert.doesNotMatch(detail, /createObjectURL|createSignedUrl|processed_storage_path|console\.(?:log|info|debug|warn)/);
  assert.doesNotMatch(styles, /annotation-media-raw|signedUrl/);

  assert.match(app, /Uploaded and queued\. Processing is in progress\./);
  assert.match(app, /youtubeHover=\{youtubeHover\} articleHover=\{articleHover\}/);
  assert.match(app, /classification === 'Web page'/);
  assert.doesNotMatch(app, /until the media worker ships/);
});
