import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public detail mapping accepts article-backed webpage video_clip rows", async () => {
  const source = await readFile(new URL("./public-annotation-model.ts", import.meta.url), "utf8");
  assert.match(source, /sourceValue\.source_type === "youtube"/);
  assert.match(source, /sourceValue\.source_type === "tiktok"/);
  assert.match(source, /sourceValue\.source_type === "spotify"/);
  assert.match(source, /sourceValue\.source_type === "article" && targetValue\.target_type === "time_range"/);
  assert.match(source, /isYouTubeVideoUrl\(canonicalUrl\.href\) \|\| isTikTokVideoUrl\(canonicalUrl\.href\)/);
  assert.match(source, /normalizeArticleUrl\(canonicalUrl\.href\)/);
  assert.match(source, /type: "article"; videoId: null/);
  assert.match(source, /kind: "video_hosted"/);
  assert.match(source, /parseStoredAnnotationTitle\(annotationValue\.title\)/);
  assert.match(source, /isSpotifyEpisodeUrl\(canonicalUrl\.href\)/);
  assert.doesNotMatch(source, /createSignedUrl|processed_storage_path|service_role/);
});

test("public detail leads with creator annotation before source clip, transcript, or passage", async () => {
  const page = await readFile(new URL("../../app/public-annotation-page.tsx", import.meta.url), "utf8");
  const commentary = page.indexOf('className="commentary-section"');
  const title = page.indexOf('className="annotation-title"');
  const audio = page.indexOf("<PublishedAudioPlayer");
  const source = page.indexOf('className="source-attribution"');
  const passage = page.indexOf('className="passage-section"');
  const clip = page.indexOf('className="clip-range-section"');
  const player = page.indexOf("<HostedMediaPlayer");
  const transcript = page.indexOf('className="transcript-section"');

  assert.ok(commentary >= 0 && title >= 0 && audio >= 0 && source >= 0 && passage >= 0 && clip >= 0 && player >= 0 && transcript >= 0);
  assert.ok(title > commentary && title < audio, "creator title leads the annotation block when present");
  assert.ok(commentary < audio, "typed commentary must precede voice commentary");
  assert.ok(audio < source, "voice commentary must precede source attribution");
  assert.ok(source < passage, "source attribution must precede captured passage");
  assert.ok(passage < clip, "article passage and clip range stay in the secondary block");
  assert.ok(clip < player, "saved clip range must precede hosted player");
  assert.ok(player < transcript, "hosted clip must precede excerpt transcript");
  assert.match(page, /<h1 id="commentary-heading" className="visually-hidden">/);
  assert.doesNotMatch(page, />The annotation</);
  assert.doesNotMatch(page, />Voice commentary</);
  assert.doesNotMatch(page, />Commentary</);
  const commentaryClose = page.indexOf("</section>", commentary);
  assert.ok(audio > commentary && audio < commentaryClose, "voice player stays inside the single annotation block");
  assert.match(page, /<h2 id="source-heading">\{sourceTitle\}<\/h2>/);
  assert.match(page, /className="visually-hidden">\{isYouTubeVideo \? "YouTube source"/);
  assert.match(page, /className="visually-hidden" id="passage-heading">Captured passage/);
  assert.match(page, /className="visually-hidden" id="clip-range-heading">Saved clip/);
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
  assert.match(page, /"Spotify episode"/);
  assert.match(page, /"Open clip on Spotify"/);
  assert.match(page, /isYouTubeVideo \? "Open clip on YouTube"/);
  assert.match(page, /isTikTokVideo \? "Open clip on TikTok"/);
  assert.match(page, /if \(isYouTubeVideo\) \{\s*sourceUrl = getYouTubeTimestampUrl/);
  assert.match(routes, /annotated a video clip from \$\{annotation\.source\.hostname\}/);
  assert.match(routes, /annotation\.source\.type === "youtube"/);
  assert.match(routes, /annotation\.source\.type === "tiktok"/);
  assert.match(routes, /annotation\.source\.type === "article"/);
  assert.doesNotMatch(page + routes, /createSignedUrl|processed_storage_path|service_role/);
});
