import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const RAW_BUCKET = 'annotation-media-raw';
export const PROCESSED_BUCKET = 'annotation-media';
export const RECAPTURE_CLEANUP_STAGE = 'recapture_cleanup';
export const RECAPTURE_CLEANUP_CODE = 'private_artifacts_pending';
export const VIDEO_LIMIT = 50 * 1024 * 1024;
export const AUDIO_LIMIT = 16 * 1024 * 1024;
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};

type JsonRecord = Record<string, unknown>;
export type AuthorizeInput = {
  annotationId: string;
  mediaId: string;
  mimeType: 'video/webm' | 'audio/webm';
  byteSize: number;
  startMs: number;
  endMs: number;
  captureMetadata: JsonRecord;
};
export type CompletionInput = {
  annotationId: string;
  mediaId: string;
  startMs: number;
  endMs: number;
};
export type CancelInput = { annotationId: string; mediaId: string };
export type MediaRow = {
  id: string;
  annotation_id: string;
  media_type: 'video' | 'audio';
  processing_status: string;
  raw_storage_path: string | null;
  processed_storage_path: string | null;
  raw_mime_type: string | null;
  raw_byte_size: number | null;
  failure_stage?: string | null;
  failure_code?: string | null;
  updated_at: string;
};
export type AnnotationRow = { id: string; user_id: string; status: string };
export type TargetRow = { start_ms: number | null; end_ms: number | null };
export type StoredObject = {
  bucketId?: string;
  name?: string;
  size?: number;
  contentType?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export type HostedMediaErrorCode =
  | 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'SERVER_MISCONFIGURED'
  | 'MEDIA_NOT_FOUND' | 'MEDIA_NOT_OWNED' | 'MEDIA_RELATION_INVALID'
  | 'MEDIA_NOT_CANCELLABLE' | 'MEDIA_ALREADY_CANCELLED'
  | 'RAW_PATH_INVALID' | 'PROCESSED_PATH_INVALID'
  | 'RAW_DELETE_FAILED' | 'PROCESSED_DELETE_FAILED' | 'CANCEL_CONFLICT'
  | 'RECAPTURE_REQUIRED'
  | 'UPLOAD_AUTHORIZATION_FAILED' | 'UPLOAD_COMPLETION_FAILED';

export class HostedMediaApiError extends Error {
  readonly code: HostedMediaErrorCode;
  readonly status: number;
  constructor(code: HostedMediaErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = 'HostedMediaApiError';
  }
}

export function hostedMediaErrorResponse(error: unknown, fallback: HostedMediaErrorCode, fallbackStatus = 400) {
  const bounded = error instanceof HostedMediaApiError
    ? error
    : new HostedMediaApiError(fallback, fallbackStatus);
  return jsonResponse({ error: bounded.code }, bounded.status);
}
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function assertRange(startMs: unknown, endMs: unknown) {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
      (startMs as number) < 0 || (endMs as number) - (startMs as number) < 1_000 ||
      (endMs as number) - (startMs as number) > 90_000) {
    throw new Error('The hosted-media range must be between 1 and 90 seconds.');
  }
}
function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000_000;
  if (Array.isArray(value)) return value.length <= 32 && value.every((item) => boundedJson(item, depth + 1));
  return isRecord(value) && Object.keys(value).length <= 32 &&
    Object.entries(value).every(([key, item]) => key.length <= 64 && boundedJson(item, depth + 1));
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hasExactKeys(value: JsonRecord, keys: readonly string[]) {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}
function finiteIn(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function nullableFiniteIn(value: unknown, minimum: number, maximum: number) {
  return value === null || finiteIn(value, minimum, maximum);
}
function validViewportSample(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['width', 'height', 'device_pixel_ratio', 'scroll_x', 'scroll_y'])) return false;
  return finiteIn(value.width, 1, 32_768) && finiteIn(value.height, 1, 32_768) &&
    finiteIn(value.device_pixel_ratio, 0.1, 16) && finiteIn(value.scroll_x, -1_000_000, 1_000_000) &&
    finiteIn(value.scroll_y, -1_000_000, 1_000_000);
}
function validCaptureRect(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'])) return false;
  return ['x', 'y', 'top', 'right', 'bottom', 'left'].every((key) => finiteIn(value[key], -100_000, 100_000)) &&
    finiteIn(value.width, 1, 32_768) && finiteIn(value.height, 1, 32_768);
}
function validTrack(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'label', 'enabled', 'muted', 'readyState', 'settings']) ||
      (value.kind !== 'audio' && value.kind !== 'video') || typeof value.label !== 'string' || value.label.length > 256 ||
      typeof value.enabled !== 'boolean' || typeof value.muted !== 'boolean' || typeof value.readyState !== 'string' ||
      value.readyState.length > 32 || !isRecord(value.settings) || Object.keys(value.settings).length > 32) return false;
  return Object.entries(value.settings).every(([key, setting]) => key.length <= 64 &&
    (typeof setting === 'string' && setting.length <= 256 || typeof setting === 'boolean' || finiteIn(setting, -1e9, 1e9)));
}
export function validateCaptureMetadata(
  metadata: unknown,
  mediaType: 'video' | 'audio',
  startMs: number,
  endMs: number,
): asserts metadata is JsonRecord {
  if (!isRecord(metadata) || new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 16_384 ||
      !boundedJson(metadata)) {
    throw new Error('Capture metadata is invalid or too large.');
  }
  if (metadata.version === 1) throw new HostedMediaApiError('RECAPTURE_REQUIRED', 409);
  if (metadata.version !== 2) throw new Error('Capture metadata is invalid or too large.');
  const topLevelKeys = mediaType === 'video'
    ? ['version', 'viewport', 'video_element', 'intrinsic_video', 'computed_style', 'fullscreen', 'capture_track', 'timing']
    : ['version', 'capture_track', 'timing'];
  if (!hasExactKeys(metadata, topLevelKeys)) throw new Error('Capture metadata contains unsupported or missing fields.');
  if (!isRecord(metadata.capture_track) || !isRecord(metadata.timing)) {
    throw new Error('Capture track and timing metadata are required.');
  }
  const track = metadata.capture_track;
  if (!hasExactKeys(track, ['mime_type', 'audio_track_count', 'video_track_count', 'tracks', 'loopback_enabled']) ||
      !Number.isSafeInteger(track.audio_track_count) || !finiteIn(track.audio_track_count, 1, 8) ||
      !Number.isSafeInteger(track.video_track_count) || !finiteIn(track.video_track_count, 0, 8) ||
      (mediaType === 'video' ? (track.video_track_count as number) < 1 : track.video_track_count !== 0) ||
      track.loopback_enabled !== true || typeof track.mime_type !== 'string' || track.mime_type.length > 200 ||
      !track.mime_type.toLowerCase().startsWith(mediaType === 'video' ? 'video/webm' : 'audio/webm') ||
      !Array.isArray(track.tracks) || track.tracks.length !== (track.audio_track_count as number) + (track.video_track_count as number) ||
      !track.tracks.every(validTrack)) {
    throw new Error('Capture track metadata does not match the hosted media type.');
  }
  const timing = metadata.timing;
  if (!hasExactKeys(timing, ['requested_start_ms', 'requested_end_ms', 'requested_duration_ms', 'lead_in_ms',
      'recorder_elapsed_ms', 'player_start_ms', 'player_end_ms', 'lead_in_clock']) ||
      timing.requested_start_ms !== startMs || timing.requested_end_ms !== endMs ||
      timing.requested_duration_ms !== endMs - startMs ||
      !finiteIn(timing.lead_in_ms, 0, 91_000) || !finiteIn(timing.recorder_elapsed_ms, 1_000, 92_000) ||
      !nullableFiniteIn(timing.player_start_ms, 0, 1e12) || !nullableFiniteIn(timing.player_end_ms, 0, 1e12) ||
      timing.lead_in_clock !== 'offscreen_monotonic') {
    throw new Error('Capture timing metadata does not match the selected range.');
  }
  if (mediaType === 'video') {
    if (!isRecord(metadata.viewport) || !isRecord(metadata.video_element) ||
        !isRecord(metadata.intrinsic_video) || !isRecord(metadata.computed_style) ||
        !isRecord(metadata.fullscreen)) {
      throw new Error('Video capture geometry is incomplete.');
    }
    const viewport = metadata.viewport;
    const element = metadata.video_element;
    const intrinsic = metadata.intrinsic_video;
    const style = metadata.computed_style;
    const fullscreen = metadata.fullscreen;
    if (!hasExactKeys(viewport, ['start', 'end']) || !validViewportSample(viewport.start) || !validViewportSample(viewport.end) ||
        !hasExactKeys(element, ['start', 'end']) || !validCaptureRect(element.start) || !validCaptureRect(element.end) ||
        !hasExactKeys(intrinsic, ['width', 'height']) || !finiteIn(intrinsic.width, 1, 32_768) || !finiteIn(intrinsic.height, 1, 32_768) ||
        !hasExactKeys(style, ['object_fit', 'object_position']) || typeof style.object_fit !== 'string' || style.object_fit.length > 32 ||
        typeof style.object_position !== 'string' || style.object_position.length > 100 ||
        !hasExactKeys(fullscreen, ['start', 'end']) || typeof fullscreen.start !== 'boolean' || typeof fullscreen.end !== 'boolean') {
      throw new Error('Video capture geometry is incomplete or out of bounds.');
    }
  }
}
export function parseAuthorizeInput(value: unknown): AuthorizeInput {
  if (!isRecord(value) || 'path' in value || !isUuid(value.annotationId) || !isUuid(value.mediaId) ||
      (value.mimeType !== 'video/webm' && value.mimeType !== 'audio/webm') ||
      !Number.isSafeInteger(value.byteSize) || (value.byteSize as number) < 1) {
    throw new Error('Invalid upload authorization request.');
  }
  assertRange(value.startMs, value.endMs);
  const mediaType = value.mimeType === 'video/webm' ? 'video' : 'audio';
  const limit = mediaType === 'video' ? VIDEO_LIMIT : AUDIO_LIMIT;
  if ((value.byteSize as number) > limit) throw new Error('The raw media exceeds the allowed size.');
  validateCaptureMetadata(value.captureMetadata, mediaType, value.startMs as number, value.endMs as number);
  return {
    annotationId: value.annotationId,
    mediaId: value.mediaId,
    mimeType: value.mimeType,
    byteSize: value.byteSize as number,
    startMs: value.startMs as number,
    endMs: value.endMs as number,
    captureMetadata: value.captureMetadata,
  };
}
export function parseCompletionInput(value: unknown): CompletionInput {
  if (!isRecord(value) || 'path' in value || !isUuid(value.annotationId) || !isUuid(value.mediaId)) {
    throw new Error('Invalid upload completion request.');
  }
  assertRange(value.startMs, value.endMs);
  return {
    annotationId: value.annotationId,
    mediaId: value.mediaId,
    startMs: value.startMs as number,
    endMs: value.endMs as number,
  };
}
export function parseCancelInput(value: unknown): CancelInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'annotationId' && key !== 'mediaId') ||
      !isUuid(value.annotationId) || !isUuid(value.mediaId)) {
    throw new HostedMediaApiError('INVALID_REQUEST', 400);
  }
  return { annotationId: value.annotationId, mediaId: value.mediaId };
}

