const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function requireMediaId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError('Media ID must be a UUID.');
  }
  return value.toLowerCase();
}

export function requireBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function persistDerivativeDurationMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Derivative duration must be an integer between 1000 and 90000.');
  }
  return requireBoundedInteger(Math.round(value), 'Derivative duration', 1_000, 90_000);
}

export function requireLocalUrl(value, label, protocols) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError(`${label} must be a valid URL.`); }
  if (!protocols.includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new TypeError(`${label} must use an approved protocol and a loopback host.`);
  }
  return parsed;
}

export function requireSecret(value, label = 'Secret') {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32 || Buffer.byteLength(value, 'utf8') > 512) {
    throw new TypeError(`${label} must contain between 32 and 512 bytes.`);
  }
  return value;
}
