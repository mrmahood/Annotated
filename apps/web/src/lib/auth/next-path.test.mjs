import assert from 'node:assert/strict';
import test from 'node:test';
import './auth-capabilities.test.mjs';
import './x-web-auth.test.mjs';
import {
  AUTH_PROVIDER_METADATA,
  DEFAULT_WEB_AUTH_CAPABILITIES,
  ENABLED_WEB_AUTH_PROVIDERS,
  WebAuthError,
  completeWebAuthCallback,
  createWebAuthStarter,
  getSafeNextPath,
  readWebAuthCallbackRequest,
  userHasAuthProvider,
} from './auth-boundary.ts';

test('keeps safe relative next paths', () => {
  assert.equal(getSafeNextPath('/account?tab=profile#details'), '/account?tab=profile#details');
  assert.equal(getSafeNextPath('/'), '/');
});

test('rejects absolute and protocol-relative next paths', () => {
  assert.equal(getSafeNextPath('https://example.com/steal'), '/');
  assert.equal(getSafeNextPath('//example.com/steal'), '/');
  assert.equal(getSafeNextPath('/\\example.com/steal'), '/');
  assert.equal(getSafeNextPath(null), '/');
});

test('provider-neutral metadata keeps X explicitly disabled for E2b delivery', () => {
  assert.deepEqual(ENABLED_WEB_AUTH_PROVIDERS, ['google']);
  assert.deepEqual(DEFAULT_WEB_AUTH_CAPABILITIES, { google: true, x: false });
  assert.equal(AUTH_PROVIDER_METADATA.google.label, 'Google');
  assert.equal(AUTH_PROVIDER_METADATA.x.label, 'X');
  assert.equal(userHasAuthProvider({ identities: [{ provider: 'google' }] }, 'google'), true);
  assert.equal(userHasAuthProvider({ identities: [{ provider: 'x' }] }, 'google'), false);
});

test('web auth start carries a safe provider hint and normalizes next', async () => {
  const calls = [];
  const starter = createWebAuthStarter();
  await starter.start({ auth: { async signInWithOAuth(options) {
    calls.push(options);
    return { error: null };
  } } }, 'google', 'https://attacker.example/steal', 'https://annotated.example');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'google');
  const callback = new URL(calls[0].options.redirectTo);
  assert.equal(callback.origin, 'https://annotated.example');
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('provider'), 'google');
  assert.equal(callback.searchParams.get('next'), '/');
});

test('web auth start permits one attempt and rejects disabled X before OAuth', async () => {
  let resolveStart;
  const pendingStart = new Promise((resolve) => { resolveStart = resolve; });
  const calls = [];
  const client = { auth: { async signInWithOAuth(options) {
    calls.push(options);
    return await pendingStart;
  } } };
  const starter = createWebAuthStarter();
  const first = starter.start(client, 'google', '/', 'https://annotated.example');

  await assert.rejects(
    starter.start(client, 'google', '/', 'https://annotated.example'),
    (error) => error instanceof WebAuthError && error.kind === 'attempt-active',
  );
  resolveStart({ error: null });
  await first;

  const xStarter = createWebAuthStarter();
  await assert.rejects(
    xStarter.start(client, 'x', '/', 'https://annotated.example'),
    (error) => error instanceof WebAuthError && error.kind === 'unsupported-provider',
  );
  assert.equal(calls.length, 1);
});

test('web auth start redacts provider failures and releases the attempt lock', async () => {
  let calls = 0;
  const starter = createWebAuthStarter();
  const client = { auth: { async signInWithOAuth() {
    calls += 1;
    return { error: new Error('sensitive-provider-start-detail') };
  } } };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      starter.start(client, 'google', '/', 'https://annotated.example'),
      (error) => error instanceof WebAuthError &&
        error.kind === 'oauth' &&
        !error.message.includes('sensitive-provider-start-detail'),
    );
  }
  assert.equal(calls, 2);
});

test('callback request requires one bounded code and one enabled provider', () => {
  assert.deepEqual(
    readWebAuthCallbackRequest(new URLSearchParams('code=code-1&provider=google&next=%2Ffeed')),
    { code: 'code-1', provider: 'google', nextPath: '/feed' },
  );
  assert.equal(
    readWebAuthCallbackRequest(new URLSearchParams('code=one&code=two&provider=google')),
    null,
  );
  assert.equal(
    readWebAuthCallbackRequest(new URLSearchParams('code=code-1&provider=x')),
    null,
  );
  assert.equal(
    readWebAuthCallbackRequest(new URLSearchParams('error=access_denied&provider=google')),
    null,
  );
  assert.equal(
    readWebAuthCallbackRequest(new URLSearchParams('code=code-1&provider=google&next=%2Fone&next=%2Ftwo')),
    null,
  );
});

function createCallbackFixture({
  exchangeUser = { identities: [{ provider: 'google' }] },
  sessionUser = exchangeUser,
  exchangeError = null,
  sessionError = null,
} = {}) {
  const calls = { exchange: [], session: [], signOut: [] };
  const client = { auth: {
    async exchangeCodeForSession(code) {
      calls.exchange.push(code);
      return {
        data: {
          session: exchangeError ? null : {
            access_token: 'annotated-access-token',
            refresh_token: 'annotated-refresh-token',
            provider_token: 'must-not-cross-boundary',
            provider_refresh_token: 'must-not-cross-boundary-either',
          },
          user: exchangeError ? null : exchangeUser,
        },
        error: exchangeError,
      };
    },
    async setSession(tokens) {
      calls.session.push(tokens);
      return {
        data: {
          session: sessionError ? null : {
            access_token: 'refreshed-annotated-access-token',
            refresh_token: 'rotated-annotated-refresh-token',
          },
          user: sessionError ? null : sessionUser,
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

const callbackRequest = { code: 'one-time-code', provider: 'google', nextPath: '/feed' };

test('callback exchanges once, verifies identity, and re-establishes only Annotated tokens', async () => {
  const { calls, client } = createCallbackFixture();
  assert.equal(await completeWebAuthCallback(client, callbackRequest), true);
  assert.deepEqual(calls.exchange, ['one-time-code']);
  assert.deepEqual(calls.session, [{
    access_token: 'annotated-access-token',
    refresh_token: 'annotated-refresh-token',
  }]);
  assert.deepEqual(calls.signOut, []);
  assert.doesNotMatch(JSON.stringify(calls.session), /provider_token|must-not-cross-boundary/);
});

test('callback provider mismatch purges the attempted session', async () => {
  const { calls, client } = createCallbackFixture({
    exchangeUser: { identities: [{ provider: 'x' }] },
  });
  assert.equal(await completeWebAuthCallback(client, callbackRequest), false);
  assert.deepEqual(calls.exchange, ['one-time-code']);
  assert.deepEqual(calls.session, []);
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('callback session failure is bounded and purges partial state', async () => {
  const { calls, client } = createCallbackFixture({
    sessionError: new Error('sensitive session failure'),
  });
  assert.equal(await completeWebAuthCallback(client, callbackRequest), false);
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('callback exchange failure performs one exchange and exposes no detail', async () => {
  const { calls, client } = createCallbackFixture({
    exchangeError: new Error('sensitive-exchange-failure'),
  });
  assert.equal(await completeWebAuthCallback(client, callbackRequest), false);
  assert.deepEqual(calls.exchange, ['one-time-code']);
  assert.deepEqual(calls.session, []);
  assert.deepEqual(calls.signOut, []);
});
