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

const GENERIC_SPOTIFY_CHROME_TITLE =
  /^(?:(?:open\.)?spotify(?:\.com)?|spotify\s*[|\-–—]\s*web player|web player|podcasts?|podcast episode|episode|show|home|search|your library|create|premium|download|install app|log ?in|sign ?up|now playing|queue|liked songs|made for you|what's new|browse)$/i;

export function isGenericSpotifyChromeTitle(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const title = value.replace(/\s+/g, ' ').trim();
  return !title || GENERIC_SPOTIFY_CHROME_TITLE.test(title);
}

function stripSpotifyChromeSuffix(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[|\-–—]\s*Podcast on Spotify$/i, '')
    .replace(/\s+on Spotify$/i, '')
    .replace(/\s*[|\-–—]\s*Spotify$/i, '')
    .replace(/\s*[|\-–—]\s*Web Player$/i, '')
    .replace(/\s*[|\-–—]\s*Podcasts?$/i, '')
    .trim();
}

export function parseSpotifyEpisodeChromeTitle(value: unknown): {
  title: string;
  showName: string | null;
} {
  if (typeof value !== 'string') return { title: '', showName: null };
  const stripped = stripSpotifyChromeSuffix(value);
  if (isGenericSpotifyChromeTitle(stripped)) return { title: '', showName: null };
  const match = stripped.match(/^(.*)(?:\s+[-–—]\s+)(.+)$/);
  if (match) {
    const title = match[1]!.trim();
    const showName = match[2]!.trim();
    if (
      !isGenericSpotifyChromeTitle(title) &&
      !isGenericSpotifyChromeTitle(showName) &&
      showName.length <= 120
    ) {
      return { title: title.slice(0, 500), showName: showName.slice(0, 500) };
    }
  }
  return { title: stripped.slice(0, 500), showName: null };
}

