import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PsqlDatabase } from '../src/infrastructure/psql-database.mjs';
import { PostgresWorkerStore } from '../src/infrastructure/postgres-worker-store.mjs';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';
import { DeterministicFakeTranscriber } from '../src/transcription/fake-transcriber.mjs';
import { createAuthenticatedLocalDispatch } from '../src/runtime/dispatch-auth.mjs';
import { runDispatchCycle } from '../src/runtime/dispatcher.mjs';
import { runReconciliationCycle } from '../src/runtime/reconciler.mjs';
import { createSanitizedLogger } from '../src/runtime/sanitized-logger.mjs';
import { runOneMediaJob } from '../src/runtime/worker-job.mjs';
import { loadLocalSupabaseStatus } from './helpers/local-supabase.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const rawFixturePath = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'fixtures', 'generated', 'audio-only.webm');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const captureMetadata = {
  version: 2,
  capture_track: {
    mime_type: 'audio/webm;codecs=opus',
    audio_track_count: 1,
    video_track_count: 0,
    tracks: [{ kind: 'audio', settings: { sampleRate: 48000, channelCount: 2 } }],
    loopback_enabled: true,
  },
  timing: {
    requested_start_ms: 12000,
    requested_end_ms: 16000,
    requested_duration_ms: 4000,
    lead_in_ms: 35,
    recorder_elapsed_ms: 4035,
    player_start_ms: 12000,
    player_end_ms: 16000,
    lead_in_clock: 'offscreen_monotonic',
  },
};

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toolPaths() {
  const directory = process.env.ANNOTATED_FFMPEG_BIN;
  if (!directory) throw new Error('Set ANNOTATED_FFMPEG_BIN to the verified temporary FFmpeg 8.1 bin directory.');
  return {
    ffmpegPath: path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ffprobePath: path.join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
  };
}

function psqlPath() {
  if (process.env.ANNOTATED_PSQL_BIN) return process.env.ANNOTATED_PSQL_BIN;
  return process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe' : 'psql';
}

