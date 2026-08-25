import { normalizeArticleUrl } from '@annotated/shared/url-normalization';
import { isYouTubeVideoUrl, normalizeYouTubeUrl } from '@annotated/shared/youtube';

export const PUBLIC_ANNOTATION_STATUS = 'published' as const;
export const PUBLIC_COMMENT_STATUS = 'public' as const;
export const ANNOTATION_PAGE_SIZE = 10;
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_BODY_LIMIT = 1_000;

export type PublicAnnotationRoute = {
  creatorHandle: string;
  annotationSlug: string;
};

const CREATOR_HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;
const ANNOTATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_ROOT_HANDLES = new Set(['api', 'auth', '_next']);

export type AnnotationQueryPlan = {
  normalizedUrl?: string;
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

  return {
    ...(options.sourceUrl
      ? { normalizedUrl: normalizeSourceUrl(options.sourceUrl) }
      : {}),
    ...(options.profileId ? { profileId: options.profileId } : {}),
    status: PUBLIC_ANNOTATION_STATUS,
    orders: [
      { column: 'published_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  };
}

export function classifySourceUrl(value: string): 'youtube' | 'article' {
  return isYouTubeVideoUrl(value) ? 'youtube' : 'article';
}

export function normalizeSourceUrl(value: string): string {
  return classifySourceUrl(value) === 'youtube'
    ? normalizeYouTubeUrl(value)
    : normalizeArticleUrl(value);
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