export function normalizeSpotifyEpisodeTitle(value: unknown) {
  if (typeof value !== 'string') return '';
  const title = stripSpotifyChromeSuffix(value);
  return isGenericSpotifyChromeTitle(title) ? '' : title.slice(0, 500);
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
    const cleanIdentity = (value: unknown) => {
      if (typeof value !== 'string') return null;
      const text = value.replace(/\s+/g, ' ').trim().slice(0, 500);
      return text && !isGenericSpotifyChromeTitle(text) ? text : null;
    };
    const author = cleanIdentity(row.author);
    const showName = cleanIdentity(row.showName);
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
  const isGenericChromeTitle = (value: string) =>
    /^(?:(?:open\.)?spotify(?:\.com)?|spotify\s*[|\-–—]\s*web player|web player|podcasts?|podcast episode|episode|show|home|search|your library|create|premium|download|install app|log ?in|sign ?up|now playing|queue|liked songs|made for you|what's new|browse)$/i
      .test(value);
  const stripChrome = (value: string | null | undefined) =>
    clean(value)
      .replace(/\s*[|\-–—]\s*Podcast on Spotify$/i, '')
      .replace(/\s+on Spotify$/i, '')
      .replace(/\s*[|\-–—]\s*Spotify$/i, '')
      .replace(/\s*[|\-–—]\s*Web Player$/i, '')
      .replace(/\s*[|\-–—]\s*Podcasts?$/i, '')
      .trim();
  const cleanTitle = (value: string | null | undefined) => {
    const title = stripChrome(value);
    return !title || isGenericChromeTitle(title) ? '' : title;
  };
  const parseChromeTitle = (value: string | null | undefined) => {
    const stripped = stripChrome(value);
    if (!stripped || isGenericChromeTitle(stripped)) return { title: '', showName: '' };
    const match = stripped.match(/^(.*)(?:\s+[-–—]\s+)(.+)$/);
    if (match) {
      const title = match[1]!.trim();
      const showName = match[2]!.trim();
      if (title && !isGenericChromeTitle(title) && showName && !isGenericChromeTitle(showName) && showName.length <= 120) {
        return { title, showName };
      }
    }
    return { title: stripped, showName: '' };
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
    // Logged-out limited previews are a valid capture surface when the
    // tab is already playing. A login CTA next to a now-playing bar is
    // not a wall.
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

  const headingTitle = () => {
    const nodes = [
      document.querySelector('[data-testid="entityTitle"]'),
      document.querySelector('main h1'),
      document.querySelector('[role="main"] h1'),
      document.querySelector('#main h1'),
    ];
    for (const node of nodes) {
      const title = cleanTitle(node?.textContent);
      if (title) return title;
    }
    for (const node of document.querySelectorAll('h1')) {
      const title = cleanTitle(node.textContent);
      if (title) return title;
    }
    return '';
  };
  const showFromPage = () => {
    const nodes = [
      document.querySelector('[data-testid="show-title"]'),
      document.querySelector('[data-testid="creator-link"]'),
      document.querySelector('main a[href*="/show/"]'),
      document.querySelector('[role="main"] a[href*="/show/"]'),
      document.querySelector('#main a[href*="/show/"]'),
    ];
    for (const node of nodes) {
      const name = clean(node?.textContent);
      if (name && !isGenericChromeTitle(name)) return name;
    }
    const album = clean(meta('meta[name="music:album"]'));
    return album && !isGenericChromeTitle(album) ? album : '';
  };

  const read = () => {
    const heading = headingTitle();
    const og = parseChromeTitle(meta('meta[property="og:title"]'));
    const twitter = parseChromeTitle(meta('meta[name="twitter:title"]'));
    const documentParsed = parseChromeTitle(document.title);
    const title = heading || og.title || twitter.title || documentParsed.title;
    const showName = showFromPage() || og.showName || twitter.showName || documentParsed.showName;
    const author =
      clean(document.querySelector('[data-testid="creator-link"]')?.textContent) ||
      clean(meta('meta[name="music:musician"]')) ||
      showName ||
      '';
    return {
      title,
      author: (author && !isGenericChromeTitle(author) ? author : '').slice(0, 500) || null,
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
  const readClock = () => ({
    position: parseClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent)),
    duration: parseClock(clean(document.querySelector('[data-testid="playback-duration"]')?.textContent)),
  });
  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const assignRange = (input: HTMLInputElement, next: number) => {
    const value = String(next);
    const previous = input.value;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
    } catch {
      input.value = value;
    }
    const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue?: (current: string) => void } })._valueTracker;
    if (tracker && typeof tracker.setValue === 'function') {
      try { tracker.setValue(previous); } catch { /* React 19 may omit the tracker. */ }
    }
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: value,
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickBarAtRatio = (surface: HTMLElement, ratio: number) => {
    const rect = surface.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 1) return false;
    const x = rect.left + rect.width * Math.min(1, Math.max(0, ratio));
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    const node = target instanceof HTMLElement ? target : surface;
    const point = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, buttons: 1 };
    try {
      if (typeof PointerEvent === 'function') {
        node.dispatchEvent(new PointerEvent('pointerdown', { ...point, pointerId: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new PointerEvent('pointerup', { ...point, pointerId: 1, pointerType: 'mouse' }));
      }
      node.dispatchEvent(new MouseEvent('mousedown', point));
      node.dispatchEvent(new MouseEvent('mouseup', point));
      node.dispatchEvent(new MouseEvent('click', point));
      return true;
    } catch {
      return false;
    }
  };
  const seekNowPlaying = async (start: number) => {
    let now = readClock();
    if (now.position === null) return { ok: false as const, reason: 'player-not-ready' as const };
    if (now.duration !== null && start > now.duration + 0.25) {
      return { ok: false as const, reason: 'player-not-ready' as const };
    }
    if (Math.abs(now.position - start) <= 2) return { ok: true as const, ...now };
    let attempted = false;
    const bar = document.querySelector('[data-testid="playback-progressbar"]');
    const input = (
      bar?.querySelector('input[type="range"]') ??
      document.querySelector('[data-testid="playback-progressbar"] input[type="range"]')
    );
    if (input instanceof HTMLInputElement) {
      const lo = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
      const hi = Number(input.max);
      if (Number.isFinite(hi) && hi > lo) {
        const span = hi - lo;
        const duration = now.duration;
        const currentRaw = Number(input.value);
        const targetMs = start * 1_000;
        const clockMs = now.position * 1_000;
        let raw: number;
        if (span <= 100.0001) {
          if (duration === null || duration <= 0) return { ok: false as const, reason: 'playback-failed' as const };
          raw = lo + (start / duration) * span;
        } else if (Number.isFinite(currentRaw) && span > 1_000) {
          const offset = clockMs - currentRaw;
          raw = Math.abs(offset) <= 2_500 ? targetMs : currentRaw + (targetMs - clockMs);
        } else if (duration !== null && Math.abs(span - duration) <= Math.max(1, duration * 0.05)) {
          raw = lo + start;
        } else if (span > 1_000) {
          raw = lo + start * 1_000;
        } else {
          raw = lo + start;
        }
        try {
          assignRange(input, Math.min(hi, Math.max(lo, raw)));
          attempted = true;
        } catch { /* Click / share-timestamp fallbacks below. */ }
      }
    }
    now = readClock();
    if (now.position === null || Math.abs(now.position - start) > 2) {
      const surface = (bar instanceof HTMLElement ? bar : null)
        ?? document.querySelector('[data-testid="progress-bar-background"]');
      const durationForClick = now.duration
        ?? (input instanceof HTMLInputElement && Number(input.max) > 1_000 ? Number(input.max) / 1_000 : null);
      if (surface instanceof HTMLElement && durationForClick !== null && durationForClick > 0
          && clickBarAtRatio(surface, start / durationForClick)) {
        attempted = true;
      }
    }
    now = readClock();
    if (now.position === null || Math.abs(now.position - start) > 2) {
      try {
        const url = new URL(location.href);
        if (url.hostname.toLowerCase() === 'open.spotify.com') {
          const stamp = String(Math.round(start * 1_000));
          if (url.searchParams.get('t') !== stamp && typeof history !== 'undefined'
              && typeof history.replaceState === 'function') {
            url.searchParams.set('t', stamp);
            history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
            attempted = true;
          }
        }
      } catch { /* Fail closed after the poll if the playhead did not move. */ }
    }
    if (!attempted) return { ok: false as const, reason: 'playback-failed' as const };
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      now = readClock();
      if (now.position !== null && Math.abs(now.position - start) <= 2) return { ok: true as const, ...now };
      await wait(50);
    }
    now = readClock();
    if (now.position !== null && Math.abs(now.position - start) <= 2) return { ok: true as const, ...now };
    return { ok: false as const, reason: 'playback-failed' as const };
  };
  const pressPlayIfPaused = () => {
    const playButton = document.querySelector<HTMLElement>('[data-testid="control-button-playpause"]');
    const playLabel = clean(playButton?.getAttribute('aria-label'));
    if (playButton && /play/i.test(playLabel) && !/pause/i.test(playLabel)) {
      try { playButton.click(); }
      catch { return false; }
    }
    return true;
  };
  if (action === 'play') {
    const sought = await seekNowPlaying(startSeconds!);
    if (!sought.ok) return { ok: false, reason: sought.reason };
    if (!pressPlayIfPaused()) return { ok: false, reason: 'playback-failed' };
    const next = readClock();
    return {
      ok: true,
      identity: expectedIdentity,
      currentTimeMs: Math.round((next.position ?? sought.position ?? startSeconds!) * 1_000),
      durationMs: next.duration === null ? null : Math.round(next.duration * 1_000),
    };
  }
  const now = readClock();
  if (now.position === null) return { ok: false, reason: 'player-not-ready' };
  return {
    ok: true,
    identity: expectedIdentity,
    currentTimeMs: Math.round(now.position * 1_000),
    durationMs: now.duration === null ? null : Math.round(now.duration * 1_000),
  };
}
