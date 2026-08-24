import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function executable(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function runPnpm(args, options) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], options);
  }
  return run(executable('pnpm'), args, options);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
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

function assertLoopbackUrl(value, label) {
  const parsed = new URL(value);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must target Local Supabase on a loopback address.`);
  }
  return parsed;
}

function findPsql() {
  if (process.env.ANNOTATED_PSQL_BIN) return process.env.ANNOTATED_PSQL_BIN;
  if (process.platform === 'win32') {
    const known = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
    if (existsSync(known)) return known;
  }
  return 'psql';
}

function encodeObjectPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

async function errorDetail(response) {
  const value = await response.text();
  if (!value) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(value);
    return parsed.message ?? parsed.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function loadLocalSupabaseStatus(repositoryRoot) {
  const output = runPnpm(['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: repositoryRoot,
    label: 'supabase status',
  });
  const status = JSON.parse(output);
  assertLoopbackUrl(status.API_URL, 'Supabase API URL');
  assertLoopbackUrl(status.DB_URL, 'Supabase database URL');
  if (!status.SERVICE_ROLE_KEY || !status.ANON_KEY) {
    throw new Error('Local Supabase did not report the required API keys.');
  }
  return Object.freeze({
    apiUrl: status.API_URL.replace(/\/$/u, ''),
    databaseUrl: status.DB_URL,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    anonKey: status.ANON_KEY,
  });
}

export class LocalDatabase {
  constructor(databaseUrl) {
    assertLoopbackUrl(databaseUrl, 'Supabase database URL');
    this.databaseUrl = databaseUrl;
    this.psql = findPsql();
  }

  execute(sql) {
    return run(this.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', this.databaseUrl, '-f', '-'], {
      input: sql,
      label: 'Local PostgreSQL command',
    }).trim();
  }

  json(sql) {
    const output = this.execute(sql);
    if (!output) return null;
    const lines = output.split(/\r?\n/u).filter(Boolean);
    return JSON.parse(lines.at(-1));
  }
}

export class LocalStorage {
  constructor({ apiUrl, serviceRoleKey, anonKey }) {
    assertLoopbackUrl(apiUrl, 'Supabase API URL');
    this.baseUrl = `${apiUrl}/storage/v1`;
    this.serviceRoleKey = serviceRoleKey;
    this.anonKey = anonKey;
  }

  serviceHeaders(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      ...extra,
    };
  }

  async upload(bucket, objectPath, bytes, contentType) {
    const response = await fetch(`${this.baseUrl}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      method: 'POST',
      headers: this.serviceHeaders({
        'cache-control': 'max-age=0',
        'content-type': contentType,
        'x-upsert': 'false',
      }),
      body: bytes,
    });
    if (!response.ok) throw new Error(`Local Storage upload failed: ${await errorDetail(response)}`);
  }

  async uploadExpectingConflict(bucket, objectPath, bytes, contentType) {
    const response = await fetch(`${this.baseUrl}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      method: 'POST',
      headers: this.serviceHeaders({
        'cache-control': 'max-age=0',
        'content-type': contentType,
        'x-upsert': 'false',
      }),
      body: bytes,
    });
    if (![400, 409].includes(response.status)) {
      throw new Error(`No-upsert duplicate returned unexpected HTTP ${response.status}.`);
    }
  }

  async download(bucket, objectPath) {
    const response = await fetch(`${this.baseUrl}/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      headers: this.serviceHeaders(),
    });
    if (!response.ok) throw new Error(`Local Storage download failed: ${await errorDetail(response)}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async exists(bucket, objectPath) {
    const response = await fetch(`${this.baseUrl}/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      headers: this.serviceHeaders(),
    });
    if (response.status === 404 || response.status === 400) return false;
    if (!response.ok) throw new Error(`Local Storage existence check failed: ${await errorDetail(response)}`);
    await response.arrayBuffer();
    return true;
  }

  async assertPrivate(bucket, objectPath) {
    const publicResponse = await fetch(`${this.baseUrl}/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      headers: { apikey: this.anonKey },
    });
    if (publicResponse.ok) throw new Error('A private Storage object was readable through the public endpoint.');

    const anonymousResponse = await fetch(`${this.baseUrl}/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      headers: { apikey: this.anonKey, authorization: `Bearer ${this.anonKey}` },
    });
    if (anonymousResponse.ok) throw new Error('A private Storage object was readable with the anonymous role.');
  }

  async remove(bucket, objectPaths) {
    if (!objectPaths.length) return;
    const response = await fetch(`${this.baseUrl}/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: this.serviceHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: objectPaths }),
    });
    if (!response.ok) throw new Error(`Local Storage deletion failed: ${await errorDetail(response)}`);
  }
}
