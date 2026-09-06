import { getSpotifyEpisodeIdentity } from '@annotated/shared/spotify';

export const SPOTIFY_CLIP_DRAFT_STORAGE_KEY = 'annotated.spotifyClipDraft.v1';
const VERSION = 1 as const;
const COMMENTARY_LIMIT = 2_000;

export type SpotifyClipDraft = {
  version: typeof VERSION;
  source: {
    episodeId: string;
    normalizedUrl: string;
    canonicalUrl: string;
  };
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

export function serializeSpotifyClipDraft(
  sourceUrl: string,
  startMs: number | null,
  endMs: number | null,
  commentary: string,
  updatedAt = Date.now(),
): SpotifyClipDraft {
  const source = getSpotifyEpisodeIdentity(sourceUrl);
  if (!validTime(startMs) || !validTime(endMs) || commentary.length > COMMENTARY_LIMIT) {
    throw new Error('The Spotify clip draft is invalid.');
  }
  return { version: VERSION, source, startMs, endMs, commentary, updatedAt };
}

export function deserializeSpotifyClipDraft(value: unknown): SpotifyClipDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === 'object' && row.source !== null
    ? row.source as Record<string, unknown>
    : null;
  if (
    row.version !== VERSION || !source ||
    typeof source.episodeId !== 'string' ||
    typeof source.normalizedUrl !== 'string' ||
    typeof source.canonicalUrl !== 'string' || !validTime(row.startMs) || !validTime(row.endMs) ||
    typeof row.commentary !== 'string' || row.commentary.length > COMMENTARY_LIMIT ||
    typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
  ) return null;
  try {
    const identity = getSpotifyEpisodeIdentity(source.normalizedUrl);
    if (
      identity.episodeId !== source.episodeId ||
      identity.normalizedUrl !== source.normalizedUrl ||
      identity.canonicalUrl !== source.canonicalUrl
    ) return null;
    return {
      version: VERSION,
      source: identity,
      startMs: row.startMs,
      endMs: row.endMs,
      commentary: row.commentary,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export function spotifyClipDraftBelongsToSource(
  draft: SpotifyClipDraft,
  sourceUrl: string,
): boolean {
  try {
    return getSpotifyEpisodeIdentity(sourceUrl).episodeId === draft.source.episodeId;
  } catch {
    return false;
  }
}
