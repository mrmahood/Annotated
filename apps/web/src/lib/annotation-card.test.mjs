import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public cards are commentary-led with nested source and Open source", async () => {
  const [card, styles] = await Promise.all([
    readFile(new URL("../app/annotation-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(card, /"use client"/);
  assert.match(card, /className="card-commentary-lead"/);
  assert.match(card, /className="card-nested-source"/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(card, /Open source/);
  assert.match(card, /getYouTubeTimestampUrl\(annotation\.source\.canonicalUrl, annotation\.startMs\)/);
  assert.match(card, /View annotation/);
  assert.match(card, /import \{ HostedMediaPlayer \} from "\.\/hosted-media-player"/);
  assert.match(card, /expanded && clipMedia &&/);
  assert.match(card, /<HostedMediaPlayer/);
  assert.match(card, /annotationId=\{annotation\.id\}/);
  assert.match(card, /media=\{clipMedia\}/);
  assert.match(card, /sourceType=\{annotation\.source\.type\}/);
  assert.match(card, /compact/);
  assert.match(card, /kind === "youtube" \|\| kind === "tiktok" \|\| kind === "video"/);
  assert.match(card, /annotation\.kind === "audio" \|\| annotation\.kind === "spotify" \? "audio\/mp4"/);
  assert.match(card, /kind === "youtube" \|\| annotation\.kind === "tiktok" \|\| annotation\.kind === "video" \|\| annotation\.kind === "audio" \|\| annotation\.kind === "spotify"/);
  assert.match(card, /kind === "spotify"\) return "Spotify"/);
  assert.match(card, /"audio\/mp4"/);
  assert.doesNotMatch(card, /section-label/);
  assert.doesNotMatch(card, />Commentary</);
  assert.doesNotMatch(card, />Clip</);
  assert.doesNotMatch(card, /YouTube video/);
  assert.doesNotMatch(card, /createSignedUrl|processed_storage_path|service_role/);

  assert.match(styles, /--accent:/);
  assert.match(styles, /--motion-duration: 180ms/);
  assert.match(styles, /\.card-commentary-lead/);
  assert.match(styles, /\.card-nested-source/);
  assert.match(styles, /\.card-hosted-media/);
  assert.match(styles, /\.card-hosted-media audio/);
  assert.match(styles, /\.card-hosted-media\[data-orientation="portrait"\] video/);
  assert.match(styles, /aspect-ratio: var\(--hosted-video-aspect, 9 \/ 16\)/);
  assert.match(styles, /max-height: none/);
  assert.doesNotMatch(styles, /\.card-hosted-media\[data-orientation="portrait"\] video[^}]*max-height: 220px/);
  assert.match(styles, /\.open-source-link/);
  assert.match(styles, /\.site-header/);
  assert.match(styles, /\.site-wordmark/);
});
