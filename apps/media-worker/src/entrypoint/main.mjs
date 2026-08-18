import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PsqlDatabase } from '../infrastructure/psql-database.mjs';
import { PostgresWorkerStore } from '../infrastructure/postgres-worker-store.mjs';
import { SupabaseStorage } from '../infrastructure/supabase-storage.mjs';
import { DeterministicFakeTranscriber } from '../transcription/fake-transcriber.mjs';
import { loadRuntimeConfig } from '../runtime/config.mjs';
import { createDispatchToken, verifyDispatchToken } from '../runtime/dispatch-auth.mjs';
import { runDispatchCycle } from '../runtime/dispatcher.mjs';
import { runReconciliationCycle } from '../runtime/reconciler.mjs';
import { createSanitizedLogger } from '../runtime/sanitized-logger.mjs';
import { runOneMediaJob } from '../runtime/worker-job.mjs';

const entrypointPath = fileURLToPath(import.meta.url);

function runtime(config) {
  const database = new PsqlDatabase({
    databaseUrl: config.databaseUrl,
    psqlPath: config.psqlPath,
    localOnly: true,
  });
  return {
    store: new PostgresWorkerStore(database),
    storage: new SupabaseStorage({
      apiUrl: config.apiUrl,
      serviceRoleKey: config.serviceRoleKey,
      localOnly: true,
    }),
  };
}

async function spawnAuthenticatedWorker(config, mediaId) {
  const token = createDispatchToken({ mediaId, secret: config.dispatchSecret });
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypointPath, 'worker'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ANNOTATED_MEDIA_ID: mediaId,
        ANNOTATED_DISPATCH_TOKEN: token,
      },
    });
    child.once('error', () => reject(new Error('Authenticated worker process could not start.')));
    child.once('close', (code) => {
      if (code === 0) resolve({ outcome: 'accepted' });
      else reject(new Error('Authenticated worker process failed.'));
    });
  });
}

async function main() {
  const mode = process.argv[2];
  if (!['worker', 'dispatch', 'reconcile'].includes(mode)) throw new TypeError('Use worker, dispatch, or reconcile mode.');
  const config = loadRuntimeConfig();
  const logger = createSanitizedLogger();
  const { store, storage } = runtime(config);

  if (mode === 'worker') {
    if (!config.mediaId || !config.dispatchToken) throw new TypeError('Worker requires one authenticated media ID.');
    verifyDispatchToken({ token: config.dispatchToken, mediaId: config.mediaId, secret: config.dispatchSecret });
    const timeout = setTimeout(() => {
      logger.emit('worker_failed', { media_id: config.mediaId, stage: 'worker', code: 'worker_timeout', outcome: 'failed' });
      process.exit(124);
    }, config.workerTimeoutMs);
    try {
      await runOneMediaJob({
        mediaId: config.mediaId,
        store,
        storage,
        ffmpegPath: config.ffmpegPath,
        ffprobePath: config.ffprobePath,
        transcriber: new DeterministicFakeTranscriber(),
        logger,
        leaseSeconds: config.leaseSeconds,
      });
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  if (mode === 'dispatch') {
    const summary = await runDispatchCycle({
      store,
      dispatchOne: (mediaId) => spawnAuthenticatedWorker(config, mediaId),
      logger,
      limit: config.dispatchLimit,
      concurrency: config.dispatchConcurrency,
    });
    if (summary.failedCount > 0) process.exitCode = 1;
    return;
  }

  const summary = await runReconciliationCycle({
    store,
    storage,
    logger,
    limit: config.reconciliationLimit,
    concurrency: config.reconciliationConcurrency,
  });
  if (summary.failedCount > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(() => {
    const logger = createSanitizedLogger();
    logger.emit('runtime_failed', { code: 'runtime_failed', outcome: 'failed' });
    process.exitCode = 1;
  });
}

export { main };
