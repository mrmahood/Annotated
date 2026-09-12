import { parseStoredAnnotationTitle } from '@annotated/shared/annotation-title';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getHistoricalStoredTargetRangeError } from '@annotated/shared/media-time';
import { getYouTubeVideoIdentity, isYouTubeVideoUrl } from '@annotated/shared/youtube';
import { getTikTokVideoIdentity, isTikTokVideoUrl } from '@annotated/shared/tiktok';
import { getSpotifyEpisodeIdentity, isSpotifyEpisodeUrl } from '@annotated/shared/spotify';
import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import {
  parseAnnotationAudio,
  type AnnotationAudio,
} from './audio-commentary.ts';
import {
  parsePublicHostedExcerpt,
  type HostedExcerpt,
} from './hosted-playback.ts';
import {
  ANNOTATION_PAGE_SIZE,
  buildAnnotationQueryPlan,
  COMMENT_BODY_LIMIT,
  getHttpUrl,
  getCommentPageRange,
  getOptionalText,
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
  isUuid,
  normalizeReshareComment,
  parseBookmarkListRow,
  parseCurrentBookmarkIds,
  parseCurrentReshareIds,
  parseTimelineRow,
  PUBLIC_COMMENT_STATUS,
  requireParticipation,
  sortComments,
  type PublicAnnotationRoute,
} from './social-helpers.ts';

type PublicAnnotationBase = {
  id: string;
  title: string | null;
  commentaryText: string;
  publishedAt: string;
  route: PublicAnnotationRoute | null;
  creator: { id: string; displayName: string; avatarUrl: string | null };
  source: {
    canonicalUrl: string;
    normalizedUrl: string;
    title: string | null;
    hostname: string;
    author: string | null;
    publisher: string | null;
    showName: string | null;
  };
  commentCount: number;
  audio: AnnotationAudio | null;
};

export type PublicAnnotation = PublicAnnotationBase & (
  | {
      kind: 'article';
      selectedText: string;
      startMs: null;
      endMs: null;
      source: PublicAnnotationBase['source'] & { type: 'article'; videoId: null };
    }
  | {
      kind: 'youtube';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'youtube'; videoId: string };
      hosted: HostedExcerpt | null;
    }
  | {
      kind: 'tiktok';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'tiktok'; videoId: string };
      hosted: HostedExcerpt | null;
    }
  | {
      kind: 'video';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'article'; videoId: null };
      hosted: HostedExcerpt | null;
    }
  | {
      kind: 'audio';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'podcast'; videoId: null };
      hosted: HostedExcerpt | null;
    }
  | {
      kind: 'spotify';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'spotify'; videoId: null; episodeId: string };
      hosted: HostedExcerpt | null;
    }
);

export type PublicReshareAttribution = {
  id: string;
  createdAt: string;
  comment: string | null;
  resharer: { id: string; displayName: string; avatarUrl: string | null };
};

export type TimelineItem = {
  annotation: PublicAnnotation;
  reshare: PublicReshareAttribution | null;
  viewerHasReshared: boolean;
  viewerHasBookmarked: boolean;
};

export type AnnotationPage = {
  annotations: PublicAnnotation[];
  items: TimelineItem[];
  total: number | null;
  hasMore: boolean;
};

export type PublicComment = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  author: { displayName: string; avatarUrl: string | null };
};

export type CommentPage = {
  comments: PublicComment[];
  total: number;
  hasMore: boolean;
};

export type PublicProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  annotationCount: number;
  followerCount: number;
  followingCount: number;
};

type UnknownRecord = Record<string, unknown>;

const ANNOTATION_SOURCE_EMBED =
  'canonical_url, normalized_url, source_type, title, author, publisher, metadata';

