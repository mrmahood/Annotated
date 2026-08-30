import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeAuthSessionStorageValue } from './supabase.ts';

test('session storage removes provider credentials while preserving the Supabase session', () => {
  const stored = sanitizeAuthSessionStorageValue(JSON.stringify({
    access_token: 'supabase-access-token',
    refresh_token: 'supabase-refresh-token',
    expires_at: 1234567890,
    provider_token: 'x-provider-token',
    provider_refresh_token: 'x-provider-refresh-token',
    user: { id: 'user-1', identities: [{ provider: 'x' }] },
  }));

  assert.notEqual(stored, null);
  assert.deepEqual(JSON.parse(stored), {
    access_token: 'supabase-access-token',
    refresh_token: 'supabase-refresh-token',
    expires_at: 1234567890,
    user: { id: 'user-1', identities: [{ provider: 'x' }] },
  });
  assert.doesNotMatch(stored, /x-provider-token|x-provider-refresh-token/);
});

test('session storage fails closed for malformed or non-object values', () => {
  assert.equal(sanitizeAuthSessionStorageValue('not-json'), null);
  assert.equal(sanitizeAuthSessionStorageValue('null'), null);
  assert.equal(sanitizeAuthSessionStorageValue('[]'), null);
  assert.equal(sanitizeAuthSessionStorageValue('"session"'), null);
});

test('extension session configuration keeps restoration and callback detection bounded', () => {
  const source = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8');
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /autoRefreshToken:\s*true/);
  assert.match(source, /detectSessionInUrl:\s*false/);
  assert.match(source, /flowType:\s*['"]implicit['"]/);
  assert.match(source, /delete session\.provider_token/);
  assert.match(source, /delete session\.provider_refresh_token/);
});
