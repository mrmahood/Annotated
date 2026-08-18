import { requireBoundedInteger } from './validation.mjs';

export async function mapBounded(values, concurrency, operation) {
  if (!Array.isArray(values)) throw new TypeError('Bounded work must be an array.');
  requireBoundedInteger(concurrency, 'Concurrency', 1, 8);
  if (typeof operation !== 'function') throw new TypeError('Bounded operation is required.');
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
