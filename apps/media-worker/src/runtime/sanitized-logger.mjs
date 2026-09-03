import { requireMediaId } from './validation.mjs';

const IDENTIFIER_PATTERN = /^[a-z0-9_]{1,100}$/u;
const ALLOWED_FACTS = Object.freeze({
  media_id: (value) => requireMediaId(value),
  stage: boundedIdentifier,
  code: boundedIdentifier,
  outcome: boundedIdentifier,
  action: boundedIdentifier,
  resume_stage: boundedIdentifier,
  attempt_count: boundedCount,
  candidate_count: boundedCount,
  dispatched_count: boundedCount,
  skipped_count: boundedCount,
  failed_count: boundedCount,
  duration_ms: boundedMeasurement,
  byte_size: boundedMeasurement,
  reason: boundedIdentifier,
});

function boundedIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) throw new TypeError('Log identifier is invalid.');
  return value;
}

function boundedCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new TypeError('Log count is invalid.');
  return value;
}

function boundedMeasurement(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new TypeError('Log measurement is invalid.');
  return value;
}

export function createSanitizedLogger({ write = (line) => process.stdout.write(`${line}\n`), clock = () => new Date() } = {}) {
  if (typeof write !== 'function' || typeof clock !== 'function') throw new TypeError('Logger dependencies are invalid.');
  return Object.freeze({
    emit(event, facts = {}) {
      const record = {
        timestamp: clock().toISOString(),
        event: boundedIdentifier(event),
      };
      if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new TypeError('Log facts are invalid.');
      for (const [key, value] of Object.entries(facts)) {
        const normalize = ALLOWED_FACTS[key];
        if (normalize && value !== undefined && value !== null) record[key] = normalize(value);
      }
      write(JSON.stringify(record));
      return Object.freeze(record);
    },
  });
}
