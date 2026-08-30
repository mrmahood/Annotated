import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_EXTENSION_AUTH_CAPABILITIES,
  ENABLED_EXTENSION_AUTH_PROVIDERS,
  ExtensionAuthError,
  createExtensionAuthController,
  isEnabledExtensionAuthProvider,
  userHasAuthProvider,
  userHasEnabledAuthProvider,
} from './auth-boundary.ts';

const expectedRedirect =
  'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth/callback';
const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4LXVzZXIifQ.signature';
const refreshToken = 'refresh-token-value-for-x-1234';
const X_ENABLED_FOR_TEST = Object.freeze({ google: true, x: true });

function callback(fragment = `access_token=${accessToken}&refresh_token=${refreshToken}`) {
  return `${expectedRedirect}#${fragment}`;
}

function createFixture({
  callbackUrl = callback(),
  launch,
  user = { id: 'x-user-1', identities: [{ provider: 'x' }] },
  setSessionError = null,
  startUrl = 'https://project.example/auth/v1/authorize?provider=x',
} = {}) {
  const calls = { oauth: [], session: [], signOut: [] };
  const supabase = {
    auth: {
      async signInWithOAuth(options) {
        calls.oauth.push(options);
        return { data: { url: startUrl }, error: null };
      },
      async setSession(tokens) {
        calls.session.push(tokens);
        return {
          data: { user: setSessionError ? null : user },
          error: setSessionError,
        };
      },
      async signOut(options) {
        calls.signOut.push(options);
        return { error: null };
      },
    },
  };
  const runtime = {
    getRedirectURL: () => expectedRedirect,
    launchWebAuthFlow: launch ?? (async () => callbackUrl),
    timeoutMs: 20,
  };
  return { calls, runtime, supabase };
}

