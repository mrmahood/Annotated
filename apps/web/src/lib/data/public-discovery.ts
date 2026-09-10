import { parseStoredAnnotationTitle } from "@annotated/shared/annotation-title";
import { ANNOTATION_AUDIO_BUCKET, parsePublicAnnotationAudio } from "@/lib/audio-commentary";
import { createClient } from "@/lib/supabase/server";
import { getHistoricalStoredTargetRangeError } from "@annotated/shared/media-time";
import { getYouTubeVideoIdentity, isYouTubeVideoUrl } from "@annotated/shared/youtube";
import { getTikTokVideoIdentity, isTikTokVideoUrl } from "@annotated/shared/tiktok";
import { getSpotifyEpisodeIdentity, isSpotifyEpisodeUrl } from "@annotated/shared/spotify";
import { getAudioSourceIdentity } from "@annotated/shared/audio-source";
import { normalizeArticleUrl } from "@annotated/shared/url-normalization";
import {
  formatHostname,
  getHttpUrl,
  getOptionalText,
  getPageRange,
  isUuid,
  PUBLIC_PAGE_SIZE,
} from "@/lib/public-content";
import {
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
  type PublicAnnotationRoute,
} from "@/lib/public-routes";
import {
  buildPublicFeedQueryPlan,
  buildPublicProfileAnnotationsQueryPlan,
  PUBLIC_ANNOTATION_STATUS,
  type PublicAnnotationQueryPlan,
} from "./public-discovery-query";
import { queryPublicCommentCounts } from "./social-query";

type PublicAnnotationCardBase = {
  id: string;
  commentCount: number;
  title: string | null;
  commentaryText: string;
  audio: { publicUrl: string; durationMs: number } | null;
  publishedAt: string;
  route: PublicAnnotationRoute | null;
  annotator: { id: string; displayName: string; avatarUrl: string | null };
  source: {
    canonicalUrl: string;
    title: string | null;
    hostname: string;
    author: string | null;
    publisher: string | null;
    showName: string | null;
  };
};

export type PublicAnnotationCardData = PublicAnnotationCardBase & (
  | {
      kind: "article";
      selectedText: string;
      startMs: null;
      endMs: null;
      source: PublicAnnotationCardBase["source"] & { type: "article"; videoId: null };
    }
  | {
      kind: "youtube";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationCardBase["source"] & { type: "youtube"; videoId: string };
    }
  | {
      kind: "tiktok";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationCardBase["source"] & { type: "tiktok"; videoId: string };
    }
  | {
      kind: "video";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationCardBase["source"] & { type: "article"; videoId: null };
    }
  | {
      kind: "audio";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationCardBase["source"] & { type: "podcast"; videoId: null };
    }
  | {
      kind: "spotify";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationCardBase["source"] & { type: "spotify"; videoId: null; episodeId: string };
    }
);

export type PublicProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type PublicAnnotationPage =
  | { status: "available"; annotations: PublicAnnotationCardData[]; hasNext: boolean }
  | { status: "unavailable" };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  }

  return isRecord(value) ? value : null;
}

export function mapPublicAnnotation(
  value: unknown,
  audioPublicUrl: string | null = null,
): PublicAnnotationCardData | null {
  if (!isRecord(value)) return null;

  const annotator = getSingleRelation(value.annotator);
  const source = getSingleRelation(value.source);
  const target = getSingleRelation(value.target);
  const annotationId = getOptionalText(value.id);
  const title = parseStoredAnnotationTitle(value.title);
  const commentaryText = typeof value.commentary_text === "string" && value.commentary_text.length <= 2_000
    ? value.commentary_text
    : null;
  const selectedText = getOptionalText(target?.selected_text);
  const annotationType = getOptionalText(value.annotation_type);
  const sourceType = getOptionalText(source?.source_type);
  const targetType = getOptionalText(target?.target_type);
  const profileId = getOptionalText(annotator?.id);
  const canonicalUrl = getHttpUrl(source?.canonical_url);
  const hostname = formatHostname(source?.canonical_url);
  const publishedAt = getOptionalText(value.published_at);
  const publishedDate = publishedAt ? new Date(publishedAt) : null;
  const sourceMetadata = isRecord(source?.metadata) ? source.metadata : {};
  const route = isPublicCreatorHandle(annotator?.username) && isPublicAnnotationSlug(value.slug)
    ? { creatorHandle: annotator.username, annotationSlug: value.slug }
    : null;

  if (
    !annotator || !source || !target ||
    !annotationId || !isUuid(annotationId) || commentaryText === null ||
    !profileId || !isUuid(profileId) || !canonicalUrl || !hostname ||
    !publishedDate || Number.isNaN(publishedDate.getTime())
  ) {
    return null;
  }

  const audioMetadata = parsePublicAnnotationAudio(value.audio);
  const resolvedAudioUrl = audioPublicUrl ? getHttpUrl(audioPublicUrl) : null;
  const audio = audioMetadata && resolvedAudioUrl
    ? { publicUrl: resolvedAudioUrl.href, durationMs: audioMetadata.durationMs }
    : null;

  const common = {
    id: annotationId,
    commentCount: 0,
    title,
    commentaryText,
    audio,
    publishedAt: publishedDate.toISOString(),
    route,
    annotator: {
      id: profileId,
      displayName: getOptionalText(annotator.display_name) ?? "Annotated reader",
      avatarUrl: getHttpUrl(annotator.avatar_url)?.href ?? null,
    },
    source: {
      canonicalUrl: canonicalUrl.href,
      title: getOptionalText(source.title),
      hostname,
      author: getOptionalText(source.author),
      publisher: getOptionalText(source.publisher),
      showName: getOptionalText(sourceMetadata.show_name),
    },
  };

  if (
    annotationType === "article_text" && sourceType === "article" &&
    targetType === "text" && selectedText
  ) {
    return {
      ...common,
      kind: "article",
      selectedText,
      startMs: null,
      endMs: null,
      source: { ...common.source, type: "article", videoId: null },
    };
  }

  const startMs = target.start_ms;
  const endMs = target.end_ms;
  if (
    annotationType === "video_clip" && sourceType === "youtube" &&
    targetType === "time_range" && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getYouTubeVideoIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(source.normalized_url)) return null;
      return {
        ...common,
        kind: "youtube",
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: "youtube", videoId: identity.videoId },
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === "video_clip" && sourceType === "tiktok" &&
    targetType === "time_range" && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getTikTokVideoIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(source.normalized_url)) return null;
      return {
        ...common,
        kind: "tiktok",
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: "tiktok", videoId: identity.videoId },
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === "video_clip" && sourceType === "article" &&
    targetType === "time_range" && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      if (isYouTubeVideoUrl(canonicalUrl.href) || isTikTokVideoUrl(canonicalUrl.href) || isSpotifyEpisodeUrl(canonicalUrl.href)) return null;
      const normalizedUrl = normalizeArticleUrl(canonicalUrl.href);
      if (normalizedUrl !== getOptionalText(source.normalized_url)) return null;
      return {
        ...common,
        kind: "video",
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: "article", videoId: null },
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === "audio_clip" && sourceType === "podcast" &&
    targetType === "time_range" && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      if (isSpotifyEpisodeUrl(canonicalUrl.href)) return null;
      const identity = getAudioSourceIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(source.normalized_url)) return null;
      return {
        ...common,
        kind: "audio",
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: "podcast", videoId: null },
      };
    } catch { return null; }
  }

  if (
    annotationType === "audio_clip" && sourceType === "spotify" &&
    targetType === "time_range" && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getSpotifyEpisodeIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(source.normalized_url)) return null;
      return {
        ...common,
        kind: "spotify",
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: "spotify", videoId: null, episodeId: identity.episodeId },
      };
    } catch { return null; }
  }

  return null;
}