export function assertCancellationRelation(
  userId: string,
  input: CancelInput,
  media: Pick<MediaRow, 'id' | 'annotation_id' | 'media_type' | 'processing_status' | 'raw_storage_path' | 'processed_storage_path'>,
  annotation: AnnotationRow,
) {
  if (annotation.user_id !== userId) throw new HostedMediaApiError('MEDIA_NOT_OWNED', 403);
  if (annotation.id !== input.annotationId || media.annotation_id !== annotation.id || media.id !== input.mediaId) {
    throw new HostedMediaApiError('MEDIA_RELATION_INVALID', 403);
  }
  if (media.processing_status === 'removed') return 'already-cancelled' as const;
  if (annotation.status !== 'draft' || media.processing_status === 'ready') {
    throw new HostedMediaApiError('MEDIA_NOT_CANCELLABLE', 409);
  }
  privateArtifactPaths(userId, input.annotationId, media);
  return 'cancel' as const;
}
export function authorizeRelation(
  userId: string,
  input: Pick<AuthorizeInput, 'annotationId' | 'mediaId' | 'mimeType' | 'byteSize'>,
  media: MediaRow,
  annotation: AnnotationRow,
  allowedStatuses = ['capture_pending', 'failed', 'uploading'],
) {
  if (annotation.user_id !== userId) throw new Error('The hosted-media draft belongs to another user.');
  if (annotation.id !== input.annotationId || media.annotation_id !== annotation.id || media.id !== input.mediaId) {
    throw new Error('The annotation and media identifiers are not related.');
  }
  if (annotation.status !== 'draft' || !allowedStatuses.includes(media.processing_status)) {
    throw new Error('The hosted-media draft is not awaiting upload.');
  }
  const expectedMime = media.media_type === 'video' ? 'video/webm' : 'audio/webm';
  if (input.mimeType !== expectedMime) throw new Error('The upload MIME type does not match the media draft.');
  const limit = media.media_type === 'video' ? VIDEO_LIMIT : AUDIO_LIMIT;
  if (input.byteSize < 1 || input.byteSize > limit) throw new Error('The upload size is outside the accepted limit.');
}
export function rawStoragePath(userId: string, annotationId: string, mediaId: string, uploadId: string) {
  if (![userId, annotationId, mediaId, uploadId].every(isUuid)) throw new Error('Cannot derive a raw storage path from invalid identifiers.');
  return `${userId}/${annotationId}/${mediaId}/${uploadId}.webm`;
}
export function exactPathMatches(path: string, userId: string, annotationId: string, mediaId: string) {
  const prefix = `${userId}/${annotationId}/${mediaId}/`;
  return path.startsWith(prefix) && isUuid(path.slice(prefix.length, -5)) && path.endsWith('.webm');
}
export function processedStoragePath(
  userId: string,
  annotationId: string,
  mediaId: string,
  mediaType: 'video' | 'audio',
) {
  if (![userId, annotationId, mediaId].every(isUuid)) {
    throw new Error('Cannot derive a processed storage path from invalid identifiers.');
  }
  return `${userId}/${annotationId}/${mediaId}/excerpt.${mediaType === 'video' ? 'mp4' : 'm4a'}`;
}
export function privateArtifactPaths(
  userId: string,
  annotationId: string,
  media: Pick<MediaRow, 'id' | 'media_type' | 'raw_storage_path' | 'processed_storage_path'>,
) {
  if (media.raw_storage_path && !exactPathMatches(
    media.raw_storage_path, userId, annotationId, media.id,
  )) throw new HostedMediaApiError('RAW_PATH_INVALID', 409);
  const expectedProcessedPath = processedStoragePath(userId, annotationId, media.id, media.media_type);
  if (media.processed_storage_path && media.processed_storage_path !== expectedProcessedPath) {
    throw new HostedMediaApiError('PROCESSED_PATH_INVALID', 409);
  }
  return {
    raw: media.raw_storage_path,
    processed: media.processed_storage_path,
    expectedProcessed: expectedProcessedPath,
  };
}

