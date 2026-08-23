import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';
import { inspectLocalRaw } from '../src/media/local-media-core.mjs';

const API_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const RETAINED_PORTRAIT_PROCESSED_SHA256 = 'fd0c97f6c50b2655c43e44e68db86ef639c7cee9f8ccd20940602ab7c4ea387a';
const CASES = Object.freeze({
  portrait: {
    ids: ['c6710000-0000-4000-8000-000000000001', 'c6720000-0000-4000-8000-000000000001', 'c6730000-0000-4000-8000-000000000001', 'c6740000-0000-4000-8000-000000000001'],
    viewport: { width: 360, height: 640 },
    rect: { x: 0, y: 20, width: 360, height: 600, top: 20, right: 360, bottom: 620, left: 0 },
    track: { width: 720, height: 1280 },
    intrinsic: { width: 1080, height: 1920 },
    expectedOutput: { width: 144, height: 240 },
    expectedTerm: 'portrait',
  },
  letterbox: {
    ids: ['c6750000-0000-4000-8000-000000000001', 'c6760000-0000-4000-8000-000000000001', 'c6770000-0000-4000-8000-000000000001', 'c6780000-0000-4000-8000-000000000001'],
    viewport: { width: 1280, height: 720 },
    rect: { x: 160, y: 90, width: 960, height: 540, top: 90, right: 1120, bottom: 630, left: 160 },
    track: { width: 1280, height: 720 },
    intrinsic: { width: 1920, height: 804 },
    expectedOutput: { width: 426, height: 240 },
    expectedTerm: 'letter',
  },
  unsafe: {
    ids: ['c6790000-0000-4000-8000-000000000001', 'c67a0000-0000-4000-8000-000000000001', 'c67b0000-0000-4000-8000-000000000001', 'c67c0000-0000-4000-8000-000000000001'],
    viewport: { width: 1280, height: 720 },
    rect: { x: -10, y: 90, width: 960, height: 540, top: 90, right: 950, bottom: 630, left: -10 },
    track: { width: 1280, height: 720 },
    intrinsic: { width: 1920, height: 1080 },
    terminalFailure: true,
  },
});

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function selectedCase() {
  const name = required(process.env.ANNOTATED_GEOMETRY_CASE, 'geometry case');
  const scenario = CASES[name];
  if (!scenario) throw new TypeError('Geometry case must be portrait, letterbox, or unsafe.');
  const [sourceId, annotationId, mediaId, objectId] = scenario.ids;
  return { name, ...scenario, sourceId, annotationId, mediaId, objectId };
}

