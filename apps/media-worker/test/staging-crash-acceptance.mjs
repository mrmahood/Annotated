import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PsqlDatabase } from '../src/infrastructure/psql-database.mjs';
import { PostgresWorkerStore } from '../src/infrastructure/postgres-worker-store.mjs';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';
import { createDerivativeAudioInput } from '../src/transcription/derivative-audio.mjs';
import { OpenAIWhisperTranscriber } from '../src/transcription/openai-whisper-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';

const API_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const EXPECTED_DATABASE_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const BOUNDARIES = Object.freeze({
  after_claim: { index: 1, expectedResume: 'probing' },
  after_derivative_upload: { index: 2, expectedResume: 'probing' },
  after_derivative_stage: { index: 3, expectedResume: 'transcribing' },
  after_transcript_stage: { index: 4, expectedResume: 'raw_cleanup' },
  after_raw_delete: { index: 5, expectedResume: 'raw_cleanup' },
  after_raw_confirm: { index: 6, expectedResume: 'finalizing' },
});
const CAPTURE_METADATA = Object.freeze({
  version: 2,
  capture_track: {
    mime_type: 'audio/webm;codecs=opus',
    audio_track_count: 1,
    video_track_count: 0,
    tracks: [{ kind: 'audio', settings: { sampleRate: 48_000, channelCount: 2 } }],
    loopback_enabled: true,
  },
  timing: {
    requested_start_ms: 0,
    requested_end_ms: 9_000,
    requested_duration_ms: 9_000,
    lead_in_ms: 0,
    recorder_elapsed_ms: 9_958,
    player_start_ms: 0,
    player_end_ms: 9_000,
    lead_in_clock: 'offscreen_monotonic',
  },
});

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function ids(index) {
  const suffix = String(index).padStart(12, '0');
  return Object.freeze({
    sourceId: `c6010000-0000-4000-8000-${suffix}`,
    annotationId: `c6020000-0000-4000-8000-${suffix}`,
    mediaId: `c6030000-0000-4000-8000-${suffix}`,
    objectId: `c6040000-0000-4000-8000-${suffix}`,
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function database() {
  const databaseUrl = required(process.env.ANNOTATED_DATABASE_URL, 'Database URL');
  const parsed = new URL(databaseUrl);
  if (parsed.hostname !== EXPECTED_DATABASE_HOST || parsed.port !== '6543') {
    throw new TypeError('Database URL is not the approved Staging pooler.');
  }
  return new PsqlDatabase({
    databaseUrl,
    psqlPath: required(process.env.ANNOTATED_PSQL_BIN, 'psql path'),
    localOnly: false,
  });
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
      'user-agent': 'Annotated-C6-Crash-Acceptance/1.0',
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

function paths(owner, fixtureIds) {
  const prefix = `${owner}/${fixtureIds.annotationId}/${fixtureIds.mediaId}`;
  return Object.freeze({
    rawPath: `${prefix}/${fixtureIds.objectId}.webm`,
    processedPath: `${prefix}/excerpt.m4a`,
  });
}

async function seed(boundary, fixtureIds, owner, objectPaths, rawBytes) {
  const existing = await api(`/rest/v1/annotation_media?select=id&id=eq.${fixtureIds.mediaId}`);
  if (!Array.isArray(existing) || existing.length !== 0) throw new Error('Crash fixture already exists.');
  const privateStorage = storage();
  await privateStorage.uploadNoUpsert('annotation-media-raw', objectPaths.rawPath, rawBytes, 'audio/webm');
  await api('/rest/v1/sources', {
    method: 'POST',
    body: [{
      id: fixtureIds.sourceId,
      normalized_url: `https://staging.invalid/c6-crash/${boundary}`,
      canonical_url: `https://staging.invalid/c6-crash/${boundary}`,
      source_type: 'podcast',
      title: 'C6 Crash Recovery Fixture',
      metadata: { fixture: 'synthetic' },
    }],
  });
  await api('/rest/v1/annotations', {
    method: 'POST',
    body: [{
      id: fixtureIds.annotationId,
      source_id: fixtureIds.sourceId,
      user_id: owner,
      annotation_type: 'audio_clip',
      commentary_text: 'C6 Staging crash recovery acceptance',
      status: 'draft',
      slug: `c6-crash-${BOUNDARIES[boundary].index}`,
    }],
  });
  await api('/rest/v1/annotation_targets', {
    method: 'POST',
    body: [{ annotation_id: fixtureIds.annotationId, target_type: 'time_range', start_ms: 0, end_ms: 9_000 }],
  });
  await api('/rest/v1/annotation_media', {
    method: 'POST',
    body: [{
      id: fixtureIds.mediaId,
      annotation_id: fixtureIds.annotationId,
      media_type: 'audio',
      processing_status: 'processing',
      processing_stage: 'queued',
      capture_metadata: CAPTURE_METADATA,
      raw_storage_path: objectPaths.rawPath,
      raw_mime_type: 'audio/webm',
      raw_byte_size: rawBytes.length,
      attempt_count: 0,
      next_attempt_at: new Date(Date.now() - 1_000).toISOString(),
      uploaded_at: new Date().toISOString(),
    }],
  });
}

async function prepare(boundary) {
  const definition = BOUNDARIES[boundary];
  if (!definition) throw new TypeError('Crash boundary is invalid.');
  const fixtureIds = ids(definition.index);
  const owner = await ownerId();
  const objectPaths = paths(owner, fixtureIds);
  const rawPath = required(process.env.ANNOTATED_RAW_FIXTURE, 'raw fixture path');
  const rawBytes = await readFile(rawPath);
  await seed(boundary, fixtureIds, owner, objectPaths, rawBytes);
  const privateStorage = storage();
  const store = new PostgresWorkerStore(database());
  const claim = store.claim(fixtureIds.mediaId, 900);
  if (!claim || claim.resume_stage !== 'probing' || Number(claim.attempt_count) !== 1) {
    throw new Error('Initial crash fixture claim was invalid.');
  }

  let derivative = null;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c6-crash-'));
  const derivativePath = path.join(temporaryDirectory, 'excerpt.m4a');
  const transcriptionPath = path.join(temporaryDirectory, 'transcription.flac');
  try {
    if (definition.index >= 2) {
      derivative = await createLocalDerivative({
        ffmpegPath: required(process.env.ANNOTATED_FFMPEG_BIN, 'FFmpeg path'),
        ffprobePath: required(process.env.ANNOTATED_FFPROBE_BIN, 'FFprobe path'),
        mediaType: 'audio',
        inputPath: rawPath,
        outputPath: derivativePath,
        captureMetadata: CAPTURE_METADATA,
        requestedDurationMs: 9_000,
      });
      await privateStorage.uploadNoUpsert(
        'annotation-media', objectPaths.processedPath, await readFile(derivativePath), derivative.output.mimeType,
      );
    }
    if (definition.index >= 3) {
      store.stageDerivative(fixtureIds.mediaId, claim.lease_token, {
        rawChecksumSha256: derivative.input.checksumSha256,
        processedStoragePath: objectPaths.processedPath,
        ...derivative.output,
      });
    }
    if (definition.index >= 4) {
      const capability = await createDerivativeAudioInput({
        ffmpegPath: required(process.env.ANNOTATED_FFMPEG_BIN, 'FFmpeg path'),
        ffprobePath: required(process.env.ANNOTATED_FFPROBE_BIN, 'FFprobe path'),
        mediaType: 'audio',
        derivativePath,
        derivativeChecksumSha256: derivative.output.checksumSha256,
        derivativeDurationMs: derivative.output.durationMs,
        transcriptionAudioPath: transcriptionPath,
      });
      const transcript = await transcribeAndValidate(new OpenAIWhisperTranscriber({
        apiKey: required(process.env.ANNOTATED_OPENAI_API_KEY, 'OpenAI key'),
      }), capability);
      store.stageTranscript(fixtureIds.mediaId, claim.lease_token, transcript);
    }
    if (definition.index >= 5) await privateStorage.remove('annotation-media-raw', [objectPaths.rawPath]);
    if (definition.index >= 6) store.confirmRawDeleted(fixtureIds.mediaId, claim.lease_token);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await api(`/rest/v1/annotation_media?id=eq.${fixtureIds.mediaId}`, {
    method: 'PATCH',
    body: { lease_expires_at: new Date(Date.now() - 60_000).toISOString() },
  });
  const mediaRows = await api(`/rest/v1/annotation_media?select=attempt_count,lease_token,lease_expires_at,processed_storage_path,checksum_sha256,raw_storage_path,raw_deleted_at&id=eq.${fixtureIds.mediaId}`);
  const annotationRows = await api(`/rest/v1/annotations?select=status&id=eq.${fixtureIds.annotationId}`);
  const transcriptRows = await api(`/rest/v1/annotation_transcripts?select=annotation_id&annotation_id=eq.${fixtureIds.annotationId}`);
  if (mediaRows.length !== 1 || annotationRows.length !== 1 || annotationRows[0].status !== 'draft') {
    throw new Error('Prepared crash fixture did not remain private and draft.');
  }
  const media = mediaRows[0];
  process.stdout.write(`${JSON.stringify({
    boundary,
    media_id: fixtureIds.mediaId,
    expected_resume: definition.expectedResume,
    annotation_draft: true,
    attempt_count: Number(media.attempt_count),
    lease_expired: new Date(media.lease_expires_at).getTime() <= Date.now(),
    raw_object_present: await privateStorage.exists('annotation-media-raw', objectPaths.rawPath),
    processed_object_present: await privateStorage.exists('annotation-media', objectPaths.processedPath),
    derivative_staged: typeof media.checksum_sha256 === 'string',
    transcript_staged: transcriptRows.length === 1,
    raw_deleted_confirmed: media.raw_storage_path === null && media.raw_deleted_at !== null,
  })}\n`);
}

async function status(boundary) {
  const definition = BOUNDARIES[boundary];
  if (!definition) throw new TypeError('Crash boundary is invalid.');
  const fixtureIds = ids(definition.index);
  const owner = await ownerId();
  const objectPaths = paths(owner, fixtureIds);
  const mediaRows = await api(`/rest/v1/annotation_media?select=processing_status,processing_stage,attempt_count,next_attempt_at,lease_token,failure_stage,failure_code,raw_storage_path,raw_deleted_at,processed_storage_path,processed_mime_type,duration_ms,byte_size,checksum_sha256&id=eq.${fixtureIds.mediaId}`);
  const annotationRows = await api(`/rest/v1/annotations?select=status&id=eq.${fixtureIds.annotationId}`);
  const transcriptRows = await api(`/rest/v1/annotation_transcripts?select=segments,provider,model&annotation_id=eq.${fixtureIds.annotationId}`);
  if (mediaRows.length !== 1 || annotationRows.length !== 1) throw new Error('Crash fixture status is unavailable.');
  const media = mediaRows[0];
  const privateStorage = storage();
  const processedPresent = await privateStorage.exists('annotation-media', objectPaths.processedPath);
  let checksumMatches = false;
  if (processedPresent && typeof media.checksum_sha256 === 'string') {
    checksumMatches = sha256(await privateStorage.download('annotation-media', objectPaths.processedPath)) === media.checksum_sha256;
  }
  const segments = transcriptRows[0]?.segments;
  process.stdout.write(`${JSON.stringify({
    boundary,
    media_id: fixtureIds.mediaId,
    annotation_status: annotationRows[0].status,
    processing_status: media.processing_status,
    processing_stage: media.processing_stage,
    attempt_count: Number(media.attempt_count),
    retry_present: media.next_attempt_at !== null,
    lease_present: media.lease_token !== null,
    failure_present: media.failure_stage !== null || media.failure_code !== null,
    raw_reference_removed: media.raw_storage_path === null,
    raw_deleted_confirmed: media.raw_deleted_at !== null,
    raw_object_present: await privateStorage.exists('annotation-media-raw', objectPaths.rawPath),
    processed_object_present: processedPresent,
    processed_checksum_matches: checksumMatches,
    duration_ms: media.duration_ms,
    transcript_present: transcriptRows.length === 1,
    transcript_provider: transcriptRows[0]?.provider ?? null,
    transcript_model: transcriptRows[0]?.model ?? null,
    segment_count: Array.isArray(segments) ? segments.length : null,
    first_segment_start_ms: Array.isArray(segments) && segments.length ? segments[0].start_ms : null,
    last_segment_end_ms: Array.isArray(segments) && segments.length ? segments.at(-1).end_ms : null,
  })}\n`);
}

async function cleanup(boundary) {
  const definition = BOUNDARIES[boundary];
  if (!definition) throw new TypeError('Crash boundary is invalid.');
  const fixtureIds = ids(definition.index);
  const owner = await ownerId();
  const objectPaths = paths(owner, fixtureIds);
  const privateStorage = storage();
  if (await privateStorage.exists('annotation-media-raw', objectPaths.rawPath)) {
    await privateStorage.remove('annotation-media-raw', [objectPaths.rawPath]);
  }
  if (await privateStorage.exists('annotation-media', objectPaths.processedPath)) {
    await privateStorage.remove('annotation-media', [objectPaths.processedPath]);
  }
  await api(`/rest/v1/annotations?id=eq.${fixtureIds.annotationId}`, { method: 'DELETE' });
  await api(`/rest/v1/sources?id=eq.${fixtureIds.sourceId}`, { method: 'DELETE' });
  const rows = await api(`/rest/v1/annotation_media?select=id&id=eq.${fixtureIds.mediaId}`);
  process.stdout.write(`${JSON.stringify({ boundary, cleanup_verified: rows.length === 0 })}\n`);
}

async function main() {
  if (process.env.ANNOTATED_C6_STAGING_CRASH !== '1') {
    throw new Error('Set ANNOTATED_C6_STAGING_CRASH=1 for this exact Staging acceptance harness.');
  }
  const command = process.argv[2];
  const boundary = process.argv[3];
  if (command === 'prepare') await prepare(boundary);
  else if (command === 'status') await status(boundary);
  else if (command === 'cleanup') await cleanup(boundary);
  else throw new TypeError('Use prepare, status, or cleanup with one crash boundary.');
}

await main().catch(() => {
  process.stderr.write('C6 Staging crash acceptance failed.\n');
  process.exitCode = 1;
});
