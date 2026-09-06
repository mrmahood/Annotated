const SPOTIFY_EPISODE_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_EPISODE_HOSTS = new Set([
  'open.spotify.com',
]);
const SPOTIFY_EPISODE_PATH = /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i;

export class SpotifyUrlError extends Error {
  constructor() {
    super('A supported public Spotify episode URL is required.');
    this.name = 'SpotifyUrlError';
  }
}

export type SpotifyEpisodeIdentity = {
  episodeId: string;
  normalizedUrl: string;
  canonicalUrl: string;
};

export function isSpotifyEpisodeId(value: unknown): value is string {
  return typeof value === 'string' && SPOTIFY_EPISODE_ID_PATTERN.test(value);
}

function parseEpisodePath(pathname: string): string | null {
  const match = pathname.match(SPOTIFY_EPISODE_PATH);
  if (!match) return null;
  const episodeId = match[1]!;
  return isSpotifyEpisodeId(episodeId) ? episodeId : null;
}

export function getSpotifyEpisodeIdentity(value: string): SpotifyEpisodeIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpotifyUrlError();
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SpotifyUrlError();
  }

  const hostname = url.hostname.toLowerCase();
  if (!SPOTIFY_EPISODE_HOSTS.has(hostname)) {
    throw new SpotifyUrlError();
  }

  const episodeId = parseEpisodePath(url.pathname);
  if (!episodeId) {
    throw new SpotifyUrlError();
  }

  const canonicalUrl = `https://open.spotify.com/episode/${episodeId}`;
  return {
    episodeId,
    normalizedUrl: canonicalUrl,
    canonicalUrl,
  };
}

export function normalizeSpotifyEpisodeUrl(value: string): string {
  return getSpotifyEpisodeIdentity(value).normalizedUrl;
}

export function isSpotifyEpisodeUrl(value: string): boolean {
  try {
    getSpotifyEpisodeIdentity(value);
    return true;
  } catch {
    return false;
  }
}
