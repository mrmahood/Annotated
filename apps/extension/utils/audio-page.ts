import { getAudioSourceIdentity, normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { isYouTubeVideoUrl } from '@annotated/shared/youtube';

export type AudioPlayerCandidate = {
  playerId: string;
  elementType: 'audio' | 'audio-only-video';
  currentTime: number | null;
  duration: number | null;
  paused: boolean;
  ended: boolean;
  sourcePresent: boolean;
  operable: boolean;
};

export type AudioPlayerSelection =
  | { status: 'supported'; player: AudioPlayerCandidate }
  | { status: 'ambiguous' }
  | { status: 'no-audio' };

export type AudioPlayerReadiness =
  | { status: 'ready'; currentTime: number; duration: number }
  | { status: 'duration-unavailable'; currentTime: number; duration: null }
  | { status: 'current-time-unavailable'; currentTime: null; duration: null };

export type AudioPlayerStatus = AudioPlayerReadiness['status'] | 'ambiguous' | 'unavailable';

export type AudioPageSource = {
  title: string;
  hostname: string;
  url: string;
  normalizedUrl: string;
  canonicalUrl: string;
  classification: 'Podcast / web audio';
  author: string | null;
  publisher: string | null;
  showName: string | null;
  playerId: string | null;
  playerStatus: AudioPlayerStatus;
};

export type AudioPageDetection =
  | {
      status: 'supported';
      exclusivePodcast: boolean;
      source: AudioPageSource;
      selection: Exclude<AudioPlayerSelection, { status: 'no-audio' }>;
      readiness: AudioPlayerReadiness | null;
    }
  | { status: 'not-audio-page' | 'no-audio' };

export function classifyConnectedSource(
  url: string,
  audioStatus: AudioPageDetection['status'],
): 'youtube' | 'audio' | 'audio-unsupported' | 'article' {
  if (isYouTubeVideoUrl(url)) return 'youtube';
  if (audioStatus === 'supported') return 'audio';
  if (audioStatus === 'no-audio') return 'audio-unsupported';
  return 'article';
}

function isPodcastOgType(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const ogType = value.toLowerCase().trim();
  return (
    ogType === 'podcast' ||
    ogType.startsWith('music.') ||
    ogType.startsWith('audio') ||
    ogType.includes('podcast')
  );
}

function hasPodcastSchemaTypes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) =>
    typeof item === 'string' &&
    /PodcastEpisode|RadioEpisode|PodcastSeries|PodcastSeason|(?:^|\/|\s)Podcast(?:$|\s)/i.test(item),
  );
}

export function hasStrongPodcastSignals(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata.podcastSignalsPresent === true) return true;
  if (metadata.audioMetadataPresent === true) return true;
  if (metadata.applePodcasts === true) return true;
  if (isPodcastOgType(metadata.ogType)) return true;
  return hasPodcastSchemaTypes(metadata.schemaTypes);
}

export function getAudioPlayerReadiness(candidate: AudioPlayerCandidate): AudioPlayerReadiness {
  if (
    candidate.currentTime === null ||
    !Number.isFinite(candidate.currentTime) ||
    candidate.currentTime < 0
  ) {
    return { status: 'current-time-unavailable', currentTime: null, duration: null };
  }
  if (
    candidate.duration === null ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration <= 0
  ) {
    return { status: 'duration-unavailable', currentTime: candidate.currentTime, duration: null };
  }
  return { status: 'ready', currentTime: candidate.currentTime, duration: candidate.duration };
}

export function selectAudioPlayerCandidate(candidates: AudioPlayerCandidate[]): AudioPlayerSelection {
  const credible = candidates.filter((candidate) =>
    (candidate.elementType === 'audio' || candidate.elementType === 'audio-only-video') &&
    candidate.sourcePresent && candidate.operable,
  );
  if (credible.length === 0) return { status: 'no-audio' };
  const playing = credible.filter((candidate) => !candidate.paused && !candidate.ended);
  const ready = credible.filter((candidate) => getAudioPlayerReadiness(candidate).status === 'ready');
  const pool = playing.length > 0 ? playing : ready.length > 0 ? ready : credible;
  const audioElements = pool.filter((candidate) => candidate.elementType === 'audio');
  const preferred = audioElements.length > 0 ? audioElements : pool;
  return preferred.length === 1
    ? { status: 'supported', player: preferred[0]! }
    : { status: 'ambiguous' };
}

