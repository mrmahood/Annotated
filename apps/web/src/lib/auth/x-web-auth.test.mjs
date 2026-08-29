import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebAuthError,
  completeWebAuthCallback,
} from './auth-boundary.ts';
import {
  X_WEB_AUTH_ATTEMPT_TTL_MS,
  readXWebAuthCallback,
  startXWebAuth,
} from './x-web-auth.ts';

const ENABLED = { google: true, x: true };
const NOW = 1_800_000_000_000;
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';

function createStartClient({
  url = 'https://project.example/auth/v1/authorize?provider=x',
  error = null,
} = {}) {
  const calls = [];
  return {
    calls,
    client: { auth: { async signInWithOAuth(options) {
      calls.push(options);
      return { data: { url: error ? null : url }, error };
    } } },
  };
}

async function startAttempt(overrides = {}) {
  const fixture = createStartClient(overrides.clientOptions);
  const result = await startXWebAuth(
    fixture.client,
    {
      origin: 'https://annotated.example',
      returnTo: '/feed?sort=new#latest',
      currentAttemptCookie: overrides.currentAttemptCookie,
      ...overrides.input,
    },
    {
      capabilities: overrides.capabilities ?? ENABLED,
      createAttemptId: () => overrides.attemptId ?? ATTEMPT_ID,
      now: () => overrides.now ?? NOW,
    },
  );
  return { ...fixture, result };
}

function callbackParams(extra = '') {
  return new URLSearchParams(`provider=x&attempt=${ATTEMPT_ID}${extra}`);
}

test('X is disabled by default and cannot call Supabase', async () => {
  const { calls, client } = createStartClient();
  await assert.rejects(
    startXWebAuth(client, {
      origin: 'https://annotated.example',
      returnTo: '/',
    }, {
      createAttemptId: () => ATTEMPT_ID,
      now: () => NOW,
    }),
    (error) => error instanceof WebAuthError && error.kind === 'unsupported-provider',
  );
  assert.deepEqual(calls, []);
});

test('enabled test capability starts Supabase provider x without adding scopes', async () => {
  const { calls, result } = await startAttempt();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    provider: 'x',
    options: {
      redirectTo: `https://annotated.example/auth/callback?provider=x&attempt=${ATTEMPT_ID}`,
      skipBrowserRedirect: true,
    },
  });
  assert.equal(result.authorizationUrl, 'https://project.example/auth/v1/authorize?provider=x');
  assert.ok(result.attemptCookie.length > 0);
  assert.doesNotMatch(JSON.stringify(calls), /scope/);
});

test('start normalizes unsafe return paths and rejects malformed origins and attempt ids', async () => {
  const { result } = await startAttempt({ input: { returnTo: 'https://attacker.example/steal' } });
  const callback = readXWebAuthCallback(
    callbackParams('&code=one-time-code'),
    result.attemptCookie,
    NOW,
    ENABLED,
  );
  assert.equal(callback.kind, 'exchange');
  assert.equal(callback.request.nextPath, '/');

  await assert.rejects(
    startAttempt({ input: { origin: 'javascript:alert(1)' } }),
    (error) => error instanceof WebAuthError && error.kind === 'oauth',
  );
  await assert.rejects(
    startAttempt({ attemptId: 'not-an-attempt-id' }),
    (error) => error instanceof WebAuthError && error.kind === 'oauth',
  );
});

test('start redacts provider errors and an in-flight attempt blocks concurrency', async () => {
  const first = await startAttempt();
  await assert.rejects(
    startAttempt({ currentAttemptCookie: first.result.attemptCookie }),
    (error) => error instanceof WebAuthError && error.kind === 'attempt-active',
  );

  await assert.rejects(
    startAttempt({ clientOptions: { error: new Error('sensitive-x-start-detail') } }),
    (error) => error instanceof WebAuthError &&
      error.kind === 'oauth' &&
      !error.message.includes('sensitive-x-start-detail'),
  );
});

