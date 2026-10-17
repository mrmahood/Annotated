import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runDispatchCycle } from '../../../media-worker/src/runtime/dispatcher.mjs';
import {
  dispatchTriggerContract,
  readDispatchTriggerConfig,
  signalQueuedMediaDispatch,
} from './media-dispatch-trigger.ts';

const STAGING_URL = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const PRODUCTION_URL = 'https://vnxjktpdzmykmqrqwvks.supabase.co';
const MEDIA_ID = '33333333-3333-4333-8333-333333333333';
const ACCESS_TOKEN = 'ya29.harness-token-0123456789';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function enabledEnv(url = PRODUCTION_URL, key = PRIVATE_PEM.replaceAll('\n', '\\n')) {
  return {
    ANNOTATED_MEDIA_DISPATCH_TRIGGER: 'on',
    NEXT_PUBLIC_SUPABASE_URL: url,
    ANNOTATED_DISPATCH_TRIGGER_PRIVATE_KEY: key,
  };
}

function runUrl(job) {
  return `${dispatchTriggerContract.apiOrigin}/v2/projects/${dispatchTriggerContract.projectId}/locations/${dispatchTriggerContract.region}/jobs/${job}:run`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function claimsOf(assertion) {
  const [header, payload, signature] = assertion.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, signature, 'base64url'), true);
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function createProcessingQueue() {
  const rows = new Map();
  return {
    enqueue(mediaId) {
      rows.set(mediaId, { media_id: mediaId, stage: 'queued', lease: null, claims: 0 });
    },
    snapshot(mediaId) {
      const row = rows.get(mediaId);
      return row ? { ...row } : null;
    },
    claim(mediaId) {
      const row = rows.get(mediaId);
      if (!row || row.lease || row.stage !== 'queued') return null;
      row.lease = randomUUID();
      row.stage = 'probing';
      row.claims += 1;
      return row.lease;
    },
    async listDispatchCandidates(limit) {
      return [...rows.values()]
        .filter((row) => row.stage === 'queued' && row.lease === null)
        .slice(0, limit)
        .map((row) => ({ media_id: row.media_id }));
    },
  };
}

test('dispatch trigger stays off until the explicit switch and hosted project are set', () => {
  assert.deepEqual(readDispatchTriggerConfig({}), { ok: false, reason: 'disabled' });
  assert.deepEqual(readDispatchTriggerConfig({ ANNOTATED_MEDIA_DISPATCH_TRIGGER: '' }), { ok: false, reason: 'disabled' });
  assert.deepEqual(readDispatchTriggerConfig({ ANNOTATED_MEDIA_DISPATCH_TRIGGER: 'true' }), { ok: false, reason: 'incomplete' });
  assert.deepEqual(readDispatchTriggerConfig({
    ANNOTATED_MEDIA_DISPATCH_TRIGGER: 'on',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    ANNOTATED_DISPATCH_TRIGGER_PRIVATE_KEY: PRIVATE_PEM,
  }), { ok: false, reason: 'url' });
  assert.deepEqual(readDispatchTriggerConfig({
    ANNOTATED_MEDIA_DISPATCH_TRIGGER: 'on',
    NEXT_PUBLIC_SUPABASE_URL: 'https://nkkunkwirvfwhmpwonqz.supabase.co.evil.example',
    ANNOTATED_DISPATCH_TRIGGER_PRIVATE_KEY: PRIVATE_PEM,
  }), { ok: false, reason: 'url' });
  assert.deepEqual(readDispatchTriggerConfig({
    ANNOTATED_MEDIA_DISPATCH_TRIGGER: 'on',
    NEXT_PUBLIC_SUPABASE_URL: `${PRODUCTION_URL}/extra`,
    ANNOTATED_DISPATCH_TRIGGER_PRIVATE_KEY: PRIVATE_PEM,
  }), { ok: false, reason: 'url' });
  assert.equal(readDispatchTriggerConfig(enabledEnv(STAGING_URL, 'not-a-key')).reason, 'private_key');
  assert.equal(readDispatchTriggerConfig(enabledEnv(STAGING_URL)).config.job, 'annotated-media-dispatcher-staging');
  assert.equal(readDispatchTriggerConfig(enabledEnv(PRODUCTION_URL)).config.job, 'annotated-media-dispatcher-production');
});