test('production capabilities keep X invisible and non-executable by default', async () => {
  assert.deepEqual(DEFAULT_EXTENSION_AUTH_CAPABILITIES, { google: true, x: false });
  assert.deepEqual(ENABLED_EXTENSION_AUTH_PROVIDERS, ['google']);
  assert.equal(isEnabledExtensionAuthProvider('google'), true);
  assert.equal(isEnabledExtensionAuthProvider('x'), false);
  assert.equal(isEnabledExtensionAuthProvider('x', X_ENABLED_FOR_TEST), true);
  assert.equal(userHasEnabledAuthProvider({ identities: [{ provider: 'x' }] }), false);
  assert.equal(
    userHasEnabledAuthProvider({ identities: [{ provider: 'x' }] }, X_ENABLED_FOR_TEST),
    true,
  );

  const { calls, runtime, supabase } = createFixture();
  const controller = createExtensionAuthController(runtime);
  await assert.rejects(
    controller.signInWithProvider(supabase, 'x'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'unsupported-provider',
  );
  assert.deepEqual(calls.oauth, []);
});

test('enabled test capability completes X without requesting scopes or persisting provider tokens', async () => {
  const providerToken = 'provider-token-must-not-cross-boundary';
  const providerRefreshToken = 'provider-refresh-token-must-not-cross-boundary';
  const { calls, runtime, supabase } = createFixture({
    callbackUrl: callback(
      `access_token=${accessToken}&refresh_token=${refreshToken}` +
      `&provider_token=${providerToken}&provider_refresh_token=${providerRefreshToken}`,
    ),
  });
  const controller = createExtensionAuthController(runtime, X_ENABLED_FOR_TEST);
  const user = await controller.signInWithProvider(supabase, 'x');

  assert.equal(user.id, 'x-user-1');
  assert.deepEqual(calls.oauth, [{
    provider: 'x',
    options: { skipBrowserRedirect: true, redirectTo: expectedRedirect },
  }]);
  assert.deepEqual(calls.session, [{
    access_token: accessToken,
    refresh_token: refreshToken,
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /provider-token-must-not-cross-boundary/);
});

test('X denial and Chrome cancellation stay bounded and create no session', async () => {
  for (const fixture of [
    createFixture({
      callbackUrl: callback('error=access_denied&error_description=sensitive-provider-detail'),
    }),
    createFixture({
      launch: async () => { throw new Error('The user did not approve access.'); },
    }),
  ]) {
    const controller = createExtensionAuthController(fixture.runtime, X_ENABLED_FOR_TEST);
    await assert.rejects(
      controller.signInWithProvider(fixture.supabase, 'x'),
      (error) => error instanceof ExtensionAuthError &&
        (error.kind === 'oauth' || error.kind === 'cancelled') &&
        !error.message.includes('sensitive-provider-detail'),
    );
    assert.deepEqual(fixture.calls.session, []);
  }
});

test('X rejects missing, duplicate, malformed, and wrong-origin callbacks before session setup', async () => {
  const invalidCallbacks = [
    callback(`access_token=${accessToken}`),
    callback(`access_token=${accessToken}&access_token=duplicate&refresh_token=${refreshToken}`),
    callback(`access_token=not-a-jwt&refresh_token=${refreshToken}`),
    `https://attacker.chromiumapp.org/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`,
  ];

  for (const callbackUrl of invalidCallbacks) {
    const { calls, runtime, supabase } = createFixture({ callbackUrl });
    const controller = createExtensionAuthController(runtime, X_ENABLED_FOR_TEST);
    await assert.rejects(
      controller.signInWithProvider(supabase, 'x'),
      (error) => error instanceof ExtensionAuthError &&
        ['callback', 'malformed-token', 'missing-token'].includes(error.kind),
    );
    assert.deepEqual(calls.session, []);
  }
});

test('X requires an exact X identity and purges missing or mismatched identities', async () => {
  for (const user of [
    { id: 'missing-identity', identities: [] },
    { id: 'google-only', email: 'same@example.test', identities: [{ provider: 'google' }] },
  ]) {
    const { calls, runtime, supabase } = createFixture({ user });
    const controller = createExtensionAuthController(runtime, X_ENABLED_FOR_TEST);
    await assert.rejects(
      controller.signInWithProvider(supabase, 'x'),
      (error) => error instanceof ExtensionAuthError && error.kind === 'provider-mismatch',
    );
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  }

  assert.equal(
    userHasAuthProvider({
      email: 'same@example.test',
      user_metadata: { provider: 'x', user_name: 'annotated' },
      identities: [{ provider: 'google' }],
    }, 'x'),
    false,
  );
});

test('invalid X session state is purged with a token-safe error', async () => {
  const detail = 'sensitive-invalid-session-detail';
  const { calls, runtime, supabase } = createFixture({
    setSessionError: new Error(detail),
  });
  const controller = createExtensionAuthController(runtime, X_ENABLED_FOR_TEST);
  await assert.rejects(
    controller.signInWithProvider(supabase, 'x'),
    (error) => error instanceof ExtensionAuthError &&
      error.kind === 'session' &&
      !error.message.includes(detail) &&
      !error.message.includes(accessToken) &&
      !error.message.includes(refreshToken),
  );
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('one X attempt blocks concurrency and a late callback cannot satisfy the next attempt', async () => {
  let resolveFirst;
  let launches = 0;
  const firstCallback = new Promise((resolve) => { resolveFirst = resolve; });
  const { calls, runtime, supabase } = createFixture({
    launch: () => {
      launches += 1;
      return launches === 1 ? firstCallback : Promise.resolve(callback());
    },
  });
  const controller = createExtensionAuthController(runtime, X_ENABLED_FOR_TEST);
  const first = controller.signInWithProvider(supabase, 'x');

  await assert.rejects(
    controller.signInWithProvider(supabase, 'x'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'attempt-active',
  );
  await assert.rejects(
    first,
    (error) => error instanceof ExtensionAuthError && error.kind === 'timeout',
  );

  resolveFirst(callback());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.session, []);

  const user = await controller.signInWithProvider(supabase, 'x');
  assert.equal(user.id, 'x-user-1');
  assert.equal(calls.session.length, 1);
});

test('extension auth source contains no manual identity-linking or metadata-merge path', () => {
  const authSource = readFileSync(new URL('./auth-boundary.ts', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const source = [authSource, appSource].join('\n');
  assert.doesNotMatch(source, /linkIdentity|unlinkIdentity|mergeIdentit/i);
  assert.doesNotMatch(appSource, /Continue with X|beginProviderSignIn\(['"]x['"]\)/);
});
