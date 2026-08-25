import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extension public detail queries and shares validated canonical route identity', async () => {
  const [dataSource, detailSource] = await Promise.all([
    readFile(new URL('./social-data.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(dataSource, /\bslug\b/);
  assert.match(dataSource, /\busername\b/);
  assert.match(dataSource, /route:/);
  assert.match(detailSource, /getPublicAnnotationPath\(annotation\.route, annotation\.id\)/);
  assert.doesNotMatch(detailSource, /getPublicUrl\(`\/a\/\$\{annotation\.id\}`\)/);
});