async function getPublicAnnotationPage(
  page: number,
  queryPlan: PublicAnnotationQueryPlan,
): Promise<PublicAnnotationPage> {
  try {
    const supabase = await createClient();
    let query = supabase.from(queryPlan.table).select(queryPlan.select);

    for (const filter of queryPlan.filters) query = query.eq(filter.column, filter.value);
    for (const order of queryPlan.orders) {
      query = query.order(order.column, { ascending: order.ascending });
    }

    const { from, to } = getPageRange(page);
    const { data, error } = await query.range(from, to);

    if (error || !data) return { status: "unavailable" };

    const hasNext = data.length > PUBLIC_PAGE_SIZE;
    const annotations = data
      .slice(0, PUBLIC_PAGE_SIZE)
      .map((item) => {
        const audioMetadata = isRecord(item) ? parsePublicAnnotationAudio(item.audio) : null;
        const audioPublicUrl = audioMetadata
          ? getHttpUrl(
            supabase.storage
              .from(ANNOTATION_AUDIO_BUCKET)
              .getPublicUrl(audioMetadata.storagePath).data.publicUrl,
          )?.href ?? null
          : null;
        return mapPublicAnnotation(item, audioPublicUrl);
      })
      .filter((item): item is PublicAnnotationCardData => Boolean(item));

    const commentCounts = await queryPublicCommentCounts(
      supabase,
      annotations.map((annotation) => annotation.id),
    );
    for (const annotation of annotations) {
      annotation.commentCount = commentCounts.get(annotation.id) ?? 0;
    }

    return { status: "available", annotations, hasNext };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getPublicFeedPage(page: number): Promise<PublicAnnotationPage> {
  return getPublicAnnotationPage(page, buildPublicFeedQueryPlan());
}

export async function getPublicProfile(profileId: string): Promise<PublicProfile | null> {
  if (!isUuid(profileId)) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, created_at")
      .eq("id", profileId)
      .maybeSingle();
    const createdAt = getOptionalText(data?.created_at);
    const createdDate = createdAt ? new Date(createdAt) : null;

    if (
      error || !data || !isUuid(data.id) || !createdDate ||
      Number.isNaN(createdDate.getTime())
    ) {
      return null;
    }

    return {
      id: data.id,
      displayName: getOptionalText(data.display_name) ?? "Annotated reader",
      avatarUrl: getHttpUrl(data.avatar_url)?.href ?? null,
      createdAt: createdDate.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getPublicProfileAnnotations(
  profileId: string,
  page: number,
): Promise<PublicAnnotationPage> {
  if (!isUuid(profileId)) return { status: "unavailable" };
  return getPublicAnnotationPage(page, buildPublicProfileAnnotationsQueryPlan(profileId));
}

export async function getPublicAnnotationCount(profileId: string): Promise<number | null> {
  if (!isUuid(profileId)) return null;

  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("annotations")
      .select("id", { count: "exact", head: true })
      .eq("status", PUBLIC_ANNOTATION_STATUS)
      .eq("user_id", profileId);

    return error || count === null ? null : count;
  } catch {
    return null;
  }
}
