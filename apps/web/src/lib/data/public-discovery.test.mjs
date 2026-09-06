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
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});
