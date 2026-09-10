import {
  getAnnotationTitleError,
  normalizeAnnotationTitle,
} from '@annotated/shared/annotation-title';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANNOTATION_AUDIO_BUCKET,
  ANNOTATION_AUDIO_MIME_TYPE,
  ATTACH_OWNER_ANNOTATION_AUDIO_RPC,
  createAudioStoragePath,
  getAudioValidationError,
  getCommentaryContractError,
  getPublishRpcName,
} from './audio-commentary.ts';
import { isUuid } from './social-helpers.ts';

export type ArticleAnnotationInput = {
  normalizedUrl: string;
  canonicalUrl: string;
  pageTitle: string;
  author: string | null;
  publisher: string | null;
  selectedText: string;
  textPrefix: string;
  textSuffix: string;
  commentaryText: string;
  annotationTitle?: string;
};

export type RecordedAudioInput = {
  blob: Blob;
  durationMs: number;
};

export type CleanupDiagnostic = {
  storagePath: string;
  message: string;
};

function getRpcArguments(
  input: ArticleAnnotationInput,
  audio?: {
    storagePath: string;
    durationMs: number;
    byteSize: number;
  },
) {
  return {
    p_normalized_url: input.normalizedUrl,
    p_canonical_url: input.canonicalUrl,
    p_page_title: input.pageTitle,
    p_author: input.author,
    p_publisher: input.publisher,
    p_selected_text: input.selectedText,
    p_text_prefix: input.textPrefix,
    p_text_suffix: input.textSuffix,
    p_commentary_text: input.commentaryText,
    p_title: normalizeAnnotationTitle(input.annotationTitle),
    ...(audio ? {
      p_storage_path: audio.storagePath,
      p_audio_duration_ms: audio.durationMs,
      p_audio_mime_type: ANNOTATION_AUDIO_MIME_TYPE,
      p_audio_byte_size: audio.byteSize,
    } : {}),
  };
}

export async function publishArticleAnnotation(
  supabase: SupabaseClient,
  input: ArticleAnnotationInput,
  audio?: RecordedAudioInput,
  onCleanupFailure?: (diagnostic: CleanupDiagnostic) => void,
): Promise<string> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id)
  ) {
    throw new Error('The authenticated session is unavailable.');
  }

  const commentaryError = getCommentaryContractError(input.commentaryText, Boolean(audio));
  if (commentaryError) throw new Error(commentaryError);
  const titleError = getAnnotationTitleError(input.annotationTitle ?? '');
  if (titleError) throw new Error(titleError);

  if (!audio) {
    const { data, error } = await supabase.rpc(
      getPublishRpcName(false),
      getRpcArguments(input),
    );
    if (error) throw new Error(error.message);
    if (!isUuid(data)) {
      throw new Error('Publishing returned an invalid annotation identifier.');
    }
    return data;
  }

  const validationError = getAudioValidationError(audio.blob, audio.durationMs);
  if (validationError) throw new Error(validationError);
  const storagePath = createAudioStoragePath(sessionUser.id);
  const bucket = supabase.storage.from(ANNOTATION_AUDIO_BUCKET);
  const { data: uploadData, error: uploadError } = await bucket.upload(
    storagePath,
    audio.blob,
    {
      upsert: false,
      contentType: ANNOTATION_AUDIO_MIME_TYPE,
    },
  );
  if (uploadError || uploadData?.path !== storagePath) {
    throw new Error('The audio upload failed.');
  }

  const { data, error } = await supabase.rpc(
    getPublishRpcName(true),
    getRpcArguments(input, {
      storagePath,
      durationMs: audio.durationMs,
      byteSize: audio.blob.size,
    }),
  );

  if (error) {
    const { error: cleanupError } = await bucket.remove([storagePath]);
    if (cleanupError) {
      onCleanupFailure?.({
        storagePath,
        message: 'The uploaded object could not be removed after the database publication failed.',
      });
    }
    throw new Error(error.message);
  }
  if (!isUuid(data)) {
    // The RPC reports success only after its transaction commits. Do not delete
    // the object here: doing so could break a publication that actually exists.
    throw new Error('Publishing returned an invalid annotation identifier.');
  }
  return data;
}

export async function uploadAndAttachOwnerCommentaryAudio(
  supabase: SupabaseClient,
  annotationId: string,
  audio: RecordedAudioInput,
  onCleanupFailure?: (diagnostic: CleanupDiagnostic) => void,
): Promise<void> {
  const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] =
    await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
  const sessionUser = sessionData.session?.user;
  if (
    sessionError || userError || !sessionUser || !userData.user ||
    userData.user.id !== sessionUser.id || !isUuid(sessionUser.id) || !isUuid(annotationId)
  ) {
    throw new Error('The authenticated session is unavailable.');
  }

  const validationError = getAudioValidationError(audio.blob, audio.durationMs);
  if (validationError) throw new Error(validationError);
  const storagePath = createAudioStoragePath(sessionUser.id);
  const bucket = supabase.storage.from(ANNOTATION_AUDIO_BUCKET);
  const { data: uploadData, error: uploadError } = await bucket.upload(
    storagePath,
    audio.blob,
    {
      upsert: false,
      contentType: ANNOTATION_AUDIO_MIME_TYPE,
    },
  );
  if (uploadError || uploadData?.path !== storagePath) {
    throw new Error('The audio upload failed.');
  }

  const { error } = await supabase.rpc(ATTACH_OWNER_ANNOTATION_AUDIO_RPC, {
    p_annotation_id: annotationId,
    p_storage_path: storagePath,
    p_audio_duration_ms: audio.durationMs,
    p_audio_mime_type: ANNOTATION_AUDIO_MIME_TYPE,
    p_audio_byte_size: audio.blob.size,
  });

  if (error) {
    const { error: cleanupError } = await bucket.remove([storagePath]);
    if (cleanupError) {
      onCleanupFailure?.({
        storagePath,
        message: 'The uploaded object could not be removed after the database attachment failed.',
      });
    }
    throw new Error(error.message);
  }
}
