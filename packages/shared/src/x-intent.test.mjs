import assert from 'node:assert/strict';
import test from 'node:test';
import { buildXPostIntentUrl, X_INTENT_TAKE_LIMIT, X_POST_INTENT_ORIGIN } from './x-intent.ts';

test('the X web intent carries the take and the permalink', () => {
  const href = buildXPostIntentUrl({
    take: '  A short take\non the passage.  ',
    permalink: 'https://annotated.example/reader/note',
  });
  const url = new URL(href ?? '');
  assert.equal(url.origin + url.pathname, X_POST_INTENT_ORIGIN);
  assert.equal(url.searchParams.get('text'), 'A short take on the passage.');
  assert.equal(url.searchParams.get('url'), 'https://annotated.example/reader/note');
});

test('a long take is bounded and an empty take still shares the permalink', () => {
  const longTake = buildXPostIntentUrl({
    take: 'word '.repeat(200),
    permalink: 'https://annotated.example/a/1',
  });
  const text = new URL(longTake ?? '').searchParams.get('text') ?? '';
  assert.ok(text.length > 0 && text.length <= X_INTENT_TAKE_LIMIT);
  assert.equal(text.endsWith(' '), false);

  const permalinkOnly = buildXPostIntentUrl({
    take: '   ',
    permalink: 'https://annotated.example/a/1',
  });
  const url = new URL(permalinkOnly ?? '');
  assert.equal(url.searchParams.get('text'), null);
  assert.equal(url.searchParams.get('url'), 'https://annotated.example/a/1');
});

test('the intent refuses a non-http permalink', () => {
  assert.equal(buildXPostIntentUrl({ take: 'Take', permalink: 'javascript:alert(1)' }), null);
  assert.equal(buildXPostIntentUrl({ take: 'Take', permalink: 'not a url' }), null);
});

test('commentary markup and the logo shortcode stay out of the intent text', () => {
  const href = buildXPostIntentUrl({
    take: '|* **Houthis** seize a port\u0000 and _hold_ it. [source](https://example.com/story)',
    permalink: 'https://annotated.example/mattmahood26/houthis',
  });
  const url = new URL(href ?? '');
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), 'Houthis seize a port and hold it. source');
  assert.equal(url.searchParams.get('text')?.startsWith('|*'), false);
});