function captureMetadata(scenario) {
  const viewport = { ...scenario.viewport, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 };
  return {
    version: 2,
    viewport: { start: viewport, end: structuredClone(viewport) },
    video_element: { start: scenario.rect, end: structuredClone(scenario.rect) },
    intrinsic_video: scenario.intrinsic,
    computed_style: { object_fit: 'contain', object_position: '50% 50%' },
    fullscreen: { start: false, end: false },
    capture_track: {
      mime_type: 'video/webm;codecs=vp9,opus', audio_track_count: 1, video_track_count: 1,
      tracks: [
        { kind: 'audio', settings: { sampleRate: 48_000, channelCount: 2 } },
        { kind: 'video', settings: { ...scenario.track, frameRate: 30 } },
      ],
      loopback_enabled: true,
    },
    timing: {
      requested_start_ms: 0, requested_end_ms: 9_000, requested_duration_ms: 9_000,
      lead_in_ms: 50, recorder_elapsed_ms: 9_950, player_start_ms: 0, player_end_ms: 9_000,
      lead_in_clock: 'offscreen_monotonic',
    },
  };
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function storage() {
  return new SupabaseStorage({ apiUrl: API_URL, serviceRoleKey: required(process.env.ANNOTATED_SERVICE_ROLE_KEY, 'Staging Storage secret'), localOnly: false });
}

async function api(pathname, { method = 'GET', body, prefer = 'return=minimal' } = {}) {
  const secret = required(process.env.ANNOTATED_SERVICE_ROLE_KEY, 'Staging API secret');
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json', prefer, 'user-agent': 'Annotated-C6-Geometry-Acceptance/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Staging API request failed with HTTP ${response.status}.`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ownerId() {
  const rows = await api('/rest/v1/profiles?select=id&limit=1');
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].id !== 'string') throw new Error('Expected exactly one selected Staging fixture owner.');
  return rows[0].id;
}

function objectPaths(owner, scenario) {
  const prefix = `${owner}/${scenario.annotationId}/${scenario.mediaId}`;
  return { prefix, raw: `${prefix}/${scenario.objectId}.webm`, processed: `${prefix}/excerpt.mp4` };
}

async function listObjects(bucket, prefix) {
  const rows = await api(`/storage/v1/object/list/${bucket}`, { method: 'POST', body: { prefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } } });
  return Array.isArray(rows) ? rows : [];
}

async function preflight() {
  const scenario = selectedCase();
  const paths = objectPaths(await ownerId(), scenario);
  const active = await api('/rest/v1/annotation_media?select=id&processing_status=eq.processing');
  const fixtures = await api(`/rest/v1/annotation_media?select=id&id=eq.${scenario.mediaId}`);
  const rawObjects = await listObjects('annotation-media-raw', paths.prefix);
  const processedObjects = await listObjects('annotation-media', paths.prefix);
  const passed = active.length === 0 && fixtures.length === 0 && rawObjects.length === 0 && processedObjects.length === 0;
  process.stdout.write(`${JSON.stringify({ gate: `c6_geometry_${scenario.name}_preflight`, processing_queue_count: active.length,
    fixture_row_count: fixtures.length, raw_object_count: rawObjects.length, processed_object_count: processedObjects.length, passed })}\n`);
  if (!passed) process.exitCode = 1;
}

async function prepare() {
  const scenario = selectedCase();
  const metadata = captureMetadata(scenario);
  const rawPath = required(process.env.ANNOTATED_RAW_FIXTURE, 'raw fixture path');
  const rawBytes = await readFile(rawPath);
  const inspected = await inspectLocalRaw({
    ffprobePath: required(process.env.ANNOTATED_FFPROBE_BIN, 'ffprobe path'), mediaType: 'video', inputPath: rawPath,
    captureMetadata: metadata, requestedDurationMs: 9_000,
  }).catch((error) => {
    if (scenario.terminalFailure && error?.code === 'unsafe_geometry') return { expectedUnsafeGeometry: true, input: null };
    throw error;
  });
  if (scenario.terminalFailure && !inspected.expectedUnsafeGeometry) throw new Error('The unsafe geometry fixture unexpectedly passed Local inspection.');
  const owner = await ownerId();
  const paths = objectPaths(owner, scenario);
  try {
    await storage().uploadNoUpsert('annotation-media-raw', paths.raw, rawBytes, 'video/webm');
    await api('/rest/v1/sources', { method: 'POST', body: [{
      id: scenario.sourceId, normalized_url: `https://staging.invalid/c6-geometry-${scenario.name}`,
      canonical_url: `https://staging.invalid/c6-geometry-${scenario.name}`, source_type: 'youtube',
      title: `C6 ${scenario.name} geometry fixture`, metadata: { fixture: 'synthetic' },
    }] });
    await api('/rest/v1/annotations', { method: 'POST', body: [{
      id: scenario.annotationId, source_id: scenario.sourceId, user_id: owner, annotation_type: 'video_clip',
      commentary_text: `C6 Staging ${scenario.name} geometry acceptance`, status: 'draft', slug: `c6-geometry-${scenario.name}`,
    }] });
    await api('/rest/v1/annotation_targets', { method: 'POST', body: [{ annotation_id: scenario.annotationId, target_type: 'time_range', start_ms: 0, end_ms: 9_000 }] });
    await api('/rest/v1/annotation_media', { method: 'POST', body: [{
      id: scenario.mediaId, annotation_id: scenario.annotationId, media_type: 'video', processing_status: 'processing', processing_stage: 'queued',
      capture_metadata: metadata, raw_storage_path: paths.raw, raw_mime_type: 'video/webm', raw_byte_size: rawBytes.length,
      attempt_count: scenario.terminalFailure ? 2 : 0, next_attempt_at: new Date(Date.now() - 1_000).toISOString(), uploaded_at: new Date().toISOString(),
    }] });
  } catch (error) {
    await cleanup({ quiet: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ gate: `c6_geometry_${scenario.name}_prepare`, media_id: scenario.mediaId,
    raw_byte_size: rawBytes.length, raw_checksum_sha256: sha256(rawBytes), requested_duration_ms: 9_000,
    expected_terminal_unsafe_geometry: Boolean(scenario.terminalFailure), annotation_draft: true, prepared: true })}\n`);
}

function segmentsAreBounded(segments) {
  if (!Array.isArray(segments) || segments.length < 1) return false;
  let priorEnd = 0;
  return segments.every((segment) => {
    const valid = Number.isInteger(segment.start_ms) && Number.isInteger(segment.end_ms) && segment.start_ms >= 0 &&
      segment.end_ms > segment.start_ms && segment.end_ms <= 9_000 && segment.start_ms >= priorEnd - 20 &&
      typeof segment.text === 'string' && segment.text.trim().length > 0;
    priorEnd = segment.end_ms;
    return valid;
  });
}

async function status({ expectedAttempt = 1, expectedChecksum = null, artifactVariable = 'ANNOTATED_ACCEPTANCE_ARTIFACT', gateSuffix = 'status' } = {}) {
  const scenario = selectedCase();
  const owner = await ownerId();
  const paths = objectPaths(owner, scenario);
  const mediaRows = await api(`/rest/v1/annotation_media?select=processing_status,processing_stage,attempt_count,next_attempt_at,lease_token,failure_stage,failure_code,raw_storage_path,raw_deleted_at,processed_storage_path,processed_mime_type,duration_ms,width,height,byte_size,checksum_sha256&id=eq.${scenario.mediaId}`);
  const annotationRows = await api(`/rest/v1/annotations?select=status&id=eq.${scenario.annotationId}`);
  const transcriptRows = await api(`/rest/v1/annotation_transcripts?select=transcript_text,segments,provider,model&annotation_id=eq.${scenario.annotationId}`);
  if (mediaRows.length !== 1 || annotationRows.length !== 1) throw new Error('Geometry fixture status is unavailable.');
  const media = mediaRows[0];
  const rawPresent = await storage().exists('annotation-media-raw', paths.raw);
  const processedPresent = await storage().exists('annotation-media', paths.processed);
  const objects = await listObjects('annotation-media', paths.prefix);

  if (scenario.terminalFailure) {
    const checks = {
      terminal_failed: media.processing_status === 'failed' && media.processing_stage === null,
      attempt_three: Number(media.attempt_count) === 3,
      unsafe_geometry: media.failure_stage === 'transcoding' && media.failure_code === 'unsafe_geometry',
      no_retry_or_lease: media.next_attempt_at === null && media.lease_token === null,
      annotation_draft: annotationRows[0].status === 'draft',
      no_transcript: transcriptRows.length === 0,
      no_processed_facts: media.processed_storage_path === null && media.processed_mime_type === null && media.duration_ms === null && media.byte_size === null && media.checksum_sha256 === null,
      no_processed_object: !processedPresent && objects.length === 0,
      raw_retained_for_terminal_cleanup: media.raw_storage_path === paths.raw && media.raw_deleted_at === null && rawPresent,
    };
    const passed = Object.values(checks).every(Boolean);
    process.stdout.write(`${JSON.stringify({ gate: 'c6_geometry_unsafe_status', outcome: passed ? 'passed' : 'failed', ...checks })}\n`);
    if (!passed) process.exitCode = media.processing_status === 'processing' ? 2 : 1;
    return;
  }

  if (media.processing_status !== 'ready') {
    const retryScheduled = media.processing_status === 'processing' && media.processing_stage === 'queued' && media.next_attempt_at !== null && media.lease_token === null && media.failure_code !== null;
    const awaitingExpectedAttempt = Number(media.attempt_count) < expectedAttempt;
    process.stdout.write(`${JSON.stringify({ gate: `c6_geometry_${scenario.name}_${gateSuffix}`, outcome: 'pending', processing_status: media.processing_status,
      processing_stage: media.processing_stage, attempt_count: Number(media.attempt_count), retry_present: media.next_attempt_at !== null,
      lease_present: media.lease_token !== null, failure_stage: media.failure_stage, failure_code: media.failure_code,
      awaiting_expected_attempt: awaitingExpectedAttempt })}\n`);
    process.exitCode = retryScheduled && !awaitingExpectedAttempt ? 3 : 2;
    return;
  }

  const processedBytes = await storage().download('annotation-media', paths.processed);
  const transcript = transcriptRows[0];
  const normalizedText = typeof transcript?.transcript_text === 'string' ? transcript.transcript_text.toLowerCase() : '';
  const artifactPath = path.resolve(required(process.env[artifactVariable], 'acceptance artifact path'));
  await writeFile(artifactPath, processedBytes, { flag: 'wx' });
  const checks = {
    annotation_published: annotationRows[0].status === 'published', ready: media.processing_status === 'ready' && media.processing_stage === null,
    attempt_count_matches: Number(media.attempt_count) === expectedAttempt, no_retry_or_lease: media.next_attempt_at === null && media.lease_token === null,
    no_failure: media.failure_stage === null && media.failure_code === null,
    raw_deleted_confirmed: media.raw_storage_path === null && media.raw_deleted_at !== null && !rawPresent,
    exact_processed_path: media.processed_storage_path === paths.processed,
    one_processed_object: processedPresent && objects.length === 1 && objects[0].name === 'excerpt.mp4',
    exact_duration: Number(media.duration_ms) === 9_000,
    expected_dimensions: media.processed_mime_type === 'video/mp4' && Number(media.width) === scenario.expectedOutput.width && Number(media.height) === scenario.expectedOutput.height,
    byte_size_matches: Number(media.byte_size) === processedBytes.length, checksum_matches: media.checksum_sha256 === sha256(processedBytes),
    transcript_contract: transcriptRows.length === 1 && transcript.provider === 'openai' && transcript.model === 'whisper-1' && segmentsAreBounded(transcript.segments),
    expected_terms_present: ['annotated', 'geometry', scenario.expectedTerm, 'final'].every((term) => normalizedText.includes(term)),
  };
  if (expectedChecksum !== null) checks.retained_derivative_reused = media.checksum_sha256 === expectedChecksum;
  const passed = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ gate: `c6_geometry_${scenario.name}_${gateSuffix}`, outcome: passed ? 'passed' : 'failed', ...checks,
    processed_byte_size: processedBytes.length, processed_checksum_sha256: sha256(processedBytes), transcript_character_count: normalizedText.length,
    segment_count: Array.isArray(transcript?.segments) ? transcript.segments.length : 0, artifact_path: artifactPath })}\n`);
  if (!passed) process.exitCode = 1;
}