export function buildAnnotationSelect(options: { innerSource?: boolean } = {}): string {
  const sourceHint = options.innerSource
    ? 'source:sources!annotations_source_id_fkey!inner'
    : 'source:sources!annotations_source_id_fkey';
  return `
  id,
  slug,
  annotation_type,
  title,
  commentary_text,
  published_at,
  creator:profiles!annotations_user_id_fkey(id, username, display_name, avatar_url),
  ${sourceHint}(${ANNOTATION_SOURCE_EMBED}),
  target:annotation_targets!annotation_targets_annotation_id_fkey(target_type, selected_text, start_ms, end_ms),
  audio:annotation_audio(storage_path, duration_ms, mime_type, byte_size)
`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  }
  return isRecord(value) ? value : null;
}

export function mapPublicAnnotation(value: unknown): PublicAnnotation | null {
  if (!isRecord(value)) return null;
  const creator = getSingleRelation(value.creator);
  const source = getSingleRelation(value.source);
  const target = getSingleRelation(value.target);
  const id = getOptionalText(value.id);
  const creatorId = getOptionalText(creator?.id);
  const title = parseStoredAnnotationTitle(value.title);
  const commentaryText = typeof value.commentary_text === 'string' && value.commentary_text.length <= 2_000
    ? value.commentary_text
    : null;
  const selectedText = getOptionalText(target?.selected_text);
  const annotationType = getOptionalText(value.annotation_type);
  const sourceType = getOptionalText(source?.source_type);
  const targetType = getOptionalText(target?.target_type);
  const canonicalUrl = getHttpUrl(source?.canonical_url);
  const storedNormalizedUrl = getOptionalText(source?.normalized_url);
  const publishedAt = getOptionalText(value.published_at);
  const sourceMetadata = isRecord(source?.metadata) ? source.metadata : {};
  const date = publishedAt ? new Date(publishedAt) : null;
  const username = creator?.username;
  const slug = value.slug;
  const route = isPublicCreatorHandle(username) && isPublicAnnotationSlug(slug)
    ? { creatorHandle: username, annotationSlug: slug }
    : null;

  if (
    !id || !isUuid(id) || !creatorId || !isUuid(creatorId) ||
    commentaryText === null || !canonicalUrl ||
    !date || Number.isNaN(date.getTime())
  ) {
    return null;
  }

  const common = {
    id,
    title,
    commentaryText,
    publishedAt: date.toISOString(),
    route,
    commentCount: 0,
    audio: parseAnnotationAudio(value.audio),
    creator: {
      id: creatorId,
      displayName: getOptionalText(creator?.display_name) ?? 'Annotated reader',
      avatarUrl: getHttpUrl(creator?.avatar_url),
    },
    source: {
      canonicalUrl,
      normalizedUrl: storedNormalizedUrl ?? canonicalUrl,
      title: getOptionalText(source?.title),
      hostname: new URL(canonicalUrl).hostname,
      author: getOptionalText(source?.author),
      publisher: getOptionalText(source?.publisher),
      showName: getOptionalText(sourceMetadata.show_name),
    },
  };

  if (
    annotationType === 'article_text' && sourceType === 'article' &&
    targetType === 'text' && selectedText
  ) {
    return {
      ...common,
      kind: 'article',
      selectedText,
      startMs: null,
      endMs: null,
      source: { ...common.source, type: 'article', videoId: null },
    };
  }

  const startMs = target?.start_ms;
  const endMs = target?.end_ms;
  if (
    annotationType === 'video_clip' && sourceType === 'youtube' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getYouTubeVideoIdentity(canonicalUrl);
      if (identity.normalizedUrl !== storedNormalizedUrl) return null;
      return {
        ...common,
        kind: 'youtube',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'youtube', videoId: identity.videoId },
        hosted: null,
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === 'video_clip' && sourceType === 'tiktok' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getTikTokVideoIdentity(canonicalUrl);
      if (identity.normalizedUrl !== storedNormalizedUrl) return null;
      return {
        ...common,
        kind: 'tiktok',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'tiktok', videoId: identity.videoId },
        hosted: null,
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === 'video_clip' && sourceType === 'article' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    if (isYouTubeVideoUrl(canonicalUrl) || isTikTokVideoUrl(canonicalUrl) || isSpotifyEpisodeUrl(canonicalUrl)) return null;
    return {
      ...common,
      kind: 'video',
      selectedText: null,
      startMs: startMs as number,
      endMs: endMs as number,
      source: { ...common.source, type: 'article', videoId: null },
      hosted: null,
    };
  }

  if (
    annotationType === 'audio_clip' && sourceType === 'podcast' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      if (isSpotifyEpisodeUrl(canonicalUrl)) return null;
      const identity = getAudioSourceIdentity(canonicalUrl);
      if (identity.normalizedUrl !== storedNormalizedUrl) return null;
      return {
        ...common,
        kind: 'audio',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'podcast', videoId: null },
        hosted: null,
      };
    } catch { return null; }
  }

  if (
    annotationType === 'audio_clip' && sourceType === 'spotify' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getHistoricalStoredTargetRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getSpotifyEpisodeIdentity(canonicalUrl);
      if (identity.normalizedUrl !== storedNormalizedUrl) return null;
      return {
        ...common,
        kind: 'spotify',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'spotify', videoId: null, episodeId: identity.episodeId },
        hosted: null,
      };
    } catch { return null; }
  }

  return null;
}

function getCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export async function queryCommentCounts(
  supabase: SupabaseClient,
  annotationIds: string[],
): Promise<Map<string, number>> {
  if (annotationIds.length === 0) return new Map();
  if (annotationIds.length > 100 || annotationIds.some((id) => !isUuid(id))) {
    throw new Error('Invalid comment count request.');
  }
  const { data, error } = await supabase.rpc(
    'get_public_annotation_comment_counts',
    { p_annotation_ids: annotationIds },
  );
  if (error || !Array.isArray(data)) throw new Error('Comment counts are unavailable.');

  const counts = new Map(annotationIds.map((id) => [id, 0]));
  for (const row of data) {
    if (!isRecord(row)) throw new Error('A comment count response was malformed.');
    const annotationId = getOptionalText(row.annotation_id);
    const count = getCount(row.comment_count);
    if (!annotationId || !counts.has(annotationId) || count === null) {
      throw new Error('A comment count response was malformed.');
    }
    counts.set(annotationId, count);
  }
  return counts;
}

export async function queryAnnotations(
  supabase: SupabaseClient,
  options: { sourceUrl?: string; profileId?: string; offset?: number } = {},
): Promise<AnnotationPage> {
  const plan = buildAnnotationQueryPlan(options);
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page offset.');

  let query = supabase
    .from('annotations')
    .select(buildAnnotationSelect({
      innerSource: Boolean(plan.normalizedUrl || plan.normalizedUrls),
    }), { count: 'exact' })
    .eq('status', plan.status);
  if (plan.normalizedUrls && plan.normalizedUrls.length > 1) {
    query = query.in('source.normalized_url', plan.normalizedUrls);
  } else if (plan.normalizedUrl) {
    query = query.eq('source.normalized_url', plan.normalizedUrl);
  }
  if (plan.profileId) query = query.eq('user_id', plan.profileId);
  for (const order of plan.orders) {
    query = query.order(order.column, { ascending: order.ascending });
  }
  const { data, count, error } = await query.range(
    offset,
    offset + ANNOTATION_PAGE_SIZE,
  );
  if (error || !data) throw new Error('Annotations are unavailable.');

  const rows = data.slice(0, ANNOTATION_PAGE_SIZE);
  const annotations = rows
    .map(mapPublicAnnotation)
    .filter((annotation): annotation is PublicAnnotation => Boolean(annotation));

  const counts = await queryCommentCounts(
    supabase,
    annotations.map(({ id }) => id),
  );
  for (const annotation of annotations) {
    annotation.commentCount = counts.get(annotation.id) ?? 0;
  }

  const annotationIds = annotations.map(({ id }) => id);
  const [viewerShares, viewerBookmarks] = await Promise.all([
    queryCurrentReshares(supabase, annotationIds),
    queryCurrentBookmarks(supabase, annotationIds),
  ]);
  const items = annotations.map((annotation) => ({
    annotation,
    reshare: null,
    viewerHasReshared: viewerShares.has(annotation.id),
    viewerHasBookmarked: viewerBookmarks.has(annotation.id),
  }));

  return {
    annotations,
    items,
    total: count,
    hasMore: data.length > ANNOTATION_PAGE_SIZE ||
      (count !== null && offset + annotations.length < count),
  };
}

