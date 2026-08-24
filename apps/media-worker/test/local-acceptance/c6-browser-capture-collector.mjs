import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const port = Number(process.argv[2]);
const token = process.argv[3];
const evidenceRoot = path.resolve(process.argv[4] ?? '');
const manifestPath = path.join(evidenceRoot, 'captures.json');
const allowedVariants = new Set([
  'vp9-default', 'loopback-off', 'timeslice-none',
  'vp8-default', 'vp9-explicit', 'vp8-explicit',
]);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 ||
    !/^[a-f0-9]{32}$/u.test(token ?? '') || !path.isAbsolute(evidenceRoot)) {
  throw new Error('The C6 Local collector arguments are invalid.');
}
mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
if (!existsSync(manifestPath)) writeFileSync(manifestPath, '[]\n', { encoding: 'utf8', mode: 0o600 });

function manifest() {
  const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(value)) throw new Error('The C6 collector manifest is malformed.');
  return value;
}

function acceptanceEligible(row) {
  return row?.capture_metadata?.timing?.requested_duration_ms === 90_000;
}

function decodeEvidence(value) {
  if (!value || value.length > 16_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('The bounded C6 evidence header is invalid.');
  }
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function send(response, status, body) {
  response.writeHead(status, {
    'access-control-allow-headers': 'content-type,x-annotated-c6-evidence',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const expectedPath = `/capture/${token}`;
  if (request.method === 'OPTIONS' && url.pathname === expectedPath) {
    send(response, 204, {});
    return;
  }
  if (request.method === 'GET' && url.pathname === `/status/${token}`) {
    const rows = manifest();
    const counts = Object.fromEntries([...allowedVariants].map((variant) => [
      variant, rows.filter((row) => row.variant === variant && acceptanceEligible(row)).length,
    ]));
    send(response, 200, {
      gate: 'c6_browser_capture_collector', capture_count: rows.length,
      acceptance_capture_count: rows.filter(acceptanceEligible).length, counts,
    });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== expectedPath) {
    send(response, 404, { error: 'not_found' });
    return;
  }

  let evidence;
  try {
    evidence = decodeEvidence(request.headers['x-annotated-c6-evidence']);
    if (!allowedVariants.has(evidence?.recorder?.variant) ||
        typeof evidence?.source?.pageUrl !== 'string' ||
        typeof evidence?.mime_type !== 'string' ||
        !evidence.mime_type.toLowerCase().startsWith('video/webm') ||
        !Number.isSafeInteger(evidence?.byte_size) || evidence.byte_size < 1) {
      throw new Error('The C6 capture evidence contract is invalid.');
    }
  } catch (error) {
    send(response, 400, { error: 'evidence_invalid', message: error instanceof Error ? error.message : 'Invalid evidence.' });
    request.resume();
    return;
  }

  const rows = manifest();
  const variant = evidence.recorder.variant;
  const captureOrdinal = rows.filter((row) => row.variant === variant).length + 1;
  const eligible = evidence.capture_metadata?.timing?.requested_duration_ms === 90_000;
  const sample = eligible
    ? rows.filter((row) => row.variant === variant && acceptanceEligible(row)).length + 1
    : null;
  if (eligible && sample > 3) {
    send(response, 409, { error: 'variant_complete' });
    request.resume();
    return;
  }
  const baseName = `${variant}-capture-${captureOrdinal}`;
  const temporaryPath = path.join(evidenceRoot, `.${baseName}-${randomUUID()}.partial`);
  const finalPath = path.join(evidenceRoot, `${baseName}.webm`);
  const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let byteSize = 0;
  let rejected = false;
  request.on('data', (chunk) => {
    byteSize += chunk.length;
    if (byteSize > 250_000_000) {
      rejected = true;
      request.destroy(new Error('The C6 capture exceeded its bounded byte ceiling.'));
      return;
    }
    hash.update(chunk);
  });
  request.pipe(output);
  output.on('finish', () => {
    if (rejected) return;
    if (byteSize !== evidence.byte_size) {
      rmSync(temporaryPath, { force: true });
      send(response, 400, { error: 'byte_size_mismatch' });
      return;
    }
    renameSync(temporaryPath, finalPath);
    const row = {
      variant, sample, capture_ordinal: captureOrdinal, acceptance_eligible: eligible,
      exclusion_reason: eligible ? null : 'requested_duration_not_exactly_90000_ms',
      source_kind: evidence.source.kind,
      source_page_url: evidence.source.pageUrl,
      mime_type: evidence.mime_type,
      byte_size: byteSize,
      checksum_sha256: hash.digest('hex'),
      capture_metadata: evidence.capture_metadata,
      recorder: evidence.recorder,
      artifact_path: finalPath,
    };
    rows.push(row);
    writeFileSync(manifestPath, `${JSON.stringify(rows, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    send(response, 201, {
      gate: 'c6_browser_capture_saved', variant, sample, capture_ordinal: captureOrdinal,
      acceptance_eligible: eligible, byte_size: byteSize,
    });
  });
  output.on('error', () => {
    rmSync(temporaryPath, { force: true });
    if (!response.headersSent) send(response, 500, { error: 'collector_write_failed' });
  });
});

server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
