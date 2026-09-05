const PROCESSED_MEDIA_SIGN_PREFIX = '/storage/v1/object/sign/annotation-media/';
const PLAYABLE_MEDIA_TYPES = new Set(['video/mp4', 'audio/mp4']);
const REDIRECT_STATUSES = new Set([302, 307]);

function isTrustedHttpUrl(value: URL): boolean {
  if (value.username || value.password) return false;
  if (value.protocol === 'https:') return true;
  return value.protocol === 'http:' &&
    (value.hostname === 'localhost' || value.hostname === '127.0.0.1');
}

function parseTrustedHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return isTrustedHttpUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function getTrustedSignedPlaybackUrl(
  location: unknown,
  supabaseUrl: string,
): string | null {
  const signedUrl = parseTrustedHttpUrl(location);
  const expected = parseTrustedHttpUrl(supabaseUrl);
  if (!signedUrl || !expected) return null;
  if (
    signedUrl.origin !== expected.origin ||
    !signedUrl.pathname.startsWith(PROCESSED_MEDIA_SIGN_PREFIX) ||
    !signedUrl.searchParams.get('token')
  ) return null;
  return signedUrl.href;
}

function mediaContentType(response: Response): string {
  return response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The playback body must never be buffered into a Blob for the player.
  }
}

function withJsonDelivery(playbackUrl: string): string {
  const url = new URL(playbackUrl);
  url.searchParams.set('delivery', 'json');
  return url.href;
}

async function resolveJsonPlaybackSrc(
  fetchImpl: typeof fetch,
  playbackUrl: string,
  supabaseUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(withJsonDelivery(playbackUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      // Stay on the playback origin so a 307 cannot pull the mp4 body into the extension.
      redirect: 'manual',
      cache: 'no-store',
      signal,
    });
  } catch {
    return null;
  }

  if (!response.ok || mediaContentType(response) !== 'application/json') {
    await discardBody(response);
    return null;
  }

  try {
    const body: unknown = await response.json();
    return isRecord(body)
      ? getTrustedSignedPlaybackUrl(body.signedUrl, supabaseUrl)
      : null;
  } catch {
    return null;
  }
}

async function fetchPlaybackResponse(
  fetchImpl: typeof fetch,
  playbackUrl: string,
  method: 'GET' | 'HEAD',
  signal?: AbortSignal,
): Promise<Response | null> {
  try {
    const response = await fetchImpl(playbackUrl, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
    await discardBody(response);
    return response;
  } catch {
    return null;
  }
}

function redirectLocation(response: Response): string | null {
  if (!REDIRECT_STATUSES.has(response.status)) return null;
  return response.headers.get('location');
}

export async function resolveHostedPlaybackSrc(input: {
  playbackUrl: string;
  supabaseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!parseTrustedHttpUrl(input.playbackUrl) || !parseTrustedHttpUrl(input.supabaseUrl)) {
    return null;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const jsonSrc = await resolveJsonPlaybackSrc(
    fetchImpl,
    input.playbackUrl,
    input.supabaseUrl,
    input.signal,
  );
  if (jsonSrc) return jsonSrc;

  let response = await fetchPlaybackResponse(fetchImpl, input.playbackUrl, 'GET', input.signal);
  if (!response || (REDIRECT_STATUSES.has(response.status) && !redirectLocation(response))) {
    const head = await fetchPlaybackResponse(fetchImpl, input.playbackUrl, 'HEAD', input.signal);
    if (head) response = head;
  }
  if (!response) return null;

  if (REDIRECT_STATUSES.has(response.status)) {
    return getTrustedSignedPlaybackUrl(redirectLocation(response), input.supabaseUrl);
  }

  if (response.ok && PLAYABLE_MEDIA_TYPES.has(mediaContentType(response))) {
    return input.playbackUrl;
  }

  return null;
}
