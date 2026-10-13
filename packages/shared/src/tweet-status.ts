const TWEET_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_ID_PATTERN = /^[0-9]{1,20}$/;

export type TweetStatusIdentity = {
  statusUrl: string;
  tweetId: string;
  authorHandle: string;
};

export function parseTweetStatusUrl(value: string): TweetStatusIdentity | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!TWEET_HOSTS.has(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[1]?.toLowerCase() !== 'status') return null;
  const handle = parts[0] ?? '';
  const tweetId = parts[2] ?? '';
  if (!HANDLE_PATTERN.test(handle) || handle.toLowerCase() === 'i' || !TWEET_ID_PATTERN.test(tweetId)) {
    return null;
  }

  const authorHandle = handle.toLowerCase();
  return {
    statusUrl: `https://x.com/${authorHandle}/status/${tweetId}`,
    tweetId,
    authorHandle,
  };
}

export function isTweetStatusUrl(value: string): boolean {
  return parseTweetStatusUrl(value) !== null;
}
