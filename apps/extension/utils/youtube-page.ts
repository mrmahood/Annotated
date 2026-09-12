import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';

export type YouTubePageMetadata = {
  videoId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  title: string;
  channelName: string | null;
  hostname: 'youtube.com';
};

export type YouTubePlayerState = {
  currentTime: number;
  duration: number | null;
  paused: boolean;
};

// Serialized into the explicitly connected top-level tab. Keep this function
// self-contained and return only public video-page metadata.
export async function extractYouTubePageMetadata() {
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const cleanTitle = (value: string | null | undefined) => {
    const title = clean(value).replace(/\s+-\s+YouTube$/i, '').trim();
    return /^(?:www\.)?youtube(?:\.com)?$/i.test(title) ? '' : title;
  };
  const meta = (selector: string) =>
    clean(document.querySelector<HTMLMetaElement>(selector)?.content);
  const linkContent = (selector: string) => {
    const element = document.querySelector<HTMLLinkElement>(selector);
    return clean(element?.getAttribute('content') ?? element?.getAttribute('title'));
  };

  const read = () => {
    const title =
      cleanTitle(document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent) ||
      cleanTitle(document.querySelector('h1.title yt-formatted-string')?.textContent) ||
      cleanTitle(document.querySelector('.ytp-title-link')?.textContent) ||
      cleanTitle(meta('meta[property="og:title"]')) ||
      cleanTitle(meta('meta[name="title"]')) ||
      cleanTitle(meta('meta[itemprop="name"]')) ||
      cleanTitle(document.title);
    const channelName =
      meta('meta[itemprop="author"]') ||
      linkContent('span[itemprop="author"] link[itemprop="name"]') ||
      linkContent('link[itemprop="name"]') ||
      clean(document.querySelector('ytd-channel-name a')?.textContent);
    return { title, channelName: channelName || null };
  };

  let metadata = read();
  for (let attempt = 0; !metadata.title && attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    metadata = read();
  }
  let videoId = '';
  try { videoId = new URL(location.href).searchParams.get('v') ?? ''; } catch { /* Invalid page URL. */ }

  return {
    pageUrl: location.href,
    videoId,
    title: metadata.title,
    channelName: metadata.channelName,
    hostname: 'youtube.com',
  };
}

export function normalizeYouTubeVideoTitle(value: unknown) {
  if (typeof value !== 'string') return '';
  const title = value.replace(/\s+/g, ' ').trim().replace(/\s+-\s+YouTube$/i, '').trim();
  return /^(?:www\.)?youtube(?:\.com)?$/i.test(title) ? '' : title.slice(0, 500);
}

export function validateYouTubePageMetadata(
  expectedUrl: string,
  value: unknown,
): YouTubePageMetadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.pageUrl !== 'string' ||
    typeof row.videoId !== 'string' ||
    typeof row.title !== 'string' ||
    (row.channelName !== null && typeof row.channelName !== 'string') ||
    row.hostname !== 'youtube.com'
  ) return null;

  try {
    const expected = getYouTubeVideoIdentity(expectedUrl);
    const actual = getYouTubeVideoIdentity(row.pageUrl);
    if (expected.videoId !== actual.videoId || row.videoId !== actual.videoId) return null;
    const title = normalizeYouTubeVideoTitle(row.title);
    const channelName = typeof row.channelName === 'string'
      ? row.channelName.replace(/\s+/g, ' ').trim().slice(0, 500) || null
      : null;
    return { ...expected, title: title || 'youtube.com', channelName, hostname: 'youtube.com' };
  } catch {
    return null;
  }
}

// Invoked for an explicit playhead refresh.
export function readYouTubePlayerState() {
  const video = document.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) return null;
  return {
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
  };
}

export function validateYouTubePlayerState(value: unknown): YouTubePlayerState | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.currentTime !== 'number' || !Number.isFinite(row.currentTime) ||
    row.currentTime < 0 || typeof row.paused !== 'boolean' ||
    (row.duration !== null && (
      typeof row.duration !== 'number' || !Number.isFinite(row.duration) || row.duration < 0
    ))
  ) return null;
  if (typeof row.duration === 'number' && row.currentTime > row.duration + 0.5) return null;
  return {
    currentTime: row.currentTime,
    duration: row.duration as number | null,
    paused: row.paused,
  };
}

// Serialized into the connected tab for an explicit Play clip action.
export function playYouTubeVideoFrom(startSeconds: number) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) return false;
  const video = document.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) return false;
  if (Number.isFinite(video.duration) && startSeconds > video.duration) return false;
  video.currentTime = startSeconds;
  void video.play().catch(() => undefined);
  return true;
}
