import { createHash } from 'node:crypto';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';

const API_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const FIXTURES = Object.freeze([
  Object.freeze({
    name: 'removed',
    sourceId: 'c6810000-0000-4000-8000-000000000001',
    annotationId: 'c6820000-0000-4000-8000-000000000001',
    mediaId: 'c6830000-0000-4000-8000-000000000001',
    objectId: 'c6840000-0000-4000-8000-000000000001',
  }),
  Object.freeze({
    name: 'processed_only_failed',
    sourceId: 'c6810000-0000-4000-8000-000000000002',
    annotationId: 'c6820000-0000-4000-8000-000000000002',
    mediaId: 'c6830000-0000-4000-8000-000000000002',
    objectId: 'c6840000-0000-4000-8000-000000000002',
  }),
]);
const ARTIFACT_BYTES = Buffer.from('Annotated C6 disposable lifecycle fixture.\n', 'utf8');
const ARTIFACT_CHECKSUM = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');
const CAPTURE_METADATA = Object.freeze({
  version: 2,
  capture_track: {
    mime_type: 'audio/webm;codecs=opus', audio_track_count: 1, video_track_count: 0,
    tracks: [{ kind: 'audio', settings: { sampleRate: 48_000, channelCount: 2 } }],
    loopback_enabled: true,
  },
  timing: {
    requested_start_ms: 0, requested_end_ms: 4_000, requested_duration_ms: 4_000,
    lead_in_ms: 0, recorder_elapsed_ms: 4_958,
    player_start_ms: 0, player_end_ms: 4_000, lead_in_clock: 'offscreen_monotonic',
  },
});
let diagnosticPhase = 'startup';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function secret() {
  return required(process.env.ANNOTATED_SERVICE_ROLE_KEY, 'Staging service-role secret');
}

function storage() {
  return new SupabaseStorage({ apiUrl: API_URL, serviceRoleKey: secret(), localOnly: false });
}

async function api(pathname, { method = 'GET', body, prefer = 'return=minimal' } = {}) {
  const credential = secret();
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      apikey: credential,
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
      prefer,
      'user-agent': 'Annotated-C6-Retention-Acceptance/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const failureCode = typeof failure?.code === 'string' && /^[A-Z0-9]{3,10}$/u.test(failure.code)
      ? failure.code : 'UNKNOWN';
    throw new Error(`Staging API request failed with HTTP ${response.status} code ${failureCode}.`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ownerId() {
  const rows = await api('/rest/v1/profiles?select=id&limit=1');
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].id !== 'string') {
    throw new Error('Expected one selected Staging fixture owner.');
  }
  return rows[0].id;
}

function objectPaths(owner, fixture) {
  const prefix = `${owner}/${fixture.annotationId}/${fixture.mediaId}`;
  return Object.freeze({
    raw: `${prefix}/${fixture.objectId}.webm`,
    processed: `${prefix}/excerpt.m4a`,
  });
}

async function fixtureRowCount() {
  const ids = FIXTURES.map(({ mediaId }) => mediaId).join(',');
  const rows = await api(`/rest/v1/annotation_media?select=id&id=in.(${ids})`);
  return rows.length;
}

async function preflight() {
  const owner = await ownerId();
  const privateStorage = storage();
  const mediaRows = await fixtureRowCount();
  const objectPresence = [];
  for (const fixture of FIXTURES) {
    const paths = objectPaths(owner, fixture);
    objectPresence.push(
      await privateStorage.exists('annotation-media-raw', paths.raw),
      await privateStorage.exists('annotation-media', paths.processed),
    );
  }
  const passed = mediaRows === 0 && objectPresence.every((present) => !present);
  process.stdout.write(`${JSON.stringify({
    gate: 'c6_retention_preflight', fixture_row_count: mediaRows,
    private_object_count: objectPresence.filter(Boolean).length, passed,
  })}\n`);
  if (!passed) throw new Error('The bounded retention fixture namespace is not empty.');
}

