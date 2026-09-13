import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPostedConfirmation,
  createPostedKindFromMediaType,
  type CreatePostedConfirmation,
} from './create-posted.ts';
import {
  canClearHostedAttentionWithoutLiveCancel,
  isMediaUuid,
  isPreparingCaptureStatus,
  userFacingCaptureMessage,
  type CaptureSnapshot,
  type HostedMediaOperation,
} from './media-capture.ts';

export const HOSTED_MEDIA_OWNER_STATUS_POLL_MS = 4_000;

export const HOSTED_MEDIA_SESSION_KEY = 'annotated.hostedMedia.operation.v1';

export type HostedMediaSession = {
  operation: HostedMediaOperation;
  sourceUrl: string;
  mediaType: 'video' | 'audio';
  startMs: number;
  endMs: number;
  createdAt: number;
};

export type OwnedHostedMediaStatus = {
  annotationId: string;
  mediaId: string;
  mediaType: 'video' | 'audio';
  processingStatus: 'capture_pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'removed';
  processingStage: string | null;
  failureStage: string | null;
  failureCode: string | null;
  creatorHandle: string;
  annotationSlug: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isHostedMediaSession(value: unknown): value is HostedMediaSession {
  if (!isRecord(value) || !isRecord(value.operation)) return false;
  const operation = value.operation;
  return isMediaUuid(operation.annotationId) && isMediaUuid(operation.mediaId) &&
    typeof operation.creatorHandle === 'string' && typeof operation.annotationSlug === 'string' &&
    operation.processingStatus === 'capture_pending' &&
    typeof value.sourceUrl === 'string' && (value.mediaType === 'video' || value.mediaType === 'audio') &&
    typeof value.startMs === 'number' && typeof value.endMs === 'number' &&
    Number.isSafeInteger(value.startMs) && Number.isSafeInteger(value.endMs) &&
    value.startMs >= 0 && value.endMs - value.startMs >= 1_000 && value.endMs - value.startMs <= 90_000 &&
    Number.isSafeInteger(value.createdAt);
}
export function parseOwnedHostedMediaStatus(value: unknown): OwnedHostedMediaStatus {
  const row = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!isRecord(row) || !isMediaUuid(row.annotation_id) || !isMediaUuid(row.media_id) ||
      (row.media_type !== 'video' && row.media_type !== 'audio') ||
      !['capture_pending','uploading','processing','ready','failed','removed'].includes(String(row.processing_status)) ||
      typeof row.creator_handle !== 'string' || typeof row.annotation_slug !== 'string') {
    throw new Error('Hosted-media status was unavailable.');
  }
  return {
    annotationId: row.annotation_id,
    mediaId: row.media_id,
    mediaType: row.media_type,
    processingStatus: row.processing_status as OwnedHostedMediaStatus['processingStatus'],
    processingStage: typeof row.processing_stage === 'string' ? row.processing_stage : null,
    failureStage: typeof row.failure_stage === 'string' ? row.failure_stage : null,
    failureCode: typeof row.failure_code === 'string' ? row.failure_code : null,
    creatorHandle: row.creator_handle,
    annotationSlug: row.annotation_slug,
  };
}
export async function getOwnedHostedMediaStatus(supabase: SupabaseClient, annotationId: string) {
  const { data, error } = await supabase.rpc('get_owned_annotation_media_status', {
    p_annotation_id: annotationId,
  });
  if (error) throw new Error(error.message);
  return parseOwnedHostedMediaStatus(data);
}

export function ownedStatusMatchesSession(
  session: HostedMediaSession,
  status: OwnedHostedMediaStatus,
) {
  return status.annotationId === session.operation.annotationId &&
    status.mediaId === session.operation.mediaId && status.mediaType === session.mediaType;
}

export type CreatePublishStatus = 'idle' | 'publishing' | 'error';

export function shouldShowCreatePublishError(
  publishStatus: CreatePublishStatus,
  hostedSession: HostedMediaSession | null,
): boolean {
  return publishStatus === 'error' && hostedSession === null;
}

export function createPublishStateAfterHostedFailure(
  hostedSession: HostedMediaSession | null,
  message: string,
): { status: 'idle' } | { status: 'error'; message: string } {
  return hostedSession ? { status: 'idle' } : { status: 'error', message };
}

export type HostedCancelCreateReset = {
  clearVideoDraft: boolean;
  clearAudioDraft: boolean;
  followActiveTab: boolean;
  ignoreActiveCaptureHold: boolean;
};

export function hostedCancelCreateReset(
  mediaType: HostedMediaSession['mediaType'],
): HostedCancelCreateReset {
  return {
    clearVideoDraft: mediaType === 'video',
    clearAudioDraft: mediaType === 'audio',
    followActiveTab: true,
    ignoreActiveCaptureHold: true,
  };
}

export function hostedCancelClearsLocalAttention(snapshot: CaptureSnapshot): boolean {
  return canClearHostedAttentionWithoutLiveCancel(snapshot, false);
}

