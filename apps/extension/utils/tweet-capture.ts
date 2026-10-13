import { isTweetStatusUrl, parseTweetStatusUrl } from '@annotated/shared/tweet-status';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from './social-helpers.ts';

export const TWEET_CAPTURE_BUCKET = 'annotation-tweet-captures';
export const TWEET_CAPTURE_MIME_TYPE = 'image/jpeg';
export const TWEET_SCREENSHOT_MAX_BYTES = 1_572_864;
export const TWEET_SCREENSHOT_MAX_EDGE = 1_400;
export const ATTACH_TWEET_CAPTURE_RPC = 'attach_annotation_tweet_capture';

const HANDLE_PATTERN = /^[a-z0-9_]{1,15}$/;
const TWEET_ID_PATTERN = /^[0-9]{1,20}$/;

export type TweetCropRect = { x: number; y: number; width: number; height: number };

export type TweetCapturePayload = {
  statusUrl: string;
  tweetId: string;
  authorHandle: string;
  authorName: string | null;
  tweetText: string | null;
  postedAt: string | null;
  rect: TweetCropRect | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
};

export type CroppedTweetScreenshot = {
  blob: Blob;
  width: number;
  height: number;
};

type TweetCaptureDependencies = {
  executeScript: (tabId: number) => Promise<unknown>;
  isTabVisible: (tabId: number, windowId: number) => Promise<boolean>;
  captureVisibleTab: (windowId: number) => Promise<string>;
  cropScreenshot: (
    dataUrl: string,
    payload: TweetCapturePayload,
  ) => Promise<CroppedTweetScreenshot | null>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, maximum);
}

function parsePostedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const year = new Date(time).getUTCFullYear();
  if (year < 2006 || year > 2100) return null;
  return new Date(time).toISOString();
}

function parseRect(value: unknown): TweetCropRect | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 40 || height < 40 || width > 8_000 || height > 8_000) return null;
  return { x, y, width, height };
}

export function buildTweetCapturePayload(input: {
  pageUrl: string;
  selectedText?: string | null;
  snapshot?: unknown;
}): TweetCapturePayload | null {
  const identity = parseTweetStatusUrl(input.pageUrl);
  if (!identity) return null;
  const snapshot = isRecord(input.snapshot) ? input.snapshot : null;
  const snapshotId = typeof snapshot?.tweetId === 'string' ? snapshot.tweetId : null;
  const matching = snapshot && snapshotId === identity.tweetId ? snapshot : null;
  const snapshotHandle = typeof matching?.authorHandle === 'string'
    ? matching.authorHandle.toLowerCase()
    : '';
  const authorHandle = HANDLE_PATTERN.test(snapshotHandle) && snapshotHandle === identity.authorHandle
    ? snapshotHandle
    : identity.authorHandle;
  if (!HANDLE_PATTERN.test(authorHandle) || !TWEET_ID_PATTERN.test(identity.tweetId)) return null;

  const viewportWidth = finiteNumber(matching?.viewportWidth);
  const viewportHeight = finiteNumber(matching?.viewportHeight);
  return {
    statusUrl: `https://x.com/${authorHandle}/status/${identity.tweetId}`,
    tweetId: identity.tweetId,
    authorHandle,
    authorName: boundedText(matching?.authorName, 80),
    tweetText: boundedText(matching?.tweetText, 4_000) ?? boundedText(input.selectedText, 4_000),
    postedAt: parsePostedAt(matching?.postedAt),
    rect: parseRect(matching?.rect),
    viewportWidth: viewportWidth && viewportWidth > 0 ? viewportWidth : null,
    viewportHeight: viewportHeight && viewportHeight > 0 ? viewportHeight : null,
  };
}

export function tweetCropSourceRect(input: {
  cssRect: TweetCropRect;
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
}): { sx: number; sy: number; sw: number; sh: number } | null {
  const { cssRect, viewportWidth, viewportHeight, imageWidth, imageHeight } = input;
  if (![viewportWidth, viewportHeight, imageWidth, imageHeight].every((value) => value > 0)) return null;
  const left = Math.max(0, cssRect.x);
  const top = Math.max(0, cssRect.y);
  const right = Math.min(viewportWidth, cssRect.x + cssRect.width);
  const bottom = Math.min(viewportHeight, cssRect.y + cssRect.height);
  const cssWidth = right - left;
  const cssHeight = bottom - top;
  if (cssWidth < 40 || cssHeight < 40) return null;
  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;
  const sx = Math.max(0, Math.floor(left * scaleX));
  const sy = Math.max(0, Math.floor(top * scaleY));
  const sw = Math.min(imageWidth - sx, Math.max(1, Math.floor(cssWidth * scaleX)));
  const sh = Math.min(imageHeight - sy, Math.max(1, Math.floor(cssHeight * scaleY)));
  if (sw < 20 || sh < 20) return null;
  return { sx, sy, sw, sh };
}

