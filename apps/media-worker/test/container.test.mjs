import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workerRoot = fileURLToPath(new URL('..', import.meta.url));

test('container contract pins every binary source and runs as a numeric non-root user', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const toolchain = JSON.parse(await readFile(new URL('../container-toolchain.json', import.meta.url), 'utf8'));
  assert.match(dockerfile, /node@sha256:e484ae3f1e3c378021c967fd42254f343c302a9263e412280eac32bf5bca7008/u);
  assert.match(dockerfile, /postgres@sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3/u);
  assert.match(dockerfile, /ADD --checksum=sha256:3a379bb6ce47ca7c175999ed44a8f386cc89a9b9e450774b69d98a2c45c5189b/u);
  assert.match(dockerfile, /USER 10001:10001/u);
  assert.match(dockerfile, /\/usr\/share\/doc\/ffmpeg\/LICENSE\.txt/u);
  assert.match(dockerfile, /ANNOTATED_WORKER_TIMEOUT_MS=600000/u);
  assert.match(dockerfile, /ENTRYPOINT \["node", "\/opt\/annotated\/src\/entrypoint\/main\.mjs"\]/u);
  assert.doesNotMatch(dockerfile, /SERVICE_ROLE|DISPATCH_SECRET|DATABASE_URL/u);
  assert.equal(toolchain.runtime.one_media_per_worker_process, true);
  assert.equal(toolchain.runtime.uid, 10001);
  assert.equal(toolchain.ffmpeg.version, 'n8.1.2-44-g7c533d0f86-20260816');
  assert.equal(typeof workerRoot, 'string');
});

test('container context excludes tests and does not include environment or credential files', async () => {
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^test$/mu);
  assert.doesNotMatch(ignore, /!.*env/u);
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY --chown=10001:10001 src \.\/src/u);
  assert.doesNotMatch(dockerfile, /COPY \. /u);
});

test('Local container acceptance is explicit, read-only, bounded, and self-cleaning', async () => {
  const acceptance = await readFile(new URL('./container-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(acceptance, /ANNOTATED_C5_CONTAINER_LOCAL/u);
  assert.match(acceptance, /'--read-only'/u);
  assert.match(acceptance, /'\/tmp:rw,noexec,nosuid,nodev,size=64m'/u);
  assert.match(acceptance, /'--cap-drop', 'ALL'/u);
  assert.match(acceptance, /'--security-opt', 'no-new-privileges:true'/u);
  assert.match(acceptance, /'--pids-limit', '128'/u);
  assert.match(acceptance, /'--memory', '512m'/u);
  assert.match(acceptance, /'--cpus', '2'/u);
  assert.match(acceptance, /'--env-file', environmentPath/u);
  assert.match(acceptance, /delete from public\.annotations/u);
  assert.match(acceptance, /await rm\(temporaryDirectory, \{ recursive: true, force: true \}\)/u);
});
