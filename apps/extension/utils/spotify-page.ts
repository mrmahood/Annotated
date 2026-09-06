import { getSpotifyEpisodeIdentity } from '@annotated/shared/spotify';
import type { PlayerActionResult, PlayerCandidate, PlayerDiscovery } from './player-discovery.ts';

export const SPOTIFY_NOW_PLAYING_IDENTITY_PREFIX = 'spotify-now-playing:1:';
const SPOTIFY_NOW_PLAYING_IDENTITY = /^spotify-now-playing:1:[0-9a-f]{8}$/;

export type SpotifyPageMetadata = {
  episodeId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  showName: string | null;
  hostname: 'open.spotify.com';
  pageBlock: null | 'login' | 'unreadable-time';
};

export type SpotifyPlayerState = {
  currentTime: number;
  duration: number | null;
  paused: boolean;
};

export function normalizeSpotifyEpisodeTitle(value: unknown) {
  if (typeof value !== 'string') return '';
  const title = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[|\-–—]\s*Spotify$/i, '')
    .replace(/\s+on Spotify$/i, '')
    .trim();
  return /^(?:open\.)?spotify(?:\.com)?$/i.test(title) ? '' : title.slice(0, 500);
}

export function isSpotifyNowPlayingIdentity(value: unknown): value is string {
  return typeof value === 'string' && SPOTIFY_NOW_PLAYING_IDENTITY.test(value);
}

export function validateSpotifyPageMetadata(
  expectedUrl: string,
  value: unknown,
): SpotifyPageMetadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.pageUrl !== 'string' ||
    typeof row.episodeId !== 'string' ||
    typeof row.title !== 'string' ||
    (row.author !== null && typeof row.author !== 'string') ||
    (row.showName !== null && typeof row.showName !== 'string') ||
    row.hostname !== 'open.spotify.com' ||
    (row.pageBlock !== null && row.pageBlock !== 'login' && row.pageBlock !== 'unreadable-time')
  ) return null;

  try {
    const expected = getSpotifyEpisodeIdentity(expectedUrl);
    const actual = getSpotifyEpisodeIdentity(row.pageUrl);
    if (expected.episodeId !== actual.episodeId || row.episodeId !== actual.episodeId) return null;
    const title = normalizeSpotifyEpisodeTitle(row.title);
    const author = typeof row.author === 'string'
      ? row.author.replace(/\s+/g, ' ').trim().slice(0, 500) || null
      : null;
    const showName = typeof row.showName === 'string'
      ? row.showName.replace(/\s+/g, ' ').trim().slice(0, 500) || null
      : null;
    return {
      ...expected,
      title: title || 'Spotify episode',
      author,
      showName,
      hostname: 'open.spotify.com',
      pageBlock: row.pageBlock,
    };
  } catch {
    return null;
  }
}

