import {
  getAnnotationTitleError,
  normalizeAnnotationTitle,
} from '@annotated/shared/annotation-title';
import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';
import { isSpotifyEpisodeUrl } from '@annotated/shared/spotify';
import { isTikTokVideoUrl } from '@annotated/shared/tiktok';
import { isYouTubeVideoUrl } from '@annotated/shared/youtube';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCommentaryContractError } from './audio-commentary.ts';
import { isUuid } from './social-helpers.ts';
import type { HostedMediaOperation } from './media-capture.ts';

export type AudioClipAnnotationInput = {
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  publisher: string | null;
  showName: string | null;
  startMs: number;
  endMs: number;
  commentaryText: string;
  annotationTitle?: string;
  hasRecordedCommentary?: boolean;
  mediaDurationMs: number;
};

export function parseHostedAudioBeginResponse(data: unknown): HostedMediaOperation {
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

export async function beginHostedAudioClipAnnotation(
  supabase: SupabaseClient,
  input: AudioClipAnnotationInput,
): Promise<HostedMediaOperation> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id)
  ) throw new Error('The authenticated session is unavailable.');

  if (isSpotifyEpisodeUrl(input.sourceUrl) || isSpotifyEpisodeUrl(input.canonicalUrl)) {
    throw new Error('Podcast audio clips cannot use a Spotify episode URL. Use the Spotify hosted begin path.');
  }
  if (isYouTubeVideoUrl(input.sourceUrl) || isYouTubeVideoUrl(input.canonicalUrl)) {
    throw new Error('Podcast audio clips cannot use a YouTube watch URL.');
  }
  if (isTikTokVideoUrl(input.sourceUrl) || isTikTokVideoUrl(input.canonicalUrl)) {
    throw new Error('Podcast audio clips cannot use a TikTok watch URL.');
  }
  const identity = getAudioSourceIdentity(input.sourceUrl, input.canonicalUrl);
  const rangeError = getNewMediaPublicationRangeError(
    input.startMs,
    input.endMs,
    input.mediaDurationMs,
  );
  if (rangeError) throw new Error(rangeError);
  const commentaryError = getCommentaryContractError(
    input.commentaryText,
    input.hasRecordedCommentary === true,
  );
  if (commentaryError) throw new Error(commentaryError);
  const titleError = getAnnotationTitleError(input.annotationTitle ?? '');
  if (titleError) throw new Error(titleError);

  const { data, error } = await supabase.rpc('begin_hosted_audio_annotation', {
    p_normalized_url: identity.normalizedUrl,
    p_canonical_url: identity.canonicalUrl,
    p_episode_title: input.title,
    p_author: input.author,
    p_publisher: input.publisher,
    p_show_name: input.showName,
    p_start_ms: input.startMs,
    p_end_ms: input.endMs,
    p_commentary_text: input.commentaryText,
    p_title: normalizeAnnotationTitle(input.annotationTitle),
  });
  if (error) {
    const raw = typeof error.message === 'string' ? error.message.trim() : '';
    throw new Error(raw || 'The audio clip could not be published.');
  }
  return parseHostedAudioBeginResponse(data);
}
