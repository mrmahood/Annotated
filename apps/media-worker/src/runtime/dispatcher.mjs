import { mapBounded } from './bounded-concurrency.mjs';
import { requireBoundedInteger, requireMediaId } from './validation.mjs';

export async function runDispatchCycle({ store, dispatchOne, logger, limit = 25, concurrency = 4 }) {
  if (!store || typeof store.listDispatchCandidates !== 'function') throw new TypeError('Dispatch store is unavailable.');
  if (typeof dispatchOne !== 'function') throw new TypeError('Authenticated dispatcher is unavailable.');
  requireBoundedInteger(limit, 'Dispatch limit', 1, 100);
  requireBoundedInteger(concurrency, 'Dispatch concurrency', 1, 8);
  const candidates = await store.listDispatchCandidates(limit);
  if (!Array.isArray(candidates) || candidates.length > limit) throw new TypeError('Dispatch candidates are invalid.');
  const mediaIds = [...new Set(candidates.map((candidate) => requireMediaId(candidate?.media_id)))];
  logger?.emit('dispatch_cycle_started', { candidate_count: mediaIds.length });
  const outcomes = await mapBounded(mediaIds, concurrency, async (mediaId) => {
    try {
      const result = await dispatchOne(mediaId);
      logger?.emit('dispatch_completed', { media_id: mediaId, outcome: result?.outcome ?? 'accepted' });
      return { mediaId, status: 'dispatched', result };
    } catch {
      logger?.emit('dispatch_failed', { media_id: mediaId, code: 'dispatch_failed' });
      return { mediaId, status: 'failed' };
    }
  });
  const summary = Object.freeze({
    candidateCount: mediaIds.length,
    dispatchedCount: outcomes.filter((result) => result.status === 'dispatched').length,
    failedCount: outcomes.filter((result) => result.status === 'failed').length,
  });
  logger?.emit('dispatch_cycle_completed', {
    candidate_count: summary.candidateCount,
    dispatched_count: summary.dispatchedCount,
    failed_count: summary.failedCount,
  });
  return summary;
}
