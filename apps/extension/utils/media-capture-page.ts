import type {
  CaptureIntent,
  CaptureIntentDiagnostic,
  CapturePreparedPage,
  CaptureSourceIdentity,
  CaptureStartRequest,
  CaptureStreamDiagnostic,
} from './media-capture-spike';

export type PrepareCapturePageRequest = {
  source: CaptureSourceIdentity;
  intent: CaptureIntent;
  maximumDurationMs: number;
};

export type PrepareCapturePageOutcome =
  | { ok: true; prepared: CapturePreparedPage }
  | {
      ok: false;
      code: 'connected-source-changed' | 'invalid-request' | 'player-unavailable';
      message: string;
    };

export type PrepareCapturePageResult = PrepareCapturePageOutcome & {
  protocolDiagnostic?: CaptureIntentDiagnostic & { maximumDurationMs: number };
};

export function createPrepareCapturePageRequest(
  request: CaptureStartRequest,
  maximumDurationMs: number,
): PrepareCapturePageRequest {
  return {
    source: request.source,
    intent: request.intent.kind === 'fixed-duration'
      ? { kind: 'fixed-duration', durationMs: request.intent.durationMs }
      : {
          kind: 'selected-range',
          startMs: request.intent.startMs,
          endMs: request.intent.endMs,
        },
    maximumDurationMs,
  };
}

export type CapturePlayerDiagnostic = {
  sourceMatches: boolean;
  source: 'youtube' | 'podcast' | 'video' | 'unsupported';
  player: 'ready' | 'not-ready' | 'not-found';
};

// Serialized into the explicitly connected top-level tab. This is read-only and
// exists only to keep the development panel's status current before capture.
export function inspectMediaCapturePlayerOnPage(
  source: CaptureSourceIdentity,
): CapturePlayerDiagnostic {
  const normalizedPageUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const youtubeVideoId = (value: string) => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      return (hostname === 'youtube.com' || hostname === 'm.youtube.com') && url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null;
    } catch { return null; }
  };
  const sourceMatches = source.kind === 'youtube'
    ? youtubeVideoId(location.href) === source.sourceKey
    : normalizedPageUrl(location.href) === normalizedPageUrl(source.pageUrl);
  const sourceLabel = source.kind === 'youtube'
    ? 'youtube' as const
    : source.kind === 'audio'
      ? 'podcast' as const
      : 'video' as const;
  if (!sourceMatches) return { sourceMatches: false, source: sourceLabel, player: 'not-found' };

  let media: HTMLMediaElement | null = null;
  if (source.kind === 'youtube') {
    const candidate = document.querySelector('video');
    media = candidate instanceof HTMLVideoElement ? candidate : null;
  } else if (source.kind === 'audio') {
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement || (
        element instanceof HTMLVideoElement && element.readyState >= 1 &&
        element.videoWidth === 0 && element.videoHeight === 0
      ))
      .filter((element) => Boolean(
        element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]'),
      ));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length > 0 ? playing : candidates;
    const audioElements = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audioElements.length > 0 ? audioElements : pool;
    media = preferred.length === 1 ? preferred[0]! : null;
  } else {
    const candidates = [...document.querySelectorAll('video')]
      .filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement &&
        element.videoWidth > 0 && element.videoHeight > 0)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((first, second) => {
        const playingDifference = Number(!second.element.paused) - Number(!first.element.paused);
        return playingDifference ||
          second.rect.width * second.rect.height - first.rect.width * first.rect.height;
      });
    media = candidates[0]?.element ?? null;
  }
  if (!media) {
    return {
      sourceMatches: true,
      source: source.kind === 'generic' ? 'unsupported' : sourceLabel,
      player: 'not-found',
    };
  }
  return {
    sourceMatches: true,
    source: sourceLabel,
    player: Number.isFinite(media.currentTime) && media.currentTime >= 0 ? 'ready' : 'not-ready',
  };
}

