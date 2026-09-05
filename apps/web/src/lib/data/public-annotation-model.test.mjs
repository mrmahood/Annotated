import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public detail mapping accepts article-backed webpage video_clip rows", async () => {
  const source = await readFile(new URL("./public-annotation-model.ts", import.meta.url), "utf8");
  assert.match(source, /sourceValue\.source_type === "youtube"/);
  assert.match(source, /sourceValue\.source_type === "tiktok"/);
  assert.match(source, /sourceValue\.source_type === "article" && targetValue\.target_type === "time_range"/);
  assert.match(source, /isYouTubeVideoUrl\(canonicalUrl\.href\) \|\| isTikTokVideoUrl\(canonicalUrl\.href\)/);
  assert.match(source, /normalizeArticleUrl\(canonicalUrl\.href\)/);
  assert.match(source, /type: "article"; videoId: null/);
  assert.match(source, /kind: "video_hosted"/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});

test("public detail page labels webpage video separately from YouTube", async () => {
  const [page, routes] = await Promise.all([
    readFile(new URL("../../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public-routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /isWebpageVideo/);
  assert.match(page, /isYouTubeVideo/);
  assert.match(page, /isTikTokVideo/);
  assert.match(page, /"Webpage video"/);
  assert.match(page, /"TikTok source"/);
  assert.match(page, /isYouTubeVideo \? "Open clip on YouTube"/);
  assert.match(page, /isTikTokVideo \? "Open clip on TikTok"/);
  assert.match(page, /if \(isYouTubeVideo\) \{\s*sourceUrl = getYouTubeTimestampUrl/);
  assert.match(routes, /annotated a video clip from \$\{annotation\.source\.hostname\}/);
  assert.match(routes, /annotation\.source\.type === "youtube"/);
  assert.match(routes, /annotation\.source\.type === "tiktok"/);
  assert.match(routes, /annotation\.source\.type === "article"/);
  assert.doesNotMatch(page + routes, /createSignedUrl|processed_storage_path|service_role/);
});