export function isRecaptureCleanupPending(
  media: Pick<MediaRow, 'processing_status' | 'failure_stage' | 'failure_code'>,
) {
  return media.processing_status === 'uploading' &&
    media.failure_stage === RECAPTURE_CLEANUP_STAGE &&
    media.failure_code === RECAPTURE_CLEANUP_CODE;
}

type PrivateArtifactStorage = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>;
  };
};

export async function removePrivateArtifacts(
  storage: PrivateArtifactStorage,
  paths: { raw: string | null; processed: string | null },
) {
  // Delete the deterministic derivative first. A partial cleanup must never
  // leave reusable processed bytes behind while reporting a failed operation.
  if (paths.processed) {
    const { error } = await storage.from(PROCESSED_BUCKET).remove([paths.processed]);
    if (error) throw new HostedMediaApiError('PROCESSED_DELETE_FAILED', 502);
  }
  if (paths.raw) {
    const { error } = await storage.from(RAW_BUCKET).remove([paths.raw]);
    if (error) throw new HostedMediaApiError('RAW_DELETE_FAILED', 502);
  }
}
export function storedObjectVerificationInput(object: {
  bucketId?: string;
  name?: string;
  size?: number;
  contentType?: string;
  metadata?: unknown;
}): StoredObject {
  const metadata = isRecord(object.metadata) ? object.metadata : {};
  const metadataSize = metadata.size;
  const size = Number.isSafeInteger(object.size)
    ? object.size
    : Number.isSafeInteger(metadataSize)
      ? Number(metadataSize)
      : undefined;
  const metadataMime = typeof metadata.mimetype === 'string'
    ? metadata.mimetype
    : typeof metadata.contentType === 'string'
      ? metadata.contentType
      : undefined;
  return {
    bucketId: object.bucketId,
    name: object.name,
    size,
    contentType: typeof object.contentType === 'string' ? object.contentType : metadataMime,
  };
}

