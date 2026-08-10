import type { SupabaseClient } from '@supabase/supabase-js';
import { getClipRangeError } from '@annotated/shared/media-time';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import {
  parseAnnotationAudio,
  type AnnotationAudio,
} from './audio-commentary';
import {
  ANNOTATION_PAGE_SIZE,
  buildAnnotationQueryPlan,
  COMMENT_BODY_LIMIT,
  getHttpUrl,
  getCommentPageRange,
  getOptionalText,
  isUuid,
  PUBLIC_COMMENT_STATUS,
  requireParticipation,
  sortComments,
} from './social-helpers';

type PublicAnnotationBase = {
  id: string;
  commentaryText: string;
  publishedAt: string;
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
    }
  | {
      kind: 'audio';
      selectedText: null;
      startMs: number;
      endMs: number;
      source: PublicAnnotationBase['source'] & { type: 'podcast'; videoId: null };
    }
);

export type AnnotationPage = {
  annotations: PublicAnnotation[];
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

const ANNOTATION_SELECT = `
  id,
  annotation_type,
  commentary_text,
  published_at,
  creator:profiles!annotations_user_id_fkey(id, display_name, avatar_url),
  source:sources!inner(canonical_url, normalized_url, source_type, title, author, publisher, metadata),
  target:annotation_targets!annotation_targets_annotation_id_fkey(target_type, selected_text, start_ms, end_ms),
  audio:annotation_audio(storage_path, duration_ms, mime_type, byte_size)
`;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  }
  return isRecord(value) ? value : null;
}

function mapAnnotation(value: unknown): PublicAnnotation | null {
  if (!isRecord(value)) return null;
  const creator = getSingleRelation(value.creator);
  const source = getSingleRelation(value.source);
  const target = getSingleRelation(value.target);
  const id = getOptionalText(value.id);
  const creatorId = getOptionalText(creator?.id);
  const commentaryText = getOptionalText(value.commentary_text);
  const selectedText = getOptionalText(target?.selected_text);
  const annotationType = getOptionalText(value.annotation_type);
  const sourceType = getOptionalText(source?.source_type);
  const targetType = getOptionalText(target?.target_type);
  const canonicalUrl = getHttpUrl(source?.canonical_url);
  const normalizedUrl = getHttpUrl(source?.normalized_url);
  const publishedAt = getOptionalText(value.published_at);
  const sourceMetadata = isRecord(source?.metadata) ? source.metadata : {};
  const date = publishedAt ? new Date(publishedAt) : null;

  if (
    !id || !isUuid(id) || !creatorId || !isUuid(creatorId) ||
    !commentaryText || !canonicalUrl || !normalizedUrl ||
    !date || Number.isNaN(date.getTime())
  ) {
    return null;
  }

  const common = {
    id,
    commentaryText,
    publishedAt: date.toISOString(),
    commentCount: 0,
    audio: parseAnnotationAudio(value.audio),
    creator: {
      id: creatorId,
      displayName: getOptionalText(creator?.display_name) ?? 'Annotated reader',
      avatarUrl: getHttpUrl(creator?.avatar_url),
    },
    source: {
      canonicalUrl,
      normalizedUrl,
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
    getClipRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getYouTubeVideoIdentity(canonicalUrl);
      if (identity.normalizedUrl !== normalizedUrl) return null;
      return {
        ...common,
        kind: 'youtube',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'youtube', videoId: identity.videoId },
      };
    } catch {
      return null;
    }
  }

  if (
    annotationType === 'audio_clip' && sourceType === 'podcast' &&
    targetType === 'time_range' && Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    getClipRangeError(startMs as number, endMs as number) === null
  ) {
    try {
      const identity = getAudioSourceIdentity(canonicalUrl);
      if (identity.normalizedUrl !== normalizedUrl) return null;
      return {
        ...common,
        kind: 'audio',
        selectedText: null,
        startMs: startMs as number,
        endMs: endMs as number,
        source: { ...common.source, type: 'podcast', videoId: null },
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
    .select(ANNOTATION_SELECT, { count: 'exact' })
    .eq('status', plan.status);
  if (plan.normalizedUrl) query = query.eq('source.normalized_url', plan.normalizedUrl);
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
    .map(mapAnnotation)
    .filter((annotation): annotation is PublicAnnotation => Boolean(annotation));
  if (annotations.length !== rows.length) throw new Error('An annotation response was malformed.');

  const counts = await queryCommentCounts(
    supabase,
    annotations.map(({ id }) => id),
  );
  for (const annotation of annotations) {
    annotation.commentCount = counts.get(annotation.id) ?? 0;
  }

  return {
    annotations,
    total: count,
    hasMore: data.length > ANNOTATION_PAGE_SIZE ||
      (count !== null && offset + annotations.length < count),
  };
}

export async function queryAnnotation(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<PublicAnnotation | null> {
  if (!isUuid(annotationId)) return null;
  const { data, error } = await supabase
    .from('annotations')
    .select(ANNOTATION_SELECT)
    .eq('id', annotationId)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw new Error('The annotation is unavailable.');
  if (!data) return null;
  const annotation = mapAnnotation(data);
  if (!annotation) throw new Error('The annotation response was malformed.');
  const counts = await queryCommentCounts(supabase, [annotation.id]);
  annotation.commentCount = counts.get(annotation.id) ?? 0;
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
