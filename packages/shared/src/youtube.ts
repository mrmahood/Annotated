const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_WATCH_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

export class YouTubeUrlError extends Error {
  constructor() {
    super('A supported public YouTube video URL is required.');
    this.name = 'YouTubeUrlError';
  }
}

export type YouTubeVideoIdentity = {
  videoId: string;
  normalizedUrl: string;
  canonicalUrl: string;
};

export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

export function getYouTubeVideoIdentity(value: string): YouTubeVideoIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YouTubeUrlError();
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new YouTubeUrlError();
  }

  const hostname = url.hostname.toLowerCase();
  let videoId: string | null = null;

  if (YOUTUBE_WATCH_HOSTS.has(hostname) && url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else if (hostname === 'youtu.be') {
    const segments = url.pathname.split('/').filter(Boolean);
    videoId = segments.length === 1 ? segments[0]! : null;
  }

  if (!isYouTubeVideoId(videoId)) {
    throw new YouTubeUrlError();
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return { videoId, normalizedUrl: canonicalUrl, canonicalUrl };
}

export function normalizeYouTubeUrl(value: string): string {
  return getYouTubeVideoIdentity(value).normalizedUrl;
}

export function isYouTubeVideoUrl(value: string): boolean {
  try {
    getYouTubeVideoIdentity(value);
    return true;
  } catch {
    return false;
  }
}

export function getYouTubeTimestampUrl(canonicalUrl: string, startMs: number): string {
  const identity = getYouTubeVideoIdentity(canonicalUrl);
  if (!Number.isSafeInteger(startMs) || startMs < 0) {
    throw new YouTubeUrlError();
  }
  const seconds = Math.floor(startMs / 1_000);
  return `${identity.canonicalUrl}&t=${seconds}s`;
}
