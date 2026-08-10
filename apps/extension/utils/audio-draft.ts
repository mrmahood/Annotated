import { getAudioSourceIdentity } from '@annotated/shared/audio-source';

export const AUDIO_CLIP_DRAFT_STORAGE_KEY = 'annotated.audioClipDraft.v1';
const VERSION = 1 as const;
const COMMENTARY_LIMIT = 2_000;

export type AudioClipDraft = {
  version: typeof VERSION;
  source: { normalizedUrl: string; canonicalUrl: string };
  startMs: number | null;
  endMs: number | null;
  commentary: string;
  updatedAt: number;
};

function validTime(value: unknown): value is number | null {
  return value === null || (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  );
}

export function serializeAudioClipDraft(
  sourceUrl: string,
  canonicalUrl: string,
  startMs: number | null,
  endMs: number | null,
  commentary: string,
  updatedAt = Date.now(),
): AudioClipDraft {
  const source = getAudioSourceIdentity(sourceUrl, canonicalUrl);
  if (!validTime(startMs) || !validTime(endMs) || commentary.length > COMMENTARY_LIMIT) {
    throw new Error('The audio clip draft is invalid.');
  }
  return {
    version: VERSION,
    source: { normalizedUrl: source.normalizedUrl, canonicalUrl: source.canonicalUrl },
    startMs,
    endMs,
    commentary,
    updatedAt,
  };
}

export function deserializeAudioClipDraft(value: unknown): AudioClipDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === 'object' && row.source !== null
    ? row.source as Record<string, unknown>
    : null;
  if (
    row.version !== VERSION || !source ||
    typeof source.normalizedUrl !== 'string' || typeof source.canonicalUrl !== 'string' ||
    !validTime(row.startMs) || !validTime(row.endMs) ||
    typeof row.commentary !== 'string' || row.commentary.length > COMMENTARY_LIMIT ||
    typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
  ) return null;
  try {
    const identity = getAudioSourceIdentity(source.normalizedUrl, source.canonicalUrl);
    if (
      identity.normalizedUrl !== source.normalizedUrl ||
      identity.canonicalUrl !== source.canonicalUrl
    ) return null;
    return {
      version: VERSION,
      source: { normalizedUrl: identity.normalizedUrl, canonicalUrl: identity.canonicalUrl },
      startMs: row.startMs,
      endMs: row.endMs,
      commentary: row.commentary,
      updatedAt: row.updatedAt,
    };
  } catch { return null; }
}

export function audioClipDraftBelongsToSource(
  draft: AudioClipDraft,
  sourceUrl: string,
  canonicalUrl?: string | null,
): boolean {
  try {
    return getAudioSourceIdentity(sourceUrl, canonicalUrl).normalizedUrl === draft.source.normalizedUrl;
  } catch { return false; }
}
