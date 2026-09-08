import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getCanonicalAnnotationPath,
  getConfiguredPublicPageUrl,
  getNotFoundMetadata,
  getPublicAnnotationMetadata,
  getPublicAnnotationPath,
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
} from "./public-routes.ts";

const ARTICLE = {
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
    avatarUrl: null,
  },
  audio: null,
};

test("accepts only the database route-part contract", () => {
  for (const value of ["abc", "reader-one", "reader_1", "abc123"]) {
    assert.equal(isPublicCreatorHandle(value), true, value);
  }
  for (const value of ["ABc", "ab", "reader.one", " reader-one", "reader-one ", "a".repeat(31)]) {
    assert.equal(isPublicCreatorHandle(value), false, value);
  }
  for (const value of ["abc", "source-title", "a1-b2", "a".repeat(100)]) {
    assert.equal(isPublicAnnotationSlug(value), true, value);
  }
  for (const value of ["ABc", "ab", "-abc", "abc-", "a--b", "a_b", "abc ", "a".repeat(101)]) {
    assert.equal(isPublicAnnotationSlug(value), false, value);
  }
});

test("constructs canonical paths only from validated stored route identity", () => {
  const route = { creatorHandle: "reader-one", annotationSlug: "source-title" };
  assert.equal(getCanonicalAnnotationPath(route), "/reader-one/source-title");
  assert.equal(getPublicAnnotationPath(route, ARTICLE.id), "/reader-one/source-title");
  assert.equal(getPublicAnnotationPath(null, ARTICLE.id), `/a/${ARTICLE.id}`);
  assert.throws(
    () => getCanonicalAnnotationPath({ creatorHandle: "../admin", annotationSlug: "source-title" }),
    /Invalid public annotation route identity/,
  );
  for (const creatorHandle of ["api", "auth", "_next", "ops"]) {
    assert.throws(
      () => getCanonicalAnnotationPath({ creatorHandle, annotationSlug: "source-title" }),
      /Invalid public annotation route identity/,
    );
  }
});