async function recoveryPreflight() {
  const scenario = selectedCase();
  if (scenario.name !== 'portrait') throw new Error('Only the retained portrait fixture may be recovered.');
  const owner = await ownerId();
  const paths = objectPaths(owner, scenario);
  const mediaRows = await api(`/rest/v1/annotation_media?select=processing_status,processing_stage,attempt_count,next_attempt_at,lease_token,failure_stage,failure_code,raw_storage_path,raw_deleted_at,processed_storage_path,processed_mime_type,duration_ms,width,height,byte_size,checksum_sha256&id=eq.${scenario.mediaId}`);
  const annotationRows = await api(`/rest/v1/annotations?select=status&id=eq.${scenario.annotationId}`);
  const transcriptRows = await api(`/rest/v1/annotation_transcripts?select=annotation_id&annotation_id=eq.${scenario.annotationId}`);
  const active = await api('/rest/v1/annotation_media?select=id&processing_status=eq.processing');
  const media = mediaRows[0];
  const rawPresent = await storage().exists('annotation-media-raw', paths.raw);
  const processedPresent = await storage().exists('annotation-media', paths.processed);
  let processedBytes = null;
  if (processedPresent) processedBytes = await storage().download('annotation-media', paths.processed);
  const retryDue = typeof media?.next_attempt_at === 'string' && Date.parse(media.next_attempt_at) <= Date.now();
  const checks = {
    exact_fixture_row: mediaRows.length === 1,
    exact_processing_queue: active.length === 1 && active[0].id === scenario.mediaId,
    annotation_draft: annotationRows.length === 1 && annotationRows[0].status === 'draft',
    no_transcript_staged: transcriptRows.length === 0,
    retry_due: retryDue,
    retained_boundary: media?.processing_status === 'processing' && media?.processing_stage === 'queued' && Number(media?.attempt_count) === 1 && media?.lease_token === null && media?.failure_stage === 'transcribing' && media?.failure_code === 'transcript_invalid',
    raw_retained: media?.raw_storage_path === paths.raw && media?.raw_deleted_at === null && rawPresent,
    derivative_staged: media?.processed_storage_path === paths.processed && media?.processed_mime_type === 'video/mp4' && processedPresent,
    derivative_facts_match: Number(media?.duration_ms) === 9_000 && Number(media?.width) === 144 && Number(media?.height) === 240 &&
      processedBytes !== null && Number(media?.byte_size) === processedBytes.length && media?.checksum_sha256 === sha256(processedBytes) &&
      media?.checksum_sha256 === RETAINED_PORTRAIT_PROCESSED_SHA256,
  };
  const passed = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ gate: 'c6_geometry_portrait_recovery_preflight', ...checks,
    processed_byte_size: processedBytes?.length ?? null, processed_checksum_sha256: processedBytes === null ? null : sha256(processedBytes), passed })}\n`);
  if (!passed) process.exitCode = 1;
}

async function diagnosticExport() {
  const scenario = selectedCase();
  if (scenario.name !== 'portrait') throw new Error('Only the retained portrait fixture may be diagnosed.');
  const owner = await ownerId();
  const paths = objectPaths(owner, scenario);
  const rows = await api(`/rest/v1/annotation_media?select=processing_status,processing_stage,attempt_count,next_attempt_at,lease_token,failure_stage,failure_code,processed_storage_path,processed_mime_type,duration_ms,width,height,byte_size,checksum_sha256&id=eq.${scenario.mediaId}`);
  const media = rows[0];
  const retained = rows.length === 1 && media.processing_status === 'processing' && media.processing_stage === 'queued' &&
    Number(media.attempt_count) === 1 && media.next_attempt_at !== null && media.lease_token === null &&
    media.failure_stage === 'transcribing' && media.failure_code === 'transcript_invalid' &&
    media.processed_storage_path === paths.processed && media.processed_mime_type === 'video/mp4' &&
    Number(media.duration_ms) === 9_000 && Number(media.width) === 144 && Number(media.height) === 240;
  const processedPresent = await storage().exists('annotation-media', paths.processed);
  if (!retained || !processedPresent) throw new Error('The retained portrait derivative is not at the exact diagnostic boundary.');
  const processedBytes = await storage().download('annotation-media', paths.processed);
  if (Number(media.byte_size) !== processedBytes.length || media.checksum_sha256 !== sha256(processedBytes)) {
    throw new Error('The retained portrait derivative does not match its staged facts.');
  }
  const artifactPath = path.resolve(required(process.env.ANNOTATED_C6_DIAGNOSTIC_ARTIFACT, 'diagnostic artifact path'));
  await writeFile(artifactPath, processedBytes, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ gate: 'c6_geometry_portrait_diagnostic_export', outcome: 'passed',
    attempt_count: Number(media.attempt_count), retry_present: true, lease_present: false,
    failure_stage: media.failure_stage, failure_code: media.failure_code, derivative_duration_ms: Number(media.duration_ms),
    processed_byte_size: processedBytes.length, processed_checksum_sha256: sha256(processedBytes), artifact_path: artifactPath })}\n`);
}

