import { mapBounded } from './bounded-concurrency.mjs';
import { requireBoundedInteger, requireMediaId } from './validation.mjs';

const PROCESSING_ACTIONS = new Set([
  'recapture_required',
  'processing_deadline_exceeded',
  'attempts_exhausted',
  'lease_expired',
]);
const CLEANUP_ACTIONS = new Set(['abandoned_cleanup', 'terminal_raw_cleanup']);

async function removeIfPresent(storage, bucket, objectPath) {
  if (!objectPath) return;
  if (await storage.exists(bucket, objectPath)) await storage.remove(bucket, [objectPath]);
  if (await storage.exists(bucket, objectPath)) throw new Error('Private object deletion was not confirmed.');
}

async function reconcileOne({ candidate, store, storage, logger }) {
  const mediaId = requireMediaId(candidate?.media_id);
  const action = candidate?.reconciliation_action;
  if (PROCESSING_ACTIONS.has(action)) {
    const result = await store.reconcileProcessing(mediaId);
    logger?.emit('reconciliation_completed', { media_id: mediaId, action, outcome: result });
    return { mediaId, status: 'reconciled', action: result };
  }
  if (!CLEANUP_ACTIONS.has(action)) throw new TypeError('Reconciliation action is invalid.');
  const claim = await store.claimCleanup(mediaId);
  if (!claim) {
    logger?.emit('cleanup_skipped', { media_id: mediaId, action });
    return { mediaId, status: 'skipped', action };
  }
  if (claim.cleanup_reason !== action || requireMediaId(claim.media_id) !== mediaId) {
    throw new TypeError('Cleanup claim does not match its candidate.');
  }
  await removeIfPresent(storage, 'annotation-media-raw', claim.raw_storage_path);
  await removeIfPresent(storage, 'annotation-media', claim.processed_storage_path);
  const result = await store.confirmCleanup(claim);
  logger?.emit('cleanup_completed', { media_id: mediaId, action, outcome: result });
  return { mediaId, status: 'cleaned', action };
}

export async function runReconciliationCycle({ store, storage, logger, limit = 25, concurrency = 2 }) {
  if (!store || typeof store.listReconciliationCandidates !== 'function') throw new TypeError('Reconciliation store is unavailable.');
  if (!storage || typeof storage.exists !== 'function' || typeof storage.remove !== 'function') throw new TypeError('Reconciliation Storage is unavailable.');
  requireBoundedInteger(limit, 'Reconciliation limit', 1, 100);
  requireBoundedInteger(concurrency, 'Reconciliation concurrency', 1, 8);
  const candidates = await store.listReconciliationCandidates(limit);
  if (!Array.isArray(candidates) || candidates.length > limit) throw new TypeError('Reconciliation candidates are invalid.');
  logger?.emit('reconciliation_cycle_started', { candidate_count: candidates.length });
  const outcomes = await mapBounded(candidates, concurrency, async (candidate) => {
    const mediaId = requireMediaId(candidate?.media_id);
    try {
      return await reconcileOne({ candidate, store, storage, logger });
    } catch {
      logger?.emit('reconciliation_failed', { media_id: mediaId, code: 'reconciliation_failed' });
      return { mediaId, status: 'failed' };
    }
  });
  const summary = Object.freeze({
    candidateCount: candidates.length,
    reconciledCount: outcomes.filter((result) => result.status === 'reconciled').length,
    cleanedCount: outcomes.filter((result) => result.status === 'cleaned').length,
    skippedCount: outcomes.filter((result) => result.status === 'skipped').length,
    failedCount: outcomes.filter((result) => result.status === 'failed').length,
  });
  logger?.emit('reconciliation_cycle_completed', {
    candidate_count: summary.candidateCount,
    skipped_count: summary.skippedCount,
    failed_count: summary.failedCount,
  });
  return summary;
}
