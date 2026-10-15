import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPublicAnnotationMetadata } from "./public-routes.ts";
import {
  SHARE_IMAGE_ALT,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SITE_SHARE_IMAGE,
  shareImagesForAnnotation,
} from "./share-image.ts";

const X_AVATAR = "https://pbs.twimg.com/profile_images/2087354769618685952/XGlq4ftQ_normal.jpg";
const ARTICLE_IMAGE = "https://example.com/story-card.jpg";

test("the static share card is a 1200 by 630 PNG at the public path", async () => {
  const png = await readFile(new URL("../../public/annotated-share.png", import.meta.url));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), SHARE_IMAGE_WIDTH);
  assert.equal(png.readUInt32BE(20), SHARE_IMAGE_HEIGHT);
  assert.equal(SHARE_IMAGE_WIDTH, 1200);
  assert.equal(SHARE_IMAGE_HEIGHT, 630);
});

test("site metadata points at the absolute production share card", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.equal(SITE_SHARE_IMAGE.url, "https://annotated.cbandcoop.com/annotated-share.png");
  assert.equal(SITE_SHARE_IMAGE.width, 1200);
  assert.equal(SITE_SHARE_IMAGE.height, 630);
  assert.equal(SITE_SHARE_IMAGE.alt, SHARE_IMAGE_ALT);
  assert.match(layout, /openGraph: \{[\s\S]*images: \[SITE_SHARE_IMAGE\]/);
  assert.match(layout, /twitter: \{[\s\S]*card: "summary_large_image"[\s\S]*images: \[SITE_SHARE_IMAGE\]/);
  assert.doesNotMatch(layout, /pbs\.twimg\.com|avatarUrl/);
});

test("annotation share images keep an article image and never an X avatar", () => {
  assert.deepEqual(shareImagesForAnnotation(null), [SITE_SHARE_IMAGE]);
  assert.deepEqual(shareImagesForAnnotation(undefined), [SITE_SHARE_IMAGE]);
  assert.deepEqual(shareImagesForAnnotation(X_AVATAR), [SITE_SHARE_IMAGE]);
  assert.deepEqual(shareImagesForAnnotation("https://pbs.twimg.com/profile_banners/1/card.jpg"), [SITE_SHARE_IMAGE]);
  assert.deepEqual(shareImagesForAnnotation(ARTICLE_IMAGE), [{ url: ARTICLE_IMAGE }]);
  assert.deepEqual(shareImagesForAnnotation("http://example.com/story.jpg"), [SITE_SHARE_IMAGE]);

  const metadata = getPublicAnnotationMetadata({
    id: "41000000-0000-4000-8000-000000000001",
    kind: "article",
    commentaryText: "Private-to-metadata commentary marker",
    publishedAt: "2026-08-24T12:00:00.000Z",
    route: { creatorHandle: "reader-one", annotationSlug: "source-title" },
    selectedText: "Selected passage marker",
    startMs: null,
    endMs: null,
    source: {
      type: "article",
      videoId: null,
      canonicalUrl: "https://example.com/story",
      title: "Example story",
      author: "Writer",
      publisher: "Publisher",
      showName: null,
      hostname: "example.com",
    },
    annotator: {
      id: "42000000-0000-4000-8000-000000000001",
      name: "Reader One",
      avatarUrl: X_AVATAR,
    },
    audio: null,
  });
  const serialized = JSON.stringify(metadata);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.deepEqual(metadata.openGraph.images, [SITE_SHARE_IMAGE]);
  assert.deepEqual(metadata.twitter.images, [SITE_SHARE_IMAGE]);
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.openGraph.images[0].height, 630);
  assert.doesNotMatch(serialized, /pbs\.twimg\.com|profile_images|X_AVATAR|avatarUrl/);
  assert.doesNotMatch(serialized, /Private-to-metadata commentary marker|Selected passage marker/);
});