export const HOSTED_FOREIGN_SOURCE_CANCEL_DETAIL =
  'Cancel the in-progress clip first to publish this page.';

export function hostedSessionMatchesConnectedUrl(
  session: HostedMediaSession,
  pageUrl: string | null | undefined,
): boolean {
  if (!pageUrl) return false;
  try {
    const sessionUrl = new URL(session.sourceUrl);
    const connected = new URL(pageUrl);
    if (!['http:', 'https:'].includes(sessionUrl.protocol) ||
        !['http:', 'https:'].includes(connected.protocol)) {
      return false;
    }
    const sessionHost = sessionUrl.hostname.toLowerCase().replace(/^www\./, '');
    const connectedHost = connected.hostname.toLowerCase().replace(/^www\./, '');
    return sessionHost === connectedHost;
  } catch {
    return session.sourceUrl === pageUrl;
  }
}

export type HostedMediaProgressCopy = {
  title: string;
  detail: string | null;
  busy: boolean;
};

const QUEUED_STAGE_DETAIL = 'Waiting for processing to start.';
const PROCESSING_STAGE_DETAIL = {
  queued: QUEUED_STAGE_DETAIL,
  probing: 'Checking the captured clip.',
  transcoding: 'Creating the playable clip.',
  transcribing: 'Transcribing the excerpt.',
  raw_cleanup: 'Finishing the clip.',
  finalizing: 'Finishing the clip.',
} as const;

export function hostedMediaProcessingStageDetail(stage: string | null | undefined): string {
  if (!stage) return QUEUED_STAGE_DETAIL;
  if (stage in PROCESSING_STAGE_DETAIL) {
    return PROCESSING_STAGE_DETAIL[stage as keyof typeof PROCESSING_STAGE_DETAIL];
  }
  return 'Working on the clip.';
}

export function hostedMediaProgressCopy(input: {
  cancelling: boolean;
  snapshot: CaptureSnapshot;
  foreignSource?: boolean;
}): HostedMediaProgressCopy {
  if (input.cancelling) {
    return { title: 'Cancelling draft…', detail: null, busy: true };
  }
  if (input.foreignSource) {
    return {
      ...hostedMediaProgressCopy({ ...input, foreignSource: false }),
      detail: HOSTED_FOREIGN_SOURCE_CANCEL_DETAIL,
    };
  }
  const { snapshot } = input;
  if (snapshot.status === 'uploading') {
    return { title: `Uploading clip… ${snapshot.progress}%`, detail: null, busy: true };
  }
  if (snapshot.status === 'waiting-to-upload') {
    return { title: 'Waiting to upload—keep Chrome open', detail: snapshot.message, busy: true };
  }
  if (snapshot.status === 'verifying-upload') {
    return {
      title: 'Confirming uploaded clip…',
      detail: 'Checking that the clip is queued for processing.',
      busy: true,
    };
  }
  if (snapshot.status === 'processing') {
    const stage = snapshot.processingStage ?? 'queued';
    if (stage === 'queued') {
      return {
        title: 'Uploaded and queued',
        detail: hostedMediaProcessingStageDetail(stage),
        busy: true,
      };
    }
    return {
      title: 'Processing clip',
      detail: hostedMediaProcessingStageDetail(stage),
      busy: true,
    };
  }
  if (snapshot.status === 'error') {
    return {
      title: 'Capture needs attention',
      detail: userFacingCaptureMessage(snapshot),
      busy: false,
    };
  }
  if (snapshot.status === 'stopping') {
    return { title: 'Finishing capture…', detail: null, busy: true };
  }
  if (snapshot.status === 'capturing') {
    return { title: 'Capturing clip…', detail: null, busy: true };
  }
  if (isPreparingCaptureStatus(snapshot.status)) {
    return { title: 'Preparing capture…', detail: null, busy: true };
  }
  if (snapshot.status === 'cancelled') {
    return { title: 'Capture needs attention', detail: userFacingCaptureMessage(snapshot), busy: false };
  }
  return { title: 'Working…', detail: null, busy: true };
}

export function presentHostedMediaSnapshot(snapshot: CaptureSnapshot): CaptureSnapshot {
  if (snapshot.status === 'processing') {
    return {
      status: 'verifying-upload',
      captureId: snapshot.captureId,
      annotationId: snapshot.annotationId,
      mediaId: snapshot.mediaId,
    };
  }
  if (snapshot.status === 'cancelled' &&
      (snapshot.code === 'connected-source-changed' || snapshot.code === 'connected-tab-closed')) {
    return { ...snapshot, status: 'error' };
  }
  return snapshot;
}

export type HostedMediaReconciliation =
  | { action: 'clear' }
  | { action: 'posted'; confirmation: CreatePostedConfirmation }
  | { action: 'show'; snapshot: CaptureSnapshot };

export function shouldPollHostedOwnerStatus(snapshot: CaptureSnapshot): boolean {
  return snapshot.status === 'processing' || snapshot.status === 'verifying-upload';
}

