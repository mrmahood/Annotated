import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalDatabase, LocalStorage, loadLocalSupabaseStatus } from '../helpers/local-supabase.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const stateRoot = path.join(
  os.tmpdir(),
  `Annotated-c4-owner-${createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)}`,
);
const statePath = path.join(stateRoot, 'state.json');
const webEnvironmentPath = path.join(repositoryRoot, 'apps', 'web', '.env.local');
const extensionEnvironmentPath = path.join(repositoryRoot, 'apps', 'extension', '.env.local');
const extensionOutputPath = path.join(repositoryRoot, 'apps', 'extension', '.output', 'chrome-mv3');
const fixtureServerPath = path.join(repositoryRoot, 'apps', 'media-worker', 'test', 'local-acceptance', 'fixture-server.mjs');
const nextBinaryPath = path.join(repositoryRoot, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const videoUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${options.label ?? command} failed${detail ? `: ${detail}` : '.'}`);
  }
  return result.stdout;
}

function runPnpm(args, label) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], { label });
  }
  return run('pnpm', args, { label });
}

function readState() {
  if (!existsSync(statePath)) throw new Error('No prepared Local Chrome acceptance session exists.');
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForUrl(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 500) return;
    } catch { /* Service is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready${lastStatus ? ` (last HTTP ${lastStatus})` : ''}.`);
}

function startDetached(command, args, { cwd, logPath, visible = false }) {
  const log = openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: visible ? 'ignore' : ['ignore', log, log],
    windowsHide: !visible,
  });
  child.unref();
  closeSync(log);
  return child.pid;
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

async function chromeTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error('Chrome debugging target list is unavailable.');
  return await response.json();
}