export function tweetScreenshotOutputSize(sw: number, sh: number): { width: number; height: number } {
  const edge = Math.max(sw, sh);
  if (edge <= TWEET_SCREENSHOT_MAX_EDGE) return { width: Math.round(sw), height: Math.round(sh) };
  const scale = TWEET_SCREENSHOT_MAX_EDGE / edge;
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), TWEET_CAPTURE_MIME_TYPE, quality);
  });
}

export async function cropTweetScreenshot(
  dataUrl: string,
  payload: TweetCapturePayload,
): Promise<CroppedTweetScreenshot | null> {
  if (
    !payload.rect ||
    !payload.viewportWidth ||
    !payload.viewportHeight ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    !dataUrl.startsWith('data:image/')
  ) return null;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('The visible tab capture could not be read.'));
    element.src = dataUrl;
  }).catch(() => null);
  if (!image) return null;

  const source = tweetCropSourceRect({
    cssRect: payload.rect,
    viewportWidth: payload.viewportWidth,
    viewportHeight: payload.viewportHeight,
    imageWidth: image.naturalWidth || image.width,
    imageHeight: image.naturalHeight || image.height,
  });
  if (!source) return null;
  const output = tweetScreenshotOutputSize(source.sw, source.sh);
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(
    image,
    source.sx,
    source.sy,
    source.sw,
    source.sh,
    0,
    0,
    output.width,
    output.height,
  );

  for (const quality of [0.82, 0.68, 0.52]) {
    const blob = await canvasBlob(canvas, quality);
    if (blob && blob.size > 0 && blob.size <= TWEET_SCREENSHOT_MAX_BYTES && blob.type === TWEET_CAPTURE_MIME_TYPE) {
      return { blob, width: output.width, height: output.height };
    }
  }
  return null;
}

const chromeApi = (globalThis as typeof globalThis & {
  chrome?: {
    scripting?: {
      executeScript: (injection: {
        target: { tabId: number; frameIds: number[] };
        func: () => unknown;
      }) => Promise<Array<{ result?: unknown }>>;
    };
    tabs?: {
      query: (query: { active: boolean; windowId: number }) => Promise<Array<{ id?: number }>>;
      captureVisibleTab: (windowId: number, options: { format: 'png' }) => Promise<string>;
    };
  };
}).chrome;

function extensionDependencies(extract: () => unknown): TweetCaptureDependencies {
  return {
    async executeScript(tabId) {
      const results = await chromeApi?.scripting?.executeScript({
        target: { tabId, frameIds: [0] },
        func: extract,
      });
      return results?.[0]?.result ?? null;
    },
    async isTabVisible(tabId, windowId) {
      const tabs = await chromeApi?.tabs?.query({ active: true, windowId });
      return tabs?.[0]?.id === tabId;
    },
    captureVisibleTab(windowId) {
      if (!chromeApi?.tabs?.captureVisibleTab) {
        return Promise.reject(new Error('Visible tab capture is unavailable.'));
      }
      return chromeApi.tabs.captureVisibleTab(windowId, { format: 'png' });
    },
    cropScreenshot: cropTweetScreenshot,
  };
}

