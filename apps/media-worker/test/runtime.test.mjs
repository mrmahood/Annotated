import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import test from 'node:test';
import { MediaCoreError } from '../src/domain/media-core-error.mjs';
import { preparePsqlConnection } from '../src/infrastructure/psql-database.mjs';
import { createCloudRunDispatch, cloudRunDispatchContract } from '../src/runtime/cloud-run-dispatch.mjs';
import { loadRuntimeConfig, stagingRuntimeContract } from '../src/runtime/config.mjs';
import { createAuthenticatedLocalDispatch, createDispatchToken, verifyDispatchToken } from '../src/runtime/dispatch-auth.mjs';
import { runDispatchCycle } from '../src/runtime/dispatcher.mjs';
import { runReconciliationCycle } from '../src/runtime/reconciler.mjs';
import { createSanitizedLogger } from '../src/runtime/sanitized-logger.mjs';
import { runOneMediaJob } from '../src/runtime/worker-job.mjs';

const mediaId = '11111111-1111-4111-8111-111111111111';
const secondMediaId = '22222222-2222-4222-8222-222222222222';
const annotationId = '33333333-3333-4333-8333-333333333333';
const leaseToken = '44444444-4444-4444-8444-444444444444';
const secret = randomBytes(32).toString('base64url');

function captureLogger() {
  const lines = [];
  return {
    lines,
    logger: createSanitizedLogger({
      write: (line) => lines.push(line),
      clock: () => new Date('2026-08-18T12:00:00.000Z'),
    }),
  };
}

function claim(resumeStage) {
  return {
    media_id: mediaId,
    annotation_id: annotationId,
    media_type: 'audio',
    target_start_ms: 0,
    target_end_ms: 3_000,
    expected_processed_storage_path: 'owner/annotation/media/excerpt.m4a',
    resume_stage: resumeStage,
    capture_metadata: { version: 2 },
    raw_storage_path: 'owner/annotation/media/raw.webm',
    raw_byte_size: 100,
    processed_storage_path: null,
    lease_token: leaseToken,
    attempt_count: 1,
  };
}

test('PostgreSQL subprocess arguments redact the database password', () => {
  const connection = preparePsqlConnection('postgresql://worker:p%40ssword@db.example:6543/postgres?sslmode=require');
  assert.equal(connection.password, 'p@ssword');
  assert.equal(connection.redactedUrl, 'postgresql://worker@db.example:6543/postgres?sslmode=require');
  assert.doesNotMatch(connection.redactedUrl, /p%40ssword|p@ssword/u);
});

test('dispatch tokens bind one media ID, expire, and reject tampering', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const token = createDispatchToken({ mediaId, secret, now, nonce: secondMediaId });
  const payload = verifyDispatchToken({ token, mediaId, secret, now: now + 60_000 });
  assert.equal(payload.media_id, mediaId);
  assert.throws(() => verifyDispatchToken({ token, mediaId: secondMediaId, secret, now }), /invalid/u);
  assert.throws(() => verifyDispatchToken({ token: `${token}x`, mediaId, secret, now }), /invalid/u);
  assert.throws(() => verifyDispatchToken({ token, mediaId, secret, now: now + 301_000 }), /expired/u);
});

test('authenticated local dispatch passes only the bound media ID', async () => {
  const received = [];
  const dispatch = createAuthenticatedLocalDispatch({ secret, clock: () => 1_776_508_800_000, handle: async (id) => {
    received.push(id);
    return { outcome: 'ready' };
  } });
  assert.deepEqual(await dispatch(mediaId), { outcome: 'ready' });
  assert.deepEqual(received, [mediaId]);
});

test('sanitized logger drops paths, tokens, URLs, transcript text, and errors', () => {
  const { logger, lines } = captureLogger();
  logger.emit('worker_failed', {
    media_id: mediaId,
    stage: 'transcribing',
    code: 'provider_timeout',
    outcome: 'retry_scheduled',
    raw_storage_path: 'secret/raw/path.webm',
    access_token: 'token-value',
    source_url: 'https://private.invalid/source',
    transcript_text: 'private transcript',
    error: new Error('sensitive provider response'),
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    timestamp: '2026-08-18T12:00:00.000Z',
    event: 'worker_failed',
    media_id: mediaId,
    stage: 'transcribing',
    code: 'provider_timeout',
    outcome: 'retry_scheduled',
  });
  assert.doesNotMatch(lines[0], /secret|token-value|private\.invalid|transcript|provider response/u);
});

