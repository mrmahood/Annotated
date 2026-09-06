import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MEDIA_PLAYBACK_CACHE_CONTROL,
  MEDIA_PLAYBACK_CORS_HEADERS,
  MEDIA_SIGNING_TTL_SECONDS,
  PROCESSED_MEDIA_BUCKET,
  MediaPlaybackError,
  getMediaPlaybackPath,
  getTrustedSignedMediaUrl,
  mediaPlaybackErrorResponse,
  mediaPlaybackOptionsResponse,
  mediaPlaybackSuccessResponse,
  parseMediaDelivery,
  wantsJsonPlaybackDelivery,
} from "./media-playback.ts";

const ANNOTATION = "41000000-0000-4000-8000-000000000001";
const MEDIA = "42000000-0000-4000-8000-000000000001";
const OWNER = "43000000-0000-4000-8000-000000000001";
const VIDEO = {
  annotation_id: ANNOTATION,
  media_id: MEDIA,
  processed_storage_path: `${OWNER}/${ANNOTATION}/${MEDIA}/excerpt.mp4`,
  mime_type: "video/mp4",
  duration_ms: 9_000,
  width: 426,
  height: 240,
  byte_size: 400_000,
};

test("freezes the private bucket, signing TTL, and no-store contract", () => {
  assert.equal(PROCESSED_MEDIA_BUCKET, "annotation-media");
  assert.equal(MEDIA_SIGNING_TTL_SECONDS, 120);
  assert.equal(MEDIA_PLAYBACK_CACHE_CONTROL, "private, no-store");
  assert.deepEqual(MEDIA_PLAYBACK_CORS_HEADERS, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Accept",
    "access-control-expose-headers": "Location",
  });
});

function assertPlaybackCors(headers) {
  assert.equal(headers.get("access-control-allow-origin"), "*");
  assert.equal(headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
  assert.equal(headers.get("access-control-allow-headers"), "Accept");
  assert.equal(headers.get("access-control-expose-headers"), "Location");
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
}

test("constructs a same-origin endpoint from annotation UUID and one retry only", () => {
  assert.equal(getMediaPlaybackPath(ANNOTATION), `/api/media/playback/${ANNOTATION}?attempt=0`);
  assert.equal(getMediaPlaybackPath(ANNOTATION, 1), `/api/media/playback/${ANNOTATION}?attempt=1`);
  assert.throws(() => getMediaPlaybackPath("../private", 0), /Invalid media playback identity/);
  assert.throws(() => getMediaPlaybackPath(ANNOTATION, 2), /Invalid media playback identity/);
});

test("accepts bounded video and audio delivery rows without returning caller inputs", () => {
  assert.deepEqual(parseMediaDelivery(VIDEO, ANNOTATION), {
    annotationId: ANNOTATION,
    mediaId: MEDIA,
    processedStoragePath: VIDEO.processed_storage_path,
    mimeType: "video/mp4",
    durationMs: 9_000,
    width: 426,
    height: 240,
    byteSize: 400_000,
  });
  const audio = {
    ...VIDEO,
    processed_storage_path: `${OWNER}/${ANNOTATION}/${MEDIA}/excerpt.m4a`,
    mime_type: "audio/mp4",
    width: null,
    height: null,
    byte_size: 200_000,
  };
  assert.equal(parseMediaDelivery(audio, ANNOTATION)?.mimeType, "audio/mp4");
});

test("rejects path, relation, MIME, dimension, and size substitution", () => {
  const invalid = [
    { ...VIDEO, annotation_id: "44000000-0000-4000-8000-000000000001" },
    { ...VIDEO, processed_storage_path: `${OWNER}/${ANNOTATION}/${MEDIA}/excerpt.m4a` },
    { ...VIDEO, processed_storage_path: `${"-".repeat(36)}/${ANNOTATION}/${MEDIA}/excerpt.mp4` },
    { ...VIDEO, processed_storage_path: `${OWNER}/44000000-0000-4000-8000-000000000001/${MEDIA}/excerpt.mp4` },
    { ...VIDEO, processed_storage_path: `${OWNER}/${ANNOTATION}/44000000-0000-4000-8000-000000000001/excerpt.mp4` },
    { ...VIDEO, mime_type: "text/html" },
    { ...VIDEO, width: null },
    { ...VIDEO, byte_size: 16 * 1024 * 1024 + 1 },
  ];
  for (const value of invalid) assert.equal(parseMediaDelivery(value, ANNOTATION), null);
});

test("accepts signed URLs only from the configured Supabase origin and processed bucket", () => {
  const token = "signed-token-value";
  const valid = `http://localhost:54321/storage/v1/object/sign/annotation-media/${VIDEO.processed_storage_path}?token=${token}`;
  assert.equal(getTrustedSignedMediaUrl(valid, "http://localhost:54321"), valid);
  for (const value of [
    `https://evil.example/storage/v1/object/sign/annotation-media/${VIDEO.processed_storage_path}?token=${token}`,
    `http://localhost:54321/storage/v1/object/sign/annotation-media-raw/${VIDEO.processed_storage_path}?token=${token}`,
    `http://localhost:54321/storage/v1/object/public/annotation-media/${VIDEO.processed_storage_path}?token=${token}`,
    `http://localhost:54321/storage/v1/object/sign/annotation-media/${VIDEO.processed_storage_path}`,
    `http://user:pass@localhost:54321/storage/v1/object/sign/annotation-media/${VIDEO.processed_storage_path}?token=${token}`,
  ]) assert.equal(getTrustedSignedMediaUrl(value, "http://localhost:54321"), null);
});

test("returns bounded no-store errors and an empty HEAD body", async () => {
  const response = mediaPlaybackErrorResponse(new MediaPlaybackError("MEDIA_UNAVAILABLE", 404));
  assert.equal(response.status, 404);
  assertPlaybackCors(response.headers);
  assert.deepEqual(await response.json(), { error: "MEDIA_UNAVAILABLE" });
  const head = mediaPlaybackErrorResponse(new MediaPlaybackError("SERVER_MISCONFIGURED", 500), true);
  assert.equal(head.status, 500);
  assertPlaybackCors(head.headers);
  assert.equal(await head.text(), "");
});

test("selects JSON delivery from delivery=json or Accept: application/json", () => {
  assert.equal(
    wantsJsonPlaybackDelivery(new Request("https://annotated.example/api/media/playback/a?delivery=json")),
    true,
  );
  assert.equal(
    wantsJsonPlaybackDelivery(new Request("https://annotated.example/api/media/playback/a", {
      headers: { Accept: "application/json" },
    })),
    true,
  );
  assert.equal(
    wantsJsonPlaybackDelivery(new Request("https://annotated.example/api/media/playback/a?attempt=0")),
    false,
  );
  assert.equal(
    wantsJsonPlaybackDelivery(new Request("https://annotated.example/api/media/playback/a", {
      headers: { Accept: "*/*" },
    })),
    false,
  );
});

test("returns JSON signedUrl or 307 Location with CORS on every playback response", async () => {
  const signed = "https://nkkunkwirvfwhmpwonqz.supabase.co/storage/v1/object/sign/annotation-media/owner/excerpt.mp4?token=signed-token-value";
  const json = mediaPlaybackSuccessResponse(signed, { jsonDelivery: true });
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("content-type"), "application/json");
  assertPlaybackCors(json.headers);
  assert.deepEqual(await json.json(), { signedUrl: signed });

  const redirect = mediaPlaybackSuccessResponse(signed, { jsonDelivery: false });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get("location"), signed);
  assertPlaybackCors(redirect.headers);
  assert.equal(await redirect.text(), "");

  const options = mediaPlaybackOptionsResponse();
  assert.equal(options.status, 204);
  assertPlaybackCors(options.headers);
  assert.equal(await options.text(), "");
});