export async function storeTweetCapture(
  supabase: SupabaseClient,
  input: {
    annotationId: string;
    tabId: number;
    windowId: number;
    pageUrl: string;
    selectedText?: string | null;
  },
  dependencies?: Partial<TweetCaptureDependencies> & { extract?: () => unknown },
): Promise<{ stored: boolean }> {
  if (!isUuid(input.annotationId) || !isTweetStatusUrl(input.pageUrl)) return { stored: false };
  const extract = dependencies?.extract ?? extractTweetSnapshotFromPage;
  const deps: TweetCaptureDependencies = {
    ...extensionDependencies(extract),
    ...dependencies,
  };

  let snapshot: unknown = null;
  try {
    snapshot = await deps.executeScript(input.tabId);
  } catch {
    snapshot = null;
  }
  const payload = buildTweetCapturePayload({
    pageUrl: input.pageUrl,
    selectedText: input.selectedText,
    snapshot,
  });
  if (!payload) return { stored: false };

  let screenshot: CroppedTweetScreenshot | null = null;
  if (payload.rect) {
    try {
      const visible = await deps.isTabVisible(input.tabId, input.windowId);
      if (visible) {
        const dataUrl = await deps.captureVisibleTab(input.windowId);
        screenshot = await deps.cropScreenshot(dataUrl, payload);
      }
    } catch {
      screenshot = null;
    }
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userError || !userId || !isUuid(userId)) return { stored: false };

    let storagePath: string | null = null;
    if (screenshot) {
      storagePath = `${userId}/${crypto.randomUUID()}.jpg`;
      const bucket = supabase.storage.from(TWEET_CAPTURE_BUCKET);
      const { data, error } = await bucket.upload(storagePath, screenshot.blob, {
        upsert: false,
        contentType: TWEET_CAPTURE_MIME_TYPE,
      });
      if (error || data?.path !== storagePath) {
        storagePath = null;
        screenshot = null;
      }
    }

    const { data, error } = await supabase.rpc(ATTACH_TWEET_CAPTURE_RPC, {
      p_annotation_id: input.annotationId,
      p_status_url: payload.statusUrl,
      p_tweet_id: payload.tweetId,
      p_author_handle: payload.authorHandle,
      p_author_name: payload.authorName,
      p_tweet_text: payload.tweetText,
      p_posted_at: payload.postedAt,
      p_screenshot_path: storagePath,
      p_screenshot_width: screenshot?.width ?? null,
      p_screenshot_height: screenshot?.height ?? null,
      p_screenshot_byte_size: screenshot?.blob.size ?? null,
    });

    if (error || data !== true) {
      if (storagePath) {
        await supabase.storage.from(TWEET_CAPTURE_BUCKET).remove([storagePath]).catch(() => undefined);
      }
      return { stored: false };
    }
    return { stored: true };
  } catch {
    return { stored: false };
  }
}

// Serialized by chrome.scripting.executeScript. Keep every helper inside.
export function extractTweetSnapshotFromPage(): {
  tweetId: string;
  authorHandle: string | null;
  authorName: string | null;
  tweetText: string | null;
  postedAt: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  viewportWidth: number;
  viewportHeight: number;
} | null {
  try {
    const parts = location.pathname.split('/').filter(Boolean);
    const tweetId = parts[1]?.toLowerCase() === 'status' ? parts[2] ?? '' : '';
    if (!/^[0-9]{1,20}$/.test(tweetId)) return null;
    const urlHandle = (parts[0] ?? '').toLowerCase();
    const articles = [...document.querySelectorAll('article')];
    let best: Element | null = null;
    let bestScore = -1;
    for (const article of articles) {
      const link = article.querySelector(`a[href*="/status/${tweetId}"]`);
      const rect = article.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
      const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
      let score = link ? 8 : 0;
      if (article.querySelector('[data-testid="tweetText"]')) score += 2;
      if (visibleWidth >= 40 && visibleHeight >= 40) score += Math.min(visibleWidth * visibleHeight / 20_000, 4);
      if (rect.top >= 0 && rect.top < 240) score += 2;
      if (score > bestScore) {
        best = article;
        bestScore = score;
      }
    }
    if (!best || bestScore < 8) {
      best = document.querySelector('article[data-testid="tweet"]') ?? best;
    }
    const nameNode = best?.querySelector('[data-testid="User-Name"]');
    const nameText = (nameNode?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const handleMatch = nameText.match(/@([A-Za-z0-9_]{1,15})/);
    const authorHandle = handleMatch?.[1]?.toLowerCase()
      ?? (urlHandle && urlHandle !== 'i' ? urlHandle : null);
    const authorName = handleMatch
      ? nameText.slice(0, handleMatch.index).replace(/[@|]/g, ' ').replace(/\s+/g, ' ').trim() || null
      : null;
    const tweetText = (best?.querySelector('[data-testid="tweetText"]')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim() || null;
    const postedAt = best?.querySelector('time')?.getAttribute('datetime') ?? null;
    const rect = best?.getBoundingClientRect();
    const crop = rect && rect.width >= 40 && rect.height >= 40
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
    return {
      tweetId,
      authorHandle,
      authorName,
      tweetText,
      postedAt,
      rect: crop,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  } catch {
    return null;
  }
}
