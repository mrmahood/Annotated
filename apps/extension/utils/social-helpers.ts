import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { isSpotifyEpisodeUrl, normalizeSpotifyEpisodeUrl } from '@annotated/shared/spotify';
import { isTikTokVideoUrl, normalizeTikTokUrl } from '@annotated/shared/tiktok';
import { normalizeArticleUrl } from '@annotated/shared/url-normalization';
import { isYouTubeVideoUrl, normalizeYouTubeUrl } from '@annotated/shared/youtube';

export const PUBLIC_ANNOTATION_STATUS = 'published' as const;
export const PUBLIC_COMMENT_STATUS = 'public' as const;
export const ANNOTATION_PAGE_SIZE = 10;
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_BODY_LIMIT = 1_000;
export const RESHARE_COMMENT_LIMIT = 1_000;

export type PublicAnnotationRoute = {
  creatorHandle: string;
  annotationSlug: string;
};

const CREATOR_HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;
const ANNOTATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_ROOT_HANDLES = new Set([
  'api',
  'auth',
  '_next',
  'privacy',
  'terms',
  'legal',
]);

export type AnnotationQueryPlan = {
  normalizedUrl?: string;
  normalizedUrls?: string[];
  profileId?: string;
  status: typeof PUBLIC_ANNOTATION_STATUS;
  orders: readonly [
    { column: 'published_at'; ascending: false },
    { column: 'id'; ascending: false },
  ];
};

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isPublicCreatorHandle(value: unknown): value is string {
  return typeof value === 'string' && CREATOR_HANDLE_PATTERN.test(value) &&
    !RESERVED_ROOT_HANDLES.has(value);
}

export function isPublicAnnotationSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 100 &&
    ANNOTATION_SLUG_PATTERN.test(value);
}

export function parsePublicAnnotationRoute(
  creatorHandle: unknown,
  annotationSlug: unknown,
): PublicAnnotationRoute | null | undefined {
  if (creatorHandle === null && annotationSlug === null) return null;
  return isPublicCreatorHandle(creatorHandle) && isPublicAnnotationSlug(annotationSlug)
    ? { creatorHandle, annotationSlug }
    : undefined;
}

export function getPublicAnnotationPath(
  route: PublicAnnotationRoute | null,
  annotationId: string,
): string {
  if (!isUuid(annotationId)) throw new Error('Invalid annotation identity.');
  if (!route) return `/a/${annotationId}`;
  if (
    !isPublicCreatorHandle(route.creatorHandle) ||
    !isPublicAnnotationSlug(route.annotationSlug)
  ) throw new Error('Invalid public annotation route identity.');
  return `/${route.creatorHandle}/${route.annotationSlug}`;
}

