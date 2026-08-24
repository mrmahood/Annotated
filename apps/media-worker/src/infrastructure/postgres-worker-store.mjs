import { requireBoundedInteger, requireMediaId } from '../runtime/validation.mjs';

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNullableText(value) {
  return value === null || value === undefined ? 'null' : sqlText(value);
}

function sqlNullableInteger(value) {
  return value === null || value === undefined ? 'null' : String(requireBoundedInteger(value, 'Nullable integer', 0, Number.MAX_SAFE_INTEGER));
}

function requireLeaseToken(value) {
  return requireMediaId(value);
}

export class PostgresWorkerStore {
  constructor(database) {
    if (!database || typeof database.json !== 'function' || typeof database.execute !== 'function') {
      throw new TypeError('PostgreSQL database adapter is unavailable.');
    }
    this.database = database;
  }

  listDispatchCandidates(limit) {
    requireBoundedInteger(limit, 'Dispatch limit', 1, 100);
    return this.database.json(`
      select coalesce(pg_catalog.json_agg(pg_catalog.row_to_json(candidate)), '[]'::json)
      from private.list_annotation_media_dispatch_candidates(${limit}) candidate;
    `) ?? [];
  }

  listReconciliationCandidates(limit) {
    requireBoundedInteger(limit, 'Reconciliation limit', 1, 100);
    return this.database.json(`
      select coalesce(pg_catalog.json_agg(pg_catalog.row_to_json(candidate)), '[]'::json)
      from private.list_annotation_media_reconciliation_candidates(${limit}) candidate;
    `) ?? [];
  }

  claim(mediaId, leaseSeconds = 900) {
    const id = requireMediaId(mediaId);
    requireBoundedInteger(leaseSeconds, 'Lease seconds', 60, 3_600);
    return this.database.json(`
      select pg_catalog.row_to_json(claimed)
      from private.claim_annotation_media_processing(${sqlText(id)}::uuid, ${leaseSeconds}) claimed;
    `);
  }

  stageDerivative(mediaId, leaseToken, facts) {
    const id = requireMediaId(mediaId);
    const lease = requireLeaseToken(leaseToken);
    this.database.execute(`
      select private.stage_annotation_media_derivative(
        ${sqlText(id)}::uuid,
        ${sqlText(lease)}::uuid,
        ${sqlText(facts.rawChecksumSha256)},
        ${sqlText(facts.processedStoragePath)},
        ${sqlText(facts.mimeType)},
        ${requireBoundedInteger(facts.durationMs, 'Derivative duration', 1_000, 90_000)},
        ${sqlNullableInteger(facts.width)},
        ${sqlNullableInteger(facts.height)},
        ${requireBoundedInteger(facts.byteSize, 'Derivative byte size', 1, 16 * 1024 * 1024)},
        ${sqlText(facts.checksumSha256)}
      );
    `);
  }

  stageTranscript(mediaId, leaseToken, transcript) {
    const id = requireMediaId(mediaId);
    const lease = requireLeaseToken(leaseToken);
    this.database.execute(`
      select private.stage_annotation_media_transcript(
        ${sqlText(id)}::uuid,
        ${sqlText(lease)}::uuid,
        ${sqlText(transcript.transcriptText)},
        ${sqlNullableText(transcript.language)},
        ${transcript.segments === null ? 'null' : `${sqlText(JSON.stringify(transcript.segments))}::jsonb`},
        ${sqlText(transcript.provider)},
        ${sqlText(transcript.model)},
        ${sqlText(JSON.stringify(transcript.providerMetadata))}::jsonb
      );
    `);
  }

  confirmRawDeleted(mediaId, leaseToken) {
    const id = requireMediaId(mediaId);
    const lease = requireLeaseToken(leaseToken);
    this.database.execute(`select private.confirm_annotation_media_raw_deleted(${sqlText(id)}::uuid, ${sqlText(lease)}::uuid);`);
  }

  finalize(mediaId, leaseToken) {
    const id = requireMediaId(mediaId);
    const lease = requireLeaseToken(leaseToken);
    this.database.execute(`select private.finalize_annotation_media_ready(${sqlText(id)}::uuid, ${sqlText(lease)}::uuid);`);
  }

  releaseAttempt(mediaId, leaseToken, stage, code) {
    const id = requireMediaId(mediaId);
    const lease = requireLeaseToken(leaseToken);
    return this.database.json(`
      select pg_catalog.row_to_json(released)
      from private.release_annotation_media_processing_attempt(
        ${sqlText(id)}::uuid, ${sqlText(lease)}::uuid, ${sqlText(stage)}, ${sqlText(code)}
      ) released;
    `);
  }

  reconcileProcessing(mediaId) {
    const id = requireMediaId(mediaId);
    return this.database.json(`select pg_catalog.to_json(private.reconcile_annotation_media_processing(${sqlText(id)}::uuid));`);
  }

  claimCleanup(mediaId) {
    const id = requireMediaId(mediaId);
    return this.database.json(`
      select pg_catalog.row_to_json(claimed)
      from private.claim_annotation_media_cleanup_v2(${sqlText(id)}::uuid) claimed;
    `);
  }

  confirmCleanup(claim) {
    const id = requireMediaId(claim.media_id);
    return this.database.json(`
      select pg_catalog.to_json(private.confirm_annotation_media_cleanup(
        ${sqlText(id)}::uuid,
        ${sqlNullableText(claim.raw_storage_path)},
        ${sqlNullableText(claim.processed_storage_path)},
        ${sqlText(claim.observed_updated_at)}::timestamptz
      ));
    `);
  }
}
