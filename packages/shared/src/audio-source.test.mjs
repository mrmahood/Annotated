import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioSourceUrlError,
  getAudioSourceIdentity,
  normalizeAudioSourceUrl,
} from './audio-source.ts';

test('normalizes podcast pages without playback location or tracking', () => {
  assert.equal(
    normalizeAudioSourceUrl('HTTPS://EXAMPLE.COM:443/episodes/42/?t=90&utm_source=feed&b=2&a=1#player'),
    'https://example.com/episodes/42?a=1&b=2',
  );
  assert.equal(
    normalizeAudioSourceUrl('https://example.com/episode?id=42&position=735&utm_campaign=x'),
    'https://example.com/episode?id=42',
  );
});

test('preserves meaningful episode parameters and stable identity', () => {
  const once = normalizeAudioSourceUrl('https://example.com/listen?episode=42&show=annotated&start=season-two');
  assert.equal(once, 'https://example.com/listen?episode=42&show=annotated&start=season-two');
  assert.equal(normalizeAudioSourceUrl(once), once);
});

test('uses only an appropriate same-origin HTTP canonical', () => {
  assert.deepEqual(
    getAudioSourceIdentity('https://example.com/player?episode=42&t=30', '/podcast/episode-42?utm_source=player'),
    {
      normalizedUrl: 'https://example.com/podcast/episode-42',
      canonicalUrl: 'https://example.com/podcast/episode-42',
      hostname: 'example.com',
    },
  );
  assert.equal(
    getAudioSourceIdentity('https://example.com/episode/42', 'https://other.test/').normalizedUrl,
    'https://example.com/episode/42',
  );
});

test('rejects non-web schemes and credential-bearing URLs', () => {
  assert.throws(() => normalizeAudioSourceUrl('javascript:alert(1)'), AudioSourceUrlError);
  assert.throws(() => normalizeAudioSourceUrl('file:///episode.mp3'), AudioSourceUrlError);
  assert.throws(() => normalizeAudioSourceUrl('https://user:pass@example.com/episode'), AudioSourceUrlError);
});