export function validateSpotifyPlayerState(value: unknown): SpotifyPlayerState | null {
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

export function validateSpotifyPlayerDiscovery(
  expectedPageUrl: string,
  value: unknown,
): PlayerDiscovery {
  if (typeof value !== 'object' || value === null) return { status: 'none', candidates: [] };
  const row = value as Record<string, unknown>;
  if (row.mode !== 'audio' || typeof row.pageUrl !== 'string') {
    return { status: 'none', candidates: [] };
  }
  try {
    if (getSpotifyEpisodeIdentity(row.pageUrl).episodeId !==
      getSpotifyEpisodeIdentity(expectedPageUrl).episodeId) {
      return { status: 'none', candidates: [] };
    }
  } catch {
    return { status: 'none', candidates: [] };
  }
  if (row.overflow === true) return { status: 'overflow', candidates: [] };
  if (!Array.isArray(row.candidates)) return { status: 'none', candidates: [] };
  const candidates: PlayerCandidate[] = [];
  for (const valueCandidate of row.candidates) {
    if (typeof valueCandidate !== 'object' || valueCandidate === null) continue;
    const candidate = valueCandidate as Record<string, unknown>;
    const nullableFiniteInteger = (entry: unknown) => entry === null || (
      typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
    );
    if (
      candidate.kind !== 'audio' ||
      !isSpotifyNowPlayingIdentity(candidate.identity) ||
      typeof candidate.label !== 'string' ||
      candidate.label.length < 1 || candidate.label.length > 120 ||
      !['playing', 'ready', 'loading'].includes(String(candidate.status)) ||
      !nullableFiniteInteger(candidate.currentTimeMs) ||
      !nullableFiniteInteger(candidate.durationMs)
    ) continue;
    candidates.push({
      identity: candidate.identity,
      kind: 'audio',
      label: candidate.label,
      status: candidate.status as PlayerCandidate['status'],
      currentTimeMs: candidate.currentTimeMs as number | null,
      durationMs: candidate.durationMs as number | null,
    });
  }
  if (candidates.length > 1) return { status: 'overflow', candidates: [] };
  return candidates.length === 1 ? { status: 'ready', candidates } : { status: 'none', candidates: [] };
}

// Serialized into the explicitly connected top-level tab.
export async function extractSpotifyPageMetadata() {
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const cleanTitle = (value: string | null | undefined) => {
    const title = clean(value)
      .replace(/\s*[|\-–—]\s*Spotify$/i, '')
      .replace(/\s+on Spotify$/i, '')
      .trim();
    return /^(?:open\.)?spotify(?:\.com)?$/i.test(title) ? '' : title;
  };
  const meta = (selector: string) =>
    clean(document.querySelector<HTMLMetaElement>(selector)?.content);

  const episodeIdFromHref = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname.toLowerCase() !== 'open.spotify.com') return '';
      const match = url.pathname.match(
        /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
      );
      return match?.[1] ?? '';
    } catch {
      return '';
    }
  };

  const looksLikeLoginWall = () => {
    const host = location.hostname.toLowerCase();
    const path = location.pathname.toLowerCase();
    if (host === 'accounts.spotify.com') return true;
    if (path.includes('/login') || path.includes('/signup') || path.includes('/password')) {
      return true;
    }
    const loginButton = document.querySelector(
      '[data-testid="login-button"], [data-testid="signup-button"], a[href*="/login"]',
    );
    const nowPlaying = document.querySelector(
      '[data-testid="now-playing-bar"], [data-testid="player-controls"], [data-testid="playback-progressbar"]',
    );
    const bodyText = clean(document.body?.innerText).slice(0, 2_000);
    if (nowPlaying) return false;
    return Boolean(loginButton) ||
      /log in to spotify|sign up to listen|continue with google/i.test(bodyText);
  };

  const parseClock = (value: string) => {
    const text = value.replace(/\s+/g, '').trim();
    const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) return null;
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3_600 + minutes * 60 + seconds;
  };

  const readNowPlayingTime = () => {
    const position = clean(
      document.querySelector('[data-testid="playback-position"]')?.textContent,
    );
    const duration = clean(
      document.querySelector('[data-testid="playback-duration"]')?.textContent,
    );
    const current = parseClock(position);
    const total = parseClock(duration);
    if (current === null) return null;
    return { currentTime: current, duration: total };
  };

  const read = () => {
    const title =
      cleanTitle(meta('meta[property="og:title"]')) ||
      cleanTitle(meta('meta[name="twitter:title"]')) ||
      cleanTitle(document.querySelector('[data-testid="entityTitle"]')?.textContent) ||
      cleanTitle(document.title);
    const author =
      clean(document.querySelector('[data-testid="creator-link"]')?.textContent) ||
      clean(meta('meta[name="music:musician"]')) ||
      clean(meta('meta[property="og:description"]')).split(' · ')[0] ||
      '';
    const showName =
      clean(document.querySelector('[data-testid="show-title"]')?.textContent) ||
      clean(meta('meta[name="music:album"]')) ||
      '';
    return {
      title,
      author: author.slice(0, 500) || null,
      showName: showName.slice(0, 500) || null,
    };
  };

  let metadata = read();
  for (let attempt = 0; !metadata.title && attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    metadata = read();
  }

  const episodeId = episodeIdFromHref(location.href);
  const login = looksLikeLoginWall();
  const time = login ? null : readNowPlayingTime();
  return {
    pageUrl: location.href,
    episodeId,
    title: metadata.title,
    author: metadata.author,
    showName: metadata.showName,
    hostname: 'open.spotify.com',
    pageBlock: login ? 'login' as const : time ? null : 'unreadable-time' as const,
  };
}

