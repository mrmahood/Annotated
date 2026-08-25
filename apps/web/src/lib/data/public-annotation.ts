import { cache } from "react";
import { ANNOTATION_AUDIO_BUCKET, parsePublicAnnotationAudio } from "@/lib/audio-commentary";
import { mapPublicAnnotationDetail, type PublicAnnotation } from "./public-annotation-model";
import { isUuid } from "@/lib/public-content";
import {
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
  type PublicAnnotationRoute,
} from "@/lib/public-routes";
import { createClient } from "@/lib/supabase/server";

export type ResolvedPublicAnnotationRoute = PublicAnnotationRoute & {
  annotationId: string;
  matchedHandleIsAlias: boolean;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResolvedRoute(
  value: unknown,
  includeAlias: boolean,
): ResolvedPublicAnnotationRoute | null {
  if (!isRecord(value)) return null;
  const annotationId = value.annotation_id;
  const creatorHandle = value.current_creator_handle;
  const annotationSlug = value.annotation_slug;
  const matchedHandleIsAlias = includeAlias
    ? value.matched_handle_is_alias
    : false;

  if (
    typeof annotationId !== "string" ||
    !isUuid(annotationId) ||
    !isPublicCreatorHandle(creatorHandle) ||
    !isPublicAnnotationSlug(annotationSlug) ||
    typeof matchedHandleIsAlias !== "boolean"
  ) {
    return null;
  }

  return { annotationId, creatorHandle, annotationSlug, matchedHandleIsAlias };
}

export const resolvePublicAnnotationRoute = cache(
  async (
    creatorHandle: string,
    annotationSlug: string,
  ): Promise<ResolvedPublicAnnotationRoute | null> => {
    if (
      !isPublicCreatorHandle(creatorHandle) ||
      !isPublicAnnotationSlug(annotationSlug)
    ) {
      return null;
    }

    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .rpc("resolve_public_annotation_route", {
          p_creator_handle: creatorHandle,
          p_annotation_slug: annotationSlug,
        })
        .maybeSingle();
      return error ? null : parseResolvedRoute(data, true);
    } catch {
      return null;
    }
  },
);

export const resolvePublicAnnotationUuid = cache(
  async (annotationId: string): Promise<ResolvedPublicAnnotationRoute | null> => {
    if (!isUuid(annotationId)) return null;

    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .rpc("resolve_public_annotation_uuid", { p_annotation_id: annotationId })
        .maybeSingle();
      return error ? null : parseResolvedRoute(data, false);
    } catch {
      return null;
    }
  },
);

export const loadPublicAnnotation = cache(
  async (annotationId: string): Promise<PublicAnnotation | null> => {
    if (!isUuid(annotationId)) return null;

    try {
      const supabase = await createClient();
      const { data: annotation, error: annotationError } = await supabase
        .from("annotations")
        .select("id, source_id, user_id, annotation_type, commentary_text, published_at, slug, audio:annotation_audio(storage_path, duration_ms, mime_type, byte_size)")
        .eq("id", annotationId)
        .eq("status", "published")
        .maybeSingle();

      if (annotationError || !annotation) return null;

      const [targetResult, sourceResult, profileResult, mediaStateResult] = await Promise.all([
        supabase
          .from("annotation_targets")
          .select("target_type, selected_text, start_ms, end_ms")
          .eq("annotation_id", annotation.id)
          .maybeSingle(),
        supabase
          .from("sources")
          .select("canonical_url, normalized_url, source_type, title, author, publisher, metadata")
          .eq("id", annotation.source_id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .eq("id", annotation.user_id)
          .maybeSingle(),
        supabase
          .rpc("get_public_annotation_media_state", { p_annotation_id: annotation.id })
          .maybeSingle(),
      ]);

      if (
        targetResult.error ||
        sourceResult.error ||
        profileResult.error ||
        mediaStateResult.error
      ) return null;

      let transcript: unknown = null;
      const mediaState = mediaStateResult.data as { availability?: unknown } | null;
      if (mediaState?.availability === "ready") {
        const transcriptResult = await supabase
          .rpc("get_public_annotation_transcript", { p_annotation_id: annotation.id })
          .maybeSingle();
        if (transcriptResult.error || !transcriptResult.data) return null;
        transcript = transcriptResult.data;
      }

      const audioMetadata = parsePublicAnnotationAudio(annotation.audio);
      let annotationAudioPublicUrl: string | null = null;
      if (audioMetadata) {
        annotationAudioPublicUrl = supabase.storage
          .from(ANNOTATION_AUDIO_BUCKET)
          .getPublicUrl(audioMetadata.storagePath).data.publicUrl;
      }

      return mapPublicAnnotationDetail(
        annotation,
        targetResult.data,
        sourceResult.data,
        profileResult.data,
        annotationAudioPublicUrl,
        mediaState,
        transcript,
      );
    } catch {
      return null;
    }
  },
);