export async function queryCurrentReshares(
  supabase: SupabaseClient,
  annotationIds: string[],
): Promise<Set<string>> {
  if (annotationIds.length === 0) return new Set();
  if (annotationIds.length > 100 || annotationIds.some((id) => !isUuid(id))) {
    throw new Error('Invalid reshare state request.');
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Set();
  const { data, error } = await supabase.rpc('get_current_annotation_reshares', {
    p_annotation_ids: annotationIds,
  });
  if (error) return new Set();
  return parseCurrentReshareIds(data);
}

export async function queryCurrentBookmarks(
  supabase: SupabaseClient,
  annotationIds: string[],
): Promise<Set<string>> {
  if (annotationIds.length === 0) return new Set();
  if (annotationIds.length > 100 || annotationIds.some((id) => !isUuid(id))) {
    throw new Error('Invalid bookmark state request.');
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Set();
  const { data, error } = await supabase.rpc('get_current_annotation_bookmarks', {
    p_annotation_ids: annotationIds,
  });
  if (error) return new Set();
  return parseCurrentBookmarkIds(data);
}

export async function queryTimeline(
  supabase: SupabaseClient,
  options: { profileId?: string; offset?: number } = {},
): Promise<AnnotationPage> {
  if (options.profileId && !isUuid(options.profileId)) {
    throw new Error('Invalid profile identifier.');
  }
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page offset.');

  const { data, error } = await supabase.rpc('list_public_timeline_items', {
    p_limit: ANNOTATION_PAGE_SIZE + 1,
    p_offset: offset,
    p_actor_id: options.profileId ?? null,
  });
  if (error || !Array.isArray(data)) throw new Error('Annotations are unavailable.');

  const rows = data.slice(0, ANNOTATION_PAGE_SIZE).map(parseTimelineRow);
  if (rows.some((row) => row === null)) throw new Error('A timeline response was malformed.');
  const timeline = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));

  const annotationIds = [...new Set(timeline.map((row) => row.annotationId))];
  const annotationsById = new Map<string, PublicAnnotation>();
  if (annotationIds.length > 0) {
    const { data: annotationRows, error: annotationError } = await supabase
      .from('annotations')
      .select(buildAnnotationSelect())
      .eq('status', 'published')
      .in('id', annotationIds);
    if (annotationError || !annotationRows) throw new Error('Annotations are unavailable.');
    for (const row of annotationRows) {
      const annotation = mapPublicAnnotation(row);
      if (annotation) annotationsById.set(annotation.id, annotation);
    }
    const counts = await queryCommentCounts(supabase, [...annotationsById.keys()]);
    for (const annotation of annotationsById.values()) {
      annotation.commentCount = counts.get(annotation.id) ?? 0;
    }
  }

  const resharerIds = [...new Set(
    timeline.flatMap((row) => (row.resharerUserId ? [row.resharerUserId] : [])),
  )];
  const resharers = new Map<string, PublicReshareAttribution['resharer']>();
  if (resharerIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', resharerIds);
    if (profileError || !profileRows) throw new Error('Reshare profiles are unavailable.');
    for (const row of profileRows) {
      if (!isUuid(row.id)) continue;
      resharers.set(row.id, {
        id: row.id,
        displayName: getOptionalText(row.display_name) ?? 'Annotated reader',
        avatarUrl: getHttpUrl(row.avatar_url),
      });
    }
  }

  const [viewerShares, viewerBookmarks] = await Promise.all([
    queryCurrentReshares(supabase, annotationIds),
    queryCurrentBookmarks(supabase, annotationIds),
  ]);
  const items: TimelineItem[] = [];
  for (const row of timeline) {
    const annotation = annotationsById.get(row.annotationId);
    if (!annotation) continue;
    if (row.itemKind === 'annotation') {
      items.push({
        annotation,
        reshare: null,
        viewerHasReshared: viewerShares.has(annotation.id),
        viewerHasBookmarked: viewerBookmarks.has(annotation.id),
      });
      continue;
    }
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
  }

  return {
    annotations: items.map((item) => item.annotation),
    items,
    total: null,
    hasMore: data.length > ANNOTATION_PAGE_SIZE,
  };
}

