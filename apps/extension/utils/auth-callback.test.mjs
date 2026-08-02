import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAuthCancellation,
  isExpectedAuthCallback,
  parseAuthCallbackTokens,
} from './auth-callback.ts';

const expectedRedirect =
  'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth/callback';
const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature';
const refreshToken = 'refresh-token-value-1234';

test('accepts only the expected chromiumapp.org callback origin and path', () => {
  assert.equal(isExpectedAuthCallback(`${expectedRedirect}#access_token=x`, expectedRedirect), true);
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