function recoveryError(
  code: 'completion-failed' | 'recapture-required' | 'raw-capture-unavailable',
  message: string,
): HostedMediaReconciliation {
  return {
    action: 'show',
    snapshot: { status: 'error', captureId: null, code, message },
  };
}

export function reconcileHostedMediaState(
  session: HostedMediaSession,
  owned: OwnedHostedMediaStatus,
  live: CaptureSnapshot | null,
  liveOperation: HostedMediaOperation | null,
): HostedMediaReconciliation {
  if (!ownedStatusMatchesSession(session, owned)) {
    return recoveryError(
      'completion-failed',
      'The hosted-media server status does not match this saved operation. Cancel the draft before trying again.',
    );
  }
  if (owned.processingStatus === 'removed') {
    return { action: 'clear' };
  }
  if (owned.processingStatus === 'ready') {
    return {
      action: 'posted',
      confirmation: createPostedConfirmation({
        annotationId: owned.annotationId,
        kind: createPostedKindFromMediaType(owned.mediaType),
        creatorHandle: owned.creatorHandle,
        annotationSlug: owned.annotationSlug,
      }),
    };
  }
  if (owned.processingStatus === 'processing') {
    const captureId = live && 'captureId' in live && live.captureId ? live.captureId : 'restored';
    return {
      action: 'show',
      snapshot: {
        status: 'processing',
        captureId,
        annotationId: owned.annotationId,
        mediaId: owned.mediaId,
        processingStage: owned.processingStage,
      },
    };
  }

  const liveMatches = Boolean(live && liveOperation &&
    liveOperation.annotationId === session.operation.annotationId &&
    liveOperation.mediaId === session.operation.mediaId);
  if (liveMatches && live && !['idle', 'processing', 'verifying-upload'].includes(live.status)) {
    return { action: 'show', snapshot: live };
  }
  if (owned.processingStatus === 'uploading') {
    if (liveMatches && live && (
      live.status === 'verifying-upload' ||
      live.status === 'uploading' ||
      live.status === 'waiting-to-upload'
    )) {
      return { action: 'show', snapshot: live };
    }
    return recoveryError(
      'raw-capture-unavailable',
      'The raw clip is no longer available after Chrome restarted. Cancel this draft, then create the clip again.',
    );
  }
  if (owned.processingStatus === 'capture_pending') {
    return recoveryError(
      'recapture-required',
      'The saved draft has no live capture. Reconnect the original source and choose Recapture, or cancel the draft.',
    );
  }
  return recoveryError(
    'recapture-required',
    'Capture failed. Reconnect the original source and choose Recapture, or cancel the draft.',
  );
}

export async function cancelOwnedHostedMedia(
  supabase: SupabaseClient,
  session: HostedMediaSession,
  cancelLaterState: () => Promise<void>,
) {
  const before = await getOwnedHostedMediaStatus(supabase, session.operation.annotationId);
  if (!ownedStatusMatchesSession(session, before)) {
    throw new Error('The hosted-media draft identifiers no longer match the owner-visible server state.');
  }
  if (before.processingStatus !== 'removed') {
    if (before.processingStatus === 'capture_pending') {
      const { data, error } = await supabase.rpc('cancel_hosted_media_annotation', {
        p_annotation_id: session.operation.annotationId,
      });
      if (error || data !== true) {
        throw new Error('The owner-scoped capture-pending cancellation was not accepted.');
      }
    } else {
      await cancelLaterState();
    }
  }
  const after = await getOwnedHostedMediaStatus(supabase, session.operation.annotationId);
  if (!ownedStatusMatchesSession(session, after) || after.processingStatus !== 'removed') {
    throw new Error('Cancellation was not confirmed by the owner-visible server state.');
  }
  return after;
}

const CANCEL_ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'The cancellation request was invalid. Refresh the draft and try again.',
  AUTH_REQUIRED: 'Your session could not be verified. Sign in again, then retry cancellation.',
  MEDIA_NOT_FOUND: 'The hosted-media draft could not be found.',
  MEDIA_NOT_OWNED: 'This hosted-media draft cannot be cancelled by the current account.',
  MEDIA_RELATION_INVALID: 'The hosted-media draft identifiers no longer match.',
  MEDIA_NOT_CANCELLABLE: 'The hosted-media draft cannot be cancelled in its current state.',
  RAW_PATH_INVALID: 'The private raw media path could not be verified.',
  RAW_DELETE_FAILED: 'The private raw media could not be cleaned up. Try again.',
  CANCEL_CONFLICT: 'The hosted-media draft changed before cancellation. Refresh and try again.',
  SERVER_MISCONFIGURED: 'Hosted-media cancellation is not configured on the web server.',
};

export async function getHostedMediaCancelError(response: Response) {
  let code = '';
  try {
    const body = await response.json() as { error?: unknown };
    code = typeof body?.error === 'string' ? body.error : '';
  } catch { /* Keep the bounded fallback. */ }
  return CANCEL_ERROR_MESSAGES[code] ?? 'The hosted-media draft could not be cancelled.';
}
