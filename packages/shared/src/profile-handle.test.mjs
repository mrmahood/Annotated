import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_HANDLE_AUTH_ERROR,
  PROFILE_HANDLE_FORMAT_ERROR,
  PROFILE_HANDLE_RESERVED_ERROR,
  PROFILE_HANDLE_SAVE_ERROR,
  PROFILE_HANDLE_UNAVAILABLE_ERROR,
  RESERVED_PROFILE_HANDLES,
  isReservedProfileHandle,
  mapSetProfileHandleError,
  normalizeProfileHandle,
  setProfileHandle,
  validateProfileHandle,
} from './profile-handle.ts';

test('normalizes handles by trimming, stripping @, and lowercasing', () => {
  assert.equal(normalizeProfileHandle('  @Matt_One  '), 'matt_one');
  assert.equal(normalizeProfileHandle('Reader-One'), 'reader-one');
  assert.equal(normalizeProfileHandle('@@jason'), 'jason');
  assert.equal(normalizeProfileHandle(12), '');
  assert.equal(normalizeProfileHandle(null), '');
});

test('validates the 3-30 lowercase a-z0-9_- contract', () => {
  for (const value of ['abc', 'reader-one', 'reader_1', 'a'.repeat(30)]) {
    assert.deepEqual(validateProfileHandle(value), { ok: true, handle: value });
  }
  assert.deepEqual(validateProfileHandle('  @Reader_1 '), {
    ok: true,
    handle: 'reader_1',
  });
  for (const value of ['', '  ', 'ab', 'a'.repeat(31), 'Reader.One', 'reader one', 'r@der']) {
    assert.deepEqual(validateProfileHandle(value), {
      ok: false,
      error: PROFILE_HANDLE_FORMAT_ERROR,
    }, value);
  }
});

test('rejects every reserved application root before the RPC', () => {
  assert.deepEqual([...RESERVED_PROFILE_HANDLES], [
    'api',
    'auth',
    '_next',
    'ops',
    'me',
    'trending',
    'who-to-follow',
    'privacy',
    'terms',
    'legal',
  ]);
  for (const handle of RESERVED_PROFILE_HANDLES) {
    assert.equal(isReservedProfileHandle(handle), true, handle);
    assert.deepEqual(validateProfileHandle(` @${handle.toUpperCase()} `), {
      ok: false,
      error: PROFILE_HANDLE_RESERVED_ERROR,
    }, handle);
  }
  assert.equal(isReservedProfileHandle('reader-one'), false);
});

test('maps RPC failures to bounded friendly errors', () => {
  assert.equal(
    mapSetProfileHandleError({
      code: '42501',
      message: 'Authentication is required to change a creator handle.',
    }),
    PROFILE_HANDLE_AUTH_ERROR,
  );
  assert.equal(
    mapSetProfileHandleError({
      code: '22023',
      message: 'That creator handle is reserved for application routing.',
    }),
    PROFILE_HANDLE_RESERVED_ERROR,
  );
  assert.equal(
    mapSetProfileHandleError({
      code: '23505',
      message: 'That creator handle is unavailable.',
    }),
    PROFILE_HANDLE_UNAVAILABLE_ERROR,
  );
  assert.equal(
    mapSetProfileHandleError({
      code: '22023',
      message: 'A handle must be 3-30 lowercase letters, numbers, underscores, or hyphens.',
    }),
    PROFILE_HANDLE_FORMAT_ERROR,
  );
  assert.equal(mapSetProfileHandleError({ message: 'boom' }), PROFILE_HANDLE_SAVE_ERROR);
});

test('setProfileHandle validates locally then calls set_profile_handle', async () => {
  const calls = [];
  const client = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return { data: args.p_handle, error: null };
    },
  };

  assert.deepEqual(await setProfileHandle(client, 'ab'), {
    ok: false,
    error: PROFILE_HANDLE_FORMAT_ERROR,
  });
  assert.deepEqual(await setProfileHandle(client, 'me'), {
    ok: false,
    error: PROFILE_HANDLE_RESERVED_ERROR,
  });
  assert.equal(calls.length, 0);

  assert.deepEqual(await setProfileHandle(client, ' @Reader_One '), {
    ok: true,
    handle: 'reader_one',
  });
  assert.deepEqual(calls, [{
    fn: 'set_profile_handle',
    args: { p_handle: 'reader_one' },
  }]);
});

test('setProfileHandle maps RPC errors and never invents a handle', async () => {
  const unavailable = {
    async rpc() {
      return {
        data: null,
        error: { code: '23505', message: 'That creator handle is unavailable.' },
      };
    },
  };
  assert.deepEqual(await setProfileHandle(unavailable, 'taken-name'), {
    ok: false,
    error: PROFILE_HANDLE_UNAVAILABLE_ERROR,
  });

  const thrown = {
    async rpc() {
      throw new Error('Authentication is required to change a creator handle.');
    },
  };
  assert.deepEqual(await setProfileHandle(thrown, 'reader-one'), {
    ok: false,
    error: PROFILE_HANDLE_AUTH_ERROR,
  });
});
