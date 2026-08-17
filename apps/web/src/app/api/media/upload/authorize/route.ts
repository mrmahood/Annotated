import {
  CORS_HEADERS,
  assertServiceOperation,
  authenticatedUser,
  authorizeRelation,
  createAuthenticatedClient,
  createServiceClient,
  exactPathMatches,
  hostedMediaErrorResponse,
  jsonResponse,
  parseAuthorizeInput,
  rawStoragePath,
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
      .select('id, annotation_id, media_type, processing_status, raw_storage_path, raw_mime_type, raw_byte_size, capture_metadata')
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
    if (media.processing_status === 'uploading') {
      if (!path || !exactPathMatches(path, user.id, input.annotationId, input.mediaId) ||
          media.raw_mime_type !== input.mimeType || Number(media.raw_byte_size) !== input.byteSize ||
          stableJson(media.capture_metadata) !== stableJson(input.captureMetadata)) {
        throw new Error('The existing upload authorization does not match this capture.');
      }
    } else {
      path = rawStoragePath(user.id, input.annotationId, input.mediaId, crypto.randomUUID());
      const { data: updated, error: updateError } = await service
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
          next_attempt_at: null,
          lease_token: null,
          lease_expires_at: null,
        })
        .eq('id', input.mediaId)
        .in('processing_status', ['capture_pending', 'failed'])
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
