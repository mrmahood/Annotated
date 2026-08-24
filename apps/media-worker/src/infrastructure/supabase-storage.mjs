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

  constructor({ apiUrl, serviceRoleKey, localOnly = true }) {
    const parsed = localOnly
      ? requireLocalUrl(apiUrl, 'Supabase API URL', ['http:', 'https:'])
      : new URL(apiUrl);
    this.#baseUrl = `${parsed.href.replace(/\/$/u, '')}/storage/v1`;
    this.#serviceRoleKey = requireSecret(serviceRoleKey, 'Supabase service key');
  }

  #headers(extra = {}) {
    return {
      apikey: this.#serviceRoleKey,
      authorization: `Bearer ${this.#serviceRoleKey}`,
      ...extra,
    };
  }

  async download(bucket, objectPath, signal) {
    const response = await fetch(`${this.#baseUrl}/object/authenticated/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
      headers: this.#headers(),
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage download failed with HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadNoUpsert(bucket, objectPath, bytes, contentType, signal) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError('Storage upload bytes are invalid.');
    const response = await fetch(`${this.#baseUrl}/object/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
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
    const response = await fetch(`${this.#baseUrl}/object/authenticated/${encodeURIComponent(requireBucket(bucket))}/${encodeObjectPath(objectPath)}`, {
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
    const response = await fetch(`${this.#baseUrl}/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes }),
      signal,
    });
    if (!response.ok) throw new Error(`Private Storage deletion failed with HTTP ${response.status}.`);
  }
}