async function loadHostedExcerpt(
  supabase: SupabaseClient,
  annotation: Extract<PublicAnnotation, { kind: 'youtube' | 'tiktok' | 'audio' | 'spotify' | 'video' }>,
): Promise<HostedExcerpt | null> {
  try {
    const { data: mediaState, error: mediaError } = await supabase
      .rpc('get_public_annotation_media_state', { p_annotation_id: annotation.id })
      .maybeSingle();
    if (mediaError) return null;

    let transcript: unknown = null;
    const availability = isRecord(mediaState) ? mediaState.availability : null;
    if (availability === 'ready') {
      const { data: transcriptData, error: transcriptError } = await supabase
        .rpc('get_public_annotation_transcript', { p_annotation_id: annotation.id })
        .maybeSingle();
      if (!transcriptError && transcriptData) {
        transcript = transcriptData;
      }
    }

    return parsePublicHostedExcerpt(
      mediaState,
      transcript,
      annotation.id,
      annotation.kind === 'audio' || annotation.kind === 'spotify' ? 'audio' : 'video',
      annotation.endMs - annotation.startMs,
    );
  } catch {
    return null;
  }
}

export async function queryPublicHostedExcerpt(
  supabase: SupabaseClient,
  annotation: Extract<PublicAnnotation, { kind: 'youtube' | 'tiktok' | 'audio' | 'spotify' | 'video' }>,
): Promise<HostedExcerpt | null> {
  return loadHostedExcerpt(supabase, annotation);
}

