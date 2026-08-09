import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';

export type YouTubePageMetadata = {
  videoId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  title: string;
  channelName: string | null;
};

export type YouTubePlayerState = {
  currentTime: number;
  duration: number | null;
  paused: boolean;
};

// Serialized into the explicitly connected top-level tab. Keep this function
// self-contained and return only public video-page metadata.
export function extractYouTubePageMetadata() {
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const meta = (selector: string) =>
    clean(document.querySelector<HTMLMetaElement>(selector)?.content);
  const linkContent = (selector: string) => {
    const element = document.querySelector<HTMLLinkElement>(selector);
    return clean(element?.getAttribute('content') ?? element?.getAttribute('title'));
  };

  const title = meta('meta[property="og:title"]') ||
    clean(document.title).replace(/\s+-\s+YouTube$/, '');
  const channelName =
    meta('meta[itemprop="author"]') ||
    linkContent('link[itemprop="name"]') ||
    clean(document.querySelector('ytd-channel-name a')?.textContent);

  return {
    pageUrl: location.href,
    title,
    channelName: channelName || null,
  };
}

export function validateYouTubePageMetadata(
  expectedUrl: string,
  value: unknown,
): YouTubePageMetadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.pageUrl !== 'string' ||
    typeof row.title !== 'string' ||
    (row.channelName !== null && typeof row.channelName !== 'string')
  ) return null;

  try {
    const expected = getYouTubeVideoIdentity(expectedUrl);
    const actual = getYouTubeVideoIdentity(row.pageUrl);
    if (expected.videoId !== actual.videoId) return null;
    const title = row.title.replace(/\s+/g, ' ').trim().slice(0, 500);
    const channelName = typeof row.channelName === 'string'
      ? row.channelName.replace(/\s+/g, ' ').trim().slice(0, 500) || null
      : null;
    return { ...expected, title: title || 'Untitled YouTube video', channelName };
  } catch {
    return null;
  }
}

// Invoked only for Set start, Set end, or an explicit refresh action.
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
