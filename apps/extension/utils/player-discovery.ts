import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';

export const MAX_PLAYER_CANDIDATES = 5;

export type PlayerMode = 'video' | 'audio';
export type PlayerCandidateKind = 'video' | 'audio' | 'audio-only-video';
export type PlayerCandidate = {
  identity: string;
  kind: PlayerCandidateKind;
  label: string;
  status: 'playing' | 'ready' | 'loading';
  currentTimeMs: number | null;
  durationMs: number | null;
};

export type PlayerDiscovery =
  | { status: 'ready'; candidates: PlayerCandidate[] }
  | { status: 'none'; candidates: [] }
  | { status: 'overflow'; candidates: [] };

export type PlayerActionResult =
  | { ok: true; identity: string; currentTimeMs: number; durationMs: number | null }
  | { ok: false; reason: 'invalid-request' | 'source-mismatch' | 'player-mismatch' | 'player-not-ready' | 'playback-failed' };

function comparablePageIdentity(mode: PlayerMode, value: string): string | null {
  try {
    return mode === 'video'
      ? getYouTubeVideoIdentity(value).videoId
      : normalizeAudioSourceUrl(value);
  } catch { return null; }
}

export function validatePlayerDiscovery(
  expectedPageUrl: string,
  expectedMode: PlayerMode,
  value: unknown,
): PlayerDiscovery {
  if (typeof value !== 'object' || value === null) return { status: 'none', candidates: [] };
  const row = value as Record<string, unknown>;
  if (
    row.mode !== expectedMode || typeof row.pageUrl !== 'string' ||
    comparablePageIdentity(expectedMode, row.pageUrl) !== comparablePageIdentity(expectedMode, expectedPageUrl)
  ) return { status: 'none', candidates: [] };
  if (row.overflow === true) return { status: 'overflow', candidates: [] };
  if (!Array.isArray(row.candidates)) return { status: 'none', candidates: [] };
  const candidates: PlayerCandidate[] = [];
  const identities = new Set<string>();
  for (const valueCandidate of row.candidates) {
    if (typeof valueCandidate !== 'object' || valueCandidate === null) continue;
    const candidate = valueCandidate as Record<string, unknown>;
    const kindAllowed = expectedMode === 'video'
      ? candidate.kind === 'video'
      : candidate.kind === 'audio' || candidate.kind === 'audio-only-video';
    const nullableFiniteInteger = (entry: unknown) => entry === null || (
      typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
    );
    if (
      !kindAllowed || typeof candidate.identity !== 'string' ||
      !/^(?:video|audio|audio-only-video):[1-5]:[0-9a-f]{8}$/.test(candidate.identity) ||
      identities.has(candidate.identity) || typeof candidate.label !== 'string' ||
      candidate.label.length < 1 || candidate.label.length > 120 ||
      !['playing', 'ready', 'loading'].includes(String(candidate.status)) ||
      !nullableFiniteInteger(candidate.currentTimeMs) || !nullableFiniteInteger(candidate.durationMs)
    ) continue;
    identities.add(candidate.identity);
    candidates.push(candidate as PlayerCandidate);
  }
  if (candidates.length > MAX_PLAYER_CANDIDATES) return { status: 'overflow', candidates: [] };
  return candidates.length > 0 ? { status: 'ready', candidates } : { status: 'none', candidates: [] };
}

export function reconcilePlayerSelection(
  discovery: PlayerDiscovery,
  previousIdentity: string | null,
): string | null {
  if (discovery.status !== 'ready') return null;
  if (discovery.candidates.length === 1) return discovery.candidates[0]!.identity;
  return discovery.candidates.some((candidate) => candidate.identity === previousIdentity)
    ? previousIdentity
    : null;
}

