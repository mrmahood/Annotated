import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDerivativeAudioInput } from '../src/transcription/derivative-audio.mjs';
import { DeterministicFakeTranscriber } from '../src/transcription/fake-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';
import { LocalDatabase, LocalStorage, loadLocalSupabaseStatus } from './helpers/local-supabase.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureRoot = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'fixtures', 'generated');
const rawFixturePath = path.join(fixtureRoot, 'audio-only.webm');
const derivativeFixturePath = path.join(fixtureRoot, 'c2', 'audio-only.m4a');
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

function sqlNullable(value) {
  return value === null || value === undefined ? 'null' : sqlText(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function findFfmpegTools() {
  const directory = process.env.ANNOTATED_FFMPEG_BIN;
  if (!directory) {
    throw new Error('Set ANNOTATED_FFMPEG_BIN to the checksum-verified temporary FFmpeg 8.1 bin directory.');
  }
  return {
    ffmpegPath: path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ffprobePath: path.join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
  };
}

test('C4 Local private Storage lifecycle and crash-boundary matrix', { timeout: 180_000 }, async (t) => {
  if (process.env.ANNOTATED_C4_LOCAL !== '1') {
    t.skip('Set ANNOTATED_C4_LOCAL=1 to authorize loopback-only Local Supabase integration.');
    return;
  }

  const status = loadLocalSupabaseStatus(repositoryRoot);
  const database = new LocalDatabase(status.databaseUrl);
  const storage = new LocalStorage(status);
  const rawBytes = await readFile(rawFixturePath);
  const derivativeBytes = await readFile(derivativeFixturePath);
  const rawChecksum = sha256(rawBytes);
  const derivativeChecksum = sha256(derivativeBytes);
  const ownerId = randomUUID();
  const sourceId = randomUUID();
  const runId = randomUUID();
  const trackedRawPaths = new Set();
  const trackedProcessedPaths = new Set();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c4-'));
  const results = [];

  function record(name) {
    results.push(name);
  }

  function state(mediaId) {
    return database.json(`
      select pg_catalog.json_build_object(
        'annotation_status', annotations.status,
        'processing_status', media.processing_status,
        'processing_stage', media.processing_stage,
        'attempt_count', media.attempt_count,
        'raw_storage_path', media.raw_storage_path,
        'processed_storage_path', media.processed_storage_path,
        'raw_deleted', media.raw_deleted_at is not null,
        'lease_present', media.lease_token is not null,
        'transcript_present', exists (
          select 1 from public.annotation_transcripts transcript
          where transcript.annotation_id = media.annotation_id
            and transcript.content_cleared_at is null
        )
      )
      from public.annotation_media media
      join public.annotations annotations on annotations.id = media.annotation_id
      where media.id = ${sqlText(mediaId)}::uuid;
    `);
  }

  function assertDraft(mediaId, expectedStage = undefined) {
    const current = state(mediaId);
    assert.equal(current.annotation_status, 'draft');
    if (expectedStage !== undefined) assert.equal(current.processing_stage, expectedStage);
  }

  async function seedScenario(label, options = {}) {
    const annotationId = randomUUID();
    const mediaId = randomUUID();
    const uploadNonce = randomUUID();
    const rawPath = `${ownerId}/${annotationId}/${mediaId}/${uploadNonce}.webm`;
    const processedPath = `${ownerId}/${annotationId}/${mediaId}/excerpt.m4a`;
    trackedRawPaths.add(rawPath);
    trackedProcessedPaths.add(processedPath);
    await storage.upload('annotation-media-raw', rawPath, rawBytes, 'audio/webm');
    database.execute(`
      insert into public.annotations (
        id, source_id, user_id, annotation_type, commentary_text, status, slug
      ) values (
        ${sqlText(annotationId)}::uuid, ${sqlText(sourceId)}::uuid, ${sqlText(ownerId)}::uuid,
        'audio_clip', ${sqlText(`C4 ${label}`)}, 'draft', ${sqlText(`c4-${mediaId}`)}
      );
      insert into public.annotation_targets (annotation_id, target_type, start_ms, end_ms)
      values (${sqlText(annotationId)}::uuid, 'time_range', 12000, 16000);
      insert into public.annotation_media (
        id, annotation_id, media_type, processing_status, processing_stage,
        capture_metadata, raw_storage_path, raw_mime_type, raw_byte_size,
        attempt_count, next_attempt_at, uploaded_at
      ) values (
        ${sqlText(mediaId)}::uuid, ${sqlText(annotationId)}::uuid, 'audio',
        ${sqlText(options.processingStatus ?? 'processing')},
        ${sqlNullable(options.processingStage ?? 'queued')},
        ${sqlText(JSON.stringify(captureMetadata))}::jsonb,
        ${sqlText(rawPath)}, 'audio/webm', ${rawBytes.length},
        ${options.attemptCount ?? 0}, pg_catalog.now(), pg_catalog.now()
      );
    `);
    return { annotationId, mediaId, rawPath, processedPath };
  }

  function claim(mediaId) {
    return database.json(`
      select pg_catalog.row_to_json(claimed)
      from private.claim_annotation_media_processing(${sqlText(mediaId)}::uuid, 900) claimed;
    `);
  }

  function reconcileExpiredLease(mediaId) {
    database.execute(`
      update public.annotation_media
      set lease_expires_at = pg_catalog.now() - interval '1 second'
      where id = ${sqlText(mediaId)}::uuid;
    `);
    const action = database.json(`
      select pg_catalog.to_json(private.reconcile_annotation_media_processing(${sqlText(mediaId)}::uuid));
    `);
    assert.equal(action, 'lease_released');
  }

  async function ensureDerivativeObject(scenario) {
    if (await storage.exists('annotation-media', scenario.processedPath)) {
      const existing = await storage.download('annotation-media', scenario.processedPath);
      assert.equal(sha256(existing), derivativeChecksum);
      assert.equal(existing.length, derivativeBytes.length);
      return 'reused';
    }
    await storage.upload('annotation-media', scenario.processedPath, derivativeBytes, 'audio/mp4');
    return 'uploaded';
  }

  function stageDerivative(scenario, leaseToken) {
    database.execute(`
      select private.stage_annotation_media_derivative(
        ${sqlText(scenario.mediaId)}::uuid,
        ${sqlText(leaseToken)}::uuid,
        ${sqlText(rawChecksum)},
        ${sqlText(scenario.processedPath)},
        'audio/mp4', 4000, null, null, ${derivativeBytes.length}, ${sqlText(derivativeChecksum)}
      );
    `);
    assertDraft(scenario.mediaId, 'transcribing');
  }

  function stageTranscript(scenario, leaseToken, transcript = undefined) {
    const candidate = transcript ?? {
      transcriptText: 'Synthetic excerpt for local crash recovery.',
      language: 'en',
      segments: [
        { start_ms: 0, end_ms: 2000, text: 'Synthetic excerpt' },
        { start_ms: 2000, end_ms: 4000, text: 'local crash recovery' },
      ],
      provider: 'deterministic-fake',
      model: 'fixture-v1',
      providerMetadata: { local_fixture: true },
    };
    database.execute(`
      select private.stage_annotation_media_transcript(
        ${sqlText(scenario.mediaId)}::uuid,
        ${sqlText(leaseToken)}::uuid,
        ${sqlText(candidate.transcriptText)},
        ${sqlNullable(candidate.language)},
        ${sqlText(JSON.stringify(candidate.segments))}::jsonb,
        ${sqlText(candidate.provider)},
        ${sqlText(candidate.model)},
        ${sqlText(JSON.stringify(candidate.providerMetadata))}::jsonb
      );
    `);
    assertDraft(scenario.mediaId, 'raw_cleanup');
  }

  async function deleteAndConfirmRaw(scenario, leaseToken) {
    if (await storage.exists('annotation-media-raw', scenario.rawPath)) {
      await storage.remove('annotation-media-raw', [scenario.rawPath]);
    }
    assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
    database.execute(`
      select private.confirm_annotation_media_raw_deleted(
        ${sqlText(scenario.mediaId)}::uuid, ${sqlText(leaseToken)}::uuid
      );
    `);
    assertDraft(scenario.mediaId, 'finalizing');
  }

  async function finalize(scenario, leaseToken) {
    database.execute(`
      select private.finalize_annotation_media_ready(
        ${sqlText(scenario.mediaId)}::uuid, ${sqlText(leaseToken)}::uuid
      );
    `);
    const current = state(scenario.mediaId);
    assert.equal(current.annotation_status, 'published');
    assert.equal(current.processing_status, 'ready');
    assert.equal(current.processing_stage, null);
    assert.equal(current.raw_storage_path, null);
    assert.equal(current.raw_deleted, true);
    assert.equal(current.transcript_present, true);
    assert.equal(current.lease_present, false);
    assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
    assert.equal(await storage.exists('annotation-media', scenario.processedPath), true);
    await storage.assertPrivate('annotation-media', scenario.processedPath);
  }

  async function completeFromClaim(scenario, activeClaim, options = {}) {
    await ensureDerivativeObject(scenario);
    if (!activeClaim.processed_storage_path) stageDerivative(scenario, activeClaim.lease_token);
    const afterDerivative = state(scenario.mediaId);
    if (!afterDerivative.transcript_present) stageTranscript(scenario, activeClaim.lease_token, options.transcript);
    if (!afterDerivative.raw_deleted) await deleteAndConfirmRaw(scenario, activeClaim.lease_token);
    await finalize(scenario, activeClaim.lease_token);
  }

  async function recoverAfterCrash(scenario, expectedResumeStage) {
    reconcileExpiredLease(scenario.mediaId);
    const recovered = claim(scenario.mediaId);
    assert.ok(recovered);
    assert.equal(recovered.resume_stage, expectedResumeStage);
    assertDraft(scenario.mediaId, expectedResumeStage);
    return recovered;
  }

  try {
    database.execute(`
      insert into auth.users (id, raw_user_meta_data)
      values (${sqlText(ownerId)}::uuid, '{}'::jsonb);
      insert into public.sources (
        id, normalized_url, canonical_url, source_type, title, metadata
      ) values (
        ${sqlText(sourceId)}::uuid,
        ${sqlText(`https://local.invalid/c4/${runId}`)},
        ${sqlText(`https://local.invalid/c4/${runId}`)},
        'podcast', 'C4 Local Fixture', '{}'::jsonb
      );
    `);

    await t.test('bucket limits and private access are enforced with exact no-upsert bytes', async () => {
      const buckets = database.json(`
        select pg_catalog.json_object_agg(id, pg_catalog.json_build_object(
          'public', public,
          'file_size_limit', file_size_limit,
          'allowed_mime_types', allowed_mime_types
        ))
        from storage.buckets where id in ('annotation-media-raw', 'annotation-media');
      `);
      assert.deepEqual(buckets['annotation-media-raw'], {
        public: false,
        file_size_limit: 52428800,
        allowed_mime_types: ['video/webm', 'audio/webm'],
      });
      assert.deepEqual(buckets['annotation-media'], {
        public: false,
        file_size_limit: 16777216,
        allowed_mime_types: ['video/mp4', 'audio/mp4'],
      });

      const scenario = await seedScenario('storage privacy');
      await storage.assertPrivate('annotation-media-raw', scenario.rawPath);
      const downloaded = await storage.download('annotation-media-raw', scenario.rawPath);
      assert.equal(downloaded.length, rawBytes.length);
      assert.equal(sha256(downloaded), rawChecksum);
      await storage.uploadExpectingConflict('annotation-media-raw', scenario.rawPath, Buffer.from('replacement'), 'audio/webm');
      const unchanged = await storage.download('annotation-media-raw', scenario.rawPath);
      assert.equal(sha256(unchanged), rawChecksum);
      record('private-storage-no-upsert');
    });

    await t.test('one complete lifecycle uses downloaded derivative audio and the deterministic fake', async () => {
      const scenario = await seedScenario('complete lifecycle');
      const firstClaim = claim(scenario.mediaId);
      assert.equal(firstClaim.resume_stage, 'probing');
      assert.equal(firstClaim.expected_processed_storage_path, scenario.processedPath);
      assert.equal(claim(scenario.mediaId), null, 'duplicate claim must not receive a lease');
      assertDraft(scenario.mediaId, 'probing');

      const rawDownload = await storage.download('annotation-media-raw', scenario.rawPath);
      assert.equal(sha256(rawDownload), rawChecksum);
      await ensureDerivativeObject(scenario);
      const derivativeDownload = await storage.download('annotation-media', scenario.processedPath);
      assert.equal(sha256(derivativeDownload), derivativeChecksum);
      stageDerivative(scenario, firstClaim.lease_token);

      const derivativePath = path.join(temporaryDirectory, `${scenario.mediaId}.m4a`);
      const transcriptionAudioPath = path.join(temporaryDirectory, `${scenario.mediaId}.flac`);
      await writeFile(derivativePath, derivativeDownload);
      const tools = findFfmpegTools();
      const capability = await createDerivativeAudioInput({
        ...tools,
        mediaType: 'audio',
        derivativePath,
        derivativeChecksumSha256: derivativeChecksum,
        derivativeDurationMs: 4000,
        transcriptionAudioPath,
      });
      const transcript = await transcribeAndValidate(new DeterministicFakeTranscriber(), capability);
      stageTranscript(scenario, firstClaim.lease_token, transcript);
      await rm(transcriptionAudioPath, { force: true });
      await deleteAndConfirmRaw(scenario, firstClaim.lease_token);
      await finalize(scenario, firstClaim.lease_token);
      assert.equal(claim(scenario.mediaId), null, 'ready rows must not be reclaimable');
      record('complete-lifecycle-fake-transcription');
    });

    const crashCases = [
      {
        name: 'after claim before durable output',
        expectedResume: 'probing',
        prepare: async () => {},
      },
      {
        name: 'after derivative upload before database staging',
        expectedResume: 'probing',
        prepare: async (scenario) => {
          assert.equal(await ensureDerivativeObject(scenario), 'uploaded');
        },
        afterRecover: async (scenario) => {
          assert.equal(await ensureDerivativeObject(scenario), 'reused');
        },
      },
      {
        name: 'after derivative database staging',
        expectedResume: 'transcribing',
        prepare: async (scenario, activeClaim) => {
          await ensureDerivativeObject(scenario);
          stageDerivative(scenario, activeClaim.lease_token);
        },
      },
      {
        name: 'after transcript database staging',
        expectedResume: 'raw_cleanup',
        prepare: async (scenario, activeClaim) => {
          await ensureDerivativeObject(scenario);
          stageDerivative(scenario, activeClaim.lease_token);
          stageTranscript(scenario, activeClaim.lease_token);
        },
      },
      {
        name: 'after raw Storage deletion before database confirmation',
        expectedResume: 'raw_cleanup',
        prepare: async (scenario, activeClaim) => {
          await ensureDerivativeObject(scenario);
          stageDerivative(scenario, activeClaim.lease_token);
          stageTranscript(scenario, activeClaim.lease_token);
          await storage.remove('annotation-media-raw', [scenario.rawPath]);
          assert.equal(await storage.exists('annotation-media-raw', scenario.rawPath), false);
        },
      },
      {
        name: 'after raw deletion database confirmation',
        expectedResume: 'finalizing',
        prepare: async (scenario, activeClaim) => {
          await ensureDerivativeObject(scenario);
          stageDerivative(scenario, activeClaim.lease_token);
          stageTranscript(scenario, activeClaim.lease_token);
          await deleteAndConfirmRaw(scenario, activeClaim.lease_token);
        },
      },
    ];

    for (const crashCase of crashCases) {
      await t.test(`recovers ${crashCase.name}`, async () => {
        const scenario = await seedScenario(crashCase.name);
        const activeClaim = claim(scenario.mediaId);
        assert.equal(activeClaim.resume_stage, 'probing');
        await crashCase.prepare(scenario, activeClaim);
        assertDraft(scenario.mediaId);
        const recovered = await recoverAfterCrash(scenario, crashCase.expectedResume);
        if (crashCase.afterRecover) await crashCase.afterRecover(scenario, recovered);
        await completeFromClaim(scenario, recovered);
        record(`crash-${crashCase.expectedResume}-${crashCase.name}`);
      });
    }

    await t.test('server backoff, retry ceiling, and terminal raw cleanup preserve privacy', async () => {
      const retryScenario = await seedScenario('retry backoff');
      const attemptOne = claim(retryScenario.mediaId);
      const releaseOne = database.json(`
        select pg_catalog.row_to_json(released) from private.release_annotation_media_processing_attempt(
          ${sqlText(retryScenario.mediaId)}::uuid,
          ${sqlText(attemptOne.lease_token)}::uuid,
          'transcoding', 'transcode_timeout'
        ) released;
      `);
      assert.equal(releaseOne.result_status, 'processing');
      const waiting = state(retryScenario.mediaId);
      assert.equal(waiting.annotation_status, 'draft');
      assert.equal(waiting.processing_stage, 'queued');
      assert.equal(waiting.lease_present, false);
      assert.equal(claim(retryScenario.mediaId), null, 'backoff must prevent an early retry');
      database.execute(`update public.annotation_media set next_attempt_at = pg_catalog.now() where id = ${sqlText(retryScenario.mediaId)}::uuid;`);
      const attemptTwo = claim(retryScenario.mediaId);
      assert.equal(attemptTwo.attempt_count, 2);
      await completeFromClaim(retryScenario, attemptTwo);

      const terminalScenario = await seedScenario('terminal cleanup', { attemptCount: 2 });
      const attemptThree = claim(terminalScenario.mediaId);
      assert.equal(attemptThree.attempt_count, 3);
      const terminal = database.json(`
        select pg_catalog.row_to_json(released) from private.release_annotation_media_processing_attempt(
          ${sqlText(terminalScenario.mediaId)}::uuid,
          ${sqlText(attemptThree.lease_token)}::uuid,
          'transcoding', 'transcode_timeout'
        ) released;
      `);
      assert.equal(terminal.result_status, 'failed');
      assertDraft(terminalScenario.mediaId, null);
      await ensureDerivativeObject(terminalScenario);

      database.execute(`
        begin;
        alter table public.annotation_media disable trigger annotation_media_set_updated_at;
        update public.annotation_media set updated_at = pg_catalog.now() - interval '73 hours'
        where id = ${sqlText(terminalScenario.mediaId)}::uuid;
        alter table public.annotation_media enable trigger annotation_media_set_updated_at;
        commit;
      `);
      const cleanup = database.json(`
        select pg_catalog.row_to_json(claimed) from private.claim_annotation_media_cleanup_v2(
          ${sqlText(terminalScenario.mediaId)}::uuid
        ) claimed;
      `);
      assert.equal(cleanup.cleanup_reason, 'terminal_raw_cleanup');
      assert.equal(cleanup.raw_storage_path, terminalScenario.rawPath);
      assert.equal(cleanup.processed_storage_path, null);
      assert.equal(cleanup.expected_processed_storage_path, terminalScenario.processedPath);
      await storage.remove('annotation-media-raw', [cleanup.raw_storage_path]);
      await storage.remove('annotation-media', [cleanup.expected_processed_storage_path]);
      assert.equal(await storage.exists('annotation-media-raw', cleanup.raw_storage_path), false);
      assert.equal(await storage.exists('annotation-media', cleanup.expected_processed_storage_path), false);
      const confirmed = database.json(`
        select pg_catalog.to_json(private.confirm_annotation_media_cleanup(
          ${sqlText(terminalScenario.mediaId)}::uuid,
          ${sqlNullable(cleanup.raw_storage_path)},
          ${sqlNullable(cleanup.processed_storage_path)},
          ${sqlText(cleanup.observed_updated_at)}::timestamptz
        ));
      `);
      assert.equal(confirmed, 'removed');
      const removed = state(terminalScenario.mediaId);
      assert.equal(removed.annotation_status, 'draft');
      assert.equal(removed.processing_status, 'removed');
      assert.equal(removed.raw_storage_path, null);
      assert.equal(removed.processed_storage_path, null);
      record('retry-backoff-terminal-cleanup');
    });

    assert.equal(results.length, 9);
  } finally {
    for (const objectPath of trackedRawPaths) {
      if (await storage.exists('annotation-media-raw', objectPath).catch(() => false)) {
        await storage.remove('annotation-media-raw', [objectPath]);
      }
    }
    for (const objectPath of trackedProcessedPaths) {
      if (await storage.exists('annotation-media', objectPath).catch(() => false)) {
        await storage.remove('annotation-media', [objectPath]);
      }
    }
    database.execute(`
      delete from public.annotations where user_id = ${sqlText(ownerId)}::uuid;
      delete from public.sources where id = ${sqlText(sourceId)}::uuid;
      delete from auth.users where id = ${sqlText(ownerId)}::uuid;
    `);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
