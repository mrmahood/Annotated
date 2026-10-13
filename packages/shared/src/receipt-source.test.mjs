import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeReceiptSources,
  parseApprovedReceiptSource,
  parsePublicReceiptSource,
} from './receipt-source.ts';

test('approved receipt sources must be labeled AI-suggested', () => {
  assert.deepEqual(parseApprovedReceiptSource({
    url: 'https://www.congress.gov/bill/118th-congress/house-bill/1',
    title: 'House bill 1',
    publisher: 'Congress.gov',
    origin: 'ai-suggested',
  }), {
    url: 'https://www.congress.gov/bill/118th-congress/house-bill/1',
    title: 'House bill 1',
    publisher: 'Congress.gov',
    origin: 'ai-suggested',
  });
  assert.equal(parseApprovedReceiptSource({
    url: 'https://example.com/doc',
    title: 'Doc',
    publisher: null,
    origin: 'user',
  }), null);
  assert.equal(parseApprovedReceiptSource({
    url: 'http://example.com/doc',
    title: 'Doc',
    origin: 'ai-suggested',
  }), null);
});

test('public sources keep the AI label and still accept an unlabeled approved source', () => {
  assert.equal(parsePublicReceiptSource({
    url: 'https://example.com/primary',
    title: 'Primary',
    origin: 'ai-suggested',
  })?.origin, 'ai-suggested');
  assert.equal(parsePublicReceiptSource({
    url: 'https://example.com/primary',
    title: 'Primary',
  })?.origin, 'approved');
});

test('merged sources prefer the first copy and stop at three', () => {
  const merged = mergeReceiptSources([
    [
      { url: 'https://a.example/1', title: 'One', origin: 'ai-suggested' },
      { url: 'https://a.example/1#cite', title: 'Duplicate', origin: 'ai-suggested' },
    ],
    [
      { url: 'https://b.example/2', title: 'Two' },
      { url: 'https://c.example/3', title: 'Three' },
      { url: 'https://d.example/4', title: 'Four' },
    ],
  ]);
  assert.deepEqual(merged.map((source) => source.title), ['One', 'Two', 'Three']);
  assert.equal(merged[0]?.origin, 'ai-suggested');
  assert.equal(merged[1]?.origin, 'approved');
});
