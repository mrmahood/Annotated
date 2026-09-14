import path from 'node:path';
import { requireBoundedInteger, requireLocalUrl, requireMediaId, requireSecret } from './validation.mjs';

const STAGING_PROJECT_REF = 'nkkunkwirvfwhmpwonqz';
const PRODUCTION_PROJECT_REF = 'vnxjktpdzmykmqrqwvks';
const SHARED_DATABASE_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const GOOGLE_PROJECT_ID = 'annotated-504301';
const GOOGLE_REGION = 'us-east4';

function hostedRuntimeContract(projectRef, workerJob) {
  return Object.freeze({
    projectRef,
    apiHost: `${projectRef}.supabase.co`,
    databaseHost: SHARED_DATABASE_HOST,
    databaseUser: `annotated_media_worker.${projectRef}`,
    googleProjectId: GOOGLE_PROJECT_ID,
    googleRegion: GOOGLE_REGION,
    workerJob,
  });
}

export const stagingRuntimeContract = hostedRuntimeContract(
  STAGING_PROJECT_REF,
  'annotated-media-worker-staging',
);

export const productionRuntimeContract = hostedRuntimeContract(
  PRODUCTION_PROJECT_REF,
  'annotated-media-worker-production',
);

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
  if (!['local', 'staging', 'production'].includes(normalized)) {
    throw new TypeError('Annotated environment must be local, staging, or production.');
  }
  return normalized;
}

function hostedLabel(environment) {
  return environment === 'production' ? 'Production' : 'Staging';
}

function approvedHostedContract(environment) {
  if (environment === 'staging') return stagingRuntimeContract;
  if (environment === 'production') return productionRuntimeContract;
  return null;
}

function exactHostedApiUrl(value, contract, environment) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError('Supabase API URL must be valid.'); }
  if (
    parsed.protocol !== 'https:' || parsed.hostname !== contract.apiHost || parsed.port ||
    !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password
  ) throw new TypeError(`Supabase API URL must match the approved ${hostedLabel(environment)} project.`);
  return parsed.href.replace(/\/$/u, '');
}

function exactHostedDatabaseUrl(value, contract, environment) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError('Database URL must be valid.'); }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== contract.databaseHost ||
    parsed.port !== '6543' || parsed.pathname !== '/postgres' || decodeURIComponent(parsed.username) !== contract.databaseUser ||
    !parsed.password || parsed.search || parsed.hash
  ) throw new TypeError(`Database URL must use the approved least-privilege ${hostedLabel(environment)} pooler identity.`);
  return value;
}

function exactValue(value, expected, label, environment) {
  if (value !== expected) throw new TypeError(`${label} must match the approved ${hostedLabel(environment)} value.`);
  return value;
}

function transcriberName(value, environment) {
  const normalized = value || (environment === 'local' ? 'deterministic-fake' : 'openai-whisper');
  if (!['deterministic-fake', 'openai-whisper'].includes(normalized)) throw new TypeError('Transcriber is invalid.');
  if (environment !== 'local' && normalized !== 'openai-whisper') {
    throw new TypeError(`${hostedLabel(environment)} requires the approved OpenAI Whisper transcriber.`);
  }
  return normalized;
}

function dispatchMode(value, environment) {
  const normalized = value || (environment === 'local' ? 'local-process' : 'cloud-run');
  if (!['local-process', 'cloud-run'].includes(normalized)) throw new TypeError('Dispatch mode is invalid.');
  if (environment !== 'local' && normalized !== 'cloud-run') {
    throw new TypeError(`${hostedLabel(environment)} requires Cloud Run dispatch.`);
  }
  return normalized;
}

export function loadRuntimeConfig(environment = process.env, mode = 'worker') {
  if (!['worker', 'dispatch', 'reconcile'].includes(mode)) throw new TypeError('Runtime mode is invalid.');
  const annotatedEnvironment = deploymentEnvironment(environment.ANNOTATED_ENVIRONMENT);
  const apiUrl = requiredText(environment.ANNOTATED_SUPABASE_URL, 'Supabase API URL');
  const databaseUrl = requiredText(environment.ANNOTATED_DATABASE_URL, 'Database URL');
  const hostedContract = approvedHostedContract(annotatedEnvironment);
  if (hostedContract) {
    exactHostedApiUrl(apiUrl, hostedContract, annotatedEnvironment);
    exactHostedDatabaseUrl(databaseUrl, hostedContract, annotatedEnvironment);
  } else {
    requireLocalUrl(apiUrl, 'Supabase API URL', ['http:', 'https:']);
    requireLocalUrl(databaseUrl, 'Database URL', ['postgres:', 'postgresql:']);
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
    googleProjectId: hostedContract
      ? exactValue(environment.ANNOTATED_GOOGLE_PROJECT_ID, hostedContract.googleProjectId, 'Google Cloud project', annotatedEnvironment) : null,
    googleRegion: hostedContract
      ? exactValue(environment.ANNOTATED_GOOGLE_REGION, hostedContract.googleRegion, 'Google Cloud region', annotatedEnvironment) : null,
    workerJob: hostedContract
      ? exactValue(environment.ANNOTATED_WORKER_JOB, hostedContract.workerJob, 'Cloud Run worker job', annotatedEnvironment) : null,
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
