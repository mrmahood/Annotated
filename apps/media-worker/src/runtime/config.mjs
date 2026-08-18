import path from 'node:path';
import { requireBoundedInteger, requireLocalUrl, requireMediaId, requireSecret } from './validation.mjs';

function requiredText(value, label, maximum = 1_024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`${label} is required.`);
  return value;
}

function integerEnvironment(value, fallback, label, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  return requireBoundedInteger(Number(value), label, minimum, maximum);
}

export function loadRuntimeConfig(environment = process.env) {
  const apiUrl = requiredText(environment.ANNOTATED_SUPABASE_URL, 'Supabase API URL');
  const databaseUrl = requiredText(environment.ANNOTATED_DATABASE_URL, 'Database URL');
  requireLocalUrl(apiUrl, 'Supabase API URL', ['http:', 'https:']);
  requireLocalUrl(databaseUrl, 'Database URL', ['postgres:', 'postgresql:']);
  const ffmpegPath = path.resolve(requiredText(environment.ANNOTATED_FFMPEG_PATH, 'FFmpeg path'));
  const ffprobePath = path.resolve(requiredText(environment.ANNOTATED_FFPROBE_PATH, 'FFprobe path'));
  const psqlPath = path.resolve(requiredText(environment.ANNOTATED_PSQL_PATH, 'psql path'));
  return Object.freeze({
    apiUrl,
    databaseUrl,
    serviceRoleKey: requireSecret(environment.ANNOTATED_SERVICE_ROLE_KEY, 'Supabase service key'),
    dispatchSecret: requireSecret(environment.ANNOTATED_DISPATCH_SECRET, 'Dispatch secret'),
    ffmpegPath,
    ffprobePath,
    psqlPath,
    leaseSeconds: integerEnvironment(environment.ANNOTATED_LEASE_SECONDS, 900, 'Lease seconds', 60, 3_600),
    dispatchLimit: integerEnvironment(environment.ANNOTATED_DISPATCH_LIMIT, 25, 'Dispatch limit', 1, 100),
    dispatchConcurrency: integerEnvironment(environment.ANNOTATED_DISPATCH_CONCURRENCY, 4, 'Dispatch concurrency', 1, 8),
    reconciliationLimit: integerEnvironment(environment.ANNOTATED_RECONCILIATION_LIMIT, 25, 'Reconciliation limit', 1, 100),
    reconciliationConcurrency: integerEnvironment(environment.ANNOTATED_RECONCILIATION_CONCURRENCY, 2, 'Reconciliation concurrency', 1, 8),
    workerTimeoutMs: integerEnvironment(environment.ANNOTATED_WORKER_TIMEOUT_MS, 600_000, 'Worker timeout', 60_000, 600_000),
    mediaId: environment.ANNOTATED_MEDIA_ID ? requireMediaId(environment.ANNOTATED_MEDIA_ID) : null,
    dispatchToken: environment.ANNOTATED_DISPATCH_TOKEN ? requiredText(environment.ANNOTATED_DISPATCH_TOKEN, 'Dispatch token', 1_024) : null,
  });
}