// Serialized into the connected tab. Keep every helper inside this function.
export function readSpotifyPlayerDiscovery() {
  const digest = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const episodeIdFromHref = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname.toLowerCase() !== 'open.spotify.com') return '';
      const match = url.pathname.match(
        /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
      );
      return match?.[1] ?? '';
    } catch {
      return '';
    }
  };
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const parseClock = (value: string) => {
    const text = value.replace(/\s+/g, '').trim();
    const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) return null;
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3_600 + minutes * 60 + seconds;
  };
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  if (
    host === 'accounts.spotify.com' ||
    path.includes('/login') ||
    path.includes('/signup') ||
    path.includes('/password')
  ) {
    return { pageUrl: location.href, mode: 'audio', overflow: false, candidates: [] };
  }
  const episodeId = episodeIdFromHref(location.href);
  if (!episodeId) {
    return { pageUrl: location.href, mode: 'audio', overflow: false, candidates: [] };
  }
  const bar = document.querySelector(
    '[data-testid="now-playing-bar"], [data-testid="player-controls"], [data-testid="playback-progressbar"]',
  );
  if (!(bar instanceof HTMLElement)) {
    return { pageUrl: location.href, mode: 'audio', overflow: false, candidates: [] };
  }
  const position = parseClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent));
  const duration = parseClock(clean(document.querySelector('[data-testid="playback-duration"]')?.textContent));
  if (position === null) {
    return { pageUrl: location.href, mode: 'audio', overflow: false, candidates: [] };
  }
  const playButton = document.querySelector('[data-testid="control-button-playpause"]');
  const playLabel = clean(playButton?.getAttribute('aria-label'));
  const paused = !/pause/i.test(playLabel);
  return {
    pageUrl: location.href,
    mode: 'audio',
    overflow: false,
    candidates: [{
      identity: `spotify-now-playing:1:${digest(episodeId)}`,
      kind: 'audio',
      label: 'Spotify now playing',
      status: paused ? 'ready' as const : 'playing' as const,
      currentTimeMs: Math.round(position * 1_000),
      durationMs: duration === null ? null : Math.round(duration * 1_000),
    }],
  };
}

// Serialized into the connected tab for Set start / Set end / preview / capture.
export async function actOnSpotifyPlayer(
  expectedIdentity: string,
  expectedEpisodeId: string,
  action: 'read' | 'play',
  startSeconds: number | null,
): Promise<PlayerActionResult> {
  const digest = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const episodeIdFromHref = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname.toLowerCase() !== 'open.spotify.com') return '';
      const match = url.pathname.match(
        /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
      );
      return match?.[1] ?? '';
    } catch {
      return '';
    }
  };
  const clean = (value: string | null | undefined) =>
    value?.replace(/\s+/g, ' ').trim() ?? '';
  const parseClock = (value: string) => {
    const text = value.replace(/\s+/g, '').trim();
    const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) return null;
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3_600 + minutes * 60 + seconds;
  };
  if (!expectedIdentity || !/^[A-Za-z0-9]{22}$/.test(expectedEpisodeId) ||
    (action === 'play' && (startSeconds === null || !Number.isFinite(startSeconds) || startSeconds < 0))
  ) {
    return { ok: false, reason: 'invalid-request' };
  }
  const episodeId = episodeIdFromHref(location.href);
  if (episodeId !== expectedEpisodeId) return { ok: false, reason: 'source-mismatch' };
  const identity = `spotify-now-playing:1:${digest(episodeId)}`;
  if (identity !== expectedIdentity) return { ok: false, reason: 'player-mismatch' };
  const position = parseClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent));
  const duration = parseClock(clean(document.querySelector('[data-testid="playback-duration"]')?.textContent));
  if (position === null) return { ok: false, reason: 'player-not-ready' };
  if (action === 'play') {
    if (duration !== null && startSeconds! > duration + 0.25) {
      return { ok: false, reason: 'player-not-ready' };
    }
    if (Math.abs(position - startSeconds!) > 2) {
      return { ok: false, reason: 'playback-failed' };
    }
    const playButton = document.querySelector<HTMLElement>('[data-testid="control-button-playpause"]');
    const playLabel = clean(playButton?.getAttribute('aria-label'));
    if (playButton && /play/i.test(playLabel) && !/pause/i.test(playLabel)) {
      try { playButton.click(); }
      catch { return { ok: false, reason: 'playback-failed' }; }
    }
  }
  const nextPosition = parseClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent))
    ?? position;
  return {
    ok: true,
    identity: expectedIdentity,
    currentTimeMs: Math.round(nextPosition * 1_000),
    durationMs: duration === null ? null : Math.round(duration * 1_000),
  };
}