test("the signing route accepts no caller path and logs only allow-listed fields", async () => {
  const [route, player, loader, model, metadata] = await Promise.all([
    readFile(new URL("../app/api/media/playback/[annotationId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hosted-media-player.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/public-annotation.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/public-annotation-model.ts", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /get_annotation_media_delivery/);
  assert.match(route, /createSignedUrl\(delivery\.processedStoragePath, MEDIA_SIGNING_TTL_SECONDS\)/);
  assert.match(route, /\.from\(PROCESSED_MEDIA_BUCKET\)/);
  assert.match(route, /wantsJsonPlaybackDelivery/);
  assert.match(route, /mediaPlaybackSuccessResponse/);
  assert.match(route, /export function OPTIONS/);
  assert.doesNotMatch(route, /request\.(?:json|formData)|searchParams\.get\(["'](?:path|bucket|expiry|mime)/);
  const logObjects = [...route.matchAll(
    /console\.(?:info|warn)\("[^"]+",\s*(\{[\s\S]*?\})\s*\);/g,
  )].map((match) => match[1]);
  assert.equal(logObjects.length, 2);
  for (const logObject of logObjects) {
    assert.doesNotMatch(logObject, /signedUrl|processedStoragePath|transcript|secretKey|sourceUrl/);
    assert.match(logObject, /annotationId/);
    assert.match(logObject, /code/);
    assert.match(logObject, /latencyMs/);
  }
  assert.match(player, /controlsList="nodownload"/);
  assert.match(player, /attempt === 0/);
  assert.match(player, /compact = false/);
  assert.match(player, /className="card-hosted-media"/);
  assert.match(player, /hostedVideoPlayerLayout/);
  assert.match(player, /data-orientation=\{layout\.orientation\}/);
  assert.match(player, /sourceType/);
  assert.doesNotMatch(player, /download=/);
  assert.match(loader, /get_public_annotation_media_state/);
  assert.match(loader, /get_public_annotation_transcript/);
  assert.doesNotMatch(loader, /\.from\("annotation_(?:media|transcripts)"\)/);
  assert.doesNotMatch(model + metadata, /provider_metadata|processed_storage_path|raw_storage_path|signedUrl/);
});
