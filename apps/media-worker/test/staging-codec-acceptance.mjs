import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';
import { inspectLocalRaw } from '../src/media/local-media-core.mjs';

const API_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const IDS = Object.freeze({
  sourceId: 'c6610000-0000-4000-8000-000000000001',
  annotationId: 'c6620000-0000-4000-8000-000000000001',
  mediaId: 'c6630000-0000-4000-8000-000000000001',
  objectId: 'c6640000-0000-4000-8000-000000000001',
});
const CAPTURE_METADATA = Object.freeze({
  version: 2,
  viewport: {
    start: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
    end: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
  },
  video_element: {
    start: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
    end: { x: 0, y: 0, width: 1280, height: 720, top: 0, right: 1280, bottom: 720, left: 0 },
  },
  intrinsic_video: { width: 1280, height: 720 },
  computed_style: { object_fit: 'contain', object_position: '50% 50%' },
  fullscreen: { start: false, end: false },
  capture_track: {
    mime_type: 'video/webm;codecs=vp8,opus',
    audio_track_count: 1,
    video_track_count: 1,
    tracks: [
      { kind: 'audio', settings: { sampleRate: 48_000, channelCount: 2 } },
      { kind: 'video', settings: { width: 1280, height: 720, frameRate: 30 } },
    ],
    loopback_enabled: true,
  },
  timing: {
    requested_start_ms: 0,
    requested_end_ms: 9_000,
    requested_duration_ms: 9_000,
    lead_in_ms: 50,
    recorder_elapsed_ms: 9_950,
    player_start_ms: 0,
    player_end_ms: 9_000,
    lead_in_clock: 'offscreen_monotonic',
  },
});

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function storage() {
  return new SupabaseStorage({
    apiUrl: API_URL,
    serviceRoleKey: required(process.env.ANNOTATED_SERVICE_ROLE_KEY, 'Staging Storage secret'),
    localOnly: false,
  });
}

async function api(pathname, { method = 'GET', body, prefer = 'return=minimal' } = {}) {
  const secret = required(process.env.ANNOTATED_SERVICE_ROLE_KEY, 'Staging API secret');
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      prefer,
      'user-agent': 'Annotated-C6-Codec-Acceptance/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Staging API request failed with HTTP ${response.status}.`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ownerId() {
  const rows = await api('/rest/v1/profiles?select=id&limit=1');
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].id !== 'string') {
    throw new Error('Expected exactly one selected Staging fixture owner.');
  }
  return rows[0].id;
}

function objectPaths(owner) {
  const prefix = `${owner}/${IDS.annotationId}/${IDS.mediaId}`;
  return Object.freeze({ prefix, raw: `${prefix}/${IDS.objectId}.webm`, processed: `${prefix}/excerpt.mp4` });
}

async function listObjects(bucket, prefix) {
  const rows = await api(`/storage/v1/object/list/${bucket}`, {
    method: 'POST', body: { prefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } },
  });
  return Array.isArray(rows) ? rows : [];
}

async function preflight() {
  const owner = await ownerId();
  const paths = objectPaths(owner);
  const active = await api('/rest/v1/annotation_media?select=id&processing_status=eq.processing');
  const fixtures = await api(`/rest/v1/annotation_media?select=id&id=eq.${IDS.mediaId}`);
  const rawObjects = await listObjects('annotation-media-raw', paths.prefix);
  const processedObjects = await listObjects('annotation-media', paths.prefix);
  const passed = active.length === 0 && fixtures.length === 0 && rawObjects.length === 0 && processedObjects.length === 0;
  process.stdout.write(`${JSON.stringify({ gate: 'c6_codec_vp8_preflight', exact_staging_ref: true,
    processing_queue_count: active.length, fixture_row_count: fixtures.length,
    raw_object_count: rawObjects.length, processed_object_count: processedObjects.length, passed })}\n`);
  if (!passed) process.exitCode = 1;
}

