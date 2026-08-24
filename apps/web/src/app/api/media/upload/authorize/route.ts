import {
  CORS_HEADERS,
  assertServiceOperation,
  authenticatedUser,
  authorizeRelation,
  createAuthenticatedClient,
  createServiceClient,
  exactPathMatches,
  hostedMediaErrorResponse,
  isRecaptureCleanupPending,
  jsonResponse,
  parseAuthorizeInput,
  privateArtifactPaths,
  rawStoragePath,
  removePrivateArtifacts,
  RECAPTURE_CLEANUP_CODE,
  RECAPTURE_CLEANUP_STAGE,
  stableJson,
  type AnnotationRow,
  type MediaRow,
  HostedMediaApiError,
} from '@/lib/hosted-media-upload';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const input = parseAuthorizeInput(await request.json());
    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    const service = createServiceClient();
    const { data: mediaData, error: mediaError } = await service
      .from('annotation_media')
      .select('id, annotation_id, media_type, processing_status, raw_storage_path, processed_storage_path, raw_mime_type, raw_byte_size, capture_metadata, failure_stage, failure_code, updated_at')
      .eq('id', input.mediaId)
      .maybeSingle();
    assertServiceOperation(mediaError, 'The hosted media draft could not be loaded.');
    if (!mediaData) throw new Error('The hosted media draft was not found.');
    const media = mediaData as MediaRow & { capture_metadata: Record<string, unknown> };
    const { data: annotationData, error: annotationError } = await service
      .from('annotations')
      .select('id, user_id, status')
      .eq('id', input.annotationId)
      .maybeSingle();
    assertServiceOperation(annotationError, 'The hosted annotation draft could not be loaded.');
    if (!annotationData) throw new Error('The hosted annotation draft was not found.');
    const annotation = annotationData as AnnotationRow;
    authorizeRelation(user.id, input, media, annotation);
    const { data: target, error: targetError } = await service
      .from('annotation_targets')
      .select('start_ms, end_ms')
      .eq('annotation_id', input.annotationId)
      .eq('target_type', 'time_range')
      .maybeSingle();
    assertServiceOperation(targetError, 'The hosted annotation target could not be loaded.');
    if (!target || target.start_ms !== input.startMs || target.end_ms !== input.endMs) {
      throw new Error('The selected range does not match the hosted annotation target.');
    }

    let path = media.raw_storage_path;
    const recaptureCleanupPending = isRecaptureCleanupPending(media);
    const requiresRecaptureCleanup = media.processing_status === 'failed' || recaptureCleanupPending;
    if (media.processing_status === 'uploading' && !recaptureCleanupPending) {
      if (media.capture_metadata?.version === 1) {
        throw new HostedMediaApiError('RECAPTURE_REQUIRED', 409);
      }
      if (!path || !exactPathMatches(path, user.id, input.annotationId, input.mediaId) ||
          media.raw_mime_type !== input.mimeType || Number(media.raw_byte_size) !== input.byteSize ||
          stableJson(media.capture_metadata) !== stableJson(input.captureMetadata)) {
        throw new Error('The existing upload authorization does not match this capture.');
      }
    } else {
      path = rawStoragePath(user.id, input.annotationId, input.mediaId, crypto.randomUUID());
      const retainedPaths = privateArtifactPaths(user.id, input.annotationId, media);
      let expectedStatus = media.processing_status;
      let expectedUpdatedAt = media.updated_at;
      if (media.processing_status === 'capture_pending' && (retainedPaths.raw || retainedPaths.processed)) {
        throw new Error('The capture-pending draft unexpectedly retains private media.');
      }
      if (media.processing_status === 'failed') {
        // Fence the terminal row before touching Storage. This preserves both
        // old paths durably across a crash while preventing any worker retry
        // from publishing the derivative being removed.
        let fenceQuery = service
          .from('annotation_media')
          .update({
            processing_status: 'uploading',
            processing_stage: null,
            failure_stage: RECAPTURE_CLEANUP_STAGE,
            failure_code: RECAPTURE_CLEANUP_CODE,
            next_attempt_at: null,
            lease_token: null,
            lease_expires_at: null,
          })
          .eq('id', input.mediaId)
          .eq('processing_status', 'failed')
          .eq('updated_at', media.updated_at);
        fenceQuery = media.raw_storage_path === null
          ? fenceQuery.is('raw_storage_path', null)
          : fenceQuery.eq('raw_storage_path', media.raw_storage_path);
        fenceQuery = media.processed_storage_path === null
          ? fenceQuery.is('processed_storage_path', null)
          : fenceQuery.eq('processed_storage_path', media.processed_storage_path);
        const { data: fenced, error: fenceError } = await fenceQuery
          .select('updated_at')
          .maybeSingle();
        assertServiceOperation(fenceError, 'The failed media draft could not be fenced for recapture.');
        if (!fenced) throw new Error('The failed media draft changed before recapture cleanup.');
        expectedStatus = 'uploading';
        expectedUpdatedAt = fenced.updated_at;
      }
      if (requiresRecaptureCleanup) {
        // This deletion sequence is deliberately idempotent. If Storage or
        // transcript cleanup fails after the fence, the exact marker remains
        // durable and the next authorization request resumes here.
        await removePrivateArtifacts(service.storage, {
          raw: retainedPaths.raw,
          processed: retainedPaths.expectedProcessed,
        });
        const { error: transcriptError } = await service
          .from('annotation_transcripts')
          .delete()
          .eq('annotation_id', input.annotationId);
        assertServiceOperation(transcriptError, 'The retained transcript could not be cleared for recapture.');
      }
      let updateQuery = service
        .from('annotation_media')
        .update({
          processing_status: 'uploading',
          processing_stage: null,
          capture_metadata: input.captureMetadata,
          raw_storage_path: path,
          raw_mime_type: input.mimeType,
          raw_byte_size: input.byteSize,
          raw_checksum_sha256: null,
          processed_storage_path: null,
          processed_mime_type: null,
          duration_ms: null,
          width: null,
          height: null,
          byte_size: null,
          checksum_sha256: null,
          processed_at: null,
          raw_deleted_at: null,
          failure_stage: null,
          failure_code: null,
          attempt_count: 0,
          next_attempt_at: null,
          lease_token: null,
          lease_expires_at: null,
        })
        .eq('id', input.mediaId)
        .eq('processing_status', expectedStatus);
      updateQuery = media.raw_storage_path === null
        ? updateQuery.is('raw_storage_path', null)
        : updateQuery.eq('raw_storage_path', media.raw_storage_path);
      updateQuery = media.processed_storage_path === null
        ? updateQuery.is('processed_storage_path', null)
        : updateQuery.eq('processed_storage_path', media.processed_storage_path);
      if (requiresRecaptureCleanup) {
        updateQuery = updateQuery
          .eq('failure_stage', RECAPTURE_CLEANUP_STAGE)
          .eq('failure_code', RECAPTURE_CLEANUP_CODE);
      }
      updateQuery = updateQuery.eq('updated_at', expectedUpdatedAt);
      const { data: updated, error: updateError } = await updateQuery
        .select('id')
        .maybeSingle();
      assertServiceOperation(updateError, 'The media draft could not enter uploading state.');
      if (!updated) throw new Error('The media draft changed before upload authorization.');
    }

    const { data: signed, error: signedError } = await service.storage
      .from('annotation-media-raw')
      .createSignedUploadUrl(path, { upsert: false });
    assertServiceOperation(signedError, 'A short-lived upload authorization could not be created.');
    if (!signed?.signedUrl) throw new Error('A short-lived upload authorization could not be created.');
    return jsonResponse({ signedUrl: signed.signedUrl, expiresInSeconds: 7_200, upsert: false });
  } catch (error) {
    console.warn('[Hosted media authorize]', {
      code: error instanceof HostedMediaApiError ? error.code : 'UPLOAD_AUTHORIZATION_FAILED',
    });
    return hostedMediaErrorResponse(error, 'UPLOAD_AUTHORIZATION_FAILED');
  }
}
