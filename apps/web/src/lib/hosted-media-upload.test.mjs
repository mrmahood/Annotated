import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AUDIO_LIMIT,
  PROCESSED_BUCKET,
  RAW_BUCKET,
  VIDEO_LIMIT,
  assertServiceOperation,
  authorizeRelation,
  assertCancellationRelation,
  createServiceClient,
  exactPathMatches,
  getBearerToken,
  parseAuthorizeInput,
  parseCompletionInput,
  parseCancelInput,
  privateArtifactPaths,
  processedStoragePath,
  removePrivateArtifacts,
  hostedMediaErrorResponse,
  HostedMediaApiError,
  isRecaptureCleanupPending,
  RECAPTURE_CLEANUP_CODE,
  RECAPTURE_CLEANUP_STAGE,
  rawStoragePath,
  validateCaptureMetadata,
  validateSupabaseApiKey,
  verifyStoredObject,
} from './hosted-media-upload.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ANNOTATION = '22222222-2222-4222-8222-222222222222';
const MEDIA = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const metadata = {
  version: 2,
  viewport: {
    start: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
    end: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
  },
  video_element: {
    start: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
    end: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
  },
  intrinsic_video: { width: 1920, height: 1080 },
  computed_style: { object_fit: 'contain', object_position: '50% 50%' },
  fullscreen: { start: false, end: false },
  capture_track: {
    mime_type: 'video/webm;codecs=vp9,opus',
    audio_track_count: 1,
    video_track_count: 1,
    tracks: [
      { kind: 'audio', label: '', enabled: true, muted: false, readyState: 'live', settings: { sampleRate: 48000 } },
      { kind: 'video', label: '', enabled: true, muted: false, readyState: 'live', settings: { width: 1280, height: 720 } },
    ],
    loopback_enabled: true,
  },
  timing: {
    requested_start_ms: 5_000,
    requested_end_ms: 20_000,
    requested_duration_ms: 15_000,
    lead_in_ms: 1,
    recorder_elapsed_ms: 15_010,
    player_start_ms: 5_000,
    player_end_ms: 20_000,
    lead_in_clock: 'offscreen_monotonic',
  },
};
const input = {
  annotationId: ANNOTATION,
  mediaId: MEDIA,
  mimeType: 'video/webm',
  byteSize: 1_000_000,
  startMs: 5_000,
  endMs: 20_000,
  captureMetadata: metadata,
};
const media = {
  id: MEDIA,
  annotation_id: ANNOTATION,
  media_type: 'video',
  processing_status: 'capture_pending',
  raw_storage_path: null,
  processed_storage_path: null,
  raw_mime_type: null,
  raw_byte_size: null,
};
const annotation = { id: ANNOTATION, user_id: USER, status: 'draft' };

test('unauthenticated upload authorization is denied', () => {
  assert.throws(() => getBearerToken(new Request('http://localhost')), (error) => error.code === 'AUTH_REQUIRED');
});

test('authorization denies the wrong owner and wrong relation', () => {
  assert.throws(() => authorizeRelation(OTHER, input, media, annotation), /another user/);
  assert.throws(() => authorizeRelation(USER, input, { ...media, annotation_id: OTHER }, annotation), /not related/);
});

test('capture_pending and failed drafts cancel without a raw path or storage object', () => {
  const cancel = { annotationId: ANNOTATION, mediaId: MEDIA };
  assert.deepEqual(parseCancelInput(cancel), cancel);
  assert.equal(assertCancellationRelation(USER, cancel, media, annotation), 'cancel');
  assert.equal(assertCancellationRelation(USER, cancel, { ...media, processing_status: 'failed' }, annotation), 'cancel');
});

test('cancellation denies wrong owner/relation/lifecycle and is deliberately idempotent', () => {
  const cancel = { annotationId: ANNOTATION, mediaId: MEDIA };
  assert.throws(() => assertCancellationRelation(OTHER, cancel, media, annotation), (error) => error.code === 'MEDIA_NOT_OWNED');
  assert.throws(() => assertCancellationRelation(USER, cancel, { ...media, annotation_id: OTHER }, annotation), (error) => error.code === 'MEDIA_RELATION_INVALID');
  assert.throws(() => assertCancellationRelation(USER, cancel, { ...media, processing_status: 'ready' }, annotation), (error) => error.code === 'MEDIA_NOT_CANCELLABLE');
  assert.equal(assertCancellationRelation(USER, cancel, { ...media, processing_status: 'removed' }, annotation), 'already-cancelled');
});

