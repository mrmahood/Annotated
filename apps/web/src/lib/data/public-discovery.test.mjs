import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("feed discovery maps audio_clip podcast rows without requiring a public route", async () => {
  const source = await readFile(new URL("./public-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /annotationType === "audio_clip" && sourceType === "podcast"/);
  assert.match(source, /kind: "audio"/);
  assert.match(
    source,
    /isPublicCreatorHandle\(annotator\?\.username\) && isPublicAnnotationSlug\(value\.slug\)/,
  );
  assert.match(source, /annotationSlug: value\.slug/);
  assert.doesNotMatch(source, /route === undefined/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});

test("feed discovery projects webpage video_clip rows on the article source as Video cards", async () => {
  const source = await readFile(new URL("./public-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /kind: "video"/);
  assert.match(source, /annotationType === "video_clip" && sourceType === "article"/);
  assert.match(source, /isYouTubeVideoUrl\(canonicalUrl\.href\) \|\| isTikTokVideoUrl\(canonicalUrl\.href\)/);
  assert.match(source, /normalizeArticleUrl\(canonicalUrl\.href\)/);
  assert.match(source, /type: "article", videoId: null/);
  assert.match(source, /annotationType === "video_clip" && sourceType === "youtube"/);
  assert.match(source, /annotationType === "video_clip" && sourceType === "tiktok"/);
  assert.match(source, /kind: "tiktok"/);
  assert.match(source, /annotationType === "audio_clip" && sourceType === "spotify"/);
  assert.match(source, /kind: "spotify"/);
  assert.match(source, /parseStoredAnnotationTitle\(value\.title\)/);
  assert.match(source, /typeof value\.commentary_text === "string" && value\.commentary_text\.length <= 2_000/);
  assert.match(source, /parsePublicAnnotationAudio/);
  assert.match(source, /ANNOTATION_AUDIO_BUCKET/);
  assert.match(source, /audio: \{ publicUrl: string; durationMs: number \} \| null/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});

test("public and profile feeds load mixed timeline items through the trusted reshare RPC", async () => {
  const source = await readFile(new URL("./public-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /list_public_timeline_items/);
  assert.match(source, /get_current_annotation_reshares/);
  assert.match(source, /itemKind === "reshare"/);
  assert.match(source, /viewerHasReshared/);
  assert.match(source, /get_current_annotation_bookmarks/);
  assert.match(source, /viewerHasBookmarked/);
  assert.doesNotMatch(source, /from\("annotation_reshares"\)/);
  assert.doesNotMatch(source, /from\("annotation_bookmarks"\)/);
  assert.doesNotMatch(source, /from\("profile_follows"\)/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});

test("web trending loads the trusted list RPC and never reads boost or follow tables", async () => {
  const source = await readFile(new URL("./public-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /list_trending_annotations/);
  assert.match(source, /TRENDING_MAX_CARDS/);
  assert.match(source, /shouldShowTrendingSurface/);
  assert.match(source, /getTrendingFeedItems/);
  assert.doesNotMatch(source, /from\("annotation_trending_boosts"\)/);
  assert.doesNotMatch(source, /from\("profile_follows"\)/);
  assert.doesNotMatch(source, /view_count|pageview|telemetry/i);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});
