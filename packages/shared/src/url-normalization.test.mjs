import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArticleUrlNormalizationError,
  normalizeArticleUrl,
} from './url-normalization.ts';

test('accepts only HTTP and HTTPS article URLs', () => {
  assert.equal(normalizeArticleUrl('https://example.com/story'), 'https://example.com/story');
  assert.equal(normalizeArticleUrl('http://example.com/story'), 'http://example.com/story');
  assert.throws(() => normalizeArticleUrl('javascript:alert(1)'), ArticleUrlNormalizationError);
  assert.throws(() => normalizeArticleUrl('not a URL'), ArticleUrlNormalizationError);
});

test('normalizes hosts, fragments, default ports, and non-root trailing slashes', () => {
  assert.equal(
    normalizeArticleUrl('HTTPS://EXAMPLE.COM:443/news/story/#section'),
    'https://example.com/news/story',
  );
  assert.equal(normalizeArticleUrl('http://EXAMPLE.COM:80/'), 'http://example.com/');
});

test('removes common tracking parameters case-insensitively', () => {
  assert.equal(
    normalizeArticleUrl(
      'https://example.com/story?utm_source=newsletter&GCLID=abc&fbclid=def&id=42',
    ),
    'https://example.com/story?id=42',
  );
});

test('preserves and sorts all remaining query parameters', () => {
  assert.equal(
    normalizeArticleUrl('https://example.com/story?z=last&topic=science&a=first&topic=policy'),
    'https://example.com/story?a=first&topic=science&topic=policy&z=last',
  );
});

test('returns the same stable value when normalization is repeated', () => {
  const once = normalizeArticleUrl('https://Example.com/story/?b=2&utm_term=x&a=1#quote');
  assert.equal(normalizeArticleUrl(once), once);
});
