import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcilePlayerSelection,
  validatePlayerDiscovery,
} from './player-discovery.ts';

const pageUrl = 'https://www.youtube.com/watch?v=abc123&utm_source=test';
const candidate = (ordinal) => ({
  identity: `video:${ordinal}:1234abcd`,
  kind: 'video',
  label: `Video player ${ordinal}`,
  status: ordinal === 1 ? 'playing' : 'ready',
  currentTimeMs: 1_000,
  durationMs: 120_000,
});

test('accepts one to five ordered candidates and never auto-selects several', () => {
  for (const count of [1, 2, 5]) {
    const discovery = validatePlayerDiscovery(pageUrl, 'video', {
      pageUrl: 'https://www.youtube.com/watch?utm_source=test&v=abc123#ignored',
      mode: 'video',
      overflow: false,
      candidates: Array.from({ length: count }, (_, index) => candidate(index + 1)),
    });
    assert.equal(discovery.status, 'ready');
    assert.equal(discovery.candidates.length, count);
    assert.equal(reconcilePlayerSelection(discovery, null), count === 1 ? candidate(1).identity : null);
  }
});

test('sixth candidate produces bounded overflow with no candidate details', () => {
  assert.deepEqual(validatePlayerDiscovery(pageUrl, 'video', {
    pageUrl,
    mode: 'video',
    overflow: true,
    candidates: Array.from({ length: 6 }, (_, index) => candidate(index + 1)),
  }), { status: 'overflow', candidates: [] });
});

test('preserves only an identity that remains in the current page generation', () => {
  const discovery = validatePlayerDiscovery(pageUrl, 'video', {
    pageUrl,
    mode: 'video',
    overflow: false,
    candidates: [candidate(1), candidate(2)],
  });
  assert.equal(reconcilePlayerSelection(discovery, candidate(2).identity), candidate(2).identity);
  assert.equal(reconcilePlayerSelection(discovery, 'video:2:ffffffff'), null);
});

test('rejects stale pages, wrong-mode kinds, duplicate identities, and unbounded labels', () => {
  assert.deepEqual(validatePlayerDiscovery('https://example.test/new', 'audio', {
    pageUrl: 'https://example.test/old', mode: 'audio', candidates: [],
  }), { status: 'none', candidates: [] });
  const result = validatePlayerDiscovery('https://example.test/episode', 'audio', {
    pageUrl: 'https://example.test/episode',
    mode: 'audio',
    candidates: [
      { ...candidate(1), kind: 'video' },
      { ...candidate(1), identity: 'audio:1:1234abcd', kind: 'audio', label: 'x'.repeat(121) },
      { ...candidate(1), identity: 'audio:2:1234abcd', kind: 'audio', label: 'Episode' },
      { ...candidate(1), identity: 'audio:2:1234abcd', kind: 'audio', label: 'Duplicate' },
    ],
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.candidates.map((entry) => entry.identity), ['audio:2:1234abcd']);
});

test('candidate contract contains no media source URLs or raw DOM', () => {
  const discovery = validatePlayerDiscovery(pageUrl, 'video', {
    pageUrl, mode: 'video', overflow: false, candidates: [candidate(1)],
  });
  assert.equal(discovery.status, 'ready');
  assert.deepEqual(Object.keys(discovery.candidates[0]).sort(), [
    'currentTimeMs', 'durationMs', 'identity', 'kind', 'label', 'status',
  ]);
});