async function findExtensionId(profilePath) {
  const preferencePaths = [
    path.join(profilePath, 'Default', 'Preferences'),
    path.join(profilePath, 'Default', 'Secure Preferences'),
  ];
  const expectedPath = path.resolve(extensionOutputPath).toLowerCase();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const preferencesPath of preferencePaths) {
      try {
        const preferences = JSON.parse(readFileSync(preferencesPath, 'utf8'));
        const settings = preferences.extensions?.settings ?? {};
        for (const [extensionId, value] of Object.entries(settings)) {
          if (typeof value?.path === 'string' && path.resolve(value.path).toLowerCase() === expectedPath) {
            return extensionId;
          }
        }
      } catch { /* Chrome is still writing the dedicated profile. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Chrome did not register the unpacked Annotated extension.');
}

async function injectSession(debugPort, profilePath, session, expectedUserId) {
  await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome debugging endpoint');
  const extensionId = await findExtensionId(profilePath);
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const created = await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {
    url: `chrome-extension://${extensionId}/sidepanel.html`,
  });
  const deadline = Date.now() + 10_000;
  let target;
  while (Date.now() < deadline) {
    const targets = await chromeTargets(debugPort);
    target = targets.find((candidate) => candidate.id === created.targetId);
    if (target?.webSocketDebuggerUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('The Local extension bootstrap page did not start.');
  const storageValue = JSON.stringify(session);
  const expression = `chrome.storage.local.set(${JSON.stringify({
    'annotated:auth:supabase-session': storageValue,
  })}).then(async () => {
    const stored = await chrome.storage.local.get('annotated:auth:supabase-session');
    const session = JSON.parse(stored['annotated:auth:supabase-session']);
    return session?.user?.id === ${JSON.stringify(expectedUserId)};
  })`;
  const result = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.result?.value !== true) throw new Error('The disposable Local session was not stored in the extension.');
  await cdpCommand(version.webSocketDebuggerUrl, 'Target.closeTarget', { targetId: created.targetId });
  return extensionId;
}

async function withExtensionPage(state, callback) {
  await waitForUrl(`http://127.0.0.1:${state.debugPort}/json/version`, 'Chrome debugging endpoint');
  const version = await (await fetch(`http://127.0.0.1:${state.debugPort}/json/version`)).json();
  const created = await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {
    url: `chrome-extension://${state.extensionId}/sidepanel.html`,
  });
  try {
    const deadline = Date.now() + 10_000;
    let target;
    while (Date.now() < deadline) {
      const targets = await chromeTargets(state.debugPort);
      target = targets.find((candidate) => candidate.id === created.targetId);
      if (target?.webSocketDebuggerUrl) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('The Local extension handoff page did not start.');
    return await callback(target.webSocketDebuggerUrl, version.webSocketDebuggerUrl);
  } finally {
    await cdpCommand(version.webSocketDebuggerUrl, 'Target.closeTarget', { targetId: created.targetId }).catch(() => undefined);
  }
}

async function createLocalSession(status) {
  const publishableKey = status.publishableKey;
  const email = `c4-owner-${randomUUID()}@annotated.local`;
  const password = `${randomBytes(32).toString('base64url')}aA1!`;
  const response = await fetch(`${status.apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, data: { display_name: 'C4 Local Owner' } }),
  });
  if (!response.ok) throw new Error(`Local Auth signup failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    throw new Error('Local Auth did not return an immediately usable disposable session.');
  }
  const session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in ?? 3600),
    token_type: payload.token_type ?? 'bearer',
    user: payload.user,
  };
  const verification = await fetch(`${status.apiUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${session.access_token}` },
  });
  if (!verification.ok || (await verification.json()).id !== payload.user.id) {
    throw new Error('The disposable Local session could not be verified.');
  }
  return { session, userId: payload.user.id };
}

function backupEnvironment(targetPath, backupName) {
  const existed = existsSync(targetPath);
  const backupPath = path.join(stateRoot, backupName);
  if (existed) copyFileSync(targetPath, backupPath);
  return { targetPath, backupPath, existed };
}

function restoreEnvironment(backup) {
  if (!backup) return;
  if (backup.existed) copyFileSync(backup.backupPath, backup.targetPath);
  else rmSync(backup.targetPath, { force: true });
}

async function prepare() {
  if (existsSync(statePath)) throw new Error('A Local acceptance session already exists. Run cleanup before preparing another.');
  if (!existsSync(chromePath)) throw new Error('Google Chrome was not found at the expected Windows installation path.');
  mkdirSync(stateRoot, { recursive: false, mode: 0o700 });

  const rawStatus = loadLocalSupabaseStatus(repositoryRoot);
  const cliOutput = JSON.parse(runPnpm(['exec', 'supabase', 'status', '-o', 'json'], 'supabase status'));
  const status = {
    ...rawStatus,
    publishableKey: cliOutput.PUBLISHABLE_KEY ?? cliOutput.ANON_KEY,
    secretKey: cliOutput.SECRET_KEY ?? cliOutput.SERVICE_ROLE_KEY,
  };
  if (!status.publishableKey || !status.secretKey) throw new Error('Local Supabase keys are unavailable.');

  const webPort = await freePort();
  const fixturePort = await freePort();
  const debugPort = await freePort();
  const webOrigin = `http://localhost:${webPort}`;
  const localSupabaseUrl = 'http://localhost:54321';
  const state = {
    version: 1,
    webPort,
    fixturePort,
    debugPort,
    videoUrl,
    pids: {},
    backups: {
      web: backupEnvironment(webEnvironmentPath, 'web.env.local.backup'),
      extension: backupEnvironment(extensionEnvironmentPath, 'extension.env.local.backup'),
    },
  };
  writeState(state);

  try {
    writeFileSync(webEnvironmentPath, [
      `NEXT_PUBLIC_SUPABASE_URL=${localSupabaseUrl}`,
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.publishableKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${status.secretKey}`,
      `NEXT_PUBLIC_SITE_URL=${webOrigin}`,
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 });
    writeFileSync(extensionEnvironmentPath, [
      `WXT_SUPABASE_URL=${localSupabaseUrl}`,
      `WXT_SUPABASE_PUBLISHABLE_KEY=${status.publishableKey}`,
      `WXT_WEB_APP_URL=${webOrigin}`,
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 });

    const identity = await createLocalSession(status);
    state.userId = identity.userId;
    state.session = identity.session;
    writeState(state);

    runPnpm(['--dir', 'apps/extension', 'run', 'build'], 'Local extension build');
    runPnpm(['--dir', 'apps/web', 'run', 'build'], 'Local web build');
    state.pids.web = startDetached(process.execPath, [nextBinaryPath, 'start', '-H', 'localhost', '-p', String(webPort)], {
      cwd: path.join(repositoryRoot, 'apps', 'web'),
      logPath: path.join(stateRoot, 'web.log'),
    });
    state.pids.fixture = startDetached(process.execPath, [fixtureServerPath, String(fixturePort)], {
      cwd: repositoryRoot,
      logPath: path.join(stateRoot, 'fixture.log'),
    });
    writeState(state);

    await Promise.all([
      waitForUrl(`${webOrigin}/auth/error`, 'Local web app'),
      waitForUrl(`http://localhost:${fixturePort}/health`, 'Local audio fixture'),
    ]);

    const profilePath = path.join(stateRoot, 'chrome-profile');
    state.profilePath = profilePath;
    state.pids.chrome = startDetached(chromePath, [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      'chrome://extensions',
    ], { cwd: repositoryRoot, logPath: path.join(stateRoot, 'chrome.log'), visible: true });
    writeState(state);

    state.preparedAt = new Date().toISOString();
    writeState(state);

    console.log(JSON.stringify({
      prepared: true,
      local_only: true,
      web_origin: webOrigin,
      extension_unpacked_path: extensionOutputPath,
      next: 'In the dedicated Chrome window, enable Developer mode and load the unpacked extension path. Then run the inject command.',
    }, null, 2));
  } catch (error) {
    await cleanup({ suppressMissing: true, preserveOnFailure: true }).catch(() => undefined);
    throw error;
  }
}

async function injectPreparedSession() {
  const state = readState();
  if (!state.session || !state.userId) {
    throw new Error('The prepared disposable session is unavailable or was already injected.');
  }
  state.extensionId = await injectSession(state.debugPort, state.profilePath, state.session, state.userId);
  state.accessToken = state.session.access_token;
  delete state.session;
  state.injectedAt = new Date().toISOString();
  writeState(state);

  const version = await (await fetch(`http://127.0.0.1:${state.debugPort}/json/version`)).json();
  await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {
    url: `http://localhost:${state.fixturePort}/audio`,
  });
  await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', { url: videoUrl });
  console.log(JSON.stringify({
    ready: true,
    local_only: true,
    extension_id: state.extensionId,
    audio_url: `http://localhost:${state.fixturePort}/audio`,
    video_url: videoUrl,
    next: 'Complete the video and audio owner acceptance steps, then run evidence.',
  }, null, 2));
}

function captureRows(database, userId, includePaths = false) {
  return database.json(`
    select coalesce(pg_catalog.json_agg(row_data order by created_at), '[]'::json)
    from (
      select media.created_at,
        pg_catalog.json_build_object(
          'annotation_id', annotations.id,
          'media_id', media.id,
          'media_type', media.media_type,
          'annotation_status', annotations.status,
          'processing_status', media.processing_status,
          'processing_stage', media.processing_stage,
          'capture_metadata', media.capture_metadata,
          'raw_reference_present', media.raw_storage_path is not null
          ${includePaths ? ", 'raw_storage_path', media.raw_storage_path, 'processed_storage_path', media.processed_storage_path" : ''}
        ) as row_data
      from public.annotation_media media
      join public.annotations annotations on annotations.id = media.annotation_id
      where annotations.user_id = ${sqlText(userId)}::uuid
    ) rows;
  `) ?? [];
}

function deleteDisposableRows(database, userId) {
  database.execute(`
    delete from public.annotations
    where user_id = ${sqlText(userId)}::uuid;
  `);
}

function countDisposableSessions(database, userId) {
  return Number(database.json(`
    select pg_catalog.to_json(pg_catalog.count(*))
    from auth.sessions
    where user_id = ${sqlText(userId)}::uuid;
  `));
}

function isRecoverableDisposableLogoutStatus(status) {
  return (status >= 200 && status < 300) || [401, 403, 404].includes(status);
}

function validateEvidence(rows) {
  const checks = rows.map((row) => {
    const metadata = row.capture_metadata;
    const timing = metadata?.timing;
    const track = metadata?.capture_track;
    const common = metadata?.version === 2 &&
      row.annotation_status === 'draft' && row.processing_status === 'processing' && row.processing_stage === 'queued' &&
      row.raw_reference_present === true && timing?.lead_in_clock === 'offscreen_monotonic' &&
      Number.isSafeInteger(timing?.requested_start_ms) && Number.isSafeInteger(timing?.requested_end_ms) &&
      timing.requested_end_ms > timing.requested_start_ms &&
      Number.isFinite(timing?.lead_in_ms) && timing.lead_in_ms >= 0 &&
      Number.isSafeInteger(timing?.recorder_elapsed_ms) && timing.recorder_elapsed_ms >= 1000 &&
      Array.isArray(track?.tracks) && track.audio_track_count >= 1 && track.loopback_enabled === true;
    const typeSpecific = row.media_type === 'video'
      ? track.video_track_count >= 1 && metadata.viewport?.start && metadata.viewport?.end &&
        metadata.video_element?.start && metadata.video_element?.end && metadata.intrinsic_video &&
        metadata.computed_style && metadata.fullscreen &&
        Math.abs(metadata.video_element.start.x - metadata.video_element.end.x) <= 1 &&
        Math.abs(metadata.video_element.start.y - metadata.video_element.end.y) <= 1 &&
        Math.abs(metadata.video_element.start.width - metadata.video_element.end.width) <= 1 &&
        Math.abs(metadata.video_element.start.height - metadata.video_element.end.height) <= 1
      : row.media_type === 'audio' && track.video_track_count === 0 &&
        !('viewport' in metadata) && !('video_element' in metadata) && !('intrinsic_video' in metadata);
    return { media_type: row.media_type, accepted: Boolean(common && typeSpecific) };
  });
  return {
    rows,
    checks,
    acceptance_complete: checks.some((row) => row.media_type === 'video' && row.accepted) &&
      checks.some((row) => row.media_type === 'audio' && row.accepted),
  };
}

async function evidence() {
  const state = readState();
  const status = loadLocalSupabaseStatus(repositoryRoot);
  const database = new LocalDatabase(status.databaseUrl);
  const result = validateEvidence(captureRows(database, state.userId));
  writeFileSync(path.join(stateRoot, 'sanitized-evidence.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.acceptance_complete) process.exitCode = 2;
}

async function advanceToAudio() {
  const state = readState();
  const status = loadLocalSupabaseStatus(repositoryRoot);
  const database = new LocalDatabase(status.databaseUrl);
  const result = validateEvidence(captureRows(database, state.userId));
  const videoChecks = result.checks.filter((row) => row.media_type === 'video');
  const audioChecks = result.checks.filter((row) => row.media_type === 'audio');
  if (videoChecks.length !== 1 || videoChecks[0].accepted !== true || audioChecks.length !== 0) {
    throw new Error('Audio handoff requires exactly one accepted queued video and no audio capture rows.');
  }

  const cleared = await withExtensionPage(state, async (webSocketUrl) => {
    const expression = `(async () => {
      const hostedKey = 'annotated.hostedMedia.operation.v1';
      const authKey = 'annotated:auth:supabase-session';
      const activeKey = 'annotated.mediaCapture.active.v1';
      const before = await chrome.storage.local.get([hostedKey, authKey]);
      const active = await chrome.storage.session.get(activeKey);
      const live = await chrome.runtime.sendMessage({
        target: 'background',
        type: 'annotated.mediaCapture.status.v1',
      });
      if (!before[hostedKey] || !before[authKey] || active[activeKey] !== undefined || live?.operation !== null) {
        return false;
      }
      await chrome.storage.local.remove(hostedKey);
      const after = await chrome.storage.local.get([hostedKey, authKey]);
      return after[hostedKey] === undefined && typeof after[authKey] === 'string';
    })()`;
    const response = await cdpCommand(webSocketUrl, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return response?.result?.value === true;
  });
  if (!cleared) throw new Error('The completed video recovery state could not be cleared safely.');

  const targets = await chromeTargets(state.debugPort);
  const audioTarget = targets.find((candidate) => candidate.url === `http://localhost:${state.fixturePort}/audio`);
  if (audioTarget) {
    const version = await (await fetch(`http://127.0.0.1:${state.debugPort}/json/version`)).json();
    await cdpCommand(version.webSocketDebuggerUrl, 'Target.activateTarget', { targetId: audioTarget.id });
  }
  console.log(JSON.stringify({
    ready_for_audio: true,
    video_evidence_accepted: true,
    completed_recovery_state_cleared: true,
    authenticated_session_preserved: true,
    audio_url: `http://localhost:${state.fixturePort}/audio`,
  }, null, 2));
}

async function closeChrome(debugPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    if (!response.ok) return;
    const version = await response.json();
    if (version.webSocketDebuggerUrl) await cdpCommand(version.webSocketDebuggerUrl, 'Browser.close');
  } catch { /* Chrome may already be closed. */ }
}

function stopProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  try { process.kill(pid); } catch { /* Process may already be stopped. */ }
}

async function cleanup(options = {}) {
  if (!existsSync(statePath)) {
    if (options.suppressMissing) return;
    throw new Error('No prepared Local Chrome acceptance session exists.');
  }
  const state = readState();
  const cliOutput = JSON.parse(runPnpm(['exec', 'supabase', 'status', '-o', 'json'], 'supabase status'));
  const status = {
    ...loadLocalSupabaseStatus(repositoryRoot),
    publishableKey: cliOutput.PUBLISHABLE_KEY ?? cliOutput.ANON_KEY,
    secretKey: cliOutput.SECRET_KEY ?? cliOutput.SERVICE_ROLE_KEY,
  };
  const database = new LocalDatabase(status.databaseUrl);
  const storage = new LocalStorage(status);
  const rows = state.userId ? captureRows(database, state.userId, true) : [];
  const rawPaths = rows.map((row) => row.raw_storage_path).filter(Boolean);
  const processedPaths = rows.map((row) => row.processed_storage_path).filter(Boolean);
  if (rawPaths.length) await storage.remove('annotation-media-raw', rawPaths);
  if (processedPaths.length) await storage.remove('annotation-media', processedPaths);

  if (state.userId) {
    // profiles.id is referenced by annotations.user_id without cascading. Remove
    // only this generated owner's annotations before Local Auth deletes its profile.
    deleteDisposableRows(database, state.userId);
    const accessToken = state.accessToken ?? state.session?.access_token;
    if (accessToken) {
      const logout = await fetch(`${status.apiUrl}/auth/v1/logout?scope=global`, {
        method: 'POST',
        headers: { apikey: status.publishableKey, authorization: `Bearer ${accessToken}` },
      });
      if (!isRecoverableDisposableLogoutStatus(logout.status)) {
        throw new Error(`Disposable Local session revocation failed with HTTP ${logout.status}.`);
      }
    }
    const response = await fetch(`${status.apiUrl}/auth/v1/admin/users/${encodeURIComponent(state.userId)}`, {
      method: 'DELETE',
      headers: { apikey: status.secretKey, authorization: `Bearer ${status.secretKey}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Disposable Local user deletion failed with HTTP ${response.status}.`);
    if (countDisposableSessions(database, state.userId) !== 0) {
      throw new Error('Disposable Local sessions remain after user deletion.');
    }
  }

  await closeChrome(state.debugPort);
  stopProcess(state.pids?.chrome);
  stopProcess(state.pids?.web);
  stopProcess(state.pids?.fixture);
  restoreEnvironment(state.backups?.web);
  restoreEnvironment(state.backups?.extension);

  const remainingRows = state.userId ? captureRows(database, state.userId) : [];
  if (remainingRows.length) throw new Error('Disposable Local acceptance rows remain after cleanup.');
  for (const objectPath of rawPaths) {
    if (await storage.exists('annotation-media-raw', objectPath)) throw new Error('A disposable raw object remains after cleanup.');
  }
  for (const objectPath of processedPaths) {
    if (await storage.exists('annotation-media', objectPath)) throw new Error('A disposable processed object remains after cleanup.');
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  try { rmSync(stateRoot, { recursive: true, force: true }); }
  catch (error) {
    if (!options.preserveOnFailure) throw error;
  }
  console.log(JSON.stringify({ cleaned: true, environments_restored: true, local_user_deleted: true, objects_deleted: true }));
}

export { countDisposableSessions, deleteDisposableRows, isRecoverableDisposableLogoutStatus, validateEvidence };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'prepare') await prepare();
  else if (command === 'inject') await injectPreparedSession();
  else if (command === 'evidence') await evidence();
  else if (command === 'advance') await advanceToAudio();
  else if (command === 'cleanup') await cleanup();
  else throw new Error('Use: node acceptance.mjs prepare|inject|evidence|advance|cleanup');
}
