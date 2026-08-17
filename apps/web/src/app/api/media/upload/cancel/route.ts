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
    if (ownerStatus.processing_status === 'removed') {
      return jsonResponse({ cancelled: true, code: 'MEDIA_ALREADY_CANCELLED' });
    }
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
      .select('id, annotation_id, processing_status, raw_storage_path')
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
    if (disposition === 'already-cancelled') {
      return jsonResponse({ cancelled: true, code: 'MEDIA_ALREADY_CANCELLED' });
    }
    if (media.raw_storage_path) {
      const { error: removeError } = await service.storage
        .from('annotation-media-raw')
        .remove([media.raw_storage_path]);
      try { assertServiceOperation(removeError, 'The private raw media could not be deleted.'); }
      catch (error) {
        if (error instanceof HostedMediaApiError) throw error;
        throw new HostedMediaApiError('RAW_DELETE_FAILED', 502);
      }
    }
    const { data: removed, error: updateError } = await service
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
      .neq('processing_status', 'ready')
      .neq('processing_status', 'removed')
      .select('id')
      .maybeSingle();
    assertServiceOperation(updateError, 'The hosted media state could not be cancelled.');
    if (!removed) throw new HostedMediaApiError('CANCEL_CONFLICT', 409);
    return jsonResponse({ cancelled: true, code: 'MEDIA_CANCELLED' });
  } catch (error) {
    console.warn('[Hosted media cancel]', {
      code: error instanceof HostedMediaApiError ? error.code : 'CANCEL_CONFLICT',
    });
    return hostedMediaErrorResponse(error, 'CANCEL_CONFLICT', 409);
  }
}
