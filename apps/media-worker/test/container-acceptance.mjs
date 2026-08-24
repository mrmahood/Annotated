import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PsqlDatabase } from '../src/infrastructure/psql-database.mjs';
import { SupabaseStorage } from '../src/infrastructure/supabase-storage.mjs';
import { createDispatchToken } from '../src/runtime/dispatch-auth.mjs';
import { loadLocalSupabaseStatus, LocalStorage } from './helpers/local-supabase.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixturePath = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'fixtures', 'generated', 'audio-only.webm');
const imageTag = 'annotated-media-worker:c5-local';
const allowedLogFields = new Set([
  'timestamp', 'event', 'media_id', 'stage', 'code', 'outcome', 'action', 'resume_stage',
  'attempt_count', 'candidate_count', 'dispatched_count', 'skipped_count', 'failed_count',
  'duration_ms', 'byte_size',
]);
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
let acceptanceStage = 'initializing';
let failedAcceptanceStage = null;

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hostPsqlPath() {
  if (process.env.ANNOTATED_PSQL_BIN) return process.env.ANNOTATED_PSQL_BIN;
  return process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe' : 'psql';
}

function docker(args, { timeout = 120_000, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error('Local Docker acceptance command failed.');
  return result;
}

function state(database, mediaId) {
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

function validateLogs(output, forbiddenValues) {
  const lines = output.split(/\r?\n/u).filter(Boolean);
  assert.ok(lines.length > 0, 'The worker must emit at least one sanitized log record.');
  for (const line of lines) {
    const record = JSON.parse(line);
    assert.equal(typeof record.timestamp, 'string');
    assert.equal(typeof record.event, 'string');
    for (const key of Object.keys(record)) assert.equal(allowedLogFields.has(key), true, `Unexpected log field: ${key}`);
  }
  for (const value of forbiddenValues) {
    if (value) assert.equal(output.includes(value), false, 'Worker output contained a forbidden value.');
  }
  assert.doesNotMatch(output, /Bearer|service_role|password|local\.invalid|Synthetic excerpt|\.webm|\.m4a/iu);
  return lines.length;
}

async function main() {
  if (process.env.ANNOTATED_C5_CONTAINER_LOCAL !== '1') {
    throw new Error('Set ANNOTATED_C5_CONTAINER_LOCAL=1 to authorize this loopback-only acceptance gate.');
  }

  acceptanceStage = 'loading_local_status';
  const status = loadLocalSupabaseStatus(repositoryRoot);
  const database = new PsqlDatabase({
    databaseUrl: status.databaseUrl,
    psqlPath: hostPsqlPath(),
    localOnly: true,
  });
  const storage = new SupabaseStorage({
    apiUrl: status.apiUrl,
    serviceRoleKey: status.serviceRoleKey,
    localOnly: true,
  });
  const localStorage = new LocalStorage(status);
  const rawBytes = await readFile(fixturePath);
  const ownerId = randomUUID();
  const sourceId = randomUUID();
  const annotationId = randomUUID();
  const mediaId = randomUUID();
  const objectNonce = randomUUID();
  const rawPath = `${ownerId}/${annotationId}/${mediaId}/${objectNonce}.webm`;
  const processedPath = `${ownerId}/${annotationId}/${mediaId}/excerpt.m4a`;
  const dispatchSecret = randomBytes(32).toString('base64url');
  const dispatchToken = createDispatchToken({ mediaId, secret: dispatchSecret });
  const containerName = `annotated-c5-${mediaId.slice(0, 8)}`;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c5-'));
  const environmentPath = path.join(temporaryDirectory, 'worker.env');
  let containerCreated = false;
  let acceptanceEvidence;

  try {
    acceptanceStage = 'seeding_storage';
    await storage.uploadNoUpsert('annotation-media-raw', rawPath, rawBytes, 'audio/webm');
    await localStorage.assertPrivate('annotation-media-raw', rawPath);
    acceptanceStage = 'seeding_database';
    database.execute(`
      insert into auth.users (id, raw_user_meta_data)
      values (${sqlText(ownerId)}::uuid, '{}'::jsonb);
      insert into public.sources (id, normalized_url, canonical_url, source_type, title, metadata)
      values (
        ${sqlText(sourceId)}::uuid, ${sqlText(`https://local.invalid/c5-container/${sourceId}`)},
        ${sqlText(`https://local.invalid/c5-container/${sourceId}`)}, 'podcast',
        'C5 Container Fixture', '{}'::jsonb
      );
      insert into public.annotations (id, source_id, user_id, annotation_type, commentary_text, status, slug)
      values (
        ${sqlText(annotationId)}::uuid, ${sqlText(sourceId)}::uuid, ${sqlText(ownerId)}::uuid,
        'audio_clip', 'C5 container acceptance', 'draft', ${sqlText(`c5-container-${mediaId}`)}
      );
      insert into public.annotation_targets (annotation_id, target_type, start_ms, end_ms)
      values (${sqlText(annotationId)}::uuid, 'time_range', 12000, 16000);
      insert into public.annotation_media (
        id, annotation_id, media_type, processing_status, processing_stage,
        capture_metadata, raw_storage_path, raw_mime_type, raw_byte_size,
        attempt_count, next_attempt_at, uploaded_at
      ) values (
        ${sqlText(mediaId)}::uuid, ${sqlText(annotationId)}::uuid, 'audio', 'processing', 'queued',
        ${sqlText(JSON.stringify(captureMetadata))}::jsonb, ${sqlText(rawPath)}, 'audio/webm',
        ${rawBytes.length}, 0, pg_catalog.now() - interval '1 second', pg_catalog.now()
      );
    `);

    const environment = [
      `ANNOTATED_SUPABASE_URL=${status.apiUrl}`,
      `ANNOTATED_DATABASE_URL=${status.databaseUrl}`,
      `ANNOTATED_SERVICE_ROLE_KEY=${status.serviceRoleKey}`,
      `ANNOTATED_DISPATCH_SECRET=${dispatchSecret}`,
      `ANNOTATED_MEDIA_ID=${mediaId}`,
      `ANNOTATED_DISPATCH_TOKEN=${dispatchToken}`,
    ].join('\n');
    acceptanceStage = 'writing_temporary_environment';
    await writeFile(environmentPath, `${environment}\n`, { mode: 0o600 });

    acceptanceStage = 'creating_container';
    const create = docker([
      'create', '--name', containerName,
      '--network', 'host',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--pids-limit', '128',
      '--memory', '512m',
      '--cpus', '2',
      '--user', '10001:10001',
      '--env-file', environmentPath,
      imageTag, 'worker',
    ]);
    assert.equal(create.status, 0);
    containerCreated = true;

    acceptanceStage = 'inspecting_container';
    const hostConfig = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', containerName]).stdout);
    const configuredUser = docker(['inspect', '--format', '{{.Config.User}}', containerName]).stdout.trim();
    assert.equal(hostConfig.ReadonlyRootfs, true);
    assert.equal(hostConfig.NetworkMode, 'host');
    assert.equal(hostConfig.Tmpfs['/tmp'].includes('size=64m'), true);
    assert.deepEqual(hostConfig.CapDrop, ['ALL']);
    assert.equal(hostConfig.SecurityOpt.includes('no-new-privileges:true'), true);
    assert.equal(hostConfig.PidsLimit, 128);
    assert.equal(hostConfig.Memory, 536_870_912);
    assert.equal(hostConfig.NanoCpus, 2_000_000_000);
    assert.equal(configuredUser, '10001:10001');

    acceptanceStage = 'running_worker';
    const execution = docker(['start', '--attach', containerName], { timeout: 660_000, allowFailure: true });
    const containerExitCode = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', containerName]).stdout.trim());
    assert.equal(execution.error, undefined);
    assert.equal(execution.status, 0);
    assert.equal(containerExitCode, 0);

    acceptanceStage = 'validating_logs';
    const logCount = validateLogs(`${execution.stdout}${execution.stderr}`, [
      status.serviceRoleKey,
      status.databaseUrl,
      dispatchSecret,
      dispatchToken,
      rawPath,
      processedPath,
      `https://local.invalid/c5-container/${sourceId}`,
    ]);
    acceptanceStage = 'validating_final_state';
    assert.deepEqual(state(database, mediaId), {
      annotation_status: 'published',
      processing_status: 'ready',
      processing_stage: null,
      attempt_count: 1,
      next_attempt_present: false,
      lease_present: false,
      raw_present: false,
      processed_present: true,
      transcript_present: true,
    });
    assert.equal(await storage.exists('annotation-media-raw', rawPath), false);
    assert.equal(await storage.exists('annotation-media', processedPath), true);
    await localStorage.assertPrivate('annotation-media', processedPath);

    const imageId = docker(['image', 'inspect', imageTag, '--format', '{{.Id}}']).stdout.trim();
    acceptanceEvidence = {
      image_id: imageId,
      platform: 'linux/amd64',
      user: configuredUser,
      read_only_root: true,
      tmpfs_bytes: 67_108_864,
      capabilities_dropped: 'ALL',
      no_new_privileges: true,
      pids_limit: hostConfig.PidsLimit,
      memory_bytes: hostConfig.Memory,
      nano_cpus: hostConfig.NanoCpus,
      media_jobs: 1,
      worker_exit_code: containerExitCode,
      sanitized_log_records: logCount,
      final_state: 'ready/published',
      raw_deleted: true,
      derivative_private: true,
      transcript_present: true,
    };
  } finally {
    if (!acceptanceEvidence) failedAcceptanceStage = acceptanceStage;
    acceptanceStage = 'cleaning_up';
    if (containerCreated) docker(['rm', '--force', containerName], { allowFailure: true });
    if (await storage.exists('annotation-media-raw', rawPath).catch(() => false)) {
      await storage.remove('annotation-media-raw', [rawPath]);
    }
    if (await storage.exists('annotation-media', processedPath).catch(() => false)) {
      await storage.remove('annotation-media', [processedPath]);
    }
    database.execute(`
      delete from public.annotations where id = ${sqlText(annotationId)}::uuid;
      delete from public.sources where id = ${sqlText(sourceId)}::uuid;
      delete from auth.users where id = ${sqlText(ownerId)}::uuid;
    `);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.equal(state(database, mediaId), null);
  assert.equal(await storage.exists('annotation-media-raw', rawPath), false);
  assert.equal(await storage.exists('annotation-media', processedPath), false);
  acceptanceStage = 'complete';
  process.stdout.write(`${JSON.stringify({ ...acceptanceEvidence, cleanup_verified: true })}\n`);
}

await main().catch(() => {
  process.stderr.write(`C5 Local container acceptance failed at stage=${failedAcceptanceStage ?? acceptanceStage}.\n`);
  process.exitCode = 1;
});
