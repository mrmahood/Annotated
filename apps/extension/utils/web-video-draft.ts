import { normalizeArticleUrl } from '@annotated/shared/url-normalization';

export const WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY = 'annotated.webVideoClipDraft.v1';
const VERSION = 1 as const;
const COMMENTARY_LIMIT = 2_000;

export type WebVideoClipDraft = {
  version: typeof VERSION;
  source: { pageUrl: string; normalizedUrl: string };
  startMs: number | null;
  endMs: number | null;
  commentary: string;
  updatedAt: number;
};

function validTime(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

export function serializeWebVideoClipDraft(
  pageUrl: string,
  startMs: number | null,
  endMs: number | null,
  commentary: string,
  updatedAt = Date.now(),
): WebVideoClipDraft {
  const normalizedUrl = normalizeArticleUrl(pageUrl);
  if (!validTime(startMs) || !validTime(endMs) || commentary.length > COMMENTARY_LIMIT || !Number.isFinite(updatedAt)) {
    throw new Error('The webpage video draft is invalid.');
  }
  return {
    version: VERSION,
    source: { pageUrl: normalizedUrl, normalizedUrl },
    startMs,
    endMs,
    commentary,
    updatedAt,
  };
}

export function deserializeWebVideoClipDraft(value: unknown): WebVideoClipDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === 'object' && row.source !== null
    ? row.source as Record<string, unknown>
    : null;
  if (
    row.version !== VERSION || !source || typeof source.pageUrl !== 'string' ||
    typeof source.normalizedUrl !== 'string' || !validTime(row.startMs) || !validTime(row.endMs) ||
    typeof row.commentary !== 'string' || row.commentary.length > COMMENTARY_LIMIT ||
    typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
  ) return null;
  try {
    const normalizedUrl = normalizeArticleUrl(source.pageUrl);
    if (normalizedUrl !== source.normalizedUrl) return null;
    return {
      version: VERSION,
      source: { pageUrl: normalizedUrl, normalizedUrl },
      startMs: row.startMs,
      endMs: row.endMs,
      commentary: row.commentary,
      updatedAt: row.updatedAt,
    };
  } catch { return null; }
}

export function webVideoClipDraftBelongsToSource(draft: WebVideoClipDraft, pageUrl: string): boolean {
  try { return normalizeArticleUrl(pageUrl) === draft.source.normalizedUrl; }
  catch { return false; }
}