async function prepare() {
  const rawPath = required(process.env.ANNOTATED_RAW_FIXTURE, 'raw fixture path');
  const rawBytes = await readFile(rawPath);
  const inspected = await inspectLocalRaw({
    ffprobePath: required(process.env.ANNOTATED_FFPROBE_BIN, 'ffprobe path'),
    mediaType: 'video', inputPath: rawPath, captureMetadata: CAPTURE_METADATA, requestedDurationMs: 9_000,
  });
  const rawVideo = inspected.input.probe.streams.find((stream) => stream.codec_type === 'video');
  const rawAudio = inspected.input.probe.streams.find((stream) => stream.codec_type === 'audio');
  if (rawVideo?.codec_name !== 'vp8' || rawAudio?.codec_name !== 'opus') throw new Error('The codec fixture changed after generation.');
  const owner = await ownerId();
  const paths = objectPaths(owner);
  try {
    await storage().uploadNoUpsert('annotation-media-raw', paths.raw, rawBytes, 'video/webm');
    await api('/rest/v1/sources', { method: 'POST', body: [{
      id: IDS.sourceId, normalized_url: 'https://staging.invalid/c6-codec-vp8',
      canonical_url: 'https://staging.invalid/c6-codec-vp8', source_type: 'youtube',
      title: 'C6 VP8 codec fixture', metadata: { fixture: 'synthetic' },
    }] });
    await api('/rest/v1/annotations', { method: 'POST', body: [{
      id: IDS.annotationId, source_id: IDS.sourceId, user_id: owner, annotation_type: 'video_clip',
      commentary_text: 'C6 Staging VP8 and Opus codec acceptance', status: 'draft', slug: 'c6-codec-vp8',
    }] });
    await api('/rest/v1/annotation_targets', { method: 'POST', body: [{
      annotation_id: IDS.annotationId, target_type: 'time_range', start_ms: 0, end_ms: 9_000,
    }] });
    await api('/rest/v1/annotation_media', { method: 'POST', body: [{
      id: IDS.mediaId, annotation_id: IDS.annotationId, media_type: 'video', processing_status: 'processing',
      processing_stage: 'queued', capture_metadata: CAPTURE_METADATA, raw_storage_path: paths.raw,
      raw_mime_type: 'video/webm', raw_byte_size: rawBytes.length, attempt_count: 0,
      next_attempt_at: new Date(Date.now() - 1_000).toISOString(), uploaded_at: new Date().toISOString(),
    }] });
  } catch (error) {
    await cleanup({ quiet: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ gate: 'c6_codec_vp8_prepare', media_id: IDS.mediaId,
    raw_duration_ms: Math.round(Number(inspected.input.probe.format.duration) * 1000), raw_byte_size: rawBytes.length,
    raw_checksum_sha256: sha256(rawBytes), raw_video_codec: rawVideo.codec_name, raw_audio_codec: rawAudio.codec_name,
    requested_duration_ms: 9_000, annotation_draft: true, prepared: true })}\n`);
}

function segmentsAreBounded(segments) {
  if (!Array.isArray(segments) || segments.length < 1) return false;
  let priorEnd = 0;
  return segments.every((segment) => {
    const valid = Number.isInteger(segment.start_ms) && Number.isInteger(segment.end_ms) &&
      segment.start_ms >= 0 && segment.end_ms > segment.start_ms && segment.end_ms <= 9_000 &&
      segment.start_ms >= priorEnd - 20 && typeof segment.text === 'string' && segment.text.trim().length > 0;
    priorEnd = segment.end_ms;
    return valid;
  });
}

async function status() {
  const owner = await ownerId();
  const paths = objectPaths(owner);
  const mediaRows = await api(`/rest/v1/annotation_media?select=processing_status,processing_stage,attempt_count,next_attempt_at,lease_token,failure_stage,failure_code,raw_storage_path,raw_deleted_at,processed_storage_path,processed_mime_type,duration_ms,width,height,byte_size,checksum_sha256&id=eq.${IDS.mediaId}`);
  const annotationRows = await api(`/rest/v1/annotations?select=status&id=eq.${IDS.annotationId}`);
  const transcriptRows = await api(`/rest/v1/annotation_transcripts?select=transcript_text,segments,provider,model&annotation_id=eq.${IDS.annotationId}`);
  if (mediaRows.length !== 1 || annotationRows.length !== 1) throw new Error('Codec fixture status is unavailable.');
  const media = mediaRows[0];
  if (media.processing_status !== 'ready') {
    const retryScheduled = media.processing_status === 'processing' && media.processing_stage === 'queued' &&
      media.next_attempt_at !== null && media.lease_token === null && media.failure_stage !== null && media.failure_code !== null;
    process.stdout.write(`${JSON.stringify({ gate: 'c6_codec_vp8_status', outcome: media.processing_status === 'failed' ? 'failed' : 'pending',
      processing_status: media.processing_status, processing_stage: media.processing_stage,
      attempt_count: Number(media.attempt_count), retry_present: media.next_attempt_at !== null,
      lease_present: media.lease_token !== null, failure_stage: media.failure_stage, failure_code: media.failure_code })}\n`);
    process.exitCode = media.processing_status === 'failed' ? 1 : retryScheduled ? 3 : 2;
    return;
  }

  const processedBytes = await storage().download('annotation-media', paths.processed);
  const rawPresent = await storage().exists('annotation-media-raw', paths.raw);
  const objects = await listObjects('annotation-media', paths.prefix);
  const transcript = transcriptRows[0];
  const normalizedText = typeof transcript?.transcript_text === 'string' ? transcript.transcript_text.toLowerCase() : '';
  const expectedTermsPresent = ['annotated', 'codec', 'final'].every((term) => normalizedText.includes(term));
  const artifactPath = path.resolve(required(process.env.ANNOTATED_ACCEPTANCE_ARTIFACT, 'acceptance artifact path'));
  await writeFile(artifactPath, processedBytes, { flag: 'wx' });
  const checks = {
    annotation_published: annotationRows[0].status === 'published',
    ready: media.processing_status === 'ready' && media.processing_stage === null,
    first_attempt: Number(media.attempt_count) === 1,
    no_retry_or_lease: media.next_attempt_at === null && media.lease_token === null,
    no_failure: media.failure_stage === null && media.failure_code === null,
    raw_deleted_confirmed: media.raw_storage_path === null && media.raw_deleted_at !== null && !rawPresent,
    exact_processed_path: media.processed_storage_path === paths.processed,
    one_processed_object: objects.length === 1 && objects[0].name === 'excerpt.mp4',
    exact_duration: Number(media.duration_ms) === 9_000,
    video_profile_shape: media.processed_mime_type === 'video/mp4' && Number(media.width) === 426 && Number(media.height) === 240,
    byte_size_matches: Number(media.byte_size) === processedBytes.length,
    checksum_matches: media.checksum_sha256 === sha256(processedBytes),
    transcript_contract: transcriptRows.length === 1 && transcript.provider === 'openai' && transcript.model === 'whisper-1' && segmentsAreBounded(transcript.segments),
    expected_terms_present: expectedTermsPresent,
  };
  const passed = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ gate: 'c6_codec_vp8_status', outcome: passed ? 'passed' : 'failed', ...checks,
    processed_byte_size: processedBytes.length, processed_checksum_sha256: sha256(processedBytes),
    transcript_character_count: normalizedText.length, segment_count: Array.isArray(transcript?.segments) ? transcript.segments.length : 0,
    first_segment_start_ms: transcript?.segments?.[0]?.start_ms ?? null,
    last_segment_end_ms: transcript?.segments?.at(-1)?.end_ms ?? null, artifact_path: artifactPath })}\n`);
  if (!passed) process.exitCode = 1;
}

