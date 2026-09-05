import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getTrustedSignedPlaybackUrl,
  resolveHostedPlaybackSrc,
} from './hosted-playback-src.ts';

const SUPABASE = 'https://nkkunkwirvfwhmpwonqz.supabase.co';
const PLAYBACK = 'https://annotated-staging.example/api/media/playback/41000000-0000-4000-8000-000000000001?attempt=0';
const PLAYBACK_JSON = `${PLAYBACK}&delivery=json`;
const SIGNED = `${SUPABASE}/storage/v1/object/sign/annotation-media/owner/41000000-0000-4000-8000-000000000001/42000000-0000-4000-8000-000000000001/excerpt.mp4?token=signed-token-value`;

function mockResponse({
  status,
  headers = {},
  ok = status >= 200 && status < 300,
  cancel = async () => {},
  body,
} = {}) {
  return {
    status,
    ok,
    headers: new Headers(headers),
    body: { cancel },
    async json() {
      return body;
    },
  };
}

function isJsonDelivery(url) {
  return String(url).includes('delivery=json');
}

function jsonFailureThen(redirectImpl) {
  return async (url, init) => {
    if (isJsonDelivery(url)) {
      return mockResponse({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: { error: 'MEDIA_UNAVAILABLE' },
      });
    }
    return redirectImpl(url, init);
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

test('resolves JSON signedUrl after requesting delivery=json', async () => {
  const fetches = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      fetches.push({
        url: String(url),
        method: init?.method,
        redirect: init?.redirect,
        credentials: init?.credentials,
        accept: new Headers(init?.headers).get('accept'),
      });
      return mockResponse({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { signedUrl: SIGNED },
      });
    },
  });
  assert.equal(src, SIGNED);
  assert.deepEqual(fetches, [{
    url: PLAYBACK_JSON,
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    accept: 'application/json',
  }]);
});

test('rejects an untrusted JSON signedUrl and does not use it', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url) => {
      if (isJsonDelivery(url)) {
        return mockResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { signedUrl: 'https://evil.example/storage/v1/object/sign/annotation-media/excerpt.mp4?token=signed-token-value' },
        });
      }
      return mockResponse({ status: 404 });
    },
  });
  assert.equal(src, null);
});

test('falls back to a 307 Location when JSON delivery fails', async () => {
  const fetches = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      fetches.push({ url: String(url), method: init?.method, redirect: init?.redirect });
      if (isJsonDelivery(url)) {
        return mockResponse({
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return mockResponse({
        status: 307,
        headers: { Location: SIGNED },
      });
    },
  });
  assert.equal(src, SIGNED);
  assert.deepEqual(fetches, [
    { url: PLAYBACK_JSON, method: 'GET', redirect: 'manual' },
    { url: PLAYBACK, method: 'GET', redirect: 'manual' },
  ]);
});

test('falls back to 307 when the JSON request throws', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url) => {
      if (isJsonDelivery(url)) throw new TypeError('Failed to fetch');
      return mockResponse({
        status: 307,
        headers: { Location: SIGNED },
      });
    },
  });
  assert.equal(src, SIGNED);
});

test('resolves a 307 Location to the trusted signed URL', async () => {
  const fetches = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      fetches.push({ url: String(url), method: init?.method, redirect: init?.redirect });
      if (isJsonDelivery(url)) return mockResponse({ status: 503 });
      return mockResponse({
        status: 307,
        headers: { Location: SIGNED },
      });
    },
  });
  assert.equal(src, SIGNED);
  assert.deepEqual(fetches, [
    { url: PLAYBACK_JSON, method: 'GET', redirect: 'manual' },
    { url: PLAYBACK, method: 'GET', redirect: 'manual' },
  ]);
});

test('resolves a 302 Location the same way', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: jsonFailureThen(async () => mockResponse({
      status: 302,
      headers: { location: SIGNED },
    })),
  });
  assert.equal(src, SIGNED);
});

test('rejects a redirect with a missing Location', async () => {
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: jsonFailureThen(async (_url, init) => mockResponse({
      status: 307,
      headers: init?.method === 'HEAD' ? {} : {},
    })),
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
      fetchImpl: jsonFailureThen(async () => mockResponse({
        status: 307,
        headers: { Location: location },
      })),
    });
    assert.equal(src, null, location);
  }
});

test('uses the original playback URL when the route already returns playable media', async () => {
  let cancelled = 0;
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: jsonFailureThen(async () => mockResponse({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      cancel: async () => {
        cancelled += 1;
      },
    })),
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
  assert.deepEqual(fetches, ['manual', 'manual']);
});

test('falls back to HEAD when GET exposes a redirect status without Location', async () => {
  const methods = [];
  const src = await resolveHostedPlaybackSrc({
    playbackUrl: PLAYBACK,
    supabaseUrl: SUPABASE,
    fetchImpl: async (url, init) => {
      methods.push(init?.method);
      if (isJsonDelivery(url)) return mockResponse({ status: 503 });
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
  assert.deepEqual(methods, ['GET', 'GET', 'HEAD']);
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

test('resolver source requests JSON delivery and never downloads the mp4', async () => {
  const source = await readFile(new URL('./hosted-playback-src.ts', import.meta.url), 'utf8');
  assert.match(source, /searchParams\.set\('delivery', 'json'\)/);
  assert.match(source, /Accept:\s*'application\/json'/);
  assert.match(source, /credentials:\s*'omit'/);
  assert.match(source, /getTrustedSignedPlaybackUrl\(body\.signedUrl/);
  assert.doesNotMatch(source, /createObjectURL|arrayBuffer|blob\(/);
  assert.doesNotMatch(source, /host_permissions/);
});