export async function queryAnnotation(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<PublicAnnotation | null> {
  if (!isUuid(annotationId)) return null;
  const { data, error } = await supabase
    .from('annotations')
    .select(buildAnnotationSelect())
    .eq('id', annotationId)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw new Error('The annotation is unavailable.');
  if (!data) return null;
  const annotation = mapPublicAnnotation(data);
  if (!annotation) throw new Error('The annotation response was malformed.');
  const counts = await queryCommentCounts(supabase, [annotation.id]);
  annotation.commentCount = counts.get(annotation.id) ?? 0;
  if (annotation.kind === 'youtube' || annotation.kind === 'tiktok' || annotation.kind === 'audio' || annotation.kind === 'spotify' || annotation.kind === 'video') {
    annotation.hosted = await loadHostedExcerpt(supabase, annotation);
  }
  return annotation;
}

function mapComment(value: unknown): PublicComment | null {
  if (!isRecord(value)) return null;
  const author = getSingleRelation(value.author);
  const id = getOptionalText(value.id);
  const userId = getOptionalText(value.user_id);
  const body = typeof value.body === 'string' ? value.body : null;
  const createdAt = getOptionalText(value.created_at);
  const date = createdAt ? new Date(createdAt) : null;
  if (
    !author || !id || !isUuid(id) || !userId || !isUuid(userId) ||
    !body || !body.trim() || !date || Number.isNaN(date.getTime())
  ) return null;
  return {
    id,
    userId,
    body,
    createdAt: date.toISOString(),
    author: {
      displayName: getOptionalText(author.display_name) ?? 'Annotated reader',
      avatarUrl: getHttpUrl(author.avatar_url),
    },
  };
}

export async function queryComments(
  supabase: SupabaseClient,
  annotationId: string,
  offset = 0,
): Promise<CommentPage> {
  if (!isUuid(annotationId) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Invalid comment request.');
  }
  const range = getCommentPageRange(offset);
  const { data, count, error } = await supabase
    .from('annotation_comments')
    .select(
      `id, user_id, body, created_at,
       author:profiles!annotation_comments_user_id_fkey(display_name, avatar_url),
       annotation:annotations!inner(id)`,
      { count: 'exact' },
    )
    .eq('annotation_id', annotationId)
    .eq('status', PUBLIC_COMMENT_STATUS)
    .eq('annotation.status', 'published')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(range.from, range.to);
  if (error || !data || count === null) throw new Error('Comments are unavailable.');
  const comments = data
    .map(mapComment)
    .filter((comment): comment is PublicComment => Boolean(comment));
  if (comments.length !== data.length) throw new Error('A comment response was malformed.');
  return {
    comments: sortComments(comments),
    total: count,
    hasMore: offset + comments.length < count,
  };
}

export async function queryProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<PublicProfile | null> {
  if (!isUuid(profileId)) return null;
  const [profileResult, annotationResult, socialResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .eq('id', profileId)
      .maybeSingle(),
    supabase
      .from('annotations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .eq('user_id', profileId),
    supabase.rpc('get_profile_social_counts', { p_profile_id: profileId }).maybeSingle(),
  ]);
  const row = isRecord(socialResult.data) ? socialResult.data : null;
  const followerCount = getCount(row?.follower_count);
  const followingCount = getCount(row?.following_count);
  const profile = profileResult.data;
  if (
    profileResult.error || annotationResult.error || socialResult.error || !profile ||
    !isUuid(profile.id) || annotationResult.count === null ||
    followerCount === null || followingCount === null
  ) {
    if (!profile && !profileResult.error) return null;
    throw new Error('The creator profile is unavailable.');
  }
  return {
    id: profile.id,
    displayName: getOptionalText(profile.display_name) ?? 'Annotated reader',
    avatarUrl: getHttpUrl(profile.avatar_url),
    annotationCount: annotationResult.count,
    followerCount,
    followingCount,
  };
}

export async function queryFollowState(
  supabase: SupabaseClient,
  profileId: string,
  currentUserId: string | null,
): Promise<boolean> {
  if (!currentUserId || currentUserId === profileId) return false;
  if (!isUuid(profileId) || !isUuid(currentUserId)) throw new Error('Invalid profile.');
  const { data, error } = await supabase.rpc('is_following_profile', {
    p_followed_id: profileId,
  });
  if (error || typeof data !== 'boolean') throw new Error('Follow state is unavailable.');
  return data;
}

async function requireCurrentUser(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Authentication is required.');
  return requireParticipation(data.user.id);
}

export async function createComment(
  supabase: SupabaseClient,
  annotationId: string,
  body: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error('That annotation is unavailable.');
  if (!body.trim()) throw new Error('Write a comment before posting.');
  if (body.length > COMMENT_BODY_LIMIT) throw new Error('Comments cannot exceed 1,000 characters.');
  const userId = await requireCurrentUser(supabase);
  const { error } = await supabase.from('annotation_comments').insert({
    annotation_id: annotationId,
    user_id: userId,
    body,
    status: PUBLIC_COMMENT_STATUS,
  });
  if (error) throw new Error('The comment could not be posted.');
}

export async function deleteComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<void> {
  if (!isUuid(commentId)) throw new Error('That comment is unavailable.');
  const userId = await requireCurrentUser(supabase);
  const { count, error } = await supabase
    .from('annotation_comments')
    .delete({ count: 'exact' })
    .eq('id', commentId)
    .eq('user_id', userId);
  if (error || count !== 1) throw new Error('The comment could not be deleted.');
}

export async function followProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<void> {
  if (!isUuid(profileId)) throw new Error('That profile is unavailable.');
  const currentUserId = await requireCurrentUser(supabase);
  if (currentUserId === profileId) throw new Error('You cannot follow yourself.');
  const { error } = await supabase.from('profile_follows').insert({
    follower_id: currentUserId,
    followed_id: profileId,
  });
  if (error) throw new Error('The profile could not be followed.');
}

export async function unfollowProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<void> {
  if (!isUuid(profileId)) throw new Error('That profile is unavailable.');
  await requireCurrentUser(supabase);
  const { data, error } = await supabase.rpc('unfollow_profile', {
    p_followed_id: profileId,
  });
  if (error || data !== true) throw new Error('The profile could not be unfollowed.');
}

export async function createAnnotationReshare(
  supabase: SupabaseClient,
  annotationId: string,
  comment?: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error('That annotation is unavailable.');
  await requireCurrentUser(supabase);
  const { error } = await supabase.rpc('create_annotation_reshare', {
    p_annotation_id: annotationId,
    p_comment: normalizeReshareComment(comment),
  });
  if (error) {
    if (error.code === '23505') throw new Error('You have already shared this annotation.');
    if (error.message.includes('unavailable')) throw new Error('That annotation is unavailable.');
    if (error.message.includes('1,000')) throw new Error('Reshare comments cannot exceed 1,000 characters.');
    throw new Error('The annotation could not be shared.');
  }
}

export async function removeAnnotationReshare(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error('That annotation is unavailable.');
  await requireCurrentUser(supabase);
  const { data, error } = await supabase.rpc('remove_annotation_reshare', {
    p_annotation_id: annotationId,
  });
  if (error || data !== true) throw new Error('The share could not be removed.');
}

export async function createAnnotationBookmark(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error('That annotation is unavailable.');
  await requireCurrentUser(supabase);
  const { error } = await supabase.rpc('create_annotation_bookmark', {
    p_annotation_id: annotationId,
  });
  if (error) {
    if (error.code === '23505') throw new Error('You have already bookmarked this annotation.');
    if (error.message.includes('unavailable')) throw new Error('That annotation is unavailable.');
    throw new Error('The annotation could not be bookmarked.');
  }
}

export async function removeAnnotationBookmark(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error('That annotation is unavailable.');
  await requireCurrentUser(supabase);
  const { data, error } = await supabase.rpc('remove_annotation_bookmark', {
    p_annotation_id: annotationId,
  });
  if (error || data !== true) throw new Error('The bookmark could not be removed.');
}

export async function queryBookmarks(
  supabase: SupabaseClient,
  options: { offset?: number } = {},
): Promise<AnnotationPage> {
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page offset.');
  await requireCurrentUser(supabase);

  const { data, error } = await supabase.rpc('list_current_annotation_bookmarks', {
    p_limit: ANNOTATION_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error || !Array.isArray(data)) throw new Error('Bookmarks are unavailable.');

  const rows = data.slice(0, ANNOTATION_PAGE_SIZE).map(parseBookmarkListRow);
  if (rows.some((row) => row === null)) throw new Error('A bookmark response was malformed.');
  const bookmarks = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  const annotationIds = bookmarks.map((row) => row.annotationId);

  const annotationsById = new Map<string, PublicAnnotation>();
  if (annotationIds.length > 0) {
    const { data: annotationRows, error: annotationError } = await supabase
      .from('annotations')
      .select(buildAnnotationSelect())
      .eq('status', 'published')
      .in('id', annotationIds);
    if (annotationError || !annotationRows) throw new Error('Annotations are unavailable.');
    for (const row of annotationRows) {
      const annotation = mapPublicAnnotation(row);
      if (annotation) annotationsById.set(annotation.id, annotation);
    }
    const counts = await queryCommentCounts(supabase, [...annotationsById.keys()]);
    for (const annotation of annotationsById.values()) {
      annotation.commentCount = counts.get(annotation.id) ?? 0;
    }
  }

  const viewerShares = await queryCurrentReshares(supabase, annotationIds);
  const items: TimelineItem[] = [];
  for (const row of bookmarks) {
    const annotation = annotationsById.get(row.annotationId);
    if (!annotation) continue;
    items.push({
      annotation,
      reshare: null,
      viewerHasReshared: viewerShares.has(annotation.id),
      viewerHasBookmarked: true,
    });
  }

  return {
    annotations: items.map((item) => item.annotation),
    items,
    total: null,
    hasMore: data.length > ANNOTATION_PAGE_SIZE,
  };
}