// Serialized into the explicitly connected top-level tab. Keep all helpers local.
export async function prepareMediaCaptureOnPage(
  request: PrepareCapturePageRequest,
): Promise<PrepareCapturePageResult> {
  const protocolDiagnostic = request.intent.kind === 'fixed-duration'
    ? {
        kind: 'fixed-duration' as const,
        durationMs: request.intent.durationMs,
        maximumDurationMs: request.maximumDurationMs,
      }
    : {
        kind: 'selected-range' as const,
        startMs: request.intent.startMs,
        endMs: request.intent.endMs,
        maximumDurationMs: request.maximumDurationMs,
      };
  console.info('[Annotated media capture spike] prepareCapturePage input', protocolDiagnostic);
  const result = await (async (): Promise<PrepareCapturePageOutcome> => {
  const normalizedPageUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
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
  const sourceMatches = () => {
    if (request.source.kind === 'youtube') {
      return youtubeId(location.href) === request.source.sourceKey;
    }
    return normalizedPageUrl(location.href) === normalizedPageUrl(request.source.pageUrl);
  };
  if (!sourceMatches()) {
    return {
      ok: false,
      code: 'connected-source-changed',
      message: 'The connected tab changed sources before capture started.',
    };
  }

  const credibleAudio = (element: Element): element is HTMLMediaElement => {
    if (element instanceof HTMLAudioElement) return Boolean(
      element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]'),
    );
    return element instanceof HTMLVideoElement && element.readyState >= 1 &&
      element.videoWidth === 0 && element.videoHeight === 0 && Boolean(
        element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]'),
      );
  };
  const selectAudio = () => {
    const elements = [...document.querySelectorAll('audio, video')].filter(credibleAudio);
    const playing = elements.filter((element) => !element.paused && !element.ended);
    const ready = elements.filter((element) => Number.isFinite(element.currentTime) &&
      Number.isFinite(element.duration) && element.duration > 0);
    const pool = playing.length ? playing : ready.length ? ready : elements;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    return preferred.length === 1 ? preferred[0]! : null;
  };
  const selectVideo = () => {
    if (request.source.kind === 'youtube') {
      const video = document.querySelector('video');
      return video instanceof HTMLVideoElement ? video : null;
    }
    const videos = [...document.querySelectorAll('video')]
      .filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement &&
        element.videoWidth > 0 && element.videoHeight > 0)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((first, second) => {
        const playingDifference = Number(!first.element.paused) - Number(!second.element.paused);
        return playingDifference !== 0
          ? -playingDifference
          : (second.rect.width * second.rect.height) - (first.rect.width * first.rect.height);
      });
    return videos[0]?.element ?? null;
  };

  const media = request.source.kind === 'audio' ? selectAudio() : selectVideo();
  if (!media) {
    return {
      ok: false,
      code: 'player-unavailable',
      message: request.source.kind === 'audio'
        ? 'A single usable top-level audio player was not available.'
        : 'A usable top-level video player was not available.',
    };
  }
  if (!Number.isFinite(media.currentTime) || media.currentTime < 0) {
    return { ok: false, code: 'player-unavailable', message: 'Player time is unavailable.' };
  }

  const currentTimeMs = Math.round(media.currentTime * 1_000);
  const mediaDurationMs = Number.isFinite(media.duration) && media.duration > 0
    ? Math.floor(media.duration * 1_000)
    : null;
  let startMs: number;
  let endMs: number;
  let durationMs: number;
  if (request.intent.kind === 'fixed-duration') {
    if (
      !Number.isSafeInteger(request.intent.durationMs) || request.intent.durationMs < 1_000 ||
      request.intent.durationMs > request.maximumDurationMs
    ) {
      return {
        ok: false,
        code: 'invalid-request',
        message: request.intent.durationMs > request.maximumDurationMs
          ? 'The media capture spike has a hard 90-second maximum.'
          : 'Unable to prepare fixed-duration capture.',
      };
    }
    startMs = currentTimeMs;
    const remainingMs = mediaDurationMs === null ? null : mediaDurationMs - startMs;
    if (remainingMs !== null && remainingMs < 1_000) {
      return {
        ok: false,
        code: 'invalid-request',
        message: 'Less than one second remains in the media.',
      };
    }
    durationMs = remainingMs === null
      ? request.intent.durationMs
      : Math.min(request.intent.durationMs, remainingMs);
    endMs = startMs + durationMs;
  } else {
    startMs = request.intent.startMs;
    const desiredEndMs = request.intent.endMs;
    if (
      !Number.isSafeInteger(startMs) || !Number.isSafeInteger(desiredEndMs) || startMs < 0 ||
      desiredEndMs - startMs < 1_000 || desiredEndMs - startMs > request.maximumDurationMs
    ) {
      return {
        ok: false,
        code: 'invalid-request',
        message: desiredEndMs - startMs > request.maximumDurationMs
          ? 'The media capture spike has a hard 90-second maximum.'
          : 'The requested range is unavailable or shorter than one second.',
      };
    }
    endMs = mediaDurationMs === null ? desiredEndMs : Math.min(desiredEndMs, mediaDurationMs);
    durationMs = endMs - startMs;
    if (durationMs < 1_000) {
      return {
        ok: false,
        code: 'invalid-request',
        message: 'The requested range is unavailable or shorter than one second.',
      };
    }
  }

  media.pause();
  if (request.intent.kind === 'selected-range' && Math.abs(media.currentTime * 1_000 - startMs) > 25) {
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
    try { media.currentTime = startMs / 1_000; } catch {
      return { ok: false, code: 'player-unavailable', message: 'The connected player could not seek to the requested start.' };
    }
    await seekFinished;
  }
  if (!sourceMatches()) {
    return {
      ok: false,
      code: 'connected-source-changed',
      message: 'The connected source changed while its player was seeking.',
    };
  }

  const video = media instanceof HTMLVideoElement ? media : null;
  const rect = video?.getBoundingClientRect() ?? null;
  const style = video ? getComputedStyle(video) : null;
  const fullscreenElement = document.fullscreenElement;
  return {
    ok: true,
    prepared: {
      sourceKind: request.source.kind === 'audio' ? 'audio' :
        request.source.kind === 'youtube' ? 'youtube' : 'video',
      requestedStartMs: startMs,
      requestedEndMs: endMs,
      requestedDurationMs: durationMs,
      playerCurrentTimeBeforeRecordingMs: Math.round(media.currentTime * 1_000),
      mediaDurationMs,
      pageUrl: location.href,
      geometry: {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        boundingClientRect: rect ? {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
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
      },
    },
  };
  })();
  return { ...result, protocolDiagnostic };
}