// Serialized into the top frame. Keep every helper inside the function.
export function readTopFramePlayerDiscovery(mode: PlayerMode) {
  const limit = 5;
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
  const digest = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const sourceFor = (element: HTMLMediaElement) => element.currentSrc ||
    element.getAttribute('src') || element.querySelector<HTMLSourceElement>('source[src]')?.src || '';
  const audioVideoOperable = (element: HTMLVideoElement) => {
    if (!element.paused && !element.ended) return true;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.controls && rect.width > 0 && rect.height > 0 &&
      element.getClientRects().length > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const eligible: HTMLMediaElement[] = [];
  for (const entry of document.querySelectorAll('audio, video')) {
    if (!(entry instanceof HTMLMediaElement) || !sourceFor(entry)) continue;
    const accepted = mode === 'video'
      ? entry instanceof HTMLVideoElement
      : entry instanceof HTMLAudioElement || (
        entry instanceof HTMLVideoElement && entry.readyState >= 1 &&
        entry.videoWidth === 0 && entry.videoHeight === 0 && audioVideoOperable(entry)
      );
    if (accepted) eligible.push(entry);
    if (eligible.length > limit) break;
  }
  if (eligible.length > limit) {
    return { pageUrl: location.href, mode, overflow: true, candidates: [] };
  }
  const candidates = eligible.map((element, index) => {
    const kind = element instanceof HTMLAudioElement
      ? 'audio' as const
      : mode === 'audio' ? 'audio-only-video' as const : 'video' as const;
    const ordinal = index + 1;
    const source = sourceFor(element);
    const identity = `${kind}:${ordinal}:${digest(`${kind}|${source}`)}`;
    const parentLabel = clean(element.closest('[aria-label]')?.getAttribute('aria-label'));
    const figureLabel = clean(element.closest('figure')?.querySelector('figcaption')?.textContent);
    const label = clean(element.getAttribute('aria-label')) || clean(element.getAttribute('title')) ||
      parentLabel || figureLabel || `${kind === 'video' ? 'Video' : 'Audio'} player ${ordinal}`;
    const currentTimeMs = Number.isFinite(element.currentTime) && element.currentTime >= 0
      ? Math.round(element.currentTime * 1_000) : null;
    const durationMs = Number.isFinite(element.duration) && element.duration > 0
      ? Math.round(element.duration * 1_000) : null;
    const status = !element.paused && !element.ended
      ? 'playing' as const
      : element.readyState >= 1 ? 'ready' as const : 'loading' as const;
    return { identity, kind, label, status, currentTimeMs, durationMs };
  });
  return { pageUrl: location.href, mode, overflow: false, candidates };
}

// Serialized into the top frame for every player-dependent action.
export async function actOnTopFramePlayer(
  mode: PlayerMode,
  expectedIdentity: string,
  expectedSourceKey: string,
  action: 'read' | 'play',
  startSeconds: number | null,
): Promise<PlayerActionResult> {
  const limit = 5;
  if (!expectedIdentity || (action === 'play' && (
    startSeconds === null || !Number.isFinite(startSeconds) || startSeconds < 0
  ))) return { ok: false, reason: 'invalid-request' };
  const pageSourceKey = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (mode === 'video') {
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        return (host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch'
          ? url.searchParams.get('v') : null;
      }
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      const remove = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 't', 'time', 'timestamp', 'start', 'start_time', 'seek', 'position', 'playback_position']);
      for (const key of [...url.searchParams.keys()]) {
        const normalizedKey = key.toLowerCase();
        const parameterValue = url.searchParams.get(key) ?? '';
        const playbackValue = /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(parameterValue) ||
          /^\d{1,3}:\d{2}(?::\d{2})?$/.test(parameterValue) ||
          /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(parameterValue);
        if (normalizedKey.startsWith('utm_') ||
          new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']).has(normalizedKey) ||
          (remove.has(normalizedKey) && playbackValue)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  if (pageSourceKey(location.href) !== expectedSourceKey) {
    return { ok: false, reason: 'source-mismatch' };
  }
  const digest = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const sourceFor = (element: HTMLMediaElement) => element.currentSrc ||
    element.getAttribute('src') || element.querySelector<HTMLSourceElement>('source[src]')?.src || '';
  const audioVideoOperable = (element: HTMLVideoElement) => {
    if (!element.paused && !element.ended) return true;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.controls && rect.width > 0 && rect.height > 0 &&
      element.getClientRects().length > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const eligible: HTMLMediaElement[] = [];
  for (const entry of document.querySelectorAll('audio, video')) {
    if (!(entry instanceof HTMLMediaElement) || !sourceFor(entry)) continue;
    const accepted = mode === 'video'
      ? entry instanceof HTMLVideoElement
      : entry instanceof HTMLAudioElement || (
        entry instanceof HTMLVideoElement && entry.readyState >= 1 &&
        entry.videoWidth === 0 && entry.videoHeight === 0 && audioVideoOperable(entry)
      );
    if (accepted) eligible.push(entry);
    if (eligible.length > limit) break;
  }
  if (eligible.length > limit) return { ok: false, reason: 'player-mismatch' };
  const matches = eligible.filter((element, index) => {
    const kind = element instanceof HTMLAudioElement ? 'audio' : mode === 'audio' ? 'audio-only-video' : 'video';
    return `${kind}:${index + 1}:${digest(`${kind}|${sourceFor(element)}`)}` === expectedIdentity;
  });
  if (matches.length !== 1) return { ok: false, reason: 'player-mismatch' };
  const player = matches[0]!;
  if (!Number.isFinite(player.currentTime) || player.currentTime < 0) {
    return { ok: false, reason: 'player-not-ready' };
  }
  if (action === 'play') {
    if (Number.isFinite(player.duration) && startSeconds! > player.duration) {
      return { ok: false, reason: 'player-not-ready' };
    }
    try {
      player.currentTime = startSeconds!;
      await player.play();
    } catch { return { ok: false, reason: 'playback-failed' }; }
  }
  return {
    ok: true,
    identity: expectedIdentity,
    currentTimeMs: Math.round(player.currentTime * 1_000),
    durationMs: Number.isFinite(player.duration) && player.duration > 0
      ? Math.round(player.duration * 1_000) : null,
  };
}