test('cancellation accepts only an exact server-owned raw path and rejects path injection', () => {
  const cancel = { annotationId: ANNOTATION, mediaId: MEDIA };
  const path = rawStoragePath(USER, ANNOTATION, MEDIA, UPLOAD);
  assert.equal(assertCancellationRelation(USER, cancel, { ...media, processing_status: 'uploading', raw_storage_path: path }, annotation), 'cancel');
  assert.throws(() => assertCancellationRelation(USER, cancel, {
    ...media, processing_status: 'uploading', raw_storage_path: `${OTHER}/${ANNOTATION}/${MEDIA}/${UPLOAD}.webm`,
  }, annotation), (error) => error.code === 'RAW_PATH_INVALID');
  assert.throws(() => parseCancelInput({ ...cancel, rawStoragePath: path }), (error) => error.code === 'INVALID_REQUEST');
});

test('failed recapture derives exact raw-only and processed artifact cleanup paths', () => {
  const raw = rawStoragePath(USER, ANNOTATION, MEDIA, UPLOAD);
  const processed = processedStoragePath(USER, ANNOTATION, MEDIA, 'video');
  assert.deepEqual(privateArtifactPaths(USER, ANNOTATION, {
    ...media, processing_status: 'failed', raw_storage_path: raw,
  }), { raw, processed: null, expectedProcessed: processed });
  assert.deepEqual(privateArtifactPaths(USER, ANNOTATION, {
    ...media, processing_status: 'failed', raw_storage_path: raw, processed_storage_path: processed,
  }), { raw, processed, expectedProcessed: processed });
  assert.throws(() => privateArtifactPaths(USER, ANNOTATION, {
    ...media,
    processing_status: 'failed',
    processed_storage_path: `${OTHER}/${ANNOTATION}/${MEDIA}/excerpt.mp4`,
  }), (error) => error.code === 'PROCESSED_PATH_INVALID');
});

test('processed Storage, recapture, and cancellation cleanup markers match the durable contracts', async () => {
  const [foundation, workerStorage, durableCleanup, reconciler] = await Promise.all([
    readFile(new URL('../../../../supabase/migrations/20260815120000_media_archive_foundation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../media-worker/src/infrastructure/supabase-storage.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../../../supabase/migrations/20260824020000_phase_c_durable_terminal_cleanup.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../media-worker/src/runtime/reconciler.mjs', import.meta.url), 'utf8'),
  ]);
  assert.equal(PROCESSED_BUCKET, 'annotation-media');
  assert.match(foundation, /\(\s*'annotation-media',\s*'annotation-media'/);
  assert.match(workerStorage, /'annotation-media'/);
  assert.equal(isRecaptureCleanupPending({
    processing_status: 'uploading',
    failure_stage: RECAPTURE_CLEANUP_STAGE,
    failure_code: RECAPTURE_CLEANUP_CODE,
  }), true);
  assert.equal(isRecaptureCleanupPending({
    processing_status: 'uploading',
    failure_stage: null,
    failure_code: null,
  }), false);
  assert.match(durableCleanup, /media\.processing_status = 'removed'[\s\S]*'removed_cleanup'/);
  assert.match(durableCleanup, /media\.processed_storage_path is not null/);
  assert.match(durableCleanup, /delete from public\.annotation_transcripts/);
  assert.match(reconciler, /'removed_cleanup'/);
});

test('failed raw-only recapture deletes the deterministic derivative before raw bytes and surfaces bounded failures', async () => {
  const raw = rawStoragePath(USER, ANNOTATION, MEDIA, UPLOAD);
  const processed = processedStoragePath(USER, ANNOTATION, MEDIA, 'video');
  const calls = [];
  const storage = {
    from(bucket) {
      return { async remove(paths) { calls.push({ bucket, paths }); return { error: null }; } };
    },
  };
  const paths = privateArtifactPaths(USER, ANNOTATION, {
    ...media, processing_status: 'failed', raw_storage_path: raw, processed_storage_path: null,
  });
  await removePrivateArtifacts(storage, { raw: paths.raw, processed: paths.expectedProcessed });
  assert.deepEqual(calls, [
    { bucket: PROCESSED_BUCKET, paths: [processed] },
    { bucket: RAW_BUCKET, paths: [raw] },
  ]);
  await assert.rejects(removePrivateArtifacts({
    from() { return { async remove() { return { error: new Error('private storage detail') }; } }; },
  }, { raw: null, processed }), (error) => error.code === 'PROCESSED_DELETE_FAILED' && error.status === 502);
});

test('bounded API errors always have a JSON body and content type', async () => {
  const response = hostedMediaErrorResponse(new HostedMediaApiError('MEDIA_NOT_CANCELLABLE', 409), 'CANCEL_CONFLICT');
  assert.equal(response.status, 409);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await response.json(), { error: 'MEDIA_NOT_CANCELLABLE' });
  const fallback = hostedMediaErrorResponse(new Error('private SQL details'), 'CANCEL_CONFLICT', 409);
  assert.deepEqual(await fallback.json(), { error: 'CANCEL_CONFLICT' });
});

