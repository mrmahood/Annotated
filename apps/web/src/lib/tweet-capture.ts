import { parseTweetStatusUrl } from "@annotated/shared/tweet-status";

export const TWEET_CAPTURE_BUCKET = "annotation-tweet-captures";

export type PublicTweetCapture = {
  statusUrl: string;
  tweetId: string;
  authorHandle: string;
  authorName: string | null;
  tweetText: string | null;
  postedAt: string | null;
  screenshotUrl: string | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > maximum) return null;
  return text;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parsePublicTweetCapture(
  value: unknown,
  screenshotUrl: string | null,
): PublicTweetCapture | null {
  if (!isRecord(value)) return null;
  const statusUrl = typeof value.status_url === "string" ? value.status_url : "";
  const identity = parseTweetStatusUrl(statusUrl);
  if (!identity || identity.statusUrl !== statusUrl) return null;
  if (value.tweet_id !== identity.tweetId || value.author_handle !== identity.authorHandle) return null;

  const authorName = value.author_name == null ? null : optionalText(value.author_name, 80);
  if (value.author_name != null && !authorName) return null;
  const tweetText = value.tweet_text == null ? null : optionalText(value.tweet_text, 4_000);
  if (value.tweet_text != null && !tweetText) return null;

  let postedAt: string | null = null;
  if (value.posted_at != null) {
    if (typeof value.posted_at !== "string") return null;
    const time = Date.parse(value.posted_at);
    if (!Number.isFinite(time)) return null;
    postedAt = new Date(time).toISOString();
  }

  const path = value.screenshot_path;
  const hasShot = typeof path === "string" && path.length > 0;
  const width = value.screenshot_width;
  const height = value.screenshot_height;
  const safeShot = hasShot
    && Number.isSafeInteger(width) && (width as number) >= 1 && (width as number) <= 4096
    && Number.isSafeInteger(height) && (height as number) >= 1 && (height as number) <= 4096
    && httpsUrl(screenshotUrl) !== null
    && screenshotUrl?.includes(path as string) === true;
  if (hasShot && !safeShot) {
    return {
      statusUrl,
      tweetId: identity.tweetId,
      authorHandle: identity.authorHandle,
      authorName,
      tweetText,
      postedAt,
      screenshotUrl: null,
      screenshotWidth: null,
      screenshotHeight: null,
    };
  }

  return {
    statusUrl,
    tweetId: identity.tweetId,
    authorHandle: identity.authorHandle,
    authorName,
    tweetText,
    postedAt,
    screenshotUrl: safeShot ? httpsUrl(screenshotUrl) : null,
    screenshotWidth: safeShot ? width as number : null,
    screenshotHeight: safeShot ? height as number : null,
  };
}