async function prepare() {
  diagnosticPhase = 'prepare_preflight';
  await preflight();
  const owner = await ownerId();
  const privateStorage = storage();
  const removed = FIXTURES[0];
  const failed = FIXTURES[1];
  const removedPaths = objectPaths(owner, removed);
  const failedPaths = objectPaths(owner, failed);
  const now = Date.now();
  const removedCreatedAt = new Date(now - 60_000).toISOString();
  const failedCreatedAt = new Date(now - (74 * 60 * 60 * 1000)).toISOString();
  const failedProcessedAt = new Date(now - (73.5 * 60 * 60 * 1000)).toISOString();
  const failedUpdatedAt = new Date(now - (73 * 60 * 60 * 1000)).toISOString();

  diagnosticPhase = 'upload_private_objects';
  await privateStorage.uploadNoUpsert('annotation-media-raw', removedPaths.raw, ARTIFACT_BYTES, 'audio/webm');
  await privateStorage.uploadNoUpsert('annotation-media', removedPaths.processed, ARTIFACT_BYTES, 'audio/mp4');
  await privateStorage.uploadNoUpsert('annotation-media', failedPaths.processed, ARTIFACT_BYTES, 'audio/mp4');
  diagnosticPhase = 'insert_sources';
  await api('/rest/v1/sources', {
    method: 'POST',
    body: FIXTURES.map((fixture) => ({
      id: fixture.sourceId,
      normalized_url: `https://staging.invalid/c6-retention/${fixture.name}`,
      canonical_url: `https://staging.invalid/c6-retention/${fixture.name}`,
      source_type: 'podcast', title: 'C6 Retention Fixture', metadata: { fixture: 'synthetic' },
    })),
  });
  diagnosticPhase = 'insert_annotations';
  await api('/rest/v1/annotations', {
    method: 'POST',
    body: FIXTURES.map((fixture, index) => ({
      id: fixture.annotationId, source_id: fixture.sourceId, user_id: owner,
      annotation_type: 'audio_clip', commentary_text: 'C6 Staging lifecycle cleanup acceptance',
      status: 'draft', slug: `c6-retention-${index + 1}`,
    })),
  });
  diagnosticPhase = 'insert_targets';
  await api('/rest/v1/annotation_targets', {
    method: 'POST',
    body: FIXTURES.map((fixture) => ({
      annotation_id: fixture.annotationId, target_type: 'time_range', start_ms: 0, end_ms: 4_000,
    })),
  });
  diagnosticPhase = 'insert_removed_media';
  await api('/rest/v1/annotation_media', {
    method: 'POST',
    body: [{
      id: removed.mediaId, annotation_id: removed.annotationId, media_type: 'audio',
      processing_status: 'removed', processing_stage: null, capture_metadata: CAPTURE_METADATA,
      raw_storage_path: removedPaths.raw, raw_mime_type: 'audio/webm', raw_byte_size: ARTIFACT_BYTES.length,
      processed_storage_path: removedPaths.processed, processed_mime_type: 'audio/mp4',
      duration_ms: 4_000, byte_size: ARTIFACT_BYTES.length, checksum_sha256: ARTIFACT_CHECKSUM,
      processed_at: new Date(now).toISOString(), removed_at: new Date(now).toISOString(),
      created_at: removedCreatedAt, updated_at: new Date(now).toISOString(),
    }],
  });
  diagnosticPhase = 'insert_processed_only_media';
  await api('/rest/v1/annotation_media', {
    method: 'POST',
    body: [{
      id: failed.mediaId, annotation_id: failed.annotationId, media_type: 'audio',
      processing_status: 'failed', processing_stage: null, capture_metadata: CAPTURE_METADATA,
      raw_storage_path: null, raw_deleted_at: failedProcessedAt,
      processed_storage_path: failedPaths.processed, processed_mime_type: 'audio/mp4',
      duration_ms: 4_000, byte_size: ARTIFACT_BYTES.length, checksum_sha256: ARTIFACT_CHECKSUM,
      processed_at: failedProcessedAt, attempt_count: 3,
      failure_stage: 'finalizing', failure_code: 'publication_failed',
      created_at: failedCreatedAt, updated_at: failedUpdatedAt,
    }],
  });
  diagnosticPhase = 'insert_transcripts';
  await api('/rest/v1/annotation_transcripts', {
    method: 'POST',
    body: FIXTURES.map((fixture) => ({
      annotation_id: fixture.annotationId,
      transcript_text: 'Disposable retention fixture.', language: 'en',
      segments: [{ start_ms: 0, end_ms: 4_000, text: 'Disposable retention fixture.' }],
      provider: 'deterministic-fake', model: 'fixture-v1', provider_metadata: { staging_fixture: true },
    })),
  });
  process.stdout.write(`${JSON.stringify({
    gate: 'c6_retention_prepare', removed_media_id: removed.mediaId,
    processed_only_media_id: failed.mediaId, annotation_draft_count: 2,
    raw_object_count: 1, processed_object_count: 2, prepared: true,
  })}\n`);
}