export function readAudioPageSnapshot(includeMetadata: boolean) {
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
  const meta = (...selectors: string[]) => {
    for (const selector of selectors) {
      const value = clean(document.querySelector<HTMLMetaElement>(selector)?.content);
      if (value) return value;
    }
    return '';
  };
  const elements = [...document.querySelectorAll('audio, video')]
    .filter((element): element is HTMLMediaElement => {
      if (element instanceof HTMLAudioElement) return true;
      return element instanceof HTMLVideoElement && element.readyState >= 1 &&
        element.videoWidth === 0 && element.videoHeight === 0;
    });
  const candidates = elements.map((element, index) => {
    const audioOnlyVideo = element instanceof HTMLVideoElement;
    const playing = !element.paused && !element.ended;
    const rect = audioOnlyVideo ? element.getBoundingClientRect() : null;
    const style = audioOnlyVideo ? getComputedStyle(element) : null;
    const operable = !audioOnlyVideo || playing || Boolean(
      element.controls && rect && rect.width > 0 && rect.height > 0 &&
      element.getClientRects().length > 0 && style && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0',
    );
    return {
      playerId: `${element instanceof HTMLAudioElement ? 'audio' : 'audio-only-video'}:${index}`,
      elementType: element instanceof HTMLAudioElement ? 'audio' as const : 'audio-only-video' as const,
      currentTime: Number.isFinite(element.currentTime) && element.currentTime >= 0
        ? element.currentTime
        : null,
      duration: Number.isFinite(element.duration) ? element.duration : null,
      paused: element.paused,
      ended: element.ended,
      sourcePresent: Boolean(element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]')),
      operable,
    };
  });
  return {
    pageUrl: location.href,
    candidates,
    ...(includeMetadata ? {
      metadata: (() => {
        const ogType = meta('meta[property="og:type"]');
        const audioMetadataPresent = Boolean(
          document.querySelector('meta[property="og:audio"], meta[property="og:audio:url"], meta[name="podcast:show"], link[type^="audio/"]'),
        );
        const appleContent = meta('meta[name="apple-itunes-app"]');
        const applePodcasts = /podcast/i.test(appleContent) || Boolean(
          document.querySelector('meta[name="podcast:episode"], link[href*="podcasts.apple.com"]'),
        );
        const schemaTypes: string[] = [];
        const visitSchema = (node: unknown, depth: number) => {
          if (!node || typeof node !== 'object' || depth > 6) return;
          if (Array.isArray(node)) {
            for (const item of node) visitSchema(item, depth + 1);
            return;
          }
          const record = node as Record<string, unknown>;
          const schemaType = record['@type'];
          if (typeof schemaType === 'string') schemaTypes.push(schemaType.slice(0, 120));
          else if (Array.isArray(schemaType)) {
            for (const item of schemaType) {
              if (typeof item === 'string') schemaTypes.push(item.slice(0, 120));
            }
          }
          if (record['@graph']) visitSchema(record['@graph'], depth + 1);
        };
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            visitSchema(JSON.parse(script.textContent || 'null'), 0);
          } catch { /* Invalid JSON-LD is ignored. */ }
        }
        for (const element of document.querySelectorAll('[itemtype]')) {
          const itemtype = element.getAttribute('itemtype') || '';
          if (itemtype) schemaTypes.push(itemtype.slice(0, 200));
        }
        const podcastSchema = schemaTypes.some((item) =>
          /PodcastEpisode|RadioEpisode|PodcastSeries|PodcastSeason|(?:^|\/|\s)Podcast(?:$|\s)/i.test(item),
        );
        const podcastOgType = /^(?:podcast|audio)|(?:^|[./])music\.|podcast/i.test(ogType);
        return {
          title: meta('meta[property="og:title"]') || clean(document.title),
          canonicalUrl: clean(document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href),
          publisher: meta('meta[property="og:site_name"]', 'meta[name="application-name"]'),
          showName: meta('meta[name="podcast:show"]', 'meta[property="og:audio:album"]', 'meta[name="podcast:title"]'),
          author: meta('meta[name="author"]', 'meta[property="article:author"]'),
          ogType,
          schemaTypes,
          audioMetadataPresent,
          applePodcasts,
          podcastSignalsPresent: podcastSchema || podcastOgType || applePodcasts || audioMetadataPresent,
        };
      })(),
    } : {}),
  };
}