test('runtime configuration is Local-only and bounded without exposing secrets', () => {
  const environment = {
    ANNOTATED_SUPABASE_URL: 'http://127.0.0.1:54321',
    ANNOTATED_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ANNOTATED_SERVICE_ROLE_KEY: secret,
    ANNOTATED_DISPATCH_SECRET: randomBytes(32).toString('base64url'),
    ANNOTATED_FFMPEG_PATH: 'C:\\tools\\ffmpeg.exe',
    ANNOTATED_FFPROBE_PATH: 'C:\\tools\\ffprobe.exe',
    ANNOTATED_PSQL_PATH: 'C:\\tools\\psql.exe',
    ANNOTATED_DISPATCH_CONCURRENCY: '8',
  };
  const config = loadRuntimeConfig(environment);
  assert.equal(config.dispatchConcurrency, 8);
  assert.equal(config.workerTimeoutMs, 600_000);
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_SUPABASE_URL: 'https://remote.supabase.co' }), /loopback/u);
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_DISPATCH_CONCURRENCY: '9' }), /between 1 and 8/u);
  assert.doesNotMatch(JSON.stringify({ ...config, serviceRoleKey: '[redacted]', dispatchSecret: '[redacted]' }), new RegExp(secret, 'u'));
});

test('runtime configuration accepts only the exact approved Staging boundary', () => {
  const environment = {
    ANNOTATED_ENVIRONMENT: 'staging',
    ANNOTATED_SUPABASE_URL: `https://${stagingRuntimeContract.apiHost}`,
    ANNOTATED_DATABASE_URL: `postgresql://${stagingRuntimeContract.databaseUser}:encoded-password@${stagingRuntimeContract.databaseHost}:6543/postgres`,
    ANNOTATED_SERVICE_ROLE_KEY: secret,
    ANNOTATED_DISPATCH_SECRET: randomBytes(32).toString('base64url'),
    ANNOTATED_OPENAI_API_KEY: `sk-proj-${randomBytes(32).toString('base64url')}`,
    ANNOTATED_FFMPEG_PATH: '/usr/local/bin/ffmpeg',
    ANNOTATED_FFPROBE_PATH: '/usr/local/bin/ffprobe',
    ANNOTATED_PSQL_PATH: '/usr/lib/postgresql/17/bin/psql',
    ANNOTATED_TRANSCRIBER: 'openai-whisper',
    ANNOTATED_DISPATCH_MODE: 'cloud-run',
    ANNOTATED_GOOGLE_PROJECT_ID: stagingRuntimeContract.googleProjectId,
    ANNOTATED_GOOGLE_REGION: stagingRuntimeContract.googleRegion,
    ANNOTATED_WORKER_JOB: stagingRuntimeContract.workerJob,
  };
  const config = loadRuntimeConfig(environment, 'worker');
  assert.equal(config.environment, 'staging');
  assert.equal(config.transcriber, 'openai-whisper');
  assert.equal(config.dispatchMode, 'cloud-run');
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_SUPABASE_URL: 'https://other.supabase.co' }), /approved Staging project/u);
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_DATABASE_URL: environment.ANNOTATED_DATABASE_URL.replace(':6543', ':5432') }), /least-privilege/u);
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_TRANSCRIBER: 'deterministic-fake' }), /requires the approved/u);
  assert.throws(() => loadRuntimeConfig({ ...environment, ANNOTATED_GOOGLE_REGION: 'us-central1' }), /approved Staging value/u);
});

test('Cloud Run dispatch uses metadata identity and overrides exactly one media ID', async () => {
  const requests = [];
  const dispatchSecret = randomBytes(32).toString('base64url');
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === cloudRunDispatchContract.metadataTokenUrl) {
      return { ok: true, async json() { return { access_token: 'metadata-access-token-value', expires_in: 3600, token_type: 'Bearer' }; } };
    }
    return { ok: true, status: 200 };
  };
  const dispatch = createCloudRunDispatch({
    projectId: stagingRuntimeContract.googleProjectId,
    region: stagingRuntimeContract.googleRegion,
    workerJob: stagingRuntimeContract.workerJob,
    dispatchSecret,
    fetchImpl,
    clock: () => Date.parse('2026-08-18T12:00:00Z'),
  });
  assert.deepEqual(await dispatch(mediaId), { outcome: 'accepted' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['metadata-flavor'], 'Google');
  assert.equal(requests[1].url, 'https://run.googleapis.com/v2/projects/annotated-504301/locations/us-east4/jobs/annotated-media-worker-staging:run');
  assert.equal(requests[1].options.headers.authorization, 'Bearer metadata-access-token-value');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.overrides.taskCount, 1);
  assert.equal(body.overrides.timeout, '600s');
  assert.equal(body.overrides.containerOverrides[0].env[0].value, mediaId);
  const dispatchToken = body.overrides.containerOverrides[0].env[1].value;
  assert.equal(verifyDispatchToken({ token: dispatchToken, mediaId, secret: dispatchSecret, now: Date.parse('2026-08-18T12:00:01Z') }).media_id, mediaId);
  assert.doesNotMatch(JSON.stringify(requests[1]), /raw_storage_path|transcript_text/u);
});