// Serialized into the same connected top-level tab after MediaRecorder starts.
export async function playMediaForCaptureOnPage(
  source: CaptureSourceIdentity,
  startMs: number,
): Promise<{ ok: boolean; currentTimeMs: number | null; message?: string }> {
  const youtubeId = (value: string) => {
    try {
      const url = new URL(value);
      return url.pathname === '/watch' ? url.searchParams.get('v') : null;
    } catch { return null; }
  };
  const comparable = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = '';
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const sourceMatches = source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : comparable(location.href) === comparable(source.pageUrl);
  if (!sourceMatches) return { ok: false, currentTimeMs: null, message: 'connected-source-changed' };

  let media: HTMLMediaElement | null = null;
  if (source.kind === 'youtube') {
    const candidate = document.querySelector('video');
    media = candidate instanceof HTMLVideoElement ? candidate : null;
  } else if (source.kind === 'audio') {
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement || (
        element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0
      ));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length ? playing : candidates;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    media = preferred.length === 1 ? preferred[0]! : null;
  } else {
    const candidates = [...document.querySelectorAll('video')]
      .filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement &&
        element.videoWidth > 0 && element.videoHeight > 0)
      .sort((first, second) => {
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
      });
    media = candidates[0] ?? null;
  }
  if (!media) return { ok: false, currentTimeMs: null, message: 'player-unavailable' };
  if (Math.abs(media.currentTime * 1_000 - startMs) > 250) media.currentTime = startMs / 1_000;
  try {
    await media.play();
    return { ok: true, currentTimeMs: Math.round(media.currentTime * 1_000) };
  } catch (error) {
    return {
      ok: false,
      currentTimeMs: Math.round(media.currentTime * 1_000),
      message: error instanceof Error ? error.message : 'playback-failed',
    };
  }
}

