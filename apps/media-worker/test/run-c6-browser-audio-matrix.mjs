import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const acceptanceRoot = path.join(os.tmpdir(), `Annotated-c4-owner-${createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)}`);
const acceptanceStatePath = path.join(acceptanceRoot, 'state.json');
const matrixRoot = path.join(os.tmpdir(), 'Annotated-c6-browser-audio-matrix');
const matrixStatePath = path.join(matrixRoot, 'state.json');
const extensionEnvironmentPath = path.join(repositoryRoot, 'apps', 'extension', '.env.local');
const acceptanceScript = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'local-acceptance', 'acceptance.mjs');
const collectorScript = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'local-acceptance', 'c6-browser-capture-collector.mjs');
const variants = {
  'vp9-default': { loopback: true, timeslice: '1000', codec: 'vp9', audioBps: null, videoBps: null },
  'loopback-off': { loopback: false, timeslice: '1000', codec: 'vp9', audioBps: null, videoBps: null },
  'timeslice-none': { loopback: true, timeslice: 'none', codec: 'vp9', audioBps: null, videoBps: null },
  'vp8-default': { loopback: true, timeslice: '1000', codec: 'vp8', audioBps: null, videoBps: null },
  'vp9-explicit': { loopback: true, timeslice: '1000', codec: 'vp9', audioBps: 128_000, videoBps: 2_500_000 },
  'vp8-explicit': { loopback: true, timeslice: '1000', codec: 'vp8', audioBps: 128_000, videoBps: 2_500_000 },
};

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}
function pnpm(args, label) {
  return run(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], label);
}
function state() {
  if (!existsSync(matrixStatePath)) throw new Error('No C6 Local browser matrix session exists.');
  return JSON.parse(readFileSync(matrixStatePath, 'utf8'));
}
function writeState(value) {
  writeFileSync(matrixStatePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
async function waitFor(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Collector is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The C6 Local collector did not become ready.');
}
async function cdpCommand(webSocketUrl, method, params = {}) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Chrome debugging command ${method} timed out.`));
    }, 10_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(`Chrome debugging command ${method} failed.`));
      else resolve(message.result);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Chrome debugging connection failed.'));
    });
  });
}

async function positionPlayer(source, seconds) {
  const sourceIds = { source1: 'aqz-KE-bpKQ', source2: 'R6MlUcmOul8' };
  const videoId = sourceIds[source];
  if (!videoId || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 600) {
    throw new Error('Use position source1|source2 <whole-seconds>.');
  }
  const acceptance = JSON.parse(readFileSync(acceptanceStatePath, 'utf8'));
  const targetsResponse = await fetch(`http://127.0.0.1:${acceptance.debugPort}/json/list`);
  const targets = await targetsResponse.json();
  const target = targets.find((candidate) => candidate.type === 'page' &&
    new URL(candidate.url).searchParams.get('v') === videoId);
  if (!target?.webSocketDebuggerUrl) throw new Error(`The ${source} YouTube tab is unavailable.`);
  const expression = `(() => {
    const player = document.querySelector('video');
    if (!(player instanceof HTMLVideoElement) || !Number.isFinite(player.duration)) return null;
    player.pause();
    player.currentTime = ${seconds};
    return Math.round(player.currentTime * 1000);
  })()`;
  const result = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression, returnByValue: true,
  });
  const currentMs = result?.result?.value;
  if (currentMs !== seconds * 1_000) throw new Error(`The ${source} player did not hold the exact requested position.`);
  const version = await (await fetch(`http://127.0.0.1:${acceptance.debugPort}/json/version`)).json();
  await cdpCommand(version.webSocketDebuggerUrl, 'Target.activateTarget', { targetId: target.id });
  console.log(JSON.stringify({ gate: 'c6_browser_exact_player_position', source, position_ms: currentMs, paused: true }));
}
function configureVariant(name, currentState) {
  const variant = variants[name];
  if (!variant) throw new Error(`Unknown variant. Use: ${Object.keys(variants).join(', ')}`);
  const existing = readFileSync(extensionEnvironmentPath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('WXT_C6_CAPTURE_') && line !== '');
  existing.push(
    `WXT_C6_CAPTURE_COLLECTOR_URL=http://127.0.0.1:${currentState.port}/capture/${currentState.token}`,
    `WXT_C6_CAPTURE_VARIANT=${name}`,
    `WXT_C6_CAPTURE_LOOPBACK=${variant.loopback}`,
    `WXT_C6_CAPTURE_TIMESLICE=${variant.timeslice}`,
    `WXT_C6_CAPTURE_VIDEO_CODEC=${variant.codec}`,
    `WXT_C6_CAPTURE_AUDIO_BPS=${variant.audioBps ?? ''}`,
    `WXT_C6_CAPTURE_VIDEO_BPS=${variant.videoBps ?? ''}`,
    '',
  );
  writeFileSync(extensionEnvironmentPath, existing.join('\n'), { encoding: 'utf8', mode: 0o600 });
  pnpm(['--dir', 'apps/extension', 'run', 'build'], `C6 ${name} extension build`);
  currentState.currentVariant = name;
  writeState(currentState);
}

