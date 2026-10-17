import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ORIGIN = 'https://run.googleapis.com';
const PROJECT_ID = 'annotated-504301';
const REGION = 'us-east4';
const CLIENT_EMAIL = 'annotated-upload-dispatch@annotated-504301.iam.gserviceaccount.com';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const EMPTY_RUN_BODY = '{}';
const DEFAULT_TIMEOUT_MS = 4_000;

const DISPATCHER_JOB_BY_PROJECT: Record<string, DispatchTriggerConfig['job']> = {
  nkkunkwirvfwhmpwonqz: 'annotated-media-dispatcher-staging',
  vnxjktpdzmykmqrqwvks: 'annotated-media-dispatcher-production',
};

export const dispatchTriggerContract = Object.freeze({
  tokenUrl: TOKEN_URL,
  apiOrigin: API_ORIGIN,
  projectId: PROJECT_ID,
  region: REGION,
  clientEmail: CLIENT_EMAIL,
  scope: TOKEN_SCOPE,
  emptyRunBody: EMPTY_RUN_BODY,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  jobs: Object.freeze({ ...DISPATCHER_JOB_BY_PROJECT }),
});

export type DispatchTriggerConfig = {
  projectId: typeof PROJECT_ID;
  region: typeof REGION;
  job: 'annotated-media-dispatcher-staging' | 'annotated-media-dispatcher-production';
  clientEmail: typeof CLIENT_EMAIL;
  privateKey: KeyObject;
};

type MisconfiguredReason = 'incomplete' | 'url' | 'private_key';

export type DispatchTriggerDecision =
  | { ok: true; config: DispatchTriggerConfig }
  | { ok: false; reason: 'disabled' | MisconfiguredReason };

export type DispatchSignal =
  | { outcome: 'skipped' }
  | { outcome: 'accepted' }
  | { outcome: 'failed' }
  | { outcome: 'misconfigured'; reason: MisconfiguredReason | 'invalid' };

type TriggerLog = (code: string, reason?: string) => void;

export type DispatchTriggerOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  clock?: () => number;
  timeoutMs?: number;
  log?: TriggerLog;
};

function emitTriggerLog(code: string, reason?: string) {
  console.warn('[Hosted media complete]', reason ? { code, reason } : { code });
}

function hostedDispatcherJob(value: string | undefined) {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password ||
    parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)
  ) return null;
  const match = /^([a-z0-9]+)\.supabase\.co$/iu.exec(parsed.hostname);
  if (!match?.[1]) return null;
  return DISPATCHER_JOB_BY_PROJECT[match[1].toLowerCase()] ?? null;
}

function privateKeyFromEnvironment(value: string | undefined) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\n/g, '\n');
  if (normalized.length < 128 || normalized.length > 16_384) return null;
  if (!normalized.startsWith('-----BEGIN ') || !normalized.includes('PRIVATE KEY-----')) return null;
  try {
    return createPrivateKey(normalized);
  } catch {
    return null;
  }
}

export function readDispatchTriggerConfig(env: NodeJS.ProcessEnv = process.env): DispatchTriggerDecision {
  const flag = env.ANNOTATED_MEDIA_DISPATCH_TRIGGER;
  if (flag === undefined || flag === '') return { ok: false, reason: 'disabled' };
  if (flag !== 'on') return { ok: false, reason: 'incomplete' };
  const job = hostedDispatcherJob(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!job) return { ok: false, reason: 'url' };
  const privateKey = privateKeyFromEnvironment(env.ANNOTATED_DISPATCH_TRIGGER_PRIVATE_KEY);
  if (!privateKey) return { ok: false, reason: 'private_key' };
  return {
    ok: true,
    config: {
      projectId: PROJECT_ID,
      region: REGION,
      job,
      clientEmail: CLIENT_EMAIL,
      privateKey,
    },
  };
}

function base64url(value: Buffer | string) {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value;
  return buffer.toString('base64url');
}

function serviceAccountAssertion(config: DispatchTriggerConfig, nowMs: number) {
  const issuedAt = Math.floor(nowMs / 1_000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: config.clientEmail,
    scope: TOKEN_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3_600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(config.privateKey).toString('base64url')}`;
}

function dispatcherRunUrl(config: DispatchTriggerConfig) {
  return `${API_ORIGIN}/v2/projects/${config.projectId}/locations/${config.region}/jobs/${config.job}:run`;
}

async function responseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function accessToken(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const token = (value as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token.length < 20 || token.length > 4_096 || !/^[\w.-]+$/u.test(token)) return null;
  return token;
}

async function postDispatcherRun(config: DispatchTriggerConfig, options: DispatchTriggerOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const clock = options.clock ?? Date.now;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const assertion = serviceAccountAssertion(config, clock());
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!tokenResponse.ok) throw new Error('Cloud identity token request failed.');
  const token = accessToken(await responseJson(tokenResponse));
  if (!token) throw new Error('Cloud identity token response was invalid.');
  const runResponse = await fetchImpl(dispatcherRunUrl(config), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    // No overrides: roles/run.invoker can execute the job. run.jobs.runWithOverrides stays on the dispatcher identity.
    body: EMPTY_RUN_BODY,
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!runResponse.ok) throw new Error('Cloud Run dispatcher invocation failed.');
}

export async function signalQueuedMediaDispatch(options: DispatchTriggerOptions = {}): Promise<DispatchSignal> {
  const log = options.log ?? emitTriggerLog;
  let decision: DispatchTriggerDecision;
  try {
    decision = readDispatchTriggerConfig(options.env ?? process.env);
  } catch {
    log('MEDIA_DISPATCH_TRIGGER_MISCONFIGURED', 'invalid');
    return { outcome: 'misconfigured', reason: 'invalid' };
  }
  if (!decision.ok) {
    if (decision.reason === 'disabled') return { outcome: 'skipped' };
    log('MEDIA_DISPATCH_TRIGGER_MISCONFIGURED', decision.reason);
    return { outcome: 'misconfigured', reason: decision.reason };
  }
  try {
    await postDispatcherRun(decision.config, options);
    return { outcome: 'accepted' };
  } catch {
    log('MEDIA_DISPATCH_TRIGGER_FAILED');
    return { outcome: 'failed' };
  }
}
