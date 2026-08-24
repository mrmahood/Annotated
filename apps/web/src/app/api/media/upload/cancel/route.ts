import {
  CORS_HEADERS,
  assertServiceOperation,
  assertCancellationRelation,
  authenticatedUser,
  createAuthenticatedClient,
  createServiceClient,
  hostedMediaErrorResponse,
  jsonResponse,
  parseCancelInput,
  privateArtifactPaths,
  removePrivateArtifacts,
  HostedMediaApiError,
} from '@/lib/hosted-media-upload';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new HostedMediaApiError('INVALID_REQUEST', 400); }
    const input = parseCancelInput(body);

    // A freshly created capture_pending draft has no raw object. Use the
    // owner-scoped Phase A RPC so this safe path does not require service-role
    // credentials in a local development server.
    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    const { data: ownerRows, error: ownerStatusError } = await ownerClient.rpc(
      'get_owned_annotation_media_status', { p_annotation_id: input.annotationId },
    );
    if (ownerStatusError) throw new HostedMediaApiError('MEDIA_NOT_FOUND', 404);
    const ownerRow = Array.isArray(ownerRows) ? ownerRows[0] : ownerRows;
    if (!ownerRow || typeof ownerRow !== 'object') throw new HostedMediaApiError('MEDIA_NOT_FOUND', 404);
    const ownerStatus = ownerRow as { media_id?: unknown; processing_status?: unknown };
    if (ownerStatus.media_id !== input.mediaId) throw new HostedMediaApiError('MEDIA_RELATION_INVALID', 403);
    if (ownerStatus.processing_status === 'capture_pending') {
      const { data: cancelled, error: cancelError } = await ownerClient.rpc(
        'cancel_hosted_media_annotation', { p_annotation_id: input.annotationId },
      );
      if (cancelError || cancelled !== true) throw new HostedMediaApiError('CANCEL_CONFLICT', 409);
      return jsonResponse({ cancelled: true, code: 'MEDIA_CANCELLED' });
    }

    // Any later state can have a private raw object. Keep deletion and the
    // conditional lifecycle transition on the service-only path.
    const service = createServiceClient();
    const { data: media, error: mediaError } = await service
      .from('annotation_media')
      .select('id, annotation_id, media_type, processing_status, raw_storage_path, processed_storage_path, updated_at')
      .eq('id', input.mediaId)
      .maybeSingle();
    const { data: annotation, error: annotationError } = await service
      .from('annotations')
      .select('id, user_id, status')
      .eq('id', input.annotationId)
      .maybeSingle();
    assertServiceOperation(mediaError, 'The hosted media draft could not be loaded for cancellation.');
    assertServiceOperation(annotationError, 'The hosted annotation draft could not be loaded for cancellation.');
    if (!media || !annotation) throw new HostedMediaApiError('MEDIA_NOT_FOUND', 404);
    const disposition = assertCancellationRelation(user.id, input, media, annotation);
    const retainedPaths = privateArtifactPaths(user.id, input.annotationId, media);
    if (disposition !== 'already-cancelled') {
      let removeTransition = service
        .from('annotation_media')
        .update({
          processing_status: 'removed',
          processing_stage: null,
          removed_at: new Date().toISOString(),
          next_attempt_at: null,
          lease_token: null,
          lease_expires_at: null,
        })
        .eq('id', input.mediaId)
        .eq('processing_status', media.processing_status)
        .eq('updated_at', media.updated_at);
      removeTransition = media.raw_storage_path === null
        ? removeTransition.is('raw_storage_path', null)
        : removeTransition.eq('raw_storage_path', media.raw_storage_path);
      removeTransition = media.processed_storage_path === null
        ? removeTransition.is('processed_storage_path', null)
        : removeTransition.eq('processed_storage_path', media.processed_storage_path);
      const { data: removed, error: updateError } = await removeTransition
        .select('id')
        .maybeSingle();
      assertServiceOperation(updateError, 'The hosted media state could not be cancelled.');
      if (!removed) throw new HostedMediaApiError('CANCEL_CONFLICT', 409);
    }
    await removePrivateArtifacts(service.storage, {
      raw: retainedPaths.raw,
      processed: retainedPaths.expectedProcessed,
    });
    return jsonResponse({
      cancelled: true,
      code: disposition === 'already-cancelled' ? 'MEDIA_ALREADY_CANCELLED' : 'MEDIA_CANCELLED',
    });
  } catch (error) {
    console.warn('[Hosted media cancel]', {
      code: error instanceof HostedMediaApiError ? error.code : 'CANCEL_CONFLICT',
    });
    return hostedMediaErrorResponse(error, 'CANCEL_CONFLICT', 409);
  }
}
