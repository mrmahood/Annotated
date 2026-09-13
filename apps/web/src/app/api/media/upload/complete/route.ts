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
  parseCompletionInput,
  verifyUploadedRawObject,
  type AnnotationRow,
  type MediaRow,
  HostedMediaApiError,
} from '@/lib/hosted-media-upload';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const input = parseCompletionInput(await request.json());
    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    const service = createServiceClient();
    const { data: mediaData, error: mediaError } = await service
      .from('annotation_media')
      .select('id, annotation_id, media_type, processing_status, processing_stage, raw_storage_path, raw_mime_type, raw_byte_size, capture_metadata, failure_stage, failure_code')
      .eq('id', input.mediaId)
      .maybeSingle();
    assertServiceOperation(mediaError, 'The hosted media draft could not be loaded.');
    if (!mediaData) throw new Error('The hosted media draft was not found.');
    const media = mediaData as MediaRow & {
      processing_stage: string | null;
      capture_metadata: Record<string, unknown>;
    };
    if (media.capture_metadata?.version === 1) {
      throw new HostedMediaApiError('RECAPTURE_REQUIRED', 409);
    }
    if (isRecaptureCleanupPending(media)) {
      throw new HostedMediaApiError('RECAPTURE_REQUIRED', 409);
    }
    const { data: annotationData, error: annotationError } = await service
      .from('annotations')
      .select('id, user_id, status')
      .eq('id', input.annotationId)
      .maybeSingle();
    assertServiceOperation(annotationError, 'The hosted annotation draft could not be loaded.');
    if (!annotationData) throw new Error('The hosted annotation draft was not found.');
    const annotation = annotationData as AnnotationRow;
    const expectedMime = media.media_type === 'video' ? 'video/webm' : 'audio/webm';
    authorizeRelation(user.id, {
      annotationId: input.annotationId,
      mediaId: input.mediaId,
      mimeType: expectedMime,
      byteSize: Number(media.raw_byte_size),
    }, media, annotation, ['uploading', 'processing']);
    if (!['uploading', 'processing'].includes(media.processing_status) || !media.raw_storage_path ||
        !exactPathMatches(media.raw_storage_path, user.id, input.annotationId, input.mediaId)) {
      throw new Error('The media draft is not in the exact uploading state.');
    }
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
    await verifyUploadedRawObject(
      (path) => service.storage.from('annotation-media-raw').info(path),
      media.raw_storage_path,
      expectedMime,
      Number(media.raw_byte_size),
    );

    if (media.processing_status === 'processing') {
      if (media.processing_stage !== 'queued') throw new Error('The upload has already advanced beyond the Phase B completion state.');
      return jsonResponse({ processingStatus: 'processing', processingStage: 'queued' });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await service
      .from('annotation_media')
      .update({
        processing_status: 'processing',
        processing_stage: 'queued',
        uploaded_at: now,
        next_attempt_at: now,
        failure_stage: null,
        failure_code: null,
        lease_token: null,
        lease_expires_at: null,
      })
      .eq('id', input.mediaId)
      .eq('processing_status', 'uploading')
      .eq('raw_storage_path', media.raw_storage_path)
      .select('id')
      .maybeSingle();
    assertServiceOperation(updateError, 'The upload state could not be completed.');
    if (!updated) throw new Error('The upload state changed before completion.');
    return jsonResponse({ processingStatus: 'processing', processingStage: 'queued' });
  } catch (error) {
    console.warn('[Hosted media complete]', {
      code: error instanceof HostedMediaApiError ? error.code : 'UPLOAD_COMPLETION_FAILED',
    });
    return hostedMediaErrorResponse(error, 'UPLOAD_COMPLETION_FAILED');
  }
}