test('an expired attempt does not block a fresh start', async () => {
  const first = await startAttempt();
  const second = await startAttempt({
    currentAttemptCookie: first.result.attemptCookie,
    now: NOW + X_WEB_AUTH_ATTEMPT_TTL_MS + 1,
    attemptId: '123e4567-e89b-42d3-a456-426614174001',
  });
  assert.equal(second.calls.length, 1);
});

test('callback accepts exactly one matching current attempt and one bounded code', async () => {
  const { result } = await startAttempt();
  assert.deepEqual(
    readXWebAuthCallback(
      callbackParams('&code=one-time-code'),
      result.attemptCookie,
      NOW,
      ENABLED,
    ),
    {
      kind: 'exchange',
      request: { code: 'one-time-code', provider: 'x', nextPath: '/feed?sort=new#latest' },
    },
  );

  const invalidCases = [
    'provider=x&code=one-time-code',
    `provider=x&attempt=${ATTEMPT_ID}`,
    `provider=x&attempt=${ATTEMPT_ID}&attempt=${ATTEMPT_ID}&code=one-time-code`,
    `provider=x&attempt=${ATTEMPT_ID}&code=one&code=two`,
    `provider=google&attempt=${ATTEMPT_ID}&code=one-time-code`,
    `provider=x&attempt=123e4567-e89b-42d3-a456-426614174999&code=one-time-code`,
    `provider=x&attempt=${ATTEMPT_ID}&code=bad%00code`,
  ];
  for (const value of invalidCases) {
    assert.deepEqual(
      readXWebAuthCallback(new URLSearchParams(value), result.attemptCookie, NOW, ENABLED),
      { kind: 'invalid' },
    );
  }
  assert.deepEqual(
    readXWebAuthCallback(
      new URLSearchParams(`provider=x&attempt=${ATTEMPT_ID}&code=${'a'.repeat(8_193)}`),
      result.attemptCookie,
      NOW,
      ENABLED,
    ),
    { kind: 'invalid' },
  );
});

test('denial and cancellation are bounded and retain only the stored safe path', async () => {
  const { result } = await startAttempt();
  assert.deepEqual(
    readXWebAuthCallback(
      callbackParams('&error=access_denied&error_description=sensitive-provider-description'),
      result.attemptCookie,
      NOW,
      ENABLED,
    ),
    { kind: 'cancelled', nextPath: '/feed?sort=new#latest' },
  );
  assert.deepEqual(
    readXWebAuthCallback(
      callbackParams('&error=access_denied&error=server_error'),
      result.attemptCookie,
      NOW,
      ENABLED,
    ),
    { kind: 'invalid' },
  );
});

test('callback rejects disabled, missing, malformed, future, expired, and already-consumed attempts', async () => {
  const { result } = await startAttempt();
  const params = callbackParams('&code=one-time-code');
  assert.deepEqual(readXWebAuthCallback(params, result.attemptCookie, NOW), { kind: 'invalid' });
  assert.deepEqual(readXWebAuthCallback(params, null, NOW, ENABLED), { kind: 'invalid' });
  assert.deepEqual(readXWebAuthCallback(params, 'not-base64-json', NOW, ENABLED), { kind: 'invalid' });
  assert.deepEqual(readXWebAuthCallback(params, result.attemptCookie, NOW - 1, ENABLED), { kind: 'invalid' });
  assert.deepEqual(
    readXWebAuthCallback(params, result.attemptCookie, NOW + X_WEB_AUTH_ATTEMPT_TTL_MS + 1, ENABLED),
    { kind: 'invalid' },
  );
  // The route consumes the HttpOnly attempt cookie before exchange, so replay has no cookie.
  assert.deepEqual(readXWebAuthCallback(params, undefined, NOW, ENABLED), { kind: 'invalid' });
});

