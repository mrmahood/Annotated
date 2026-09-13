const TRACKING_PARAMETERS = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']);
const PLAYBACK_LOCATION_PARAMETERS = new Set([
  't', 'time', 'timestamp', 'start', 'start_time', 'seek', 'position', 'playback_position',
]);

function isPlaybackLocationValue(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(value) ||
    /^\d{1,3}:\d{2}(?::\d{2})?$/.test(value) ||
    /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(value);
}

export class AudioSourceUrlError extends Error {
  constructor() {
    super('Podcast and web-audio sources must use HTTP or HTTPS.');
    this.name = 'AudioSourceUrlError';
  }
}

export type AudioSourceIdentity = {
  normalizedUrl: string;
  canonicalUrl: string;
  hostname: string;
};

function parseHttpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AudioSourceUrlError(); }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' || url.password !== ''
  ) throw new AudioSourceUrlError();
  return url;
}

export function normalizeAudioSourceUrl(value: string): string {
  const url = parseHttpUrl(value);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const parameter of [...url.searchParams.keys()]) {
    const key = parameter.toLowerCase();
    if (
      key.startsWith('utm_') || TRACKING_PARAMETERS.has(key) ||
      (PLAYBACK_LOCATION_PARAMETERS.has(key) && isPlaybackLocationValue(url.searchParams.get(parameter) ?? ''))
    ) url.searchParams.delete(parameter);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

export function isApplePodcastsUrl(value: string): boolean {
  try {
    const url = parseHttpUrl(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return hostname === 'podcasts.apple.com';
  } catch {
    return false;
  }
}

export function getAudioSourceIdentity(
  pageUrl: string,
  canonicalCandidate?: string | null,
): AudioSourceIdentity {
  const page = parseHttpUrl(pageUrl);
  let identityUrl = page.href;
  if (canonicalCandidate?.trim()) {
    try {
      const canonical = parseHttpUrl(new URL(canonicalCandidate, page).href);
      if (canonical.origin === page.origin) identityUrl = canonical.href;
    } catch { /* Ignore invalid or cross-origin canonical metadata. */ }
  }
  const normalizedUrl = normalizeAudioSourceUrl(identityUrl);
  return { normalizedUrl, canonicalUrl: normalizedUrl, hostname: new URL(normalizedUrl).hostname };
}
