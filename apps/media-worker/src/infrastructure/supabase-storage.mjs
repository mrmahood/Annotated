import { requireLocalUrl, requireSecret } from '../runtime/validation.mjs';

function encodeObjectPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024 || value.startsWith('/') || value.includes('\\')) {
    throw new TypeError('Storage object path is invalid.');
  }
  return value.split('/').map(encodeURIComponent).join('/');
}

function requireBucket(value) {
  if (!['annotation-media-raw', 'annotation-media'].includes(value)) throw new TypeError('Storage bucket is invalid.');
  return value;
}

export class SupabaseStorage {
  #baseUrl;
  #serviceRoleKey;
  #fetch;

  constructor({ apiUrl, serviceRoleKey, localOnly = true, fetchImpl = globalThis.fetch }) {
    const parsed = localOnly
      ? requireLocalUrl(apiUrl, 'Supabase API URL', ['http:', 'https:'])
      : new URL(apiUrl);
    this.#baseUrl = `${parsed.href.replace(/\/$/u, '')}/storage/v1`;
    this.#serviceRoleKey = requireSecret(serviceRoleKey, 'Supabase service key');
    if (typeof fetchImpl !== 'function') throw new TypeError('Storage fetch is unavailable.');
    this.#fetch = fetchImpl;
  }

  #headers(extra = {}) {
    return {
      apikey: this.#serviceRoleKey,
      authorization: `Bearer ${this.#serviceRoleKey}`,
      ...extra,
    };
  }

  async download(bucket, objectPath, signal) {
    const response = await this.#fetch(`${this.#baseUrl}/object/authenticated/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
      headers: this.#headers(),
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage download failed with HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadNoUpsert(bucket, objectPath, bytes, contentType, signal) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError('Storage upload bytes are invalid.');
    const response = await this.#fetch(`${this.#baseUrl}/object/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
      method: 'POST',
      headers: this.#headers({
        'cache-control': 'max-age=0',
        'content-type': contentType,
        'x-upsert': 'false',
      }),
      body: bytes,
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage upload failed with HTTP ${response.status}.`);
  }

  async exists(bucket, objectPath, signal) {
    const response = await this.#fetch(`${this.#baseUrl}/object/authenticated/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
      headers: this.#headers(),
      signal,
    });
    if ([400, 404].includes(response.status)) return false;
    if (!response.ok) throw new Error(`Private Storage existence check failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
    return true;
  }

  async remove(bucket, objectPaths, signal) {
    requireBucket(bucket);
    if (!Array.isArray(objectPaths) || objectPaths.length < 1 || objectPaths.length > 100) throw new TypeError('Storage deletion paths are invalid.');
    const prefixes = objectPaths.map((objectPath) => {
      encodeObjectPath(objectPath);
      return objectPath;
    });
    const response = await this.#fetch(`${this.#baseUrl}/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes }),
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage deletion failed with HTTP ${response.status}.`);
  }

  async objectVisible(bucket, objectPath, signal) {
    encodeObjectPath(objectPath);
    const slash = objectPath.lastIndexOf('/');
    const prefix = slash === -1 ? '' : objectPath.slice(0, slash);
    const name = slash === -1 ? objectPath : objectPath.slice(slash + 1);
    const response = await this.#fetch(`${this.#baseUrl}/object/list/${encodeURIComponent(requireBucket(bucket))}`, {
      method: 'POST',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix, search: name, limit: 100 }),
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage list failed with HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Private Storage list response was invalid.');
    return rows.some((row) => row?.name === name);
  }
}