export function validateAudioPageSnapshot(expectedPageUrl: string, value: unknown): AudioPageDetection {
  if (typeof value !== 'object' || value === null) return { status: 'not-audio-page' };
  const row = value as Record<string, unknown>;
  if (typeof row.pageUrl !== 'string' || !Array.isArray(row.candidates)) return { status: 'not-audio-page' };
  try {
    if (normalizeAudioSourceUrl(expectedPageUrl) !== normalizeAudioSourceUrl(row.pageUrl)) {
      return { status: 'not-audio-page' };
    }
  } catch { return { status: 'not-audio-page' }; }
  const candidates: AudioPlayerCandidate[] = [];
  for (const candidate of row.candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.playerId !== 'string' ||
      (item.elementType !== 'audio' && item.elementType !== 'audio-only-video') ||
      (item.currentTime !== null && (
        typeof item.currentTime !== 'number' || !Number.isFinite(item.currentTime) || item.currentTime < 0
      )) ||
      (item.duration !== null && (typeof item.duration !== 'number' || !Number.isFinite(item.duration))) ||
      typeof item.paused !== 'boolean' || typeof item.ended !== 'boolean' ||
      typeof item.sourcePresent !== 'boolean' || typeof item.operable !== 'boolean'
    ) continue;
    candidates.push(item as AudioPlayerCandidate);
  }
  const metadata = typeof row.metadata === 'object' && row.metadata !== null
    ? row.metadata as Record<string, unknown>
    : {};
  const selection = selectAudioPlayerCandidate(candidates);
  const podcastPage = hasStrongPodcastSignals(metadata);
  if (selection.status === 'no-audio') {
    return podcastPage
      ? { status: 'no-audio' }
      : { status: 'not-audio-page' };
  }
  const text = (key: string) => typeof metadata[key] === 'string'
    ? metadata[key].replace(/\s+/g, ' ').trim().slice(0, 500) || null
    : null;
  try {
    const identity = getAudioSourceIdentity(row.pageUrl, text('canonicalUrl'));
    const readiness = selection.status === 'supported'
      ? getAudioPlayerReadiness(selection.player)
      : null;
    return {
      status: 'supported',
      exclusivePodcast: podcastPage,
      selection,
      readiness,
      source: {
        ...identity,
        url: row.pageUrl,
        title: text('title') ?? 'Untitled audio episode',
        classification: 'Podcast / web audio',
        author: text('author'),
        publisher: text('publisher'),
        showName: text('showName'),
        playerId: selection.status === 'supported' ? selection.player.playerId : null,
        playerStatus: selection.status === 'supported' ? readiness!.status : 'ambiguous',
      },
    };
  } catch { return { status: 'not-audio-page' }; }
}

// Serialized into the connected tab for explicit preview/play actions only.
export function playAudioPageFrom(startSeconds: number, expectedNormalizedUrl: string) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) return { ok: false, reason: 'invalid-time' };
  const normalize = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hostname = url.hostname.toLowerCase();
      url.hash = '';
      const remove = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 't', 'time', 'timestamp', 'start', 'start_time', 'seek', 'position', 'playback_position']);
      for (const key of [...url.searchParams.keys()]) {
        const normalizedKey = key.toLowerCase();
        const parameterValue = url.searchParams.get(key) ?? '';
        const playbackValue = /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(parameterValue) ||
          /^\d{1,3}:\d{2}(?::\d{2})?$/.test(parameterValue) ||
          /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(parameterValue);
        if (
          normalizedKey.startsWith('utm_') ||
          (new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']).has(normalizedKey)) ||
          (remove.has(normalizedKey) && playbackValue)
        ) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  let identityUrl = location.href;
  const canonicalHref = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href;
  if (canonicalHref) {
    try {
      const canonical = new URL(canonicalHref, location.href);
      if (
        (canonical.protocol === 'http:' || canonical.protocol === 'https:') &&
        canonical.origin === location.origin
      ) identityUrl = canonical.href;
    } catch { /* Invalid canonical metadata is ignored. */ }
  }
  if (normalize(identityUrl) !== expectedNormalizedUrl) return { ok: false, reason: 'source-mismatch' };
  const elements = [...document.querySelectorAll('audio, video')]
    .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement || (
      element instanceof HTMLVideoElement && element.readyState >= 1 &&
      element.videoWidth === 0 && element.videoHeight === 0
    ));
  const usable = elements.filter((element) =>
    Number.isFinite(element.currentTime) && element.currentTime >= 0 &&
    Number.isFinite(element.duration) && element.duration > 0 &&
    Boolean(element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]')),
  );
  const playing = usable.filter((element) => !element.paused && !element.ended);
  const pool = playing.length > 0 ? playing : usable;
  const audio = pool.filter((element) => element instanceof HTMLAudioElement);
  const preferred = audio.length > 0 ? audio : pool;
  if (preferred.length !== 1) return { ok: false, reason: preferred.length ? 'ambiguous' : 'player-unavailable' };
  const player = preferred[0]!;
  if (startSeconds > player.duration) return { ok: false, reason: 'invalid-time' };
  player.currentTime = startSeconds;
  void player.play().catch(() => undefined);
  return { ok: true };
}
