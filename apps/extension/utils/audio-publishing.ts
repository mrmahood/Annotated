import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from './social-helpers.ts';

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
  mediaDurationMs: number;
};

export async function publishAudioClipAnnotation(
  supabase: SupabaseClient,
  input: AudioClipAnnotationInput,
): Promise<string> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id)
  ) throw new Error('The authenticated session is unavailable.');

  const identity = getAudioSourceIdentity(input.sourceUrl, input.canonicalUrl);
  const rangeError = getNewMediaPublicationRangeError(
    input.startMs,
    input.endMs,
    input.mediaDurationMs,
  );
  if (rangeError) throw new Error(rangeError);
  if (!input.commentaryText.trim() || input.commentaryText.length > 2_000) {
    throw new Error('Commentary must contain between 1 and 2,000 characters.');
  }

  const { data, error } = await supabase.rpc('publish_audio_clip_annotation', {
    p_normalized_url: identity.normalizedUrl,
    p_canonical_url: identity.canonicalUrl,
    p_episode_title: input.title,
    p_author: input.author,
    p_publisher: input.publisher,
    p_show_name: input.showName,
    p_start_ms: input.startMs,
    p_end_ms: input.endMs,
    p_commentary_text: input.commentaryText,
  });
  if (error) throw new Error(error.message);
  if (!isUuid(data)) throw new Error('Publishing returned an invalid annotation identifier.');
  return data;
}