function createCallbackFixture({
  exchangeUser = { identities: [{ provider: 'x' }] },
  establishedUser = exchangeUser,
  exchangeError = null,
  exchangeSession = {
    access_token: 'annotated-access-token',
    refresh_token: 'annotated-refresh-token',
    provider_token: 'x-provider-token-must-not-persist',
    provider_refresh_token: 'x-provider-refresh-token-must-not-persist',
  },
  establishedSession = {
    access_token: 'refreshed-annotated-access-token',
    refresh_token: 'rotated-annotated-refresh-token',
  },
  sessionError = null,
} = {}) {
  const calls = { exchange: [], setSession: [], signOut: [] };
  const client = { auth: {
    async exchangeCodeForSession(code) {
      calls.exchange.push(code);
      return {
        data: {
          session: exchangeError ? null : exchangeSession,
          user: exchangeError ? null : exchangeUser,
        },
        error: exchangeError,
      };
    },
    async setSession(tokens) {
      calls.setSession.push(tokens);
      return {
        data: {
          session: sessionError ? null : establishedSession,
          user: sessionError ? null : establishedUser,
        },
        error: sessionError,
      };
    },
    async signOut(options) {
      calls.signOut.push(options);
      return { error: null };
    },
  } };
  return { calls, client };
}

const REQUEST = { code: 'one-time-x-code', provider: 'x', nextPath: '/feed' };

test('X callback exchanges once, verifies identity, refreshes, and retains only Annotated tokens', async () => {
  const { calls, client } = createCallbackFixture();
  assert.equal(await completeWebAuthCallback(client, REQUEST), true);
  assert.deepEqual(calls.exchange, ['one-time-x-code']);
  assert.deepEqual(calls.setSession, [{
    access_token: 'annotated-access-token',
    refresh_token: 'annotated-refresh-token',
  }]);
  assert.deepEqual(calls.signOut, []);
  assert.doesNotMatch(JSON.stringify(calls.setSession), /provider_token|x-provider/);
});

test('provider mismatch and missing X identity purge partial sessions', async () => {
  for (const exchangeUser of [
    { identities: [{ provider: 'google' }] },
    { identities: [] },
    {},
  ]) {
    const { calls, client } = createCallbackFixture({ exchangeUser });
    assert.equal(await completeWebAuthCallback(client, REQUEST), false);
    assert.deepEqual(calls.setSession, []);
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  }
});

test('expired exchange codes and exchange failures stay generic and do not create sessions', async () => {
  for (const detail of ['expired authorization code', 'sensitive exchange response']) {
    const { calls, client } = createCallbackFixture({ exchangeError: new Error(detail) });
    assert.equal(await completeWebAuthCallback(client, REQUEST), false);
    assert.deepEqual(calls.exchange, ['one-time-x-code']);
    assert.deepEqual(calls.setSession, []);
    assert.deepEqual(calls.signOut, []);
  }
});

test('malformed exchange and refreshed sessions fail closed with cleanup', async () => {
  const cases = [
    { exchangeSession: { access_token: '', refresh_token: 'valid-refresh' } },
    { exchangeSession: { access_token: 'valid-access', refresh_token: 'bad refresh' } },
    { establishedSession: null },
    { establishedSession: { access_token: 'valid-access', refresh_token: '' } },
    {
      establishedSession: {
        access_token: 'valid-access',
        refresh_token: 'valid-refresh',
        provider_token: 'must-not-remain',
      },
    },
  ];
  for (const options of cases) {
    const { calls, client } = createCallbackFixture(options);
    assert.equal(await completeWebAuthCallback(client, REQUEST), false);
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  }
});

test('refresh failure and refreshed-provider mismatch purge the attempted session', async () => {
  for (const options of [
    { sessionError: new Error('invalid or expired refresh') },
    { establishedUser: { identities: [{ provider: 'google' }] } },
  ]) {
    const { calls, client } = createCallbackFixture(options);
    assert.equal(await completeWebAuthCallback(client, REQUEST), false);
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  }
});

test('failure paths do not log or return provider, callback, or token detail', async () => {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  console.log = (...values) => logs.push(values);
  console.warn = (...values) => logs.push(values);
  console.error = (...values) => logs.push(values);
  try {
    const { client } = createCallbackFixture({
      exchangeError: new Error('secret-code provider-token callback-url'),
    });
    assert.equal(await completeWebAuthCallback(client, REQUEST), false);
    await assert.rejects(
      startAttempt({ clientOptions: { error: new Error('secret-provider-start-detail') } }),
      (error) => error instanceof WebAuthError && error.message === 'Sign-in could not be started. Please try again.',
    );
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.deepEqual(logs, []);
});