export function storedObjectMimeMatches(
  actual: string | undefined,
  expectedMime: 'video/webm' | 'audio/webm',
) {
  const baseMime = actual?.split(';', 1)[0]?.trim().toLowerCase();
  if (baseMime === expectedMime) return true;
  return expectedMime === 'audio/webm' &&
    (baseMime === 'video/webm' || baseMime === 'application/octet-stream');
}

export function verifyStoredObject(
  object: StoredObject,
  expectedPath: string,
  expectedMime: 'video/webm' | 'audio/webm',
  expectedSize: number,
) {
  if (object.bucketId !== RAW_BUCKET || object.name !== expectedPath) throw new Error('The uploaded object is in the wrong bucket or path.');
  if (!storedObjectMimeMatches(object.contentType, expectedMime)) {
    throw new Error('The uploaded object MIME type is invalid.');
  }
  const limit = expectedMime === 'video/webm' ? VIDEO_LIMIT : AUDIO_LIMIT;
  if (!Number.isSafeInteger(object.size) || object.size! < 1 || object.size! > limit || object.size !== expectedSize) {
    throw new Error('The uploaded object size is invalid.');
  }
}

export async function verifyUploadedRawObject(
  info: (path: string) => Promise<{ data: unknown; error: unknown }>,
  path: string,
  expectedMime: 'video/webm' | 'audio/webm',
  expectedSize: number,
  attempts = 3,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }),
) {
  let lastError: unknown = null;
  let sawObject = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data: object, error: objectError } = await info(path);
    if (!objectError && object) {
      sawObject = true;
      verifyStoredObject(
        storedObjectVerificationInput(object as {
          bucketId?: string;
          name?: string;
          size?: number;
          contentType?: string;
          metadata?: unknown;
        }),
        path,
        expectedMime,
        expectedSize,
      );
      return;
    }
    lastError = objectError ?? null;
    if (attempt === attempts) break;
    await wait(250 * attempt);
  }
  if (!sawObject && lastError) {
    assertServiceOperation(lastError, 'The uploaded raw object could not be verified.');
  }
  throw new Error('The uploaded raw object does not exist.');
}
export function getBearerToken(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match?.[1] || match[1].length < 20) throw new HostedMediaApiError('AUTH_REQUIRED', 401);
  return match[1];
}

