import {
  ANNOTATION_TITLE_MAX_LENGTH,
  readDraftAnnotationTitle,
} from '@annotated/shared/annotation-title';
import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';

export const TIKTOK_CLIP_DRAFT_STORAGE_KEY = 'annotated.tiktokClipDraft.v1';
const VERSION = 1 as const;
const COMMENTARY_LIMIT = 2_000;

export type TikTokClipDraft = {
  version: typeof VERSION;
  source: {
    videoId: string;
    handle: string;
    normalizedUrl: string;
    canonicalUrl: string;
  };
  startMs: number | null;
  endMs: number | null;
  title: string;
  commentary: string;
  updatedAt: number;
};

function validTime(value: unknown): value is number | null {
  return value === null || (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  );
}

export function serializeTikTokClipDraft(
  sourceUrl: string,
  startMs: number | null,
  endMs: number | null,
  commentary: string,
  updatedAt = Date.now(),
  title = '',
): TikTokClipDraft {
  const source = getTikTokVideoIdentity(sourceUrl);
  if (
    !validTime(startMs) || !validTime(endMs) || commentary.length > COMMENTARY_LIMIT ||
    title.length > ANNOTATION_TITLE_MAX_LENGTH
  ) {
    throw new Error('The TikTok clip draft is invalid.');
  }
  return { version: VERSION, source, startMs, endMs, title, commentary, updatedAt };
}

export function deserializeTikTokClipDraft(value: unknown): TikTokClipDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === 'object' && row.source !== null
    ? row.source as Record<string, unknown>
    : null;
  if (
    row.version !== VERSION || !source ||
    typeof source.videoId !== 'string' || typeof source.handle !== 'string' ||
    typeof source.normalizedUrl !== 'string' ||
    typeof source.canonicalUrl !== 'string' || !validTime(row.startMs) || !validTime(row.endMs) ||
    typeof row.commentary !== 'string' || row.commentary.length > COMMENTARY_LIMIT ||
    typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
  ) return null;
  try {
    const identity = getTikTokVideoIdentity(source.normalizedUrl);
    if (
      identity.videoId !== source.videoId ||
      identity.handle !== source.handle ||
      identity.normalizedUrl !== source.normalizedUrl ||
      identity.canonicalUrl !== source.canonicalUrl
    ) return null;
    return {
      version: VERSION,
      source: identity,
      startMs: row.startMs,
      endMs: row.endMs,
      title: readDraftAnnotationTitle(row.title),
      commentary: row.commentary,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export function tiktokClipDraftBelongsToSource(
  draft: TikTokClipDraft,
  sourceUrl: string,
): boolean {
  try {
    return getTikTokVideoIdentity(sourceUrl).videoId === draft.source.videoId;
  } catch {
    return false;
  }
}
