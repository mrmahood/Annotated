import { spawnSync } from 'node:child_process';
import { requireBoundedInteger, requireLocalUrl } from '../runtime/validation.mjs';

export const PROCESSED_DURATION_INVALID_MESSAGE = 'Processed duration is invalid for the requested hosted range.';

export function boundedPostgresFailureReason(stderr) {
  if (typeof stderr !== 'string' || !stderr.includes(PROCESSED_DURATION_INVALID_MESSAGE)) {
    return null;
  }
  return 'duration_overshoot';
}

export function preparePsqlConnection(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new TypeError('Database URL must be valid.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new TypeError('Database URL must use PostgreSQL.');
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  return Object.freeze({ redactedUrl: parsed.href, password });
}

export class PsqlDatabase {
  #databaseUrl;
  #password;
  #psqlPath;
  #timeoutMs;

  constructor({ databaseUrl, psqlPath = 'psql', timeoutMs = 30_000, localOnly = true }) {
    if (localOnly) requireLocalUrl(databaseUrl, 'Database URL', ['postgres:', 'postgresql:']);
    const connection = preparePsqlConnection(databaseUrl);
    this.#databaseUrl = connection.redactedUrl;
    this.#password = connection.password;
    this.#psqlPath = psqlPath;
    this.#timeoutMs = requireBoundedInteger(timeoutMs, 'PostgreSQL timeout', 1_000, 120_000);
  }

  execute(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('PostgreSQL command is invalid.');
    const result = spawnSync(this.#psqlPath, ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', this.#databaseUrl, '-f', '-'], {
      encoding: 'utf8',
      input: sql,
      timeout: this.#timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: this.#password },
    });
    if (result.error || result.status !== 0) {
      const error = new Error('PostgreSQL worker command failed.');
      const reason = boundedPostgresFailureReason(result.stderr);
      if (reason) error.boundedReason = reason;
      throw error;
    }
    return result.stdout.trim();
  }

  json(sql) {
    const output = this.execute(sql);
    if (!output) return null;
    const lines = output.split(/\r?\n/u).filter(Boolean);
    try { return JSON.parse(lines.at(-1)); }
    catch { throw new Error('PostgreSQL worker response was invalid.'); }
  }
}