test('dispatcher deduplicates IDs, bounds concurrency, and never forwards candidate details', async () => {
  const { logger, lines } = captureLogger();
  let active = 0;
  let maximumActive = 0;
  const received = [];
  const store = {
    listDispatchCandidates: async () => [
      { media_id: mediaId, resume_stage: 'probing', raw_storage_path: 'must-not-forward' },
      { media_id: mediaId, resume_stage: 'probing' },
      { media_id: secondMediaId, resume_stage: 'transcribing' },
    ],
  };
  const summary = await runDispatchCycle({
    store,
    logger,
    limit: 5,
    concurrency: 1,
    dispatchOne: async (id) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      received.push(id);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { outcome: 'accepted' };
    },
  });
  assert.deepEqual(received, [mediaId, secondMediaId]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(summary, { candidateCount: 2, dispatchedCount: 2, failedCount: 0 });
  assert.doesNotMatch(lines.join('\n'), /must-not-forward/u);
});

test('reconciler releases expired leases and removes an unstaged deterministic derivative', async () => {
  const { logger, lines } = captureLogger();
  const removed = [];
  const ownerId = '55555555-5555-4555-8555-555555555555';
  const rawPath = `${ownerId}/${annotationId}/${secondMediaId}/66666666-6666-4666-8666-666666666666.webm`;
  const processedPath = `${ownerId}/${annotationId}/${secondMediaId}/excerpt.m4a`;
  const existing = new Set([rawPath, processedPath]);
  const store = {
    listReconciliationCandidates: async () => [
      { media_id: mediaId, reconciliation_action: 'lease_expired' },
      { media_id: secondMediaId, reconciliation_action: 'terminal_raw_cleanup' },
    ],
    reconcileProcessing: async (id) => {
      assert.equal(id, mediaId);
      return 'lease_released';
    },
    claimCleanup: async (id) => ({
      media_id: id,
      cleanup_reason: 'terminal_raw_cleanup',
      raw_storage_path: rawPath,
      processed_storage_path: null,
      expected_processed_storage_path: processedPath,
      observed_updated_at: '2026-08-15T12:00:00Z',
    }),
    confirmCleanup: async (value) => {
      assert.equal(value.media_id, secondMediaId);
      assert.equal(value.processed_storage_path, null);
      assert.equal(existing.size, 0);
      return 'removed';
    },
  };
  const storage = {
    exists: async (_bucket, objectPath) => existing.has(objectPath),
    remove: async (_bucket, objectPaths) => {
      removed.push(...objectPaths);
      objectPaths.forEach((objectPath) => existing.delete(objectPath));
    },
  };
  const summary = await runReconciliationCycle({ store, storage, logger, concurrency: 1 });
  assert.deepEqual(removed, [rawPath, processedPath]);
  assert.deepEqual(summary, { candidateCount: 2, reconciledCount: 1, cleanedCount: 1, skippedCount: 0, failedCount: 0 });
  assert.doesNotMatch(lines.join('\n'), /owner\/annotation/u);
});

test('one-ID worker persists a retry schedule through the lease-fenced store', async () => {
  const { logger } = captureLogger();
  let released;
  const store = {
    claim: async () => claim('raw_cleanup'),
    releaseAttempt: async (_id, _lease, stage, code) => {
      released = { stage, code };
      return { result_status: 'processing', retry_at: '2026-08-18T12:01:00Z' };
    },
  };
  const storage = {
    download: async () => Buffer.alloc(1),
    exists: async () => { throw new MediaCoreError('raw_cleanup', 'raw_delete_failed', 'sensitive storage failure'); },
  };
  const result = await runOneMediaJob({
    mediaId,
    store,
    storage,
    ffmpegPath: 'unused',
    ffprobePath: 'unused',
    transcriber: {},
    logger,
    temporaryRoot: os.tmpdir(),
  });
  assert.deepEqual(released, { stage: 'raw_cleanup', code: 'raw_delete_failed' });
  assert.deepEqual(result, { outcome: 'retry_scheduled', stage: 'raw_cleanup', code: 'raw_delete_failed' });
});

test('one-ID worker resumes finalization without media or transcription access', async () => {
  const { logger } = captureLogger();
  let finalized = false;
  const store = {
    claim: async () => claim('finalizing'),
    finalize: async (id, lease) => {
      assert.equal(id, mediaId);
      assert.equal(lease, leaseToken);
      finalized = true;
    },
    releaseAttempt: async () => { throw new Error('must not release'); },
  };
  const result = await runOneMediaJob({
    mediaId,
    store,
    storage: { download: async () => { throw new Error('must not download'); } },
    ffmpegPath: 'unused',
    ffprobePath: 'unused',
    transcriber: {},
    logger,
  });
  assert.equal(finalized, true);
  assert.deepEqual(result, { outcome: 'ready' });
});
