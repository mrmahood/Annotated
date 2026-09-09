import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';
import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCommentaryContractError } from './audio-commentary.ts';
import { isUuid } from './social-helpers.ts';
import type { HostedMediaOperation } from './media-capture.ts';

export type TikTokAnnotationInput = {
  sourceUrl: string;
  title: string;
  author: string | null;
  startMs: number;
  endMs: number;
  commentaryText: string;
  hasRecordedCommentary?: boolean;
  videoDurationMs?: number | null;
};

export function parseHostedTikTokBeginResponse(data: unknown): HostedMediaOperation {
  const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (
    typeof row !== 'object' || row === null ||
    !isUuid((row as { annotation_id?: unknown }).annotation_id) ||
    !isUuid((row as { media_id?: unknown }).media_id) ||
    typeof (row as { creator_handle?: unknown }).creator_handle !== 'string' ||
    typeof (row as { annotation_slug?: unknown }).annotation_slug !== 'string' ||
    (row as { processing_status?: unknown }).processing_status !== 'capture_pending'
  ) throw new Error('Beginning hosted media returned an invalid draft.');
  return {
    annotationId: (row as { annotation_id: string }).annotation_id,
    mediaId: (row as { media_id: string }).media_id,
    creatorHandle: (row as { creator_handle: string }).creator_handle,
    annotationSlug: (row as { annotation_slug: string }).annotation_slug,
    processingStatus: 'capture_pending',
  };
}

export async function beginHostedTikTokAnnotation(
  supabase: SupabaseClient,
  input: TikTokAnnotationInput,
): Promise<HostedMediaOperation> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id)
  ) throw new Error('The authenticated session is unavailable.');

  const identity = getTikTokVideoIdentity(input.sourceUrl);
  const rangeError = getNewMediaPublicationRangeError(
    input.startMs,
    input.endMs,
    input.videoDurationMs,
  );
  if (rangeError) throw new Error(rangeError);
  const commentaryError = getCommentaryContractError(
    input.commentaryText,
    input.hasRecordedCommentary === true,
  );
  if (commentaryError) throw new Error(commentaryError);

  const { data, error } = await supabase.rpc('begin_hosted_tiktok_annotation', {
    p_normalized_url: identity.normalizedUrl,
    p_canonical_url: identity.canonicalUrl,
    p_video_id: identity.videoId,
    p_video_title: input.title,
    p_author: input.author,
    p_start_ms: input.startMs,
    p_end_ms: input.endMs,
    p_commentary_text: input.commentaryText,
  });
  if (error) {
    const raw = typeof error.message === 'string' ? error.message.trim() : '';
    throw new Error(raw || 'The TikTok clip could not be published.');
  }
  return parseHostedTikTokBeginResponse(data);
}
