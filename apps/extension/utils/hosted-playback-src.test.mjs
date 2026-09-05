import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getTrustedSignedPlaybackUrl,
  resolveHostedPlaybackSrc,
} from './hosted-playback-src.ts';

const SUPABASE = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const PLAYBACK = 'https://annotated-staging.example/api/media/playback/41000000-0000-4000-8000-000000000001?attempt=0';
const SIGNED = `${SUPABASE}/storage/v1/object/sign/annotation-media/owner/41000000-0000-4000-8000-000000000001/42000000-0000-4000-8000-000000000001/excerpt.mp4?token=signed-token-value`;

function mockResponse({
  status,
  headers = {},
  ok = status >= 200 && status < 300,
  cancel = async () => {},
} = {}) {
  return {
    status,
    ok,
    headers: new Headers(headers),
    body: { cancel },
  };
}

test('accepts an HTTPS signed Location on the configured Supabase origin', () => {
  assert.equal(getTrustedSignedPlaybackUrl(SIGNED, SUPABASE), SIGNED);
  assert.equal(
    getTrustedSignedPlaybackUrl(
      'http://localhost:54321/storage/v1/object/sign/annotation-media/owner/excerpt.mp4?token=local-token',
      'http://localhost:54321',
    ),
    'http://localhost:54321/storage/v1/object/sign/annotation-media/owner/excerpt.mp4?token=local-token',
  );
});

test('rejects non-https, wrong-host, and unsigned Location values', () => {
  const rejected = [
    null,
    '',
    'not-a-url',
    `http://nkkunkwirvfwhmpwonqz.supabase.co/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value`,
    `https://evil.example/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value`,
    `${SUPABASE}/storage/v1/object/sign/annotation-media-raw/excerpt.mp4?token=signed-token-value`,
    `${SUPABASE}/storage/v1/object/public/annotation-media/excerpt.mp4?token=signed-token-value`,
    `${SUPABASE}/storage/v1/object/sign/annotation-media/excerpt.mp4`,
    `https://user:pass@nkkunkwirvfwhmpwonqz.supabase.co/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value`,
  ];
  for (const value of rejected) {
    assert.equal(getTrustedSignedPlaybackUrl(value, SUPABASE), null, String(value));
  }
});

test('resolves a 307 Location to the trusted signed URL', async () => {
  const fetches = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      fetches.push({ url, method: init?.method, redirect: init?.redirect });
      return mockResponse({
        status: 307,
        headers: { Location: SIGNED },
      });
    },
  });
  assert.equal(src, SIGNED);
  assert.deepEqual(fetches, [{ url: PLAYBACK, method: 'GET', redirect: 'manual' }]);
});

test('resolves a 302 Location the same way', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async () => mockResponse({
      status: 302,
      headers: { location: SIGNED },
    }),
  });
  assert.equal(src, SIGNED);
});

test('rejects a redirect with a missing Location', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (_url, init) => mockResponse({
      status: 307,
      headers: init?.method === 'HEAD' ? {} : {},
    }),
  });
  assert.equal(src, null);
});

test('rejects a 307 Location that is not HTTPS on the expected host', async () => {
  for (const location of [
    'http://nkkunkwirvfwhmpwonqz.supabase.co/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value',
    'https://evil.example/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value',
  ]) {
    const src = await resolveHostedPlaybackSrc({
      playbackUrl: PLAYBACK,
      supabaseUrl: SUPABASE,
      fetchImpl: async () => mockResponse({
        status: 307,
        headers: { Location: location },
      }),
    });
    assert.equal(src, null, location);
  }
});

test('uses the original playback URL when the route already returns playable media', async () => {
  let cancelled = 0;
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async () => mockResponse({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      cancel: async () => {
        cancelled += 1;
      },
    }),
  });
  assert.equal(src, PLAYBACK);
  assert.equal(cancelled, 1);
});

test('does not treat an HTML 200 as playable and does not follow redirects automatically', async () => {
  const fetches = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      fetches.push(init?.redirect);
      return mockResponse({
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(src, null);
  assert.deepEqual(fetches, ['manual']);
});

test('falls back to HEAD when GET exposes a redirect status without Location', async () => {
  const methods = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (_url, init) => {
      methods.push(init?.method);
      if (init?.method === 'HEAD') {
        return mockResponse({
          status: 307,
          headers: { Location: SIGNED },
        });
      }
      return mockResponse({ status: 307 });
    },
  });
  assert.equal(src, SIGNED);
  assert.deepEqual(methods, ['GET', 'HEAD']);
});

test('HostedExcerptPlayer resolves a signed src before attaching media', async () => {
  const source = await readFile(
    new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url),
    'utf8',
  );
  const player = source.slice(
    source.indexOf('function HostedExcerptPlayer'),
    source.indexOf('function ExcerptTranscript'),
  );

  assert.match(player, /resolveHostedPlaybackSrc/);
  assert.match(player, /WXT_SUPABASE_URL/);
  assert.match(player, /redirect: 'manual'|resolveHostedPlaybackSrc\(\{/);
  assert.match(player, /src=\{mediaSrc\}/);
  assert.match(player, /controlsList="nodownload"/);
  assert.match(player, /setAttempt\(1\)/);
  assert.doesNotMatch(player, /src=\{playbackUrl\}/);
  assert.doesNotMatch(player, /createObjectURL|arrayBuffer|blob\(/);
  assert.doesNotMatch(player, /console\.(?:log|info|debug|warn)/);
  assert.doesNotMatch(player, /host_permissions/);
});