async function prepare() {
  if (existsSync(matrixStatePath) || existsSync(acceptanceStatePath)) {
    throw new Error('A Local acceptance or matrix session already exists; do not overwrite it.');
  }
  run(process.execPath, [acceptanceScript, 'prepare'], 'C4 Local acceptance preparation');
  mkdirSync(matrixRoot, { recursive: false, mode: 0o700 });
  const port = await freePort();
  const token = randomBytes(16).toString('hex');
  const logPath = path.join(matrixRoot, 'collector.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [collectorScript, String(port), token, matrixRoot], {
    cwd: repositoryRoot, detached: true, stdio: ['ignore', log, log], windowsHide: true,
  });
  child.unref();
  closeSync(log);
  const nextState = { version: 1, port, token, collectorPid: child.pid, currentVariant: null };
  writeState(nextState);
  await waitFor(`http://127.0.0.1:${port}/status/${token}`);
  configureVariant('vp9-default', nextState);
  console.log(JSON.stringify({
    gate: 'c6_browser_audio_matrix_prepare', local_only: true,
    evidence_root: matrixRoot,
    current_variant: 'vp9-default',
    extension_unpacked_path: path.join(repositoryRoot, 'apps', 'extension', '.output', 'chrome-mv3'),
    next: 'Load the unpacked extension in the dedicated Chrome window, then run the inject command.',
  }, null, 2));
}

async function status() {
  const current = state();
  const response = await fetch(`http://127.0.0.1:${current.port}/status/${current.token}`);
  if (!response.ok) throw new Error('The C6 Local collector status is unavailable.');
  console.log(JSON.stringify({ ...(await response.json()), current_variant: current.currentVariant, evidence_root: matrixRoot }, null, 2));
}

async function restartCollector() {
  const current = state();
  try { process.kill(current.collectorPid); } catch { /* Collector may already be stopped. */ }
  const log = openSync(path.join(matrixRoot, 'collector.log'), 'a');
  const child = spawn(process.execPath, [collectorScript, String(current.port), current.token, matrixRoot], {
    cwd: repositoryRoot, detached: true, stdio: ['ignore', log, log], windowsHide: true,
  });
  child.unref();
  closeSync(log);
  current.collectorPid = child.pid;
  writeState(current);
  await waitFor(`http://127.0.0.1:${current.port}/status/${current.token}`);
  console.log(JSON.stringify({ gate: 'c6_browser_capture_collector_restart', restarted: true }));
}

async function cleanup() {
  const current = existsSync(matrixStatePath) ? state() : null;
  if (existsSync(acceptanceStatePath)) run(process.execPath, [acceptanceScript, 'cleanup'], 'Local acceptance cleanup');
  if (current?.collectorPid) {
    try { process.kill(current.collectorPid); } catch { /* Collector may already be stopped. */ }
  }
  console.log(JSON.stringify({ gate: 'c6_browser_audio_matrix_cleanup', local_session_cleaned: true, evidence_retained: matrixRoot }));
}

const command = process.argv[2];
if (command === 'prepare') await prepare();
else if (command === 'inject') console.log(run(process.execPath, [acceptanceScript, 'inject'], 'Local acceptance session injection').trim());
else if (command === 'variant') {
  const current = state();
  configureVariant(process.argv[3], current);
  console.log(JSON.stringify({ gate: 'c6_browser_audio_matrix_variant', variant: process.argv[3], rebuilt: true, next: 'Click Reload for Annotated on chrome://extensions.' }));
}
else if (command === 'status') await status();
else if (command === 'position') await positionPlayer(process.argv[3], Number(process.argv[4]));
else if (command === 'restart-collector') await restartCollector();
else if (command === 'cleanup') await cleanup();
else throw new Error('Use: node run-c6-browser-audio-matrix.mjs prepare|inject|variant <name>|position <source> <seconds>|status|restart-collector|cleanup');
