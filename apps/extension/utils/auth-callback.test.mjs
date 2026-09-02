import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_PROVIDER_METADATA,
  ENABLED_EXTENSION_AUTH_PROVIDERS,
  createExtensionAuthController,
  ExtensionAuthError,
  isAuthCancellation,
  isExpectedAuthCallback,
  parseAuthCallbackTokens,
  userHasAuthProvider,
  userHasEnabledAuthProvider,
} from './auth-boundary.ts';

const expectedRedirect =
  'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth/callback';
const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature';
const refreshToken = 'refresh-token-value-1234';
const denialDescription = 'The user denied the authorization request';

function supabaseDenialCallback({
  redirect = expectedRedirect,
  description = denialDescription,
  querySuffix = '',
  fragmentSuffix = '',
} = {}) {
  const encodedDescription = encodeURIComponent(description);
  return `${redirect}?error=access_denied&error_description=${encodedDescription}${querySuffix}` +
    `#error=access_denied&error_description=${encodedDescription}&sb=${fragmentSuffix}`;
}

test('accepts only the expected chromiumapp.org callback origin and path', () => {
  assert.equal(isExpectedAuthCallback(`${expectedRedirect}#access_token=x`, expectedRedirect), true);
  assert.equal(isExpectedAuthCallback(supabaseDenialCallback(), expectedRedirect), true);
  assert.equal(
    isExpectedAuthCallback(
      'https://attacker.chromiumapp.org/auth/callback#access_token=x',
      expectedRedirect,
    ),
    false,
  );
  assert.equal(
    isExpectedAuthCallback(
      'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/other',
      expectedRedirect,
    ),
    false,
  );
  assert.equal(
    isExpectedAuthCallback(
      `${expectedRedirect}?unexpected=true#access_token=x`,
      expectedRedirect,
    ),
    false,
  );
  assert.equal(
    isExpectedAuthCallback(
      supabaseDenialCallback({
        redirect: 'https://attacker.chromiumapp.org/auth/callback',
      }),
      expectedRedirect,
    ),
    false,
  );
  assert.equal(
    isExpectedAuthCallback(
      supabaseDenialCallback({
        redirect: 'https://user@abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth/callback',
      }),
      expectedRedirect,
    ),
    false,
  );
});

test('parses Supabase tokens from the callback fragment', () => {
  assert.deepEqual(
    parseAuthCallbackTokens(
      `${expectedRedirect}#access_token=${accessToken}&refresh_token=${refreshToken}`,
    ),
    { accessToken, refreshToken },
  );
});

test('rejects missing callback tokens', () => {
  assert.throws(
    () => parseAuthCallbackTokens(`${expectedRedirect}#access_token=${accessToken}`),
    /authentication response was incomplete/i,
  );
});

test('rejects duplicate callback tokens without exposing their values', () => {
  const duplicate = 'duplicate-sensitive-token';
  assert.throws(
    () => parseAuthCallbackTokens(
      `${expectedRedirect}#access_token=${accessToken}&access_token=${duplicate}&refresh_token=${refreshToken}`,
    ),
    (error) => {
      assert.equal(error.message.includes(duplicate), false);
      assert.match(error.message, /authentication response was incomplete/i);
      return true;
    },
  );
});

test('maps provider denial to a provider-neutral bounded error', () => {
  const detail = 'sensitive-provider-denial-detail';
  assert.throws(
    () => parseAuthCallbackTokens(
      `${expectedRedirect}#error=access_denied&error_description=${detail}`,
    ),
    (error) => {
      assert.equal(error instanceof ExtensionAuthError, true);
      assert.equal(error.kind, 'oauth');
      assert.equal(error.message.includes(detail), false);
      assert.equal(error.message.includes('Google'), false);
      return true;
    },
  );
});

test('maps the bounded Supabase query-and-fragment denial to cancellation', () => {
  assert.throws(
    () => parseAuthCallbackTokens(supabaseDenialCallback()),
    (error) => {
      assert.equal(error instanceof ExtensionAuthError, true);
      assert.equal(error.kind, 'cancelled');
      assert.match(error.message, /cancelled/i);
      assert.equal(error.message.includes(denialDescription), false);
      return true;
    },
  );
});

test('rejects duplicate, unknown, mismatched, and mixed denial responses', () => {
  const invalidCallbacks = [
    supabaseDenialCallback({ querySuffix: '&error=access_denied' }),
    supabaseDenialCallback({ querySuffix: '&unexpected=true' }),
    supabaseDenialCallback({ fragmentSuffix: `&access_token=${accessToken}` }),
    `${expectedRedirect}?error=access_denied&error_description=one` +
      '#error=access_denied&error_description=two&sb=',
  ];

  for (const callbackUrl of invalidCallbacks) {
    assert.equal(isExpectedAuthCallback(callbackUrl, expectedRedirect), false);
    assert.throws(
      () => parseAuthCallbackTokens(callbackUrl),
      (error) => error instanceof ExtensionAuthError && error.kind === 'callback',
    );
  }
});

test('redacts malformed token values from errors', () => {
  const malformedAccessToken = 'sensitive malformed access token';
  const malformedRefreshToken = 'sensitive malformed refresh token';

  assert.throws(
    () =>
      parseAuthCallbackTokens(
        `${expectedRedirect}#access_token=${encodeURIComponent(malformedAccessToken)}&refresh_token=${encodeURIComponent(malformedRefreshToken)}`,
      ),
    (error) => {
      assert.equal(error.message.includes(malformedAccessToken), false);
      assert.equal(error.message.includes(malformedRefreshToken), false);
      assert.match(error.message, /authentication response was malformed/i);
      return true;
    },
  );
});