async function cleanup({ quiet = false } = {}) {
  const scenario = selectedCase();
  const owner = await ownerId();
  const paths = objectPaths(owner, scenario);
  const privateStorage = storage();
  if (await privateStorage.exists('annotation-media-raw', paths.raw)) await privateStorage.remove('annotation-media-raw', [paths.raw]);
  if (await privateStorage.exists('annotation-media', paths.processed)) await privateStorage.remove('annotation-media', [paths.processed]);
  await api(`/rest/v1/annotations?id=eq.${scenario.annotationId}`, { method: 'DELETE' });
  await api(`/rest/v1/sources?id=eq.${scenario.sourceId}`, { method: 'DELETE' });
  const mediaRows = await api(`/rest/v1/annotation_media?select=id&id=eq.${scenario.mediaId}`);
  const sourceRows = await api(`/rest/v1/sources?select=id&id=eq.${scenario.sourceId}`);
  const rawObjects = await listObjects('annotation-media-raw', paths.prefix);
  const processedObjects = await listObjects('annotation-media', paths.prefix);
  const active = await api('/rest/v1/annotation_media?select=id&processing_status=eq.processing');
  const passed = mediaRows.length === 0 && sourceRows.length === 0 && rawObjects.length === 0 && processedObjects.length === 0 && active.length === 0;
  if (!quiet) process.stdout.write(`${JSON.stringify({ gate: `c6_geometry_${scenario.name}_cleanup`, fixture_rows: mediaRows.length,
    source_rows: sourceRows.length, raw_objects: rawObjects.length, processed_objects: processedObjects.length,
    processing_queue_count: active.length, passed })}\n`);
  if (!passed) process.exitCode = 1;
}

if (process.env.ANNOTATED_C6_STAGING_GEOMETRY !== '1') throw new Error('Set ANNOTATED_C6_STAGING_GEOMETRY=1 for this exact Staging acceptance harness.');
const command = process.argv[2];
if (command === 'preflight') await preflight();
else if (command === 'prepare') await prepare();
else if (command === 'status') await status();
else if (command === 'recovery-preflight') await recoveryPreflight();
else if (command === 'recovery-status') await status({ expectedAttempt: 2, expectedChecksum: RETAINED_PORTRAIT_PROCESSED_SHA256,
  artifactVariable: 'ANNOTATED_C6_RECOVERY_ARTIFACT', gateSuffix: 'recovery_status' });
else if (command === 'diagnostic-export') await diagnosticExport();
else if (command === 'cleanup') await cleanup();
else throw new TypeError('Use preflight, prepare, status, recovery-preflight, recovery-status, diagnostic-export, or cleanup.');
