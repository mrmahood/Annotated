import type {
  CaptureGeometry,
  CapturePreparedPage,
  CaptureSourceIdentity,
  CaptureStartRequest,
  PreparationDiagnosticCode,
} from './media-capture';
import { isCapturePreparedPage } from './media-capture.ts';

export type PrepareCapturePageResult =
  | { ok: true; prepared: CapturePreparedPage }
  | { ok: false; code: PreparationDiagnosticCode; message: string };

export async function prepareMediaCaptureOnPage(
  request: Pick<CaptureStartRequest, 'source' | 'startMs' | 'endMs'>,
): Promise<PrepareCapturePageResult> {
  // Chrome serializes only this function for executeScript. Every runtime helper
  // must therefore live inside this function rather than in the extension module.
  const comparable = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const youtubeId = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      return (host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null;
    } catch { return null; }
  };
  const sourceMatches = () => request.source.kind === 'youtube'
    ? youtubeId(location.href) === request.source.sourceKey
    : comparable(location.href) === comparable(request.source.pageUrl);
  const selectMedia = (): HTMLMediaElement | null => {
    if (request.source.kind === 'youtube') {
      const video = document.querySelector('video');
      return video instanceof HTMLVideoElement ? video : null;
    }
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement =>
        element instanceof HTMLAudioElement ||
        (element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0))
      .filter((element) => Boolean(
        element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]'),
      ));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length ? playing : candidates;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    return preferred.length === 1 ? preferred[0]! : null;
  };
  const geometryFor = (media: HTMLMediaElement): CaptureGeometry => {
    const video = media instanceof HTMLVideoElement ? media : null;
    const rect = video?.getBoundingClientRect() ?? null;
    const style = video ? getComputedStyle(video) : null;
    const fullscreenElement = document.fullscreenElement;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      boundingClientRect: rect ? {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      } : null,
      videoWidth: video?.videoWidth ?? null,
      videoHeight: video?.videoHeight ?? null,
      objectFit: style?.objectFit ?? null,
      objectPosition: style?.objectPosition ?? null,
      fullscreen: fullscreenElement !== null,
      fullscreenElement: fullscreenElement
        ? `${fullscreenElement.tagName.toLowerCase()}${fullscreenElement.id ? `#${fullscreenElement.id}` : ''}`
        : null,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  };

  if (!sourceMatches()) {
    return { ok: false, code: 'SOURCE_CHANGED', message: 'The connected source changed before capture started.' };
  }
  const durationMs = request.endMs - request.startMs;
  if (!Number.isSafeInteger(request.startMs) || request.startMs < 0 ||
      !Number.isSafeInteger(request.endMs) || durationMs < 1_000 || durationMs > 90_000) {
    return { ok: false, code: 'RANGE_INVALID', message: 'The selected range must be between 1 and 90 seconds.' };
  }
  const media = selectMedia();
  if (!media) {
    return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'A usable top-level player was not available.' };
  }
  if (!Number.isFinite(media.currentTime) || (media.readyState === 0 && !Number.isFinite(media.duration))) {
    return { ok: false, code: 'PLAYER_NOT_READY', message: 'The connected player is not ready yet.' };
  }
  const mediaDurationMs = Number.isFinite(media.duration) && media.duration > 0
    ? Math.floor(media.duration * 1_000)
    : null;
  if (mediaDurationMs !== null && request.endMs > mediaDurationMs + 250) {
    return { ok: false, code: 'RANGE_INVALID', message: 'The selected range extends beyond the connected media.' };
  }
  media.pause();
  if (Math.abs(media.currentTime * 1_000 - request.startMs) > 25) {
    const seekFinished = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        media.removeEventListener('seeked', finish);
        resolve();
      };
      media.addEventListener('seeked', finish, { once: true });
      window.setTimeout(finish, 3_000);
    });
    try { media.currentTime = request.startMs / 1_000; }
    catch {
      return { ok: false, code: 'PLAYER_NOT_READY', message: 'The connected player could not seek to the selected start.' };
    }
    await seekFinished;
  }
  if (!sourceMatches()) {
    return { ok: false, code: 'NAVIGATION_CHANGED', message: 'The source changed while its player was seeking.' };
  }
  return {
    ok: true,
    prepared: {
      sourceKind: request.source.kind,
      requestedStartMs: request.startMs,
      requestedEndMs: request.endMs,
      requestedDurationMs: durationMs,
      playerCurrentTimeBeforeRecordingMs: Math.round(media.currentTime * 1_000),
      mediaDurationMs,
      pageUrl: location.href,
      geometry: geometryFor(media),
    },
  };
}