type LegacyApiKeyClaims = { role?: unknown; ref?: unknown };

function hostedProjectRef(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500); }
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
  const match = /^([a-z0-9]+)[.]supabase[.]co$/i.exec(parsed.hostname);
  if (parsed.protocol !== 'https:' || !match || parsed.pathname !== '/') {
    throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500);
  }
  return match[1].toLowerCase();
}

function legacyApiKeyClaims(key: string): LegacyApiKeyClaims | null {
  if (!key.startsWith('eyJ')) return null;
  try {
    const segments = key.split('.');
    if (segments.length !== 3) return null;
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as LegacyApiKeyClaims;
  } catch { return null; }
}

export function validateSupabaseApiKey(
  url: string,
  key: string,
  expected: 'publishable' | 'secret',
) {
  const projectRef = hostedProjectRef(url);
  const opaquePrefix = expected === 'secret' ? 'sb_secret_' : 'sb_publishable_';
  if (key.startsWith(opaquePrefix) && key.length > opaquePrefix.length + 16 && key.length <= 512) return;
  const claims = legacyApiKeyClaims(key);
  const expectedRole = expected === 'secret' ? 'service_role' : 'anon';
  if (!claims || claims.role !== expectedRole ||
      (projectRef !== null && claims.ref !== projectRef)) {
    throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500);
  }
}

function serviceErrorText(error: unknown) {
  if (!isRecord(error)) return error instanceof Error ? error.message : '';
  return [error.message, error.error, error.code, error.status, error.statusCode]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}

export function assertServiceOperation(error: unknown, fallbackMessage: string) {
  if (!error) return;
  const text = serviceErrorText(error);
  if (/invalid api key|apikey|service[_ -]?role|jwt.*(invalid|malformed)|PGRST301/i.test(text) ||
      (/\b(?:401|403)\b/.test(text) && /auth|key|token|jwt/i.test(text))) {
    throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500);
  }
  throw new Error(fallbackMessage);
}

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500);
  validateSupabaseApiKey(url, secretKey, 'secret');
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export function createAuthenticatedClient(request: Request): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new HostedMediaApiError('SERVER_MISCONFIGURED', 500);
  validateSupabaseApiKey(url, publishableKey, 'publishable');
  const token = getBearerToken(request);
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}
export async function authenticatedUser(service: SupabaseClient, request: Request) {
  const { data, error } = await service.auth.getUser(getBearerToken(request));
  if (error || !data.user || !isUuid(data.user.id)) throw new HostedMediaApiError('AUTH_REQUIRED', 401);
  return data.user;
}