test('server configuration fails closed with bounded JSON and supports opaque sb_secret keys', async () => {
  assert.doesNotThrow(() => validateSupabaseApiKey(
    'https://nkkunkwirvfwhmpwonqz.supabase.co',
    `sb_secret_${'a'.repeat(40)}`,
    'secret',
  ));
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let failure;
    assert.throws(() => createServiceClient(), (error) => {
      failure = error;
      return error.code === 'SERVER_MISCONFIGURED';
    });
    const response = hostedMediaErrorResponse(failure, 'UPLOAD_AUTHORIZATION_FAILED');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'SERVER_MISCONFIGURED' });
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('legacy privileged JWT must declare service_role and match the hosted project ref', () => {
  const jwt = (payload) => [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
  assert.doesNotThrow(() => validateSupabaseApiKey(
    'https://nkkunkwirvfwhmpwonqz.supabase.co',
    jwt({ role: 'service_role', ref: 'nkkunkwirvfwhmpwonqz' }),
    'secret',
  ));
  assert.throws(() => validateSupabaseApiKey(
    'https://nkkunkwirvfwhmpwonqz.supabase.co',
    jwt({ role: 'service_role', ref: 'local-project' }),
    'secret',
  ), (error) => error.code === 'SERVER_MISCONFIGURED');
});

test('invalid privileged API-key responses become bounded server misconfiguration', () => {
  assert.throws(
    () => assertServiceOperation({ status: 401, message: 'Invalid API key' }, 'private provider detail'),
    (error) => error.code === 'SERVER_MISCONFIGURED' && error.status === 500,
  );
  assert.throws(
    () => assertServiceOperation({ status: 500, message: 'database unavailable' }, 'bounded operation failure'),
    /bounded operation failure/,
  );
});

test('authorization rejects non-draft and non-uploadable lifecycle states', () => {
  assert.throws(() => authorizeRelation(USER, input, media, { ...annotation, status: 'published' }), /not awaiting/);
  assert.throws(() => authorizeRelation(USER, input, { ...media, processing_status: 'processing' }, annotation), /not awaiting/);
});

test('server derives one exact private raw path and client paths are impossible', () => {
  const path = rawStoragePath(USER, ANNOTATION, MEDIA, UPLOAD);
  assert.equal(path, `${USER}/${ANNOTATION}/${MEDIA}/${UPLOAD}.webm`);
  assert.equal(exactPathMatches(path, USER, ANNOTATION, MEDIA), true);
  assert.equal(exactPathMatches(`${OTHER}/${ANNOTATION}/${MEDIA}/${UPLOAD}.webm`, USER, ANNOTATION, MEDIA), false);
  assert.throws(() => parseAuthorizeInput({ ...input, path: 'arbitrary.webm' }), /Invalid/);
  assert.throws(() => parseCompletionInput({ annotationId: ANNOTATION, mediaId: MEDIA, startMs: 5_000, endMs: 20_000, path }), /Invalid/);
});

test('authorization enforces zero, video, and audio size limits', () => {
  assert.throws(() => parseAuthorizeInput({ ...input, byteSize: 0 }), /Invalid/);
  assert.throws(() => parseAuthorizeInput({ ...input, byteSize: VIDEO_LIMIT + 1 }), /allowed size/);
  const audioMetadata = {
    version: 2,
    capture_track: { ...metadata.capture_track, mime_type: 'audio/webm;codecs=opus', video_track_count: 0 },
    timing: metadata.timing,
  };
  assert.throws(() => parseAuthorizeInput({
    ...input, mimeType: 'audio/webm', byteSize: AUDIO_LIMIT + 1, captureMetadata: audioMetadata,
  }), /allowed size/);
});

test('capture metadata validates the allow-list, type, range, and 92-second bound', () => {
  assert.doesNotThrow(() => validateCaptureMetadata(metadata, 'video', 5_000, 20_000));
  assert.throws(() => validateCaptureMetadata({ ...metadata, raw_path: 'secret' }, 'video', 5_000, 20_000), /unsupported/);
  assert.throws(() => validateCaptureMetadata({
    ...metadata, timing: { ...metadata.timing, requested_end_ms: 20_001 },
  }, 'video', 5_000, 20_000), /does not match/);
  assert.throws(() => validateCaptureMetadata({
    ...metadata, timing: { ...metadata.timing, recorder_elapsed_ms: 92_001 },
  }, 'video', 5_000, 20_000), /does not match/);
  assert.throws(
    () => validateCaptureMetadata({ ...metadata, version: 1 }, 'video', 5_000, 20_000),
    (error) => error.code === 'RECAPTURE_REQUIRED' && error.status === 409,
  );
  assert.throws(() => validateCaptureMetadata({
    ...metadata, viewport: { ...metadata.viewport, end: null },
  }, 'video', 5_000, 20_000), /incomplete/);
  assert.throws(() => validateCaptureMetadata({
    ...metadata, timing: { ...metadata.timing, lead_in_clock: 'page_epoch' },
  }, 'video', 5_000, 20_000), /does not match/);
});

test('completion rejects missing identity, wrong MIME, zero/oversized size, bucket, and path', () => {
  const path = rawStoragePath(USER, ANNOTATION, MEDIA, UPLOAD);
  const valid = { bucketId: RAW_BUCKET, name: path, size: 1_000_000, contentType: 'video/webm;codecs=vp9,opus' };
  assert.doesNotThrow(() => verifyStoredObject(valid, path, 'video/webm', 1_000_000));
  assert.throws(() => verifyStoredObject({ ...valid, contentType: 'audio/webm' }, path, 'video/webm', 1_000_000), /MIME/);
  assert.throws(() => verifyStoredObject({ ...valid, size: 0 }, path, 'video/webm', 1_000_000), /size/);
  assert.throws(() => verifyStoredObject({ ...valid, size: VIDEO_LIMIT + 1 }, path, 'video/webm', VIDEO_LIMIT + 1), /size/);
  assert.throws(() => verifyStoredObject({ ...valid, bucketId: 'annotation-media' }, path, 'video/webm', 1_000_000), /bucket or path/);
  assert.throws(() => verifyStoredObject({ ...valid, name: `${path}.other` }, path, 'video/webm', 1_000_000), /bucket or path/);
  assert.throws(() => verifyStoredObject({}, path, 'video/webm', 1_000_000), /bucket or path/);
});

test('routes use short-lived no-upsert authorization and transition only to processing/queued', async () => {
  const [authorize, complete, cancel] = await Promise.all([
    readFile(new URL('../app/api/media/upload/authorize/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/media/upload/complete/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/media/upload/cancel/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(authorize, /createSignedUploadUrl\(path, \{ upsert: false \}\)/);
  assert.match(authorize, /expiresInSeconds: 7_200, upsert: false/);
  assert.match(complete, /processing_status: 'processing'/);
  assert.match(complete, /processing_stage: 'queued'/);
  assert.match(authorize, /attempt_count: 0/);
  assert.match(authorize + complete, /RECAPTURE_REQUIRED/);
  assert.doesNotMatch(authorize + complete, /serviceRoleKey.*jsonResponse|SUPABASE_SERVICE_ROLE_KEY.*jsonResponse/);
  assert.doesNotMatch(authorize + complete + cancel, /console\.(?:log|warn|error)\([^\n]*(?:secretKey|serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY)/);
  assert.doesNotMatch(authorize + complete, /claim_annotation_media_processing|finalize_annotation_media_ready/);
  assert.match(cancel, /ownerStatus\.processing_status === 'capture_pending'/);
  assert.match(cancel, /cancel_hosted_media_annotation/);
  assert.match(authorize, /processed: retainedPaths\.expectedProcessed/);
  assert.match(authorize, /failure_stage: RECAPTURE_CLEANUP_STAGE/);
  assert.match(authorize, /failure_code: RECAPTURE_CLEANUP_CODE/);
  assert.match(authorize, /requiresRecaptureCleanup = media\.processing_status === 'failed' \|\| recaptureCleanupPending/);
  assert.match(authorize, /\.eq\('failure_stage', RECAPTURE_CLEANUP_STAGE\)/);
  assert.match(authorize, /\.eq\('failure_code', RECAPTURE_CLEANUP_CODE\)/);
  assert.match(complete, /isRecaptureCleanupPending\(media\)/);
  assert.match(authorize, /\.eq\('processing_status', 'failed'\)/);
  assert.match(authorize, /\.eq\('processing_status', expectedStatus\)/);
  assert.match(authorize, /\.eq\('raw_storage_path', media\.raw_storage_path\)/);
  assert.match(authorize, /\.eq\('processed_storage_path', media\.processed_storage_path\)/);
  assert.match(authorize, /\.eq\('updated_at', expectedUpdatedAt\)/);
  assert.ok(authorize.indexOf('const { data: fenced') < authorize.indexOf('if (requiresRecaptureCleanup)'));
  assert.ok(authorize.indexOf('processed: retainedPaths.expectedProcessed') < authorize.indexOf('let updateQuery'));
  assert.match(cancel, /processed: retainedPaths\.expectedProcessed/);
  assert.match(cancel, /disposition !== 'already-cancelled'/);
  assert.match(cancel, /\.eq\('processing_status', media\.processing_status\)/);
  assert.ok(cancel.indexOf(".update({") < cancel.indexOf('processed: retainedPaths.expectedProcessed'));
  assert.doesNotMatch(cancel, /ownerStatus\.processing_status === 'removed'/);
  assert.doesNotMatch(cancel, /body\.(?:path|raw_storage_path)|input\.(?:path|raw_storage_path)/);
});