// Serialized into the connected tab when recording finishes or is cancelled.
export function finishMediaCaptureOnPage(
  source: CaptureSourceIdentity,
  pausePlayer: boolean,
): { currentTimeMs: number | null; sourceMatches: boolean } {
  const youtubeId = (value: string) => {
    try { return new URL(value).searchParams.get('v'); } catch { return null; }
  };
  const comparable = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = '';
      url.searchParams.sort();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const matches = source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : comparable(location.href) === comparable(source.pageUrl);
  if (!matches) return { currentTimeMs: null, sourceMatches: false };
  let candidates: HTMLMediaElement[] = [];
  if (source.kind === 'youtube') {
    const video = document.querySelector('video');
    candidates = video instanceof HTMLVideoElement ? [video] : [];
  } else if (source.kind === 'audio') {
    candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement || (
        element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0
      ));
  } else {
    candidates = [...document.querySelectorAll('video')]
      .filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement &&
        element.videoWidth > 0 && element.videoHeight > 0);
  }
  const playing = candidates.filter((element) => !element.paused && !element.ended);
  const media = playing.length === 1 ? playing[0]! : candidates.length === 1 ? candidates[0]! : null;
  if (!media) return { currentTimeMs: null, sourceMatches: true };
  const currentTimeMs = Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 1_000) : null;
  if (pausePlayer) media.pause();
  return { currentTimeMs, sourceMatches: true };
}

// Optional diagnostic only. It never fetches or inspects the underlying media URL.
export function inspectMediaElementCaptureStreamOnPage(
  source: CaptureSourceIdentity,
): CaptureStreamDiagnostic {
  const empty = (): CaptureStreamDiagnostic => ({
    methodExists: false,
    callSucceeded: false,
    audioTrackCount: 0,
    videoTrackCount: 0,
    tracks: [],
    currentSourceCrossOrigin: null,
    crossOriginAttribute: null,
    exceptionName: null,
    exceptionMessage: null,
  });
  let media: HTMLMediaElement | null = null;
  if (source.kind === 'youtube') {
    const candidate = document.querySelector('video');
    media = candidate instanceof HTMLVideoElement ? candidate : null;
  } else if (source.kind === 'audio') {
    const candidates = [...document.querySelectorAll('audio, video')]
      .filter((element): element is HTMLMediaElement => element instanceof HTMLAudioElement || (
        element instanceof HTMLVideoElement && element.videoWidth === 0 && element.videoHeight === 0
      ));
    const playing = candidates.filter((element) => !element.paused && !element.ended);
    const pool = playing.length ? playing : candidates;
    const audio = pool.filter((element) => element instanceof HTMLAudioElement);
    const preferred = audio.length ? audio : pool;
    media = preferred.length === 1 ? preferred[0]! : null;
  } else {
    const candidates = [...document.querySelectorAll('video')]
      .filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement &&
        element.videoWidth > 0 && element.videoHeight > 0);
    media = candidates.length === 1 ? candidates[0]! : null;
  }
  if (!media) return { ...empty(), exceptionName: 'PlayerUnavailable', exceptionMessage: 'No unambiguous media element was selected.' };
  const currentSourceCrossOrigin = (() => {
    if (!media.currentSrc) return null;
    try { return new URL(media.currentSrc, location.href).origin !== location.origin; } catch { return null; }
  })();
  const callable = media as HTMLMediaElement & { captureStream?: () => MediaStream };
  const result = {
    ...empty(),
    methodExists: typeof callable.captureStream === 'function',
    currentSourceCrossOrigin,
    crossOriginAttribute: media.crossOrigin,
  };
  if (!callable.captureStream) return result;
  let stream: MediaStream | null = null;
  try {
    stream = callable.captureStream();
    const tracks = stream.getTracks().map((track) => ({
      kind: track.kind,
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
    }));
    return {
      ...result,
      callSucceeded: true,
      audioTrackCount: stream.getAudioTracks().length,
      videoTrackCount: stream.getVideoTracks().length,
      tracks,
    };
  } catch (error) {
    return {
      ...result,
      exceptionName: error instanceof DOMException ? error.name : error instanceof Error ? error.name : 'UnknownError',
      exceptionMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
