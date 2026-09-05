import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
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

function comparablePageIdentity(mode: PlayerMode, value: string, genericVideo = false): string | null {
  try {
    if (mode === 'video' && !genericVideo) {
      try {
        return getYouTubeVideoIdentity(value).videoId;
      } catch {
        return getTikTokVideoIdentity(value).videoId;
      }
    }
    return mode === 'video'
      ? normalizeArticleUrlForPlayer(value)
      : normalizeAudioSourceUrl(value);
  } catch { return null; }
}

function normalizeArticleUrlForPlayer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid-page');
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  const tracking = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']);
  for (const key of [...url.searchParams.keys()]) {
    if (tracking.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

export function validatePlayerDiscovery(
  expectedPageUrl: string,
  expectedMode: PlayerMode,
  value: unknown,
  genericVideo = false,
): PlayerDiscovery {
  if (typeof value !== 'object' || value === null) return { status: 'none', candidates: [] };
  const row = value as Record<string, unknown>;
  if (
    row.mode !== expectedMode || typeof row.pageUrl !== 'string' ||
    comparablePageIdentity(expectedMode, row.pageUrl, genericVideo) !==
      comparablePageIdentity(expectedMode, expectedPageUrl, genericVideo)
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
      !(/^(?:video|audio|audio-only-video):[1-5]:[0-9a-f]{8}$/.test(candidate.identity) ||
        (genericVideo && /^web-video:(?:top|[1-9][0-9]*(?:\.[1-9][0-9]*)*):[1-5]:[0-9a-f]{8}$/.test(candidate.identity))) ||
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

export function playerDiscoveryMakesModeAvailable(discovery: PlayerDiscovery): boolean {
  return discovery.status === 'ready' || discovery.status === 'overflow';
}

// Serialized into the top frame. Keep every helper inside the function.
export function readTopFramePlayerDiscovery(mode: PlayerMode, genericVideo = false) {
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
  const styleFor = (ownerWindow: Window, element: Element) =>
    typeof ownerWindow.getComputedStyle === 'function' ? ownerWindow.getComputedStyle(element) : getComputedStyle(element);
  const safeGenericSource = (value: string, ownerWindow: Window) => {
    if (!value || value.length > 4_096) return false;
    try {
      const url = new URL(value, ownerWindow.location.href || `${ownerWindow.location.origin}/`);
      return (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:') &&
        url.username === '' && url.password === '';
    } catch { return false; }
  };
  const advertisingMarker = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|advertising|preroll|midroll|postroll|sponsored|vast|vpaid)(?:$|[\s_-])/i;
  const looksLikeAdvertisingVideo = (element: HTMLVideoElement) => {
    let node: Element | null = element;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const className = typeof node.className === 'string' ? node.className : '';
      const marker = [node.id, className, node.getAttribute('aria-label'), node.getAttribute('role'),
        node.getAttribute('data-ad'), node.getAttribute('data-ad-slot'),
        node.getAttribute('data-advertisement'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
      if (advertisingMarker.test(marker)) return true;
    }
    return false;
  };
  const audioVideoOperable = (element: HTMLVideoElement) => {
    if (!element.paused && !element.ended) return true;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.controls && rect.width > 0 && rect.height > 0 &&
      element.getClientRects().length > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const videoExposed = (element: HTMLVideoElement, ownerDocument: Document, ownerWindow: Window) => {
    const rect = element.getBoundingClientRect();
    const style = styleFor(ownerWindow, element);
    const left = Math.max(0, rect.left);
    const right = Math.min(ownerWindow.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(ownerWindow.innerHeight, rect.bottom);
    if (
      right <= left || bottom <= top || element.getClientRects().length === 0 ||
      style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0
    ) return false;
    const points = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + (right - left) / 4, top + (bottom - top) / 4],
      [right - (right - left) / 4, bottom - (bottom - top) / 4],
    ];
    return points.some(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(element));
  };
  const normalizeArticle = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hostname = url.hostname.toLowerCase(); url.hash = '';
      const tracking = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']);
      for (const key of [...url.searchParams.keys()]) if (tracking.has(key.toLowerCase())) url.searchParams.delete(key);
      url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const pageKey = genericVideo && mode === 'video' ? normalizeArticle(location.href) : null;
  type Located = { element: HTMLMediaElement; video: HTMLVideoElement | null; framePath: string; frameOrigin: string };
  const eligible: Located[] = [];
  const collect = (ownerDocument: Document, ownerWindow: Window, framePath: string, topOrigin: string) => {
    for (const entry of ownerDocument.querySelectorAll('audio, video')) {
      const genericEntry = genericVideo && mode === 'video';
      if (!genericEntry && !(entry instanceof HTMLMediaElement)) continue;
      const media = entry as HTMLMediaElement;
      if (!sourceFor(media)) continue;
      const video = (genericEntry ? entry.localName === 'video' : entry instanceof HTMLVideoElement)
        ? entry as HTMLVideoElement
        : null;
      const accepted = mode === 'video'
        ? Boolean(video && videoExposed(video, ownerDocument, ownerWindow) && (!genericVideo || (
          video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0 &&
          Number.isFinite(video.duration) && video.duration > 0 &&
          safeGenericSource(sourceFor(video), ownerWindow) &&
          !looksLikeAdvertisingVideo(video) &&
          !video.mediaKeys && !(video as HTMLVideoElement & { webkitKeys?: unknown }).webkitKeys && !video.srcObject &&
          styleFor(ownerWindow, video).transform === 'none' &&
          video.getBoundingClientRect().left >= -1 && video.getBoundingClientRect().top >= -1 &&
          video.getBoundingClientRect().right <= ownerWindow.innerWidth + 1 &&
          video.getBoundingClientRect().bottom <= ownerWindow.innerHeight + 1
        )))
        : media instanceof HTMLAudioElement || (
          video && video.readyState >= 1 && video.videoWidth === 0 && video.videoHeight === 0 && audioVideoOperable(video)
        );
      if (accepted) eligible.push({ element: media, video, framePath, frameOrigin: genericVideo ? ownerWindow.location.origin : '' });
      if (eligible.length > limit) return;
    }
    if (!genericVideo || mode !== 'video') return;
    const frames = [...ownerDocument.querySelectorAll('iframe, frame')];
    for (const [index, frame] of frames.entries()) {
      if (eligible.length > limit) return;
      try {
        const childWindow = (frame as HTMLIFrameElement).contentWindow;
        const childDocument = (frame as HTMLIFrameElement).contentDocument;
        if (!childWindow || !childDocument || childWindow.location.origin !== topOrigin) continue;
        const rect = (frame as HTMLElement).getBoundingClientRect();
        const style = styleFor(ownerWindow, frame);
        const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
        const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
        const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
        const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
        const fullyVisible = rect.left >= -1 && rect.top >= -1 &&
          rect.right <= ownerWindow.innerWidth + 1 && rect.bottom <= ownerWindow.innerHeight + 1;
        const unscaled = Math.abs(rect.width - childWindow.innerWidth - borderLeft - borderRight) <= 1 &&
          Math.abs(rect.height - childWindow.innerHeight - borderTop - borderBottom) <= 1;
        const hit = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + rect.width / 4, rect.top + rect.height / 4],
          [rect.right - rect.width / 4, rect.bottom - rect.height / 4],
        ].every(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(frame));
        if (!fullyVisible || !unscaled || !hit || style.transform !== 'none' ||
            style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) continue;
        collect(childDocument, childWindow, framePath === 'top' ? `${index + 1}` : `${framePath}.${index + 1}`, topOrigin);
      } catch { /* Inaccessible or navigated frames are intentionally unsupported. */ }
    }
  };
  collect(document, window, 'top', genericVideo ? new URL(location.href).origin : '');
  if (eligible.length > limit) {
    return { pageUrl: location.href, mode, overflow: true, candidates: [] };
  }
  const candidates = eligible.map(({ element, video, framePath, frameOrigin }, index) => {
    const kind = genericVideo && mode === 'video' ? 'video' as const : element instanceof HTMLAudioElement
      ? 'audio' as const
      : mode === 'audio' ? 'audio-only-video' as const : 'video' as const;
    const ordinal = index + 1;
    const source = sourceFor(element);
    const identity = genericVideo && mode === 'video'
      ? `web-video:${framePath}:${ordinal}:${digest(`${pageKey}|${frameOrigin}|${framePath}|${kind}|${source}|${Number.isFinite(element.duration) ? Math.round(element.duration * 1_000) : 0}|${video ? `${video.videoWidth}x${video.videoHeight}` : '0x0'}`)}`
      : `${kind}:${ordinal}:${digest(`${kind}|${source}`)}`;
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
  genericVideo = false,
): Promise<PlayerActionResult> {
  const limit = 5;
  if (!expectedIdentity || (action === 'play' && (
    startSeconds === null || !Number.isFinite(startSeconds) || startSeconds < 0
  ))) return { ok: false, reason: 'invalid-request' };
  const pageSourceKey = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (mode === 'video' && !genericVideo) {
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if ((host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch') {
          return url.searchParams.get('v');
        }
        if (host === 'tiktok.com' || host === 'm.tiktok.com') {
          const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
          return match?.[2] ?? null;
        }
        return null;
      }
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      const remove = genericVideo && mode === 'video'
        ? new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'])
        : new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 't', 'time', 'timestamp', 'start', 'start_time', 'seek', 'position', 'playback_position']);
      for (const key of [...url.searchParams.keys()]) {
        const normalizedKey = key.toLowerCase();
        const parameterValue = url.searchParams.get(key) ?? '';
        const playbackValue = /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(parameterValue) ||
          /^\d{1,3}:\d{2}(?::\d{2})?$/.test(parameterValue) ||
          /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(parameterValue);
        if ((!genericVideo || mode !== 'video') && normalizedKey.startsWith('utm_') ||
          new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']).has(normalizedKey) ||
          (remove.has(normalizedKey) && (genericVideo && mode === 'video' || playbackValue))) url.searchParams.delete(key);
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
  const styleFor = (ownerWindow: Window, element: Element) =>
    typeof ownerWindow.getComputedStyle === 'function' ? ownerWindow.getComputedStyle(element) : getComputedStyle(element);
  const safeGenericSource = (value: string, ownerWindow: Window) => {
    if (!value || value.length > 4_096) return false;
    try {
      const url = new URL(value, ownerWindow.location.href || `${ownerWindow.location.origin}/`);
      return (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:') &&
        url.username === '' && url.password === '';
    } catch { return false; }
  };
  const advertisingMarker = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|advertising|preroll|midroll|postroll|sponsored|vast|vpaid)(?:$|[\s_-])/i;
  const looksLikeAdvertisingVideo = (element: HTMLVideoElement) => {
    let node: Element | null = element;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const className = typeof node.className === 'string' ? node.className : '';
      const marker = [node.id, className, node.getAttribute('aria-label'), node.getAttribute('role'),
        node.getAttribute('data-ad'), node.getAttribute('data-ad-slot'),
        node.getAttribute('data-advertisement'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
      if (advertisingMarker.test(marker)) return true;
    }
    return false;
  };
  const audioVideoOperable = (element: HTMLVideoElement) => {
    if (!element.paused && !element.ended) return true;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.controls && rect.width > 0 && rect.height > 0 &&
      element.getClientRects().length > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const videoExposed = (element: HTMLVideoElement, ownerDocument: Document, ownerWindow: Window) => {
    const rect = element.getBoundingClientRect();
    const style = styleFor(ownerWindow, element);
    const left = Math.max(0, rect.left);
    const right = Math.min(ownerWindow.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(ownerWindow.innerHeight, rect.bottom);
    if (
      right <= left || bottom <= top || element.getClientRects().length === 0 ||
      style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0
    ) return false;
    const points = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + (right - left) / 4, top + (bottom - top) / 4],
      [right - (right - left) / 4, bottom - (bottom - top) / 4],
    ];
    return points.some(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(element));
  };
  type Located = { element: HTMLMediaElement; video: HTMLVideoElement | null; framePath: string; frameOrigin: string };
  const eligible: Located[] = [];
  const collect = (ownerDocument: Document, ownerWindow: Window, framePath: string, topOrigin: string) => {
    for (const entry of ownerDocument.querySelectorAll('audio, video')) {
      const genericEntry = genericVideo && mode === 'video';
      if (!genericEntry && !(entry instanceof HTMLMediaElement)) continue;
      const media = entry as HTMLMediaElement;
      if (!sourceFor(media)) continue;
      const video = (genericEntry ? entry.localName === 'video' : entry instanceof HTMLVideoElement)
        ? entry as HTMLVideoElement
        : null;
      const accepted = mode === 'video'
        ? Boolean(video && videoExposed(video, ownerDocument, ownerWindow) && (!genericVideo || (
          video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0 &&
          Number.isFinite(video.duration) && video.duration > 0 &&
          safeGenericSource(sourceFor(video), ownerWindow) &&
          !looksLikeAdvertisingVideo(video) &&
          !video.mediaKeys && !(video as HTMLVideoElement & { webkitKeys?: unknown }).webkitKeys && !video.srcObject &&
          styleFor(ownerWindow, video).transform === 'none' &&
          video.getBoundingClientRect().left >= -1 && video.getBoundingClientRect().top >= -1 &&
          video.getBoundingClientRect().right <= ownerWindow.innerWidth + 1 &&
          video.getBoundingClientRect().bottom <= ownerWindow.innerHeight + 1
        )))
        : media instanceof HTMLAudioElement || (
          video && video.readyState >= 1 && video.videoWidth === 0 && video.videoHeight === 0 && audioVideoOperable(video)
        );
      if (accepted) eligible.push({ element: media, video, framePath, frameOrigin: genericVideo ? ownerWindow.location.origin : '' });
      if (eligible.length > limit) return;
    }
    if (!genericVideo || mode !== 'video') return;
    const frames = [...ownerDocument.querySelectorAll('iframe, frame')];
    for (const [index, frame] of frames.entries()) {
      if (eligible.length > limit) return;
      try {
        const childWindow = (frame as HTMLIFrameElement).contentWindow;
        const childDocument = (frame as HTMLIFrameElement).contentDocument;
        if (!childWindow || !childDocument || childWindow.location.origin !== topOrigin) continue;
        const rect = (frame as HTMLElement).getBoundingClientRect(); const style = styleFor(ownerWindow, frame);
        const borders = ['Left', 'Right', 'Top', 'Bottom'].map((side) =>
          Number.parseFloat(style[`border${side}Width` as keyof CSSStyleDeclaration] as string) || 0);
        const fullyVisible = rect.left >= -1 && rect.top >= -1 && rect.right <= ownerWindow.innerWidth + 1 && rect.bottom <= ownerWindow.innerHeight + 1;
        const unscaled = Math.abs(rect.width - childWindow.innerWidth - borders[0]! - borders[1]!) <= 1 &&
          Math.abs(rect.height - childWindow.innerHeight - borders[2]! - borders[3]!) <= 1;
        const hit = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + rect.width / 4, rect.top + rect.height / 4],
          [rect.right - rect.width / 4, rect.bottom - rect.height / 4],
        ].every(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(frame));
        if (!fullyVisible || !unscaled || !hit || style.transform !== 'none' || style.display === 'none' ||
            style.visibility === 'hidden' || Number(style.opacity) <= 0) continue;
        collect(childDocument, childWindow, framePath === 'top' ? `${index + 1}` : `${framePath}.${index + 1}`, topOrigin);
      } catch { /* Inaccessible or navigated frames are intentionally unsupported. */ }
    }
  };
  collect(document, window, 'top', genericVideo ? new URL(location.href).origin : '');
  if (eligible.length > limit) return { ok: false, reason: 'player-mismatch' };
  const matches = eligible.filter(({ element, video, framePath, frameOrigin }, index) => {
    const kind = genericVideo && mode === 'video' ? 'video'
      : element instanceof HTMLAudioElement ? 'audio' : mode === 'audio' ? 'audio-only-video' : 'video';
    const identity = genericVideo && mode === 'video'
      ? `web-video:${framePath}:${index + 1}:${digest(`${pageSourceKey(location.href)}|${frameOrigin}|${framePath}|${kind}|${sourceFor(element)}|${Number.isFinite(element.duration) ? Math.round(element.duration * 1_000) : 0}|${video ? `${video.videoWidth}x${video.videoHeight}` : '0x0'}`)}`
      : `${kind}:${index + 1}:${digest(`${kind}|${sourceFor(element)}`)}`;
    return identity === expectedIdentity;
  });
  if (matches.length !== 1) return { ok: false, reason: 'player-mismatch' };
  const player = matches[0]!.element;
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