test('a queued upload starts the dispatcher once and a second trigger does not take another lease', async () => {
  const queue = createProcessingQueue();
  const requests = [];
  const logs = [];
  const now = 1_700_000_000_000;

  function completeUpload(mediaId) {
    const current = queue.snapshot(mediaId);
    if (current?.stage === 'queued' || current?.stage === 'probing') return 'already-queued';
    queue.enqueue(mediaId);
    return 'queued';
  }

  async function fetchImpl(input, init) {
    const url = String(input);
    requests.push({ url, init });
    if (url === dispatchTriggerContract.tokenUrl) {
      const body = String(init?.body);
      assert.equal(init?.method, 'POST');
      assert.doesNotMatch(body, /PRIVATE KEY/);
      const params = new URLSearchParams(body);
      assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const claims = claimsOf(params.get('assertion'));
      assert.equal(claims.iss, dispatchTriggerContract.clientEmail);
      assert.equal(claims.aud, dispatchTriggerContract.tokenUrl);
      assert.equal(claims.scope, dispatchTriggerContract.scope);
      assert.equal(claims.iat, Math.floor(now / 1_000));
      return jsonResponse({ access_token: ACCESS_TOKEN });
    }
    assert.equal(url, runUrl('annotated-media-dispatcher-production'));
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, dispatchTriggerContract.emptyRunBody);
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${ACCESS_TOKEN}`);
    assert.doesNotMatch(String(init?.body), /PRIVATE KEY|overrides|ANNOTATED_MEDIA_ID|ANNOTATED_DISPATCH_TOKEN/);
    const summary = await runDispatchCycle({
      store: queue,
      dispatchOne: async (mediaId) => {
        const lease = queue.claim(mediaId);
        assert.ok(lease);
        return { outcome: 'accepted' };
      },
      limit: 25,
      concurrency: 1,
    });
    return jsonResponse({ name: 'executions/harness', summary });
  }

  assert.equal(completeUpload(MEDIA_ID), 'queued');
  const first = await signalQueuedMediaDispatch({
    env: enabledEnv(),
    fetchImpl,
    clock: () => now,
    log: (code, reason) => logs.push({ code, reason }),
  });
  assert.deepEqual(first, { outcome: 'accepted' });
  assert.equal(queue.snapshot(MEDIA_ID).claims, 1);
  assert.equal(queue.snapshot(MEDIA_ID).stage, 'probing');
  assert.equal(queue.claim(MEDIA_ID), null);
  assert.deepEqual(logs, []);

  assert.equal(completeUpload(MEDIA_ID), 'already-queued');
  const second = await signalQueuedMediaDispatch({
    env: enabledEnv(),
    fetchImpl,
    clock: () => now,
    log: (code, reason) => logs.push({ code, reason }),
  });
  assert.deepEqual(second, { outcome: 'accepted' });
  assert.equal(queue.snapshot(MEDIA_ID).claims, 1);
  assert.deepEqual(await queue.listDispatchCandidates(25), []);
  assert.deepEqual(requests.map((request) => request.url), [
    dispatchTriggerContract.tokenUrl,
    runUrl('annotated-media-dispatcher-production'),
    dispatchTriggerContract.tokenUrl,
    runUrl('annotated-media-dispatcher-production'),
  ]);
});

test('a dispatcher failure leaves the queued upload in place and does not throw', async () => {
  const logs = [];
  const privateKeyText = PRIVATE_PEM;
  let runs = 0;
  const signal = await signalQueuedMediaDispatch({
    env: enabledEnv(STAGING_URL),
    log: (code, reason) => logs.push({ code, reason }),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === dispatchTriggerContract.tokenUrl) return jsonResponse({ access_token: ACCESS_TOKEN });
      assert.equal(url, runUrl('annotated-media-dispatcher-staging'));
      runs += 1;
      throw new Error(privateKeyText);
    },
  });
  assert.deepEqual(signal, { outcome: 'failed' });
  assert.equal(runs, 1);
  assert.deepEqual(logs, [{ code: 'MEDIA_DISPATCH_TRIGGER_FAILED', reason: undefined }]);
  assert.equal(JSON.stringify(logs).includes('PRIVATE KEY'), false);
  assert.equal(JSON.stringify(logs).includes(ACCESS_TOKEN), false);

  const queuedResponse = await (async () => {
    try {
      await signalQueuedMediaDispatch({
        env: enabledEnv(STAGING_URL),
        log: () => undefined,
        fetchImpl: async () => new Response('unavailable', { status: 503 }),
      });
    } catch {
      return { processingStatus: 'failed' };
    }
    return { processingStatus: 'processing', processingStage: 'queued' };
  })();
  assert.deepEqual(queuedResponse, { processingStatus: 'processing', processingStage: 'queued' });
});

test('an unset trigger makes no network call', async () => {
  let called = false;
  const signal = await signalQueuedMediaDispatch({
    env: { NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL },
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });
  assert.deepEqual(signal, { outcome: 'skipped' });
  assert.equal(called, false);
});

test('the trigger module does not send worker overrides or embed a credential', async () => {
  const source = await readFile(new URL('./media-dispatch-trigger.ts', import.meta.url), 'utf8');
  assert.match(source, /body: EMPTY_RUN_BODY/);
  assert.doesNotMatch(source, /containerOverrides|ANNOTATED_DISPATCH_TOKEN|ANNOTATED_MEDIA_ID|BEGIN PRIVATE KEY/);
  assert.match(source, /annotated-upload-dispatch@annotated-504301\.iam\.gserviceaccount\.com/);
  assert.match(source, /roles\/run\.invoker|jobs:run|EMPTY_RUN_BODY/);
});
