import path from 'node:path';
import { requireBoundedInteger, requireLocalUrl, requireMediaId, requireSecret } from './validation.mjs';

const STAGING_PROJECT_REF = 'nkkunkwirvfwhmpwonqz';
const STAGING_API_HOST = `${STAGING_PROJECT_REF}.supabase.co`;
const STAGING_DATABASE_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const STAGING_DATABASE_USER = `annotated_media_worker.${STAGING_PROJECT_REF}`;
const GOOGLE_PROJECT_ID = 'annotated-504301';
const GOOGLE_REGION = 'us-east4';
const WORKER_JOB = 'annotated-media-worker-staging';

function requiredText(value, label, maximum = 1_024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`${label} is required.`);
  return value;
}

function integerEnvironment(value, fallback, label, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  return requireBoundedInteger(Number(value), label, minimum, maximum);
}

function deploymentEnvironment(value) {
  const normalized = value || 'local';
  if (!['local', 'staging'].includes(normalized)) throw new TypeError('Annotated environment must be local or staging.');
  return normalized;
}

function exactStagingApiUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError('Supabase API URL must be valid.'); }
  if (
    parsed.protocol !== 'https:' || parsed.hostname !== STAGING_API_HOST || parsed.port ||
    !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password
  ) throw new TypeError('Supabase API URL must match the approved Staging project.');
  return parsed.href.replace(/\/$/u, '');
}

function exactStagingDatabaseUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError('Database URL must be valid.'); }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== STAGING_DATABASE_HOST ||
    parsed.port !== '6543' || parsed.pathname !== '/postgres' || decodeURIComponent(parsed.username) !== STAGING_DATABASE_USER ||
    !parsed.password || parsed.search || parsed.hash
  ) throw new TypeError('Database URL must use the approved least-privilege Staging pooler identity.');
  return value;
}

function exactValue(value, expected, label) {
  if (value !== expected) throw new TypeError(`${label} must match the approved Staging value.`);
  return value;
}

function transcriberName(value, environment) {
  const normalized = value || (environment === 'local' ? 'deterministic-fake' : 'openai-whisper');
  if (!['deterministic-fake', 'openai-whisper'].includes(normalized)) throw new TypeError('Transcriber is invalid.');
  if (environment === 'staging' && normalized !== 'openai-whisper') throw new TypeError('Staging requires the approved OpenAI Whisper transcriber.');
  return normalized;
}

function dispatchMode(value, environment) {
  const normalized = value || (environment === 'local' ? 'local-process' : 'cloud-run');
  if (!['local-process', 'cloud-run'].includes(normalized)) throw new TypeError('Dispatch mode is invalid.');
  if (environment === 'staging' && normalized !== 'cloud-run') throw new TypeError('Staging requires Cloud Run dispatch.');
  return normalized;
}

export function loadRuntimeConfig(environment = process.env, mode = 'worker') {
  if (!['worker', 'dispatch', 'reconcile'].includes(mode)) throw new TypeError('Runtime mode is invalid.');
  const annotatedEnvironment = deploymentEnvironment(environment.ANNOTATED_ENVIRONMENT);
  const apiUrl = requiredText(environment.ANNOTATED_SUPABASE_URL, 'Supabase API URL');
  const databaseUrl = requiredText(environment.ANNOTATED_DATABASE_URL, 'Database URL');
  if (annotatedEnvironment === 'local') {
    requireLocalUrl(apiUrl, 'Supabase API URL', ['http:', 'https:']);
    requireLocalUrl(databaseUrl, 'Database URL', ['postgres:', 'postgresql:']);
  } else {
    exactStagingApiUrl(apiUrl);
    exactStagingDatabaseUrl(databaseUrl);
  }
  const transcriber = transcriberName(environment.ANNOTATED_TRANSCRIBER, annotatedEnvironment);
  const selectedDispatchMode = dispatchMode(environment.ANNOTATED_DISPATCH_MODE, annotatedEnvironment);
  const ffmpegPath = mode === 'worker' ? path.resolve(requiredText(environment.ANNOTATED_FFMPEG_PATH, 'FFmpeg path')) : null;
  const ffprobePath = mode === 'worker' ? path.resolve(requiredText(environment.ANNOTATED_FFPROBE_PATH, 'FFprobe path')) : null;
  const psqlPath = path.resolve(requiredText(environment.ANNOTATED_PSQL_PATH, 'psql path'));
  return Object.freeze({
    environment: annotatedEnvironment,
    mode,
    apiUrl,
    databaseUrl,
    serviceRoleKey: mode === 'dispatch' ? null : requireSecret(environment.ANNOTATED_SERVICE_ROLE_KEY, 'Supabase Storage secret key'),
    dispatchSecret: mode === 'reconcile' ? null : requireSecret(environment.ANNOTATED_DISPATCH_SECRET, 'Dispatch secret'),
    transcriber,
    openAiApiKey: mode === 'worker' && transcriber === 'openai-whisper'
      ? requireSecret(environment.ANNOTATED_OPENAI_API_KEY, 'OpenAI API key') : null,
    dispatchMode: selectedDispatchMode,
    googleProjectId: annotatedEnvironment === 'staging'
      ? exactValue(environment.ANNOTATED_GOOGLE_PROJECT_ID, GOOGLE_PROJECT_ID, 'Google Cloud project') : null,
    googleRegion: annotatedEnvironment === 'staging'
      ? exactValue(environment.ANNOTATED_GOOGLE_REGION, GOOGLE_REGION, 'Google Cloud region') : null,
    workerJob: annotatedEnvironment === 'staging'
      ? exactValue(environment.ANNOTATED_WORKER_JOB, WORKER_JOB, 'Cloud Run worker job') : null,
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

export const stagingRuntimeContract = Object.freeze({
  projectRef: STAGING_PROJECT_REF,
  apiHost: STAGING_API_HOST,
  databaseHost: STAGING_DATABASE_HOST,
  databaseUser: STAGING_DATABASE_USER,
  googleProjectId: GOOGLE_PROJECT_ID,
  googleRegion: GOOGLE_REGION,
  workerJob: WORKER_JOB,
});
