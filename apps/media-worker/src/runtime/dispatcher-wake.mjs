export function dispatcherJobForWorker(workerJob) {
  if (typeof workerJob !== 'string' || !workerJob.includes('-worker-')) {
    throw new TypeError('Cloud Run worker job is invalid.');
  }
  return workerJob.replace('-worker-', '-dispatcher-');
}

export async function wakeDispatcherAt({
  retryAt,
  runDispatcher,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxWaitMs = 180_000,
} = {}) {
  if (typeof runDispatcher !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') {
    throw new TypeError('Dispatcher wake is unavailable.');
  }
  const due = Date.parse(retryAt);
  if (!Number.isFinite(due)) return Object.freeze({ outcome: 'skipped' });
  const waitMs = due - now();
  if (waitMs > maxWaitMs) return Object.freeze({ outcome: 'skipped' });
  if (waitMs > 0) await sleep(waitMs);
  await runDispatcher();
  return Object.freeze({ outcome: 'accepted' });
}
