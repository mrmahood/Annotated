import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { requireBoundedInteger, requireMediaId, requireSecret } from './validation.mjs';

const TOKEN_VERSION = 1;
const MAX_TOKEN_BYTES = 1_024;
const TOKEN_TTL_SECONDS = 300;

function signature(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest();
}

function exactPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Dispatch token payload is invalid.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'issued_at,media_id,nonce,version') throw new TypeError('Dispatch token payload is invalid.');
  if (value.version !== TOKEN_VERSION) throw new TypeError('Dispatch token version is unsupported.');
  const mediaId = requireMediaId(value.media_id);
  const issuedAt = requireBoundedInteger(value.issued_at, 'Dispatch token time', 1, 9_999_999_999);
  const nonce = requireMediaId(value.nonce);
  return { version: TOKEN_VERSION, media_id: mediaId, issued_at: issuedAt, nonce };
}

export function createDispatchToken({ mediaId, secret, now = Date.now(), nonce = randomUUID() }) {
  const normalizedSecret = requireSecret(secret, 'Dispatch secret');
  const payload = exactPayload({
    version: TOKEN_VERSION,
    media_id: requireMediaId(mediaId),
    issued_at: Math.floor(now / 1_000),
    nonce: requireMediaId(nonce),
  });
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signed = signature(normalizedSecret, encoded).toString('base64url');
  return `${encoded}.${signed}`;
}

export function verifyDispatchToken({ token, mediaId, secret, now = Date.now() }) {
  const normalizedSecret = requireSecret(secret, 'Dispatch secret');
  const expectedMediaId = requireMediaId(mediaId);
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    throw new TypeError('Dispatch token is invalid.');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new TypeError('Dispatch token is invalid.');
  let suppliedSignature;
  let payload;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
    payload = exactPayload(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
  } catch {
    throw new TypeError('Dispatch token is invalid.');
  }
  const expectedSignature = signature(normalizedSecret, parts[0]);
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new TypeError('Dispatch token is invalid.');
  }
  const currentSeconds = Math.floor(now / 1_000);
  if (payload.media_id !== expectedMediaId || payload.issued_at > currentSeconds + 5 || currentSeconds - payload.issued_at > TOKEN_TTL_SECONDS) {
    throw new TypeError('Dispatch token is invalid or expired.');
  }
  return Object.freeze(payload);
}

export function createAuthenticatedLocalDispatch({ secret, handle, clock = () => Date.now() }) {
  requireSecret(secret, 'Dispatch secret');
  if (typeof handle !== 'function') throw new TypeError('Authenticated dispatch handler is required.');
  return async (mediaId) => {
    const normalized = requireMediaId(mediaId);
    const token = createDispatchToken({ mediaId: normalized, secret, now: clock() });
    verifyDispatchToken({ token, mediaId: normalized, secret, now: clock() });
    return await handle(normalized);
  };
}
