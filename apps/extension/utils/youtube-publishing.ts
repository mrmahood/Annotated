import { getClipRangeError } from '@annotated/shared/media-time';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from './social-helpers.ts';

export type YouTubeAnnotationInput = {
  sourceUrl: string;
  title: string;
  channelName: string | null;
  startMs: number;
  endMs: number;
  commentaryText: string;
  videoDurationMs?: number | null;
};

export async function publishYouTubeAnnotation(
  supabase: SupabaseClient,
  input: YouTubeAnnotationInput,
): Promise<string> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id)
  ) throw new Error('The authenticated session is unavailable.');

  const identity = getYouTubeVideoIdentity(input.sourceUrl);
  const rangeError = getClipRangeError(input.startMs, input.endMs, input.videoDurationMs);
  if (rangeError) throw new Error(rangeError);
  if (!input.commentaryText.trim() || input.commentaryText.length > 2_000) {
    throw new Error('Commentary must contain between 1 and 2,000 characters.');
  }

  const { data, error } = await supabase.rpc('publish_youtube_annotation', {
    p_normalized_url: identity.normalizedUrl,
    p_canonical_url: identity.canonicalUrl,
    p_video_id: identity.videoId,
    p_video_title: input.title,
    p_channel_name: input.channelName,
    p_start_ms: input.startMs,
    p_end_ms: input.endMs,
    p_commentary_text: input.commentaryText,
  });
  if (error) throw new Error(error.message);
  if (!isUuid(data)) throw new Error('Publishing returned an invalid annotation identifier.');
  return data;
}
