import { spawnSync } from 'node:child_process';
import { requireBoundedInteger, requireLocalUrl } from '../runtime/validation.mjs';

export class PsqlDatabase {
  #databaseUrl;
  #psqlPath;
  #timeoutMs;

  constructor({ databaseUrl, psqlPath = 'psql', timeoutMs = 30_000, localOnly = true }) {
    if (localOnly) requireLocalUrl(databaseUrl, 'Database URL', ['postgres:', 'postgresql:']);
    this.#databaseUrl = databaseUrl;
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
    });
    if (result.error || result.status !== 0) throw new Error('PostgreSQL worker command failed.');
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