test("accepts HTTPS or loopback HTTP site origins and rejects ambiguous origins", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.equal(
      getConfiguredPublicPageUrl("/reader-one/source-title"),
      "http://localhost:3000/reader-one/source-title",
    );
    process.env.NEXT_PUBLIC_SITE_URL = "https://annotated.example";
    assert.equal(
      getConfiguredPublicPageUrl("/reader-one/source-title"),
      "https://annotated.example/reader-one/source-title",
    );
    assert.equal(getConfiguredPublicPageUrl("//evil.example/reader-one/source-title"), undefined);
    assert.equal(getConfiguredPublicPageUrl("/api/source-title"), undefined);
    for (const value of [
      "http://annotated.example",
      "https://user:pass@annotated.example",
      "https://annotated.example/base",
      "https://annotated.example/?origin=other",
      "not-a-url",
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = value;
      assert.equal(getConfiguredPublicPageUrl("/reader-one/source-title"), undefined, value);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("emits exact canonical metadata without commentary, passage, or media credentials", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  try {
    const metadata = getPublicAnnotationMetadata(ARTICLE);
    assert.equal(metadata.alternates.canonical, "http://localhost:3000/reader-one/source-title");
    assert.equal(metadata.openGraph.url, "http://localhost:3000/reader-one/source-title");
    assert.equal(metadata.twitter.card, "summary");
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /Private-to-metadata commentary marker|Selected passage marker/);
    assert.doesNotMatch(serialized, /signed|storage_path|transcript/i);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
  assert.deepEqual(getNotFoundMetadata().robots, { index: false, follow: false });
});

test("webpage video metadata names the article host, not YouTube", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  try {
    const webpageVideo = {
      ...ARTICLE,
      kind: "video_hosted",
      selectedText: null,
      startMs: 1_000,
      endMs: 10_000,
      source: { ...ARTICLE.source, type: "article", videoId: null },
      media: {
        id: "42000000-0000-4000-8000-000000000001",
        mimeType: "video/mp4",
        durationMs: 9_000,
        width: 426,
        height: 240,
        byteSize: 200_000,
      },
      transcript: {
        text: "Private transcript body marker",
        language: "en",
        segments: null,
      },
    };
    const metadata = getPublicAnnotationMetadata(webpageVideo);
    const serialized = JSON.stringify(metadata);
    assert.match(serialized, /annotated a video clip from example.com/);
    assert.doesNotMatch(serialized, /YouTube clip/);
    assert.doesNotMatch(serialized, /Private transcript body marker|signed|storage/i);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("hosted and removed metadata remains text-only and credential-free", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  try {
    const hosted = {
      ...ARTICLE,
      kind: "audio_hosted",
      selectedText: null,
      startMs: 1_000,
      endMs: 10_000,
      source: { ...ARTICLE.source, type: "podcast", videoId: null },
      media: {
        id: "42000000-0000-4000-8000-000000000001",
        mimeType: "audio/mp4",
        durationMs: 9_000,
        width: null,
        height: null,
        byteSize: 200_000,
      },
      transcript: {
        text: "Private transcript body marker",
        language: "en",
        segments: null,
      },
    };
    const removed = {
      ...hosted,
      kind: "media_removed",
      mediaType: "audio",
    };
    delete removed.media;
    delete removed.transcript;
    for (const annotation of [hosted, removed]) {
      const serialized = JSON.stringify(getPublicAnnotationMetadata(annotation));
      assert.match(serialized, /\/reader-one\/source-title/);
      assert.doesNotMatch(serialized, /Private transcript body marker|signed|storage/i);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("route implementations share one renderer and preserve public-only redirect guards", async () => {
  const [canonicalPage, uuidPage, loader, renderer, discoveryQuery, player, styles] = await Promise.all([
    readFile(new URL("../app/[creatorHandle]/[annotationSlug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/a/[annotationId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/public-annotation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/public-discovery-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hosted-media-player.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(canonicalPage, /isPublicCreatorHandle/);
  assert.match(canonicalPage, /isPublicAnnotationSlug/);
  assert.match(canonicalPage, /matchedHandleIsAlias/);
  assert.match(canonicalPage, /permanentRedirect/);
  assert.match(uuidPage, /resolvePublicAnnotationUuid/);
  assert.match(uuidPage, /permanentRedirect/);
  assert.match(canonicalPage, /PublicAnnotationPage/);
  assert.match(uuidPage, /PublicAnnotationPage/);
  assert.match(loader, /\.eq\("status", "published"\)/);
  assert.match(loader, /resolve_public_annotation_route/);
  assert.match(loader, /resolve_public_annotation_uuid/);
  assert.doesNotMatch(loader + renderer, /SUPABASE_SERVICE_ROLE_KEY|processed_storage_path|raw_storage_path|createSignedUrl/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(renderer, /returnTo=\{`\$\{publicPath\}#comments`\}/);
  assert.match(renderer, /aria-label="Timestamped excerpt transcript"/);
  assert.match(renderer, /<time dateTime=\{getDurationDateTime\(segment\.startMs\)\}>/);
  assert.match(renderer, /aria-labelledby="media-removed-heading"/);
  assert.match(renderer, /isWebpageVideo \? "Webpage video"/);
  assert.match(renderer, /isYouTubeVideo \? "Open clip on YouTube"/);
  assert.match(renderer, /isTikTokVideo \? "TikTok source"/);
  assert.match(renderer, /isTikTokVideo \? "Open clip on TikTok"/);
  assert.match(player, /aria-label="Archived source video excerpt"/);
  assert.match(player, /aria-label="Archived source audio excerpt"/);
  assert.match(player, /role="status"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 400px\)/);
  assert.match(discoveryQuery, /\bslug\b/);
  assert.match(discoveryQuery, /\busername\b/);
});