async function cleanup({ quiet = false } = {}) {
  const owner = await ownerId();
  const paths = objectPaths(owner);
  const privateStorage = storage();
  if (await privateStorage.exists('annotation-media-raw', paths.raw)) await privateStorage.remove('annotation-media-raw', [paths.raw]);
  if (await privateStorage.exists('annotation-media', paths.processed)) await privateStorage.remove('annotation-media', [paths.processed]);
  await api(`/rest/v1/annotations?id=eq.${IDS.annotationId}`, { method: 'DELETE' });
  await api(`/rest/v1/sources?id=eq.${IDS.sourceId}`, { method: 'DELETE' });
  const mediaRows = await api(`/rest/v1/annotation_media?select=id&id=eq.${IDS.mediaId}`);
  const sourceRows = await api(`/rest/v1/sources?select=id&id=eq.${IDS.sourceId}`);
  const rawObjects = await listObjects('annotation-media-raw', paths.prefix);
  const processedObjects = await listObjects('annotation-media', paths.prefix);
  const active = await api('/rest/v1/annotation_media?select=id&processing_status=eq.processing');
  const passed = mediaRows.length === 0 && sourceRows.length === 0 && rawObjects.length === 0 && processedObjects.length === 0 && active.length === 0;
  if (!quiet) process.stdout.write(`${JSON.stringify({ gate: 'c6_codec_vp8_cleanup', fixture_rows: mediaRows.length,
    source_rows: sourceRows.length, raw_objects: rawObjects.length, processed_objects: processedObjects.length,
    processing_queue_count: active.length, passed })}\n`);
  if (!passed) process.exitCode = 1;
}

if (process.env.ANNOTATED_C6_STAGING_CODEC !== '1') throw new Error('Set ANNOTATED_C6_STAGING_CODEC=1 for this exact Staging acceptance harness.');
const command = process.argv[2];
if (command === 'preflight') await preflight();
else if (command === 'prepare') await prepare();
else if (command === 'status') await status();
else if (command === 'cleanup') await cleanup();
else throw new TypeError('Use preflight, prepare, status, or cleanup.');
