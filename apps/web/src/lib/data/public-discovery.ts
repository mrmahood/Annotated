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
  PUBLIC_ANNOTATION_CARD_SELECT,
  PUBLIC_ANNOTATION_STATUS,
} from "./public-discovery-query";
import {
  parseBookmarkListRow,
  parseCurrentBookmarkIds,
} from "./bookmark";
import {
  feedItemKey,
  parseCurrentReshareIds,
  parseTimelineRow,
  type PublicReshareAttribution,
} from "./reshare";
import { queryPublicCommentCounts } from "./social-query";
import {
  TRENDING_MAX_CARDS,
  parseTrendingListRow,
  shouldShowTrendingSurface,
} from "./trending";

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

export type PublicFeedItem = {
  annotation: PublicAnnotationCardData;
  reshare: PublicReshareAttribution | null;
  viewerHasReshared: boolean;
  viewerHasBookmarked: boolean;
};

export type PublicAnnotationPage =
  | { status: "available"; items: PublicFeedItem[]; hasNext: boolean }
  | { status: "unavailable" };

export type PublicTrendingPage =
  | { status: "available"; items: PublicFeedItem[]; visible: boolean }
  | { status: "unavailable" };

export { feedItemKey, type PublicReshareAttribution };

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

function mapAnnotationRow(
  item: unknown,
  audioPublicUrl: string | null,
): PublicAnnotationCardData | null {
  return mapPublicAnnotation(item, audioPublicUrl);
}

function audioPublicUrlFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: unknown,
): string | null {
  const audioMetadata = isRecord(item) ? parsePublicAnnotationAudio(item.audio) : null;
  return audioMetadata
    ? getHttpUrl(
      supabase.storage
        .from(ANNOTATION_AUDIO_BUCKET)
        .getPublicUrl(audioMetadata.storagePath).data.publicUrl,
    )?.href ?? null
    : null;
}

async function loadPublishedAnnotationsByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  annotationIds: string[],
): Promise<Map<string, PublicAnnotationCardData>> {
  const uniqueIds = [...new Set(annotationIds.filter((id) => isUuid(id)))];
  const mapped = new Map<string, PublicAnnotationCardData>();
  if (uniqueIds.length === 0) return mapped;

  const { data, error } = await supabase
    .from("annotations")
    .select(PUBLIC_ANNOTATION_CARD_SELECT)
    .eq("status", PUBLIC_ANNOTATION_STATUS)
    .in("id", uniqueIds);
  if (error || !data) throw new Error("Annotations are unavailable.");

  for (const row of data) {
    const annotation = mapAnnotationRow(row, audioPublicUrlFor(supabase, row));
    if (annotation) mapped.set(annotation.id, annotation);
  }

  const commentCounts = await queryPublicCommentCounts(supabase, [...mapped.keys()]);
  for (const annotation of mapped.values()) {
    annotation.commentCount = commentCounts.get(annotation.id) ?? 0;
  }
  return mapped;
}

async function loadResharerProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileIds: string[],
): Promise<Map<string, PublicReshareAttribution["resharer"]>> {
  const uniqueIds = [...new Set(profileIds.filter((id) => isUuid(id)))];
  const profiles = new Map<string, PublicReshareAttribution["resharer"]>();
  if (uniqueIds.length === 0) return profiles;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", uniqueIds);
  if (error || !data) throw new Error("Reshare profiles are unavailable.");

  for (const row of data) {
    if (!isUuid(row.id)) continue;
    profiles.set(row.id, {
      id: row.id,
      displayName: getOptionalText(row.display_name) ?? "Annotated reader",
      avatarUrl: getHttpUrl(row.avatar_url)?.href ?? null,
    });
  }
  return profiles;
}

