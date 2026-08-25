export const PROCESSED_MEDIA_BUCKET = "annotation-media";
export const MEDIA_SIGNING_TTL_SECONDS = 120;
export const MEDIA_PLAYBACK_CACHE_CONTROL = "private, no-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const AUDIO_MAX_BYTES = 8 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

export type MediaDelivery = {
  annotationId: string;
  mediaId: string;
  processedStoragePath: string;
  mimeType: "video/mp4" | "audio/mp4";
  durationMs: number;
  width: number | null;
  height: number | null;
  byteSize: number;
};

export class MediaPlaybackError extends Error {
  readonly code: "MEDIA_UNAVAILABLE" | "SERVER_MISCONFIGURED";
  readonly status: 404 | 500 | 503;

  constructor(
    code: "MEDIA_UNAVAILABLE" | "SERVER_MISCONFIGURED",
    status: 404 | 500 | 503,
  ) {
    super(code);
    this.name = "MediaPlaybackError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

export function isPlaybackUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function getMediaPlaybackPath(annotationId: string, attempt = 0): string {
  if (!isPlaybackUuid(annotationId) || !safeIntegerIn(attempt, 0, 1)) {
    throw new Error("Invalid media playback identity.");
  }
  return `/api/media/playback/${annotationId}?attempt=${attempt}`;
}

export function parseMediaDelivery(
  value: unknown,
  requestedAnnotationId: string,
): MediaDelivery | null {
  if (!isRecord(value) || !isPlaybackUuid(requestedAnnotationId)) return null;
  const annotationId = value.annotation_id;
  const mediaId = value.media_id;
  const path = value.processed_storage_path;
  const mimeType = value.mime_type;
  if (
    annotationId !== requestedAnnotationId ||
    !isPlaybackUuid(annotationId) ||
    !isPlaybackUuid(mediaId) ||
    typeof path !== "string" ||
    path.length > 300 ||
    (mimeType !== "video/mp4" && mimeType !== "audio/mp4") ||
    !safeIntegerIn(value.duration_ms, 1_000, 90_000)
  ) return null;

  const expectedExtension = mimeType === "video/mp4" ? "mp4" : "m4a";
  const pathParts = path.split("/");
  if (
    pathParts.length !== 4 ||
    !isPlaybackUuid(pathParts[0]) ||
    pathParts[1] !== annotationId ||
    pathParts[2] !== mediaId ||
    pathParts[3] !== `excerpt.${expectedExtension}`
  ) return null;

  if (mimeType === "video/mp4") {
    if (
      !safeIntegerIn(value.width, 2, 8192) ||
      !safeIntegerIn(value.height, 2, 8192) ||
      !safeIntegerIn(value.byte_size, 1, VIDEO_MAX_BYTES)
    ) return null;
  } else if (
    value.width !== null ||
    value.height !== null ||
    !safeIntegerIn(value.byte_size, 1, AUDIO_MAX_BYTES)
  ) return null;

  return {
    annotationId,
    mediaId,
    processedStoragePath: path,
    mimeType,
    durationMs: value.duration_ms as number,
    width: value.width as number | null,
    height: value.height as number | null,
    byteSize: value.byte_size as number,
  };
}

export function getTrustedSignedMediaUrl(value: unknown, supabaseUrl: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const signedUrl = new URL(value);
    const expectedOrigin = new URL(supabaseUrl).origin;
    if (
      signedUrl.origin !== expectedOrigin ||
      signedUrl.username ||
      signedUrl.password ||
      !signedUrl.pathname.startsWith(
        `/storage/v1/object/sign/${PROCESSED_MEDIA_BUCKET}/`,
      ) ||
      !signedUrl.searchParams.get("token")
    ) return null;
    return signedUrl.href;
  } catch {
    return null;
  }
}

export function mediaPlaybackErrorResponse(error: unknown, head = false): Response {
  const bounded = error instanceof MediaPlaybackError
    ? error
    : new MediaPlaybackError("MEDIA_UNAVAILABLE", 503);
  const headers = new Headers({ "cache-control": MEDIA_PLAYBACK_CACHE_CONTROL });
  if (head) return new Response(null, { status: bounded.status, headers });
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: bounded.code }), {
    status: bounded.status,
    headers,
  });
}
