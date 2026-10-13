import assert from 'node:assert/strict';
import test from 'node:test';
import { isTweetStatusUrl, parseTweetStatusUrl } from './tweet-status.ts';

test('status URLs on x.com and twitter.com canonicalize to the post', () => {
  assert.deepEqual(
    parseTweetStatusUrl('https://twitter.com/SomeUser/status/1234567890123456789?s=20'),
    {
      statusUrl: 'https://x.com/someuser/status/1234567890123456789',
      tweetId: '1234567890123456789',
      authorHandle: 'someuser',
    },
  );
  assert.deepEqual(
    parseTweetStatusUrl('https://www.x.com/reader_one/status/42/'),
    {
      statusUrl: 'https://x.com/reader_one/status/42',
      tweetId: '42',
      authorHandle: 'reader_one',
    },
  );
  assert.equal(isTweetStatusUrl('https://mobile.twitter.com/abc/status/99'), true);
});

test('non-status pages and malformed post URLs are rejected', () => {
  assert.equal(parseTweetStatusUrl('https://x.com/home'), null);
  assert.equal(parseTweetStatusUrl('https://x.com/i/status/123'), null);
  assert.equal(parseTweetStatusUrl('https://example.com/reader/status/123'), null);
  assert.equal(parseTweetStatusUrl('https://x.com/has space/status/123'), null);
  assert.equal(parseTweetStatusUrl('http://x.com/user/status/abc'), null);
  assert.equal(isTweetStatusUrl('https://twitter.com/user'), false);
});