async function status() {
  const owner = await ownerId();
  const privateStorage = storage();
  const ids = FIXTURES.map(({ mediaId }) => mediaId).join(',');
  const annotationIds = FIXTURES.map(({ annotationId }) => annotationId).join(',');
  const rows = await api(`/rest/v1/annotation_media?select=id,processing_status,raw_storage_path,processed_storage_path,removed_at&id=in.(${ids})`);
  const annotations = await api(`/rest/v1/annotations?select=id,status&id=in.(${annotationIds})`);
  const transcripts = await api(`/rest/v1/annotation_transcripts?select=annotation_id&annotation_id=in.(${annotationIds})`);
  const objects = [];
  for (const fixture of FIXTURES) {
    const paths = objectPaths(owner, fixture);
    objects.push(
      await privateStorage.exists('annotation-media-raw', paths.raw),
      await privateStorage.exists('annotation-media', paths.processed),
    );
  }
  const passed = rows.length === 2 && rows.every((row) => row.processing_status === 'removed' &&
      row.raw_storage_path === null && row.processed_storage_path === null && row.removed_at !== null) &&
    annotations.length === 2 && annotations.every(({ status: annotationStatus }) => annotationStatus === 'draft') &&
    transcripts.length === 0 && objects.every((present) => !present);
  process.stdout.write(`${JSON.stringify({
    gate: 'c6_retention_status', outcome: passed ? 'passed' : 'failed',
    removed_row_count: rows.filter(({ processing_status: value }) => value === 'removed').length,
    cleared_reference_count: rows.filter((row) => row.raw_storage_path === null && row.processed_storage_path === null).length,
    annotation_draft_count: annotations.filter(({ status: value }) => value === 'draft').length,
    transcript_count: transcripts.length, private_object_count: objects.filter(Boolean).length,
  })}\n`);
  if (!passed) throw new Error('The Staging retention lifecycle result is incomplete.');
}

async function cleanup() {
  const owner = await ownerId();
  const privateStorage = storage();
  for (const fixture of FIXTURES) {
    const paths = objectPaths(owner, fixture);
    if (await privateStorage.exists('annotation-media-raw', paths.raw)) {
      await privateStorage.remove('annotation-media-raw', [paths.raw]);
    }
    if (await privateStorage.exists('annotation-media', paths.processed)) {
      await privateStorage.remove('annotation-media', [paths.processed]);
    }
    await api(`/rest/v1/annotations?id=eq.${fixture.annotationId}`, { method: 'DELETE' });
    await api(`/rest/v1/sources?id=eq.${fixture.sourceId}`, { method: 'DELETE' });
  }
  const remaining = await fixtureRowCount();
  process.stdout.write(`${JSON.stringify({ gate: 'c6_retention_cleanup', fixture_row_count: remaining, passed: remaining === 0 })}\n`);
  if (remaining !== 0) throw new Error('The disposable retention fixture cleanup is incomplete.');
}

async function main() {
  if (process.env.ANNOTATED_C6_STAGING_RETENTION !== '1') {
    throw new Error('Set ANNOTATED_C6_STAGING_RETENTION=1 for this exact Staging harness.');
  }
  const command = process.argv[2];
  if (command === 'preflight') await preflight();
  else if (command === 'prepare') await prepare();
  else if (command === 'status') await status();
  else if (command === 'cleanup') await cleanup();
  else throw new TypeError('Use preflight, prepare, status, or cleanup.');
}

await main().catch((error) => {
  const boundedMessage = error instanceof Error &&
    /^Staging API request failed with HTTP [0-9]{3} code (?:[A-Z0-9]{3,10}|UNKNOWN)[.]$/u.test(error.message)
    ? error.message : 'Bounded lifecycle assertion failed.';
  process.stderr.write(`${JSON.stringify({
    gate: 'c6_retention_diagnostic', phase: diagnosticPhase, message: boundedMessage,
  })}\n`);
  process.exitCode = 1;
});