async function getPublicTimelinePage(
  page: number,
  actorId: string | null,
): Promise<PublicAnnotationPage> {
  try {
    const supabase = await createClient();
    const { from, to } = getPageRange(page);
    const { data, error } = await supabase.rpc("list_public_timeline_items", {
      p_limit: to - from + 1,
      p_offset: from,
      p_actor_id: actorId,
    });
    if (error || !Array.isArray(data)) return { status: "unavailable" };

    const hasNext = data.length > PUBLIC_PAGE_SIZE;
    const rows = data.slice(0, PUBLIC_PAGE_SIZE).map(parseTimelineRow);
    if (rows.some((row) => row === null)) return { status: "unavailable" };
    const timeline = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));

    const annotations = await loadPublishedAnnotationsByIds(
      supabase,
      timeline.map((row) => row.annotationId),
    );
    const resharers = await loadResharerProfiles(
      supabase,
      timeline.flatMap((row) => (row.resharerUserId ? [row.resharerUserId] : [])),
    );

    const { data: userData } = await supabase.auth.getUser();
    const viewerIds = [...new Set(timeline.map((row) => row.annotationId))];
    let viewerShares = new Set<string>();
    let viewerBookmarks = new Set<string>();
    if (userData.user && isUuid(userData.user.id) && viewerIds.length > 0) {
      const [
        { data: shareData, error: shareError },
        { data: bookmarkData, error: bookmarkError },
      ] = await Promise.all([
        supabase.rpc("get_current_annotation_reshares", { p_annotation_ids: viewerIds }),
        supabase.rpc("get_current_annotation_bookmarks", { p_annotation_ids: viewerIds }),
      ]);
      if (!shareError) viewerShares = parseCurrentReshareIds(shareData);
      if (!bookmarkError) viewerBookmarks = parseCurrentBookmarkIds(bookmarkData);
    }

    const items: PublicFeedItem[] = [];
    for (const row of timeline) {
      const annotation = annotations.get(row.annotationId);
      if (!annotation) continue;
      if (row.itemKind === "reshare") {
        const resharer = row.resharerUserId ? resharers.get(row.resharerUserId) : null;
        if (!resharer) continue;
        items.push({
          annotation,
          reshare: {
            id: row.itemId,
            createdAt: row.occurredAt,
            comment: row.reshareComment,
            resharer,
          },
          viewerHasReshared: viewerShares.has(annotation.id),
          viewerHasBookmarked: viewerBookmarks.has(annotation.id),
        });
        continue;
      }
      items.push({
        annotation,
        reshare: null,
        viewerHasReshared: viewerShares.has(annotation.id),
        viewerHasBookmarked: viewerBookmarks.has(annotation.id),
      });
    }

    return { status: "available", items, hasNext };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getPublicFeedPage(page: number): Promise<PublicAnnotationPage> {
  return getPublicTimelinePage(page, null);
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
  return getPublicTimelinePage(page, profileId);
}

export async function getCurrentUserBookmarksPage(
  page: number,
): Promise<PublicAnnotationPage> {
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user || !isUuid(userData.user.id)) return { status: "unavailable" };

    const { from, to } = getPageRange(page);
    const { data, error } = await supabase.rpc("list_current_annotation_bookmarks", {
      p_limit: to - from + 1,
      p_offset: from,
    });
    if (error || !Array.isArray(data)) return { status: "unavailable" };

    const hasNext = data.length > PUBLIC_PAGE_SIZE;
    const rows = data.slice(0, PUBLIC_PAGE_SIZE).map(parseBookmarkListRow);
    if (rows.some((row) => row === null)) return { status: "unavailable" };
    const bookmarks = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));

    const annotations = await loadPublishedAnnotationsByIds(
      supabase,
      bookmarks.map((row) => row.annotationId),
    );
    const viewerIds = [...new Set(bookmarks.map((row) => row.annotationId))];
    let viewerShares = new Set<string>();
    if (viewerIds.length > 0) {
      const { data: shareData, error: shareError } = await supabase.rpc(
        "get_current_annotation_reshares",
        { p_annotation_ids: viewerIds },
      );
      if (!shareError) viewerShares = parseCurrentReshareIds(shareData);
    }

    const items: PublicFeedItem[] = [];
    for (const row of bookmarks) {
      const annotation = annotations.get(row.annotationId);
      if (!annotation) continue;
      items.push({
        annotation,
        reshare: null,
        viewerHasReshared: viewerShares.has(annotation.id),
        viewerHasBookmarked: true,
      });
    }

    return { status: "available", items, hasNext };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getTrendingFeedItems(): Promise<PublicTrendingPage> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_trending_annotations", {
      p_limit: TRENDING_MAX_CARDS,
    });
    if (error || !Array.isArray(data)) return { status: "unavailable" };

    const rows = data.map(parseTrendingListRow);
    if (rows.some((row) => row === null)) return { status: "unavailable" };
    const trending = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));

    const annotations = await loadPublishedAnnotationsByIds(
      supabase,
      trending.map((row) => row.annotationId),
    );
    const { data: userData } = await supabase.auth.getUser();
    const viewerIds = [...new Set(trending.map((row) => row.annotationId))];
    let viewerShares = new Set<string>();
    let viewerBookmarks = new Set<string>();
    if (userData.user && isUuid(userData.user.id) && viewerIds.length > 0) {
      const [
        { data: shareData, error: shareError },
        { data: bookmarkData, error: bookmarkError },
      ] = await Promise.all([
        supabase.rpc("get_current_annotation_reshares", { p_annotation_ids: viewerIds }),
        supabase.rpc("get_current_annotation_bookmarks", { p_annotation_ids: viewerIds }),
      ]);
      if (!shareError) viewerShares = parseCurrentReshareIds(shareData);
      if (!bookmarkError) viewerBookmarks = parseCurrentBookmarkIds(bookmarkData);
    }

    const items: PublicFeedItem[] = [];
    for (const row of trending) {
      const annotation = annotations.get(row.annotationId);
      if (!annotation) continue;
      items.push({
        annotation,
        reshare: null,
        viewerHasReshared: viewerShares.has(annotation.id),
        viewerHasBookmarked: viewerBookmarks.has(annotation.id),
      });
    }

    return {
      status: "available",
      items,
      visible: shouldShowTrendingSurface(items.length),
    };
  } catch {
    return { status: "unavailable" };
  }
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
