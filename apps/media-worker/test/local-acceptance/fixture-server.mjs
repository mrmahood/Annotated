import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const audioPath = path.join(
  repositoryRoot,
  'apps',
  'media-worker',
  'test',
  'fixtures',
  'generated',
  'audio-only.webm',
);
const port = Number.parseInt(process.argv[2] ?? '4173', 10);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('The Local acceptance fixture port is invalid.');
}

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta property="og:title" content="Annotated C4 synthetic audio acceptance">
    <meta property="og:site_name" content="Annotated Local Acceptance">
    <meta name="podcast:show" content="Annotated Synthetic Fixtures">
    <meta name="author" content="Annotated engineering">
    <meta property="og:audio" content="http://localhost:${port}/audio-only.webm">
    <link rel="canonical" href="http://localhost:${port}/audio">
    <title>Annotated C4 synthetic audio acceptance</title>
    <style>
      body { color: #17202a; font: 18px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 48rem; padding: 0 1.5rem; }
      audio { display: block; margin: 2rem 0; width: 100%; }
      code { background: #eef2f5; padding: .15rem .35rem; }
    </style>
  </head>
  <body>
    <h1>Annotated C4 synthetic audio acceptance</h1>
    <p>This local four-second WebM/Opus tone is the approved synthetic fixture. Play it, choose a one-to-four-second range, and capture it through the Annotated side panel.</p>
    <audio controls preload="auto" src="/audio-only.webm"></audio>
    <p>Expected identity: <code>http://localhost:${port}/audio</code></p>
  </body>
</html>`;

function sendNotFound(response) {
  response.writeHead(404, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/audio') {
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (url.pathname !== '/audio-only.webm') {
    sendNotFound(response);
    return;
  }

  const facts = await stat(audioPath);
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '');
  let start = 0;
  let end = facts.size - 1;
  let status = 200;
  if (range) {
    start = Number.parseInt(range[1], 10);
    end = range[2] ? Math.min(Number.parseInt(range[2], 10), facts.size - 1) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= facts.size) {
      response.writeHead(416, { 'content-range': `bytes */${facts.size}` });
      response.end();
      return;
    }
    status = 206;
  }
  response.writeHead(status, {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': String(end - start + 1),
    'content-type': 'audio/webm',
    ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${facts.size}` } : {}),
  });
  createReadStream(audioPath, { start, end }).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Annotated Local audio fixture ready: http://localhost:${port}/audio`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