test('C5 Local authenticated dispatch, retry, reconciliation, and retention lifecycle', { timeout: 240_000 }, async (t) => {
  if (process.env.ANNOTATED_C5_LOCAL !== '1') {
    t.skip('Set ANNOTATED_C5_LOCAL=1 to authorize the loopback-only C5 integration.');
    return;
  }
  const status = loadLocalSupabaseStatus(repositoryRoot);
  const database = new PsqlDatabase({ databaseUrl: status.databaseUrl, psqlPath: psqlPath(), localOnly: true });
  const store = new PostgresWorkerStore(database);
  const storage = new SupabaseStorage({ apiUrl: status.apiUrl, serviceRoleKey: status.serviceRoleKey, localOnly: true });
  const tools = toolPaths();
  const rawBytes = await readFile(rawFixturePath);
  const ownerId = randomUUID();
  const sourceId = randomUUID();
  const runId = randomUUID();
  const dispatchSecret = randomBytes(32).toString('base64url');
  const trackedRaw = new Set();
  const trackedProcessed = new Set();
  const logs = [];
  const logger = createSanitizedLogger({ write: (line) => logs.push(line) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('C5 integration denied non-loopback network access.');
    return await originalFetch(input, init);
  };

  function state(mediaId) {
    return database.json(`
      select pg_catalog.json_build_object(
        'annotation_status', annotations.status,
        'processing_status', media.processing_status,
        'processing_stage', media.processing_stage,
        'attempt_count', media.attempt_count,
        'next_attempt_present', media.next_attempt_at is not null,
        'lease_present', media.lease_token is not null,
        'raw_present', media.raw_storage_path is not null,
        'processed_present', media.processed_storage_path is not null,
        'transcript_present', exists (
          select 1 from public.annotation_transcripts transcript where transcript.annotation_id = media.annotation_id
        )
      )
      from public.annotation_media media
      join public.annotations annotations on annotations.id = media.annotation_id
      where media.id = ${sqlText(mediaId)}::uuid;
    `);
  }

  async function seed(label, { status: processingStatus = 'processing', attemptCount = 0 } = {}) {
    const annotationId = randomUUID();
    const mediaId = randomUUID();
    const rawPath = `${ownerId}/${annotationId}/${mediaId}/${randomUUID()}.webm`;
    const processedPath = `${ownerId}/${annotationId}/${mediaId}/excerpt.m4a`;
    trackedRaw.add(rawPath);
    trackedProcessed.add(processedPath);
    await storage.uploadNoUpsert('annotation-media-raw', rawPath, rawBytes, 'audio/webm');
    database.execute(`
      insert into public.annotations (id, source_id, user_id, annotation_type, commentary_text, status, slug)
      values (
        ${sqlText(annotationId)}::uuid, ${sqlText(sourceId)}::uuid, ${sqlText(ownerId)}::uuid,
        'audio_clip', ${sqlText(`C5 ${label}`)}, 'draft', ${sqlText(`c5-${mediaId}`)}
      );
      insert into public.annotation_targets (annotation_id, target_type, start_ms, end_ms)
      values (${sqlText(annotationId)}::uuid, 'time_range', 12000, 16000);
      insert into public.annotation_media (
        id, annotation_id, media_type, processing_status, processing_stage,
        capture_metadata, raw_storage_path, raw_mime_type, raw_byte_size,
        attempt_count, next_attempt_at, uploaded_at
      ) values (
        ${sqlText(mediaId)}::uuid, ${sqlText(annotationId)}::uuid, 'audio', ${sqlText(processingStatus)},
        ${processingStatus === 'processing' ? "'queued'" : 'null'}, ${sqlText(JSON.stringify(captureMetadata))}::jsonb,
        ${sqlText(rawPath)}, 'audio/webm', ${rawBytes.length}, ${attemptCount},
        ${processingStatus === 'processing' ? "pg_catalog.now() - interval '1 second'" : 'null'}, pg_catalog.now()
      );
    `);
    return { annotationId, mediaId, rawPath, processedPath };
  }

  function dispatchOnly(scenarios, transcriberFor) {
    const allowed = new Set(scenarios.map((scenario) => scenario.mediaId));
    const filteredStore = {
      // Query a wider authoritative page before isolating this fixture. Other
      // Local integration files intentionally run in parallel and may occupy
      // earlier global queue positions.
      listDispatchCandidates: async () => (await store.listDispatchCandidates(100)).filter((row) => allowed.has(row.media_id)),
    };
    const dispatchOne = createAuthenticatedLocalDispatch({
      secret: dispatchSecret,
      handle: (mediaId) => runOneMediaJob({
        mediaId,
        store,
        storage,
        ...tools,
        transcriber: transcriberFor(mediaId),
        logger,
      }),
    });
    return runDispatchCycle({ store: filteredStore, dispatchOne, logger, limit: 25, concurrency: 2 });
  }

  function reconcileOnly(scenarios) {
    const allowed = new Set(scenarios.map((scenario) => scenario.mediaId));
    const filteredStore = {
      listReconciliationCandidates: async () => (await store.listReconciliationCandidates(100)).filter((row) => allowed.has(row.media_id)),
      reconcileProcessing: (mediaId) => store.reconcileProcessing(mediaId),
      claimCleanup: (mediaId) => store.claimCleanup(mediaId),
      confirmCleanup: (claim) => store.confirmCleanup(claim),
    };
    return runReconciliationCycle({ store: filteredStore, storage, logger, limit: 25, concurrency: 2 });
  }

  try {
    database.execute(`
      insert into auth.users (id, raw_user_meta_data) values (${sqlText(ownerId)}::uuid, '{}'::jsonb);
      insert into public.sources (id, normalized_url, canonical_url, source_type, title, metadata)
      values (
        ${sqlText(sourceId)}::uuid, ${sqlText(`https://local.invalid/c5/${runId}`)},
        ${sqlText(`https://local.invalid/c5/${runId}`)}, 'podcast', 'C5 Local Fixture', '{}'::jsonb
      );
    `);

    await t.test('authenticated due dispatch completes exactly one media job', async () => {
      const scenario = await seed('authenticated dispatch');
      const summary = await dispatchOnly([scenario], () => new DeterministicFakeTranscriber());
      assert.deepEqual(summary, { candidateCount: 1, dispatchedCount: 1, failedCount: 0 });
      assert.deepEqual(state(scenario.mediaId), {
        annotation_status: 'published', processing_status: 'ready', processing_stage: null,
        attempt_count: 1, next_attempt_present: false, lease_present: false,
        raw_present: false, processed_present: true, transcript_present: true,
      });
      assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
      assert.equal(await storage.exists('annotation-media', scenario.processedPath), true);
    });

    await t.test('database backoff prevents early redispatch and resumes staged derivative', async () => {
      const scenario = await seed('retry scheduling');
      let fail = true;
      const first = await dispatchOnly([scenario], () => new DeterministicFakeTranscriber({
        ...(fail ? { failureCode: 'provider_timeout' } : {}),
      }));
      assert.equal(first.dispatchedCount, 1);
      const waiting = state(scenario.mediaId);
      assert.equal(waiting.processing_status, 'processing');
      assert.equal(waiting.processing_stage, 'queued');
      assert.equal(waiting.attempt_count, 1);
      assert.equal(waiting.next_attempt_present, true);
      assert.equal(waiting.processed_present, true);
      assert.equal(waiting.transcript_present, false);
      assert.equal((await store.listDispatchCandidates(100)).some((row) => row.media_id === scenario.mediaId), false);
      database.execute(`update public.annotation_media set next_attempt_at = pg_catalog.now() where id = ${sqlText(scenario.mediaId)}::uuid;`);
      fail = false;
      const second = await dispatchOnly([scenario], () => new DeterministicFakeTranscriber());
      assert.equal(second.dispatchedCount, 1);
      assert.equal(state(scenario.mediaId).processing_status, 'ready');
    });

    await t.test('expired lease reconciliation returns the row to the due queue', async () => {
      const scenario = await seed('expired lease');
      const active = store.claim(scenario.mediaId, 900);
      assert.ok(active?.lease_token);
      database.execute(`
        update public.annotation_media set lease_expires_at = pg_catalog.now() - interval '1 second'
        where id = ${sqlText(scenario.mediaId)}::uuid;
      `);
      const summary = await reconcileOnly([scenario]);
      assert.equal(summary.reconciledCount, 1);
      const current = state(scenario.mediaId);
      assert.equal(current.processing_status, 'processing');
      assert.equal(current.processing_stage, 'queued');
      assert.equal(current.lease_present, false);
      assert.equal((await store.listDispatchCandidates(100)).some((row) => row.media_id === scenario.mediaId), true);
    });

    await t.test('terminal and abandoned retention delete only authoritative private objects', async () => {
      const terminal = await seed('terminal retention', { attemptCount: 2 });
      const failed = await dispatchOnly([terminal], () => new DeterministicFakeTranscriber({ failureCode: 'provider_timeout' }));
      assert.equal(failed.dispatchedCount, 1);
      assert.equal(state(terminal.mediaId).processing_status, 'failed');
      assert.equal(await storage.exists('annotation-media-raw', terminal.rawPath), true);
      assert.equal(await storage.exists('annotation-media', terminal.processedPath), true);

      const abandoned = await seed('abandoned retention', { status: 'uploading' });
      database.execute(`
        begin;
        alter table public.annotation_media disable trigger annotation_media_set_updated_at;
        update public.annotation_media set updated_at = pg_catalog.now() - interval '73 hours'
        where id in (${sqlText(terminal.mediaId)}::uuid, ${sqlText(abandoned.mediaId)}::uuid);
        alter table public.annotation_media enable trigger annotation_media_set_updated_at;
        commit;
      `);
      const summary = await reconcileOnly([terminal, abandoned]);
      assert.equal(summary.cleanedCount, 2);
      for (const scenario of [terminal, abandoned]) {
        const current = state(scenario.mediaId);
        assert.equal(current.annotation_status, 'draft');
        assert.equal(current.processing_status, 'removed');
        assert.equal(current.raw_present, false);
        assert.equal(current.processed_present, false);
        assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
        assert.equal(await storage.exists('annotation-media', scenario.processedPath), false);
      }
    });

    await t.test('attempt-three failure after raw confirmation cleans processed-only terminal state', async () => {
      const scenario = await seed('processed-only terminal retention');
      await storage.uploadNoUpsert('annotation-media', scenario.processedPath, rawBytes, 'audio/mp4');
      await storage.remove('annotation-media-raw', [scenario.rawPath]);
      database.execute(`
        update public.annotation_media
        set processing_status = 'processing', processing_stage = 'finalizing',
          raw_storage_path = null, raw_deleted_at = pg_catalog.now(),
          processed_storage_path = ${sqlText(scenario.processedPath)},
          processed_mime_type = 'audio/mp4', duration_ms = 4000,
          byte_size = ${rawBytes.length}, checksum_sha256 = pg_catalog.repeat('a', 64),
          processed_at = pg_catalog.now(), attempt_count = 3,
          next_attempt_at = null, lease_token = null, lease_expires_at = null
        where id = ${sqlText(scenario.mediaId)}::uuid;
        insert into public.annotation_transcripts (
          annotation_id, transcript_text, language, segments, provider, model, provider_metadata
        ) values (
          ${sqlText(scenario.annotationId)}::uuid, 'Processed-only terminal fixture.', 'en',
          '[{"start_ms":0,"end_ms":4000,"text":"Processed-only terminal fixture."}]'::jsonb,
          'deterministic-fake', 'fixture-v1', '{"local_fixture":true}'::jsonb
        );
      `);
      const terminalized = await reconcileOnly([scenario]);
      assert.equal(terminalized.reconciledCount, 1);
      assert.deepEqual(state(scenario.mediaId), {
        annotation_status: 'draft', processing_status: 'failed', processing_stage: null,
        attempt_count: 3, next_attempt_present: false, lease_present: false,
        raw_present: false, processed_present: true, transcript_present: true,
      });

      database.execute(`
        begin;
        alter table public.annotation_media disable trigger annotation_media_set_updated_at;
        update public.annotation_media set updated_at = pg_catalog.now() - interval '73 hours'
        where id = ${sqlText(scenario.mediaId)}::uuid;
        alter table public.annotation_media enable trigger annotation_media_set_updated_at;
        commit;
      `);
      const cleaned = await reconcileOnly([scenario]);
      assert.equal(cleaned.cleanedCount, 1);
      assert.deepEqual(state(scenario.mediaId), {
        annotation_status: 'draft', processing_status: 'removed', processing_stage: null,
        attempt_count: 3, next_attempt_present: false, lease_present: false,
        raw_present: false, processed_present: false, transcript_present: false,
      });
      assert.equal(await storage.exists('annotation-media', scenario.processedPath), false);
    });

    await t.test('cancellation crash after removed transition is immediately janitor-recoverable', async () => {
      const scenario = await seed('removed cleanup boundary', { status: 'uploading' });
      await storage.uploadNoUpsert('annotation-media', scenario.processedPath, rawBytes, 'audio/mp4');
      database.execute(`
        update public.annotation_media
        set processing_status = 'removed', processing_stage = null,
          processed_storage_path = ${sqlText(scenario.processedPath)},
          processed_mime_type = 'audio/mp4', duration_ms = 4000,
          byte_size = ${rawBytes.length}, checksum_sha256 = pg_catalog.repeat('b', 64),
          processed_at = pg_catalog.now(), removed_at = pg_catalog.now(),
          next_attempt_at = null, lease_token = null, lease_expires_at = null
        where id = ${sqlText(scenario.mediaId)}::uuid;
        insert into public.annotation_transcripts (
          annotation_id, transcript_text, language, segments, provider, model, provider_metadata
        ) values (
          ${sqlText(scenario.annotationId)}::uuid, 'Removed cleanup boundary fixture.', 'en',
          '[{"start_ms":0,"end_ms":4000,"text":"Removed cleanup boundary fixture."}]'::jsonb,
          'deterministic-fake', 'fixture-v1', '{"local_fixture":true}'::jsonb
        );
      `);
      const cleaned = await reconcileOnly([scenario]);
      assert.equal(cleaned.cleanedCount, 1);
      assert.deepEqual(state(scenario.mediaId), {
        annotation_status: 'draft', processing_status: 'removed', processing_stage: null,
        attempt_count: 0, next_attempt_present: false, lease_present: false,
        raw_present: false, processed_present: false, transcript_present: false,
      });
      assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
      assert.equal(await storage.exists('annotation-media', scenario.processedPath), false);
    });

    const output = logs.join('\n');
    for (const objectPath of [...trackedRaw, ...trackedProcessed]) assert.doesNotMatch(output, new RegExp(objectPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(output, /Synthetic excerpt|local\.invalid|Bearer|service_role|raw\.webm|excerpt\.m4a/u);
    assert.doesNotMatch(output, new RegExp(status.serviceRoleKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const objectPath of trackedRaw) {
      if (await storage.exists('annotation-media-raw', objectPath).catch(() => false)) await storage.remove('annotation-media-raw', [objectPath]);
    }
    for (const objectPath of trackedProcessed) {
      if (await storage.exists('annotation-media', objectPath).catch(() => false)) await storage.remove('annotation-media', [objectPath]);
    }
    database.execute(`
      delete from public.annotations where user_id = ${sqlText(ownerId)}::uuid;
      delete from public.sources where id = ${sqlText(sourceId)}::uuid;
      delete from auth.users where id = ${sqlText(ownerId)}::uuid;
    `);
  }
});