export async function playMediaForCaptureOnPage(
  source: CaptureSourceIdentity,
  startMs: number,
): Promise<{ ok: boolean; acknowledgedAtMs: number; currentTimeMs: number | null; message?: string }> {
  const youtubeId = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      return (host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch'
        ? url.searchParams.get('v') : null;
    } catch { return null; }
  };
  const comparable = (value: string) => {
    try {
      const url = new URL(value); url.hash = ''; url.hostname = url.hostname.toLowerCase();
      url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const sourceMatches = () => source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : comparable(location.href) === comparable(source.pageUrl);
  const selectMedia = (): HTMLMediaElement | null => {
    if (source.kind === 'youtube') {
      const video = document.querySelector('video');
      return video instanceof HTMLVideoElement ? video : null;
    }
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement ||
        (element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0))
      .filter((element) => Boolean(element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]')));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length ? playing : candidates;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    return preferred.length === 1 ? preferred[0]! : null;
  };
  const acknowledgedAtMs = Date.now();
  if (!sourceMatches()) return { ok: false, acknowledgedAtMs, currentTimeMs: null, message: 'connected-source-changed' };
  const media = selectMedia();
  if (!media) return { ok: false, acknowledgedAtMs, currentTimeMs: null, message: 'player-unavailable' };
  if (Math.abs(media.currentTime * 1_000 - startMs) > 250) media.currentTime = startMs / 1_000;
  try {
    await media.play();
    return { ok: true, acknowledgedAtMs: Date.now(), currentTimeMs: Math.round(media.currentTime * 1_000) };
  } catch (error) {
    return {
      ok: false,
      acknowledgedAtMs: Date.now(),
      currentTimeMs: Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 1_000) : null,
      message: error instanceof Error ? error.message : 'playback-failed',
    };
  }
}

export function finishMediaCaptureOnPage(
  source: CaptureSourceIdentity,
  pausePlayer: boolean,
): { currentTimeMs: number | null; sourceMatches: boolean; geometry: CaptureGeometry | null } {
  const youtubeId = (value: string) => {
    try {
      const url = new URL(value); const host = url.hostname.toLowerCase().replace(/^www\./, '');
      return (host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch'
        ? url.searchParams.get('v') : null;
    } catch { return null; }
  };
  const comparable = (value: string) => {
    try {
      const url = new URL(value); url.hash = ''; url.hostname = url.hostname.toLowerCase();
      url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const sourceStillMatches = () => source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : comparable(location.href) === comparable(source.pageUrl);
  const selectMedia = (): HTMLMediaElement | null => {
    if (source.kind === 'youtube') {
      const video = document.querySelector('video');
      return video instanceof HTMLVideoElement ? video : null;
    }
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement ||
        (element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0))
      .filter((element) => Boolean(element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]')));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length ? playing : candidates;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    return preferred.length === 1 ? preferred[0]! : null;
  };
  const geometryFor = (media: HTMLMediaElement): CaptureGeometry => {
    const video = media instanceof HTMLVideoElement ? media : null;
    const rect = video?.getBoundingClientRect() ?? null;
    const style = video ? getComputedStyle(video) : null;
    const fullscreenElement = document.fullscreenElement;
    return {
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      boundingClientRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } : null,
      videoWidth: video?.videoWidth ?? null, videoHeight: video?.videoHeight ?? null,
      objectFit: style?.objectFit ?? null, objectPosition: style?.objectPosition ?? null,
      fullscreen: fullscreenElement !== null,
      fullscreenElement: fullscreenElement
        ? `${fullscreenElement.tagName.toLowerCase()}${fullscreenElement.id ? `#${fullscreenElement.id}` : ''}` : null,
      scrollX: window.scrollX, scrollY: window.scrollY,
    };
  };
  if (!sourceStillMatches()) return { currentTimeMs: null, sourceMatches: false, geometry: null };
  const media = selectMedia();
  if (!media) return { currentTimeMs: null, sourceMatches: true, geometry: null };
  const currentTimeMs = Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 1_000) : null;
  if (pausePlayer) media.pause();
  return { currentTimeMs, sourceMatches: true, geometry: geometryFor(media) };
}

const PREPARATION_CODES = new Set<PreparationDiagnosticCode>([
  'PLAYER_NOT_FOUND', 'PLAYER_NOT_READY', 'SOURCE_CHANGED', 'RANGE_INVALID',
  'SCRIPT_INJECTION_FAILED', 'PREPARATION_RESULT_MISSING',
  'PREPARATION_RESULT_INVALID', 'STALE_CAPTURE', 'NAVIGATION_CHANGED',
]);

export function readTopFramePreparationResult(value: unknown): PrepareCapturePageResult {
  if (!Array.isArray(value)) {
    return { ok: false, code: 'PREPARATION_RESULT_MISSING', message: 'The connected player returned no preparation result.' };
  }
  const topFrame = value.find((entry) => typeof entry === 'object' && entry !== null &&
    (entry as { frameId?: unknown }).frameId === 0) as { result?: unknown } | undefined;
  if (!topFrame || topFrame.result === undefined) {
    return { ok: false, code: 'PREPARATION_RESULT_MISSING', message: 'The connected player returned no preparation result.' };
  }
  const result = topFrame.result;
  if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
    return { ok: false, code: 'PREPARATION_RESULT_INVALID', message: 'The connected player returned an invalid preparation result.' };
  }
  if ((result as { ok: boolean }).ok) {
    const prepared = (result as { prepared?: unknown }).prepared;
    return isCapturePreparedPage(prepared)
      ? { ok: true, prepared }
      : { ok: false, code: 'PREPARATION_RESULT_INVALID', message: 'The connected player returned an invalid preparation result.' };
  }
  const failure = result as { code?: unknown; message?: unknown };
  return typeof failure.code === 'string' && PREPARATION_CODES.has(failure.code as PreparationDiagnosticCode) &&
    typeof failure.message === 'string' && failure.message.length > 0 && failure.message.length <= 500
    ? { ok: false, code: failure.code as PreparationDiagnosticCode, message: failure.message }
    : { ok: false, code: 'PREPARATION_RESULT_INVALID', message: 'The connected player returned an invalid preparation result.' };
}