export function buildAnnotationQueryPlan(options: {
  sourceUrl?: string;
  profileId?: string;
} = {}): AnnotationQueryPlan {
  if (options.profileId && !isUuid(options.profileId)) {
    throw new Error('Invalid profile identifier.');
  }

  const normalizedUrls = options.sourceUrl
    ? listingNormalizedUrls(options.sourceUrl)
    : undefined;

  return {
    ...(normalizedUrls
      ? { normalizedUrl: normalizedUrls[0], normalizedUrls }
      : {}),
    ...(options.profileId ? { profileId: options.profileId } : {}),
    status: PUBLIC_ANNOTATION_STATUS,
    orders: [
      { column: 'published_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  };
}

export function classifySourceUrl(value: string): 'youtube' | 'tiktok' | 'spotify' | 'article' {
  if (isYouTubeVideoUrl(value)) return 'youtube';
  if (isTikTokVideoUrl(value)) return 'tiktok';
  if (isSpotifyEpisodeUrl(value)) return 'spotify';
  return 'article';
}

export function normalizeSourceUrl(value: string): string {
  const kind = classifySourceUrl(value);
  if (kind === 'youtube') return normalizeYouTubeUrl(value);
  if (kind === 'tiktok') return normalizeTikTokUrl(value);
  if (kind === 'spotify') return normalizeSpotifyEpisodeUrl(value);
  return normalizeArticleUrl(value);
}

function listingNormalizedUrls(sourceUrl: string): string[] {
  const urls = new Set<string>([normalizeSourceUrl(sourceUrl)]);
  if (classifySourceUrl(sourceUrl) === 'article') {
    try {
      urls.add(normalizeAudioSourceUrl(sourceUrl));
    } catch {
      // Invalid audio identity is ignored; article normalization still lists text.
    }
  }
  return [...urls];
}

export function getHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function getOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getInitial(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || 'A';
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function sortComments<T extends { id: string; createdAt: string }>(
  comments: T[],
): T[] {
  return [...comments].sort((first, second) => {
    const timeDifference =
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
    return timeDifference || first.id.localeCompare(second.id);
  });
}

export function mergeCommentPages<T extends { id: string; createdAt: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((comment) => [comment.id, comment]));
  for (const comment of incoming) byId.set(comment.id, comment);
  return sortComments([...byId.values()]);
}

export function getCommentPageRange(offset: number): { from: number; to: number } {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Invalid comment page offset.');
  }
  return { from: offset, to: offset + COMMENT_PAGE_SIZE - 1 };
}

export function requireParticipation(userId: string | null): string {
  if (!userId || !isUuid(userId)) throw new Error('Authentication is required.');
  return userId;
}

export function normalizeReshareComment(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > RESHARE_COMMENT_LIMIT) {
    throw new Error('Reshare comments cannot exceed 1,000 characters.');
  }
  return trimmed;
}

export type PublicTimelineRow = {
  itemKind: 'annotation' | 'reshare';
  itemId: string;
  occurredAt: string;
  annotationId: string;
  resharerUserId: string | null;
  reshareComment: string | null;
};

export function parseTimelineRow(value: unknown): PublicTimelineRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const itemKind = row.item_kind === 'annotation' || row.item_kind === 'reshare'
    ? row.item_kind
    : null;
  const itemId = getOptionalText(row.item_id);
  const annotationId = getOptionalText(row.annotation_id);
  const occurredAt = getOptionalText(row.occurred_at);
  const occurredDate = occurredAt ? new Date(occurredAt) : null;
  const resharerUserId = getOptionalText(row.resharer_user_id);
  const comment = typeof row.reshare_comment === 'string' ? row.reshare_comment : null;

  if (
    !itemKind || !itemId || !isUuid(itemId) || !annotationId || !isUuid(annotationId) ||
    !occurredDate || Number.isNaN(occurredDate.getTime())
  ) {
    return null;
  }

  if (itemKind === 'reshare') {
    if (!resharerUserId || !isUuid(resharerUserId)) return null;
    if (comment !== null && (!comment.trim() || comment.length > RESHARE_COMMENT_LIMIT)) {
      return null;
    }
  } else if (resharerUserId || comment) {
    return null;
  }

  return {
    itemKind,
    itemId,
    occurredAt: occurredDate.toISOString(),
    annotationId,
    resharerUserId: itemKind === 'reshare' ? resharerUserId : null,
    reshareComment: itemKind === 'reshare' ? (comment?.trim() || null) : null,
  };
}

export function parseCurrentReshareIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const row of value) {
    const annotationId = typeof row === 'object' && row !== null
      ? getOptionalText((row as Record<string, unknown>).annotation_id)
      : getOptionalText(row);
    if (annotationId && isUuid(annotationId)) ids.add(annotationId);
  }
  return ids;
}

export function parseCurrentBookmarkIds(value: unknown): Set<string> {
  return parseCurrentReshareIds(value);
}

export type BookmarkListRow = {
  annotationId: string;
  bookmarkedAt: string;
};

export function parseBookmarkListRow(value: unknown): BookmarkListRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const annotationId = getOptionalText(row.annotation_id);
  const bookmarkedAt = getOptionalText(row.bookmarked_at);
  const bookmarkedDate = bookmarkedAt ? new Date(bookmarkedAt) : null;
  if (
    !annotationId ||
    !isUuid(annotationId) ||
    !bookmarkedDate ||
    Number.isNaN(bookmarkedDate.getTime())
  ) {
    return null;
  }
  return {
    annotationId,
    bookmarkedAt: bookmarkedDate.toISOString(),
  };
}

export function feedItemKey(item: {
  annotation: { id: string };
  reshare: { id: string } | null;
}): string {
  return item.reshare ? `reshare:${item.reshare.id}` : `annotation:${item.annotation.id}`;
}

export class RequestRevision {
  #revision = 0;

  begin(): number {
    this.#revision += 1;
    return this.#revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.#revision;
  }

  invalidate(): void {
    this.#revision += 1;
  }
}
