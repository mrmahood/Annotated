const TIKTOK_VIDEO_ID_PATTERN = /^\d{10,25}$/;
const TIKTOK_HANDLE_PATTERN = /^[A-Za-z0-9._]{2,24}$/;
const TIKTOK_WATCH_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
]);

export class TikTokUrlError extends Error {
  constructor() {
    super('A supported public TikTok video URL is required.');
    this.name = 'TikTokUrlError';
  }
}

export type TikTokVideoIdentity = {
  videoId: string;
  handle: string;
  normalizedUrl: string;
  canonicalUrl: string;
};

export function isTikTokVideoId(value: unknown): value is string {
  return typeof value === 'string' && TIKTOK_VIDEO_ID_PATTERN.test(value);
}

export function isTikTokHandle(value: unknown): value is string {
  return typeof value === 'string' && TIKTOK_HANDLE_PATTERN.test(value);
}

function parseWatchPath(pathname: string): { handle: string; videoId: string } | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 3) return null;
  const [rawHandle, kind, videoId] = segments;
  if (kind?.toLowerCase() !== 'video' || !isTikTokVideoId(videoId)) return null;
  const handle = rawHandle?.startsWith('@') ? rawHandle.slice(1).toLowerCase() : '';
  if (!isTikTokHandle(handle)) return null;
  return { handle, videoId };
}

export function getTikTokVideoIdentity(value: string): TikTokVideoIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TikTokUrlError();
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TikTokUrlError();
  }

  const hostname = url.hostname.toLowerCase();
  if (!TIKTOK_WATCH_HOSTS.has(hostname)) {
    throw new TikTokUrlError();
  }

  const parsed = parseWatchPath(url.pathname);
  if (!parsed) {
    throw new TikTokUrlError();
  }

  const canonicalUrl = `https://www.tiktok.com/@${parsed.handle}/video/${parsed.videoId}`;
  return {
    videoId: parsed.videoId,
    handle: parsed.handle,
    normalizedUrl: canonicalUrl,
    canonicalUrl,
  };
}

export function normalizeTikTokUrl(value: string): string {
  return getTikTokVideoIdentity(value).normalizedUrl;
}

export function isTikTokVideoUrl(value: string): boolean {
  try {
    getTikTokVideoIdentity(value);
    return true;
  } catch {
    return false;
  }
}