test('classifies user-cancelled identity flows as recoverable cancellation', () => {
  assert.equal(isAuthCancellation(new Error('The user did not approve access.')), true);
  assert.equal(isAuthCancellation(new Error('The window was closed by the user.')), true);
  assert.equal(isAuthCancellation(new Error('Network request failed')), false);
});

test('keeps X closed while exposing provider-neutral metadata and identity checks', () => {
  assert.deepEqual(ENABLED_EXTENSION_AUTH_PROVIDERS, ['google']);
  assert.equal(AUTH_PROVIDER_METADATA.google.label, 'Google');
  assert.equal(AUTH_PROVIDER_METADATA.x.label, 'X');
  assert.equal(userHasAuthProvider({ identities: [{ provider: 'google' }] }, 'google'), true);
  assert.equal(userHasAuthProvider({ identities: [{ provider: 'x' }] }, 'google'), false);
  assert.equal(userHasEnabledAuthProvider({ identities: [{ provider: 'google' }] }), true);
  assert.equal(userHasEnabledAuthProvider({ identities: [{ provider: 'x' }] }), false);
});

function createAuthFixture({
  callbackUrl = `${expectedRedirect}#access_token=${accessToken}&refresh_token=${refreshToken}`,
  user = { id: 'user-1', identities: [{ provider: 'google' }] },
  launch,
  setSessionError = null,
} = {}) {
  const calls = { oauth: [], session: [], signOut: [] };
  const supabase = {
    auth: {
      async signInWithOAuth(options) {
        calls.oauth.push(options);
        return { data: { url: 'https://example.supabase.co/auth/v1/authorize' }, error: null };
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

test('provider-neutral extension sign-in preserves the Google flow and verifies identity', async () => {
  const { calls, runtime, supabase } = createAuthFixture();
  const controller = createExtensionAuthController(runtime);
  const user = await controller.signInWithProvider(supabase, 'google');

  assert.equal(user.id, 'user-1');
  assert.deepEqual(calls.oauth, [{
    provider: 'google',
    options: { skipBrowserRedirect: true, redirectTo: expectedRedirect },
  }]);
  assert.deepEqual(calls.session, [{
    access_token: accessToken,
    refresh_token: refreshToken,
  }]);
  assert.deepEqual(calls.signOut, []);
});

test('provider mismatch purges the attempted session and returns a token-safe error', async () => {
  const { calls, runtime, supabase } = createAuthFixture({
    user: { id: 'user-1', identities: [{ provider: 'x' }] },
  });
  const controller = createExtensionAuthController(runtime);

  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => {
      assert.equal(error instanceof ExtensionAuthError, true);
      assert.equal(error.kind, 'provider-mismatch');
      assert.equal(error.message.includes(accessToken), false);
      assert.equal(error.message.includes(refreshToken), false);
      return true;
    },
  );
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('session failure purges partial state and reports a bounded error', async () => {
  const { calls, runtime, supabase } = createAuthFixture({
    setSessionError: new Error('sensitive provider failure'),
  });
  const controller = createExtensionAuthController(runtime);

  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => error instanceof ExtensionAuthError &&
      error.kind === 'session' &&
      !error.message.includes('sensitive provider failure'),
  );
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('cancelled Chrome flow is recoverable and does not create a session', async () => {
  const { calls, runtime, supabase } = createAuthFixture({
    launch: async () => { throw new Error('The user did not approve access.'); },
  });
  const controller = createExtensionAuthController(runtime);

  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'cancelled',
  );
  assert.deepEqual(calls.session, []);
  assert.deepEqual(calls.signOut, []);
});

test('OAuth start failures are generic and release the attempt lock', async () => {
  const { calls, runtime, supabase } = createAuthFixture();
  supabase.auth.signInWithOAuth = async (options) => {
    calls.oauth.push(options);
    return { data: { url: null }, error: new Error('sensitive-start-detail') };
  };
  const controller = createExtensionAuthController(runtime);

  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => error instanceof ExtensionAuthError &&
      error.kind === 'oauth' &&
      !error.message.includes('sensitive-start-detail'),
  );
  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'oauth',
  );
  assert.equal(calls.oauth.length, 2);
});

test('one active attempt blocks concurrency and a timed-out attempt cannot satisfy a later one', async () => {
  let resolveFirst;
  const firstLaunch = new Promise((resolve) => { resolveFirst = resolve; });
  const { runtime, supabase } = createAuthFixture({ launch: () => firstLaunch });
  const controller = createExtensionAuthController(runtime);
  const first = controller.signInWithProvider(supabase, 'google');

  await assert.rejects(
    controller.signInWithProvider(supabase, 'google'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'attempt-active',
  );
  await assert.rejects(
    first,
    (error) => error instanceof ExtensionAuthError && error.kind === 'timeout',
  );

  resolveFirst(`${expectedRedirect}#access_token=${accessToken}&refresh_token=${refreshToken}`);
  const secondFixture = createAuthFixture();
  const user = await controller.signInWithProvider(secondFixture.supabase, 'google');
  assert.equal(user.id, 'user-1');
});

test('disabled X start fails before opening OAuth', async () => {
  const { calls, runtime, supabase } = createAuthFixture();
  const controller = createExtensionAuthController(runtime);
  await assert.rejects(
    controller.signInWithProvider(supabase, 'x'),
    (error) => error instanceof ExtensionAuthError && error.kind === 'unsupported-provider',
  );
  assert.deepEqual(calls.oauth, []);
});
