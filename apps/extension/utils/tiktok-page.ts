import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';

export type TikTokPageMetadata = {
  videoId: string;
  handle: string;
  normalizedUrl: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  hostname: 'tiktok.com';
};

export type TikTokPlayerState = {
  currentTime: number;
  duration: number | null;
  paused: boolean;
};

// Serialized into the explicitly connected top-level tab. Keep this function
// self-contained and return only public video-page metadata.
export async function extractTikTokPageMetadata() {
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const cleanTitle = (value: string | null | undefined) => {
    const title = clean(value)
      .replace(/\s*[|\-–—]\s*TikTok$/i, '')
      .replace(/\s+on TikTok$/i, '')
      .trim();
    return /^(?:www\.)?tiktok(?:\.com)?$/i.test(title) ? '' : title;
  };
  const meta = (selector: string) =>
    clean(document.querySelector<HTMLMetaElement>(selector)?.content);

  const read = () => {
    const title =
      cleanTitle(meta('meta[property="og:title"]')) ||
      cleanTitle(meta('meta[name="og:title"]')) ||
      cleanTitle(document.querySelector('[data-e2e="browse-video-desc"]')?.textContent) ||
      cleanTitle(document.title);
    const author =
      meta('meta[property="og:description"]') &&
      /^@?[A-Za-z0-9._]{2,24}$/.test(clean(meta('meta[name="author"]')))
        ? clean(meta('meta[name="author"]'))
        : clean(document.querySelector('[data-e2e="browse-username"]')?.textContent) ||
          clean(document.querySelector('a[href^="/@"]')?.textContent);
    return {
      title,
      author: author.replace(/^@/, '').trim() || null,
    };
  };

  let metadata = read();
  for (let attempt = 0; !metadata.title && attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    metadata = read();
  }

  let videoId = '';
  let handle = '';
  try {
    const match = new URL(location.href).pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
    handle = match?.[1]?.toLowerCase() ?? '';
    videoId = match?.[2] ?? '';
  } catch { /* Invalid page URL. */ }

  return {
    pageUrl: location.href,
    videoId,
    handle,
    title: metadata.title,
    author: metadata.author,
    hostname: 'tiktok.com',
  };
}

export function normalizeTikTokVideoTitle(value: unknown) {
  if (typeof value !== 'string') return '';
  const title = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[|\-–—]\s*TikTok$/i, '')
    .replace(/\s+on TikTok$/i, '')
    .trim();
  return /^(?:www\.)?tiktok(?:\.com)?$/i.test(title) ? '' : title.slice(0, 500);
}

export function validateTikTokPageMetadata(
  expectedUrl: string,
  value: unknown,
): TikTokPageMetadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.pageUrl !== 'string' ||
    typeof row.videoId !== 'string' ||
    typeof row.title !== 'string' ||
    (row.author !== null && typeof row.author !== 'string') ||
    row.hostname !== 'tiktok.com'
  ) return null;

  try {
    const expected = getTikTokVideoIdentity(expectedUrl);
    const actual = getTikTokVideoIdentity(row.pageUrl);
    if (expected.videoId !== actual.videoId || row.videoId !== actual.videoId) return null;
    if (
      typeof row.handle === 'string' &&
      row.handle.toLowerCase() !== actual.handle
    ) return null;
    const title = normalizeTikTokVideoTitle(row.title);
    const author = typeof row.author === 'string'
      ? row.author.replace(/^@/, '').replace(/\s+/g, ' ').trim().slice(0, 500) || null
      : null;
    return {
      ...expected,
      title: title || `@${expected.handle}`,
      author: author ?? expected.handle,
      hostname: 'tiktok.com',
    };
  } catch {
    return null;
  }
}

// Invoked for an explicit playhead refresh.
export function readTikTokPlayerState() {
  const video = document.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) return null;
  return {
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
  };
}

export function validateTikTokPlayerState(value: unknown): TikTokPlayerState | null {
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
