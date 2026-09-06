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
  const tiktokId = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'tiktok.com' && host !== 'm.tiktok.com') return null;
      const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
      return match?.[2] ?? null;
    } catch { return null; }
  };
  const articleKey = (value: string) => {
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
  const sourceMatches = () => request.source.kind === 'youtube'
    ? youtubeId(location.href) === request.source.sourceKey
    : request.source.kind === 'tiktok'
      ? tiktokId(location.href) === request.source.sourceKey
    : request.source.kind === 'web-video'
      ? articleKey(location.href) === request.source.sourceKey && articleKey(request.source.pageUrl) === request.source.sourceKey
      : comparable(location.href) === comparable(request.source.pageUrl);
  type FrameMapping = NonNullable<CaptureGeometry['frameMapping']> & { offsetX: number; offsetY: number };
  const selectMedia = (): { media: HTMLMediaElement; mapping: FrameMapping | null } | null => {
    const digest = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const sourceFor = (element: HTMLMediaElement) => element.currentSrc ||
      element.getAttribute('src') || element.querySelector<HTMLSourceElement>('source[src]')?.src || '';
    const operableAudioVideo = (element: HTMLVideoElement) => {
      if (!element.paused && !element.ended) return true;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return element.controls && rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
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
    const videoExposed = (element: HTMLVideoElement, ownerDocument: Document = document, ownerWindow: Window = window) => {
      const rect = element.getBoundingClientRect(); const style = styleFor(ownerWindow, element);
      const left = Math.max(0, rect.left); const right = Math.min(ownerWindow.innerWidth, rect.right);
      const top = Math.max(0, rect.top); const bottom = Math.min(ownerWindow.innerHeight, rect.bottom);
      if (right <= left || bottom <= top || element.getClientRects().length === 0 ||
          style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) return false;
      return [
        [(left + right) / 2, (top + bottom) / 2],
        [left + (right - left) / 4, top + (bottom - top) / 4],
        [right - (right - left) / 4, bottom - (bottom - top) / 4],
      ].some(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(element));
    };
    if (request.source.kind === 'web-video') {
      const candidates: Array<{ media: HTMLVideoElement; mapping: FrameMapping }> = [];
      const topOrigin = new URL(location.href).origin;
      const collect = (ownerDocument: Document, ownerWindow: Window, mapping: FrameMapping) => {
        for (const entry of ownerDocument.querySelectorAll('video')) {
          if (!sourceFor(entry) || entry.readyState < 1 ||
              entry.videoWidth <= 0 || entry.videoHeight <= 0 || !Number.isFinite(entry.duration) || entry.duration <= 0 ||
              !safeGenericSource(sourceFor(entry), ownerWindow) ||
              looksLikeAdvertisingVideo(entry) ||
              entry.mediaKeys || (entry as HTMLVideoElement & { webkitKeys?: unknown }).webkitKeys || entry.srcObject ||
              styleFor(ownerWindow, entry).transform !== 'none' || !videoExposed(entry, ownerDocument, ownerWindow) ||
              entry.getBoundingClientRect().left < -1 || entry.getBoundingClientRect().top < -1 ||
              entry.getBoundingClientRect().right > ownerWindow.innerWidth + 1 ||
              entry.getBoundingClientRect().bottom > ownerWindow.innerHeight + 1) continue;
          candidates.push({ media: entry, mapping });
          if (candidates.length > 5) return;
        }
        const frames = [...ownerDocument.querySelectorAll('iframe, frame')];
        for (const [index, frame] of frames.entries()) {
          if (candidates.length > 5) return;
          try {
            const childWindow = (frame as HTMLIFrameElement).contentWindow;
            const childDocument = (frame as HTMLIFrameElement).contentDocument;
            if (!childWindow || !childDocument || childWindow.location.origin !== topOrigin) continue;
            const rect = (frame as HTMLElement).getBoundingClientRect(); const style = styleFor(ownerWindow, frame);
            const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
            const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
            const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
            const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
            const frameExposed = [
              [rect.left + rect.width / 2, rect.top + rect.height / 2],
              [rect.left + rect.width / 4, rect.top + rect.height / 4],
              [rect.right - rect.width / 4, rect.bottom - rect.height / 4],
            ].every(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(frame));
            const safe = style.transform === 'none' && style.display !== 'none' && style.visibility !== 'hidden' &&
              Number(style.opacity) > 0 && rect.left >= -1 && rect.top >= -1 &&
              rect.right <= ownerWindow.innerWidth + 1 && rect.bottom <= ownerWindow.innerHeight + 1 &&
              Math.abs(rect.width - childWindow.innerWidth - borderLeft - borderRight) <= 1 &&
              Math.abs(rect.height - childWindow.innerHeight - borderTop - borderBottom) <= 1 && frameExposed;
            if (!safe) continue;
            collect(childDocument, childWindow, {
              path: mapping.path === 'top' ? `${index + 1}` : `${mapping.path}.${index + 1}`,
              origin: childWindow.location.origin,
              viewportWidth: childWindow.innerWidth, viewportHeight: childWindow.innerHeight,
              borderLeft, borderRight, borderTop, borderBottom,
              offsetX: mapping.offsetX + rect.left + borderLeft,
              offsetY: mapping.offsetY + rect.top + borderTop,
            });
          } catch { /* Cross-origin and navigated frames fail closed. */ }
        }
      };
      collect(document, window, {
        path: 'top', origin: topOrigin, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        borderLeft: 0, borderRight: 0, borderTop: 0, borderBottom: 0, offsetX: 0, offsetY: 0,
      });
      if (candidates.length > 5) return null;
      const pageKey = articleKey(location.href);
      const matches = candidates.filter(({ media, mapping }, index) =>
        `web-video:${mapping.path}:${index + 1}:${digest(`${pageKey}|${mapping.origin}|${mapping.path}|video|${sourceFor(media)}|${Math.round(media.duration * 1_000)}|${media.videoWidth}x${media.videoHeight}`)}` === request.source.playerIdentity);
      return matches.length === 1 ? matches[0]! : null;
    }
    const candidates: HTMLMediaElement[] = [];
    for (const element of document.querySelectorAll('audio, video')) {
      if (!(element instanceof HTMLMediaElement) || !sourceFor(element)) continue;
      const accepted = request.source.kind === 'youtube' || request.source.kind === 'tiktok'
        ? element instanceof HTMLVideoElement && videoExposed(element)
        : element instanceof HTMLAudioElement || (
          element instanceof HTMLVideoElement && element.readyState >= 1 &&
          element.videoWidth === 0 && element.videoHeight === 0 && operableAudioVideo(element)
        );
      if (accepted) candidates.push(element);
      if (candidates.length > 5) break;
    }
    if (candidates.length > 5) return null;
    const matches = candidates.filter((element, index) => {
      const kind = element instanceof HTMLAudioElement ? 'audio'
        : request.source.kind === 'audio' ? 'audio-only-video' : 'video';
      return `${kind}:${index + 1}:${digest(`${kind}|${sourceFor(element)}`)}` ===
        request.source.playerIdentity;
    });
    return matches.length === 1 ? { media: matches[0]!, mapping: null } : null;
  };
  const geometryFor = (media: HTMLMediaElement, mapping: FrameMapping | null): CaptureGeometry => {
    const video = mapping ? media as HTMLVideoElement : media instanceof HTMLVideoElement ? media : null;
    const localRect = video?.getBoundingClientRect() ?? null;
    const rect = localRect && mapping ? {
      x: localRect.x + mapping.offsetX, y: localRect.y + mapping.offsetY,
      width: localRect.width, height: localRect.height,
      top: localRect.top + mapping.offsetY, right: localRect.right + mapping.offsetX,
      bottom: localRect.bottom + mapping.offsetY, left: localRect.left + mapping.offsetX,
    } : localRect;
    const style = video ? (video.ownerDocument?.defaultView?.getComputedStyle(video) ?? getComputedStyle(video)) : null;
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
      frameMapping: mapping ? {
        path: mapping.path, origin: mapping.origin,
        viewportWidth: mapping.viewportWidth, viewportHeight: mapping.viewportHeight,
        borderLeft: mapping.borderLeft, borderRight: mapping.borderRight,
        borderTop: mapping.borderTop, borderBottom: mapping.borderBottom,
      } : null,
    };
  };

  const spotifyEpisodeId = (value: string) => {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
      const match = url.pathname.match(
        /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
      );
      return match?.[1] ?? null;
    } catch { return null; }
  };
  const parseSpotifyClock = (value: string) => {
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
  const readSpotifyNowPlaying = () => {
    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      position: parseSpotifyClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent)),
      duration: parseSpotifyClock(clean(document.querySelector('[data-testid="playback-duration"]')?.textContent)),
    };
  };
  const spotifyGeometry = (): CaptureGeometry => {
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    const rect = bar instanceof HTMLElement ? bar.getBoundingClientRect() : null;
    return {
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      boundingClientRect: rect ? {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      } : null,
      videoWidth: null, videoHeight: null, objectFit: null, objectPosition: null,
      fullscreen: false, fullscreenElement: null,
      scrollX: window.scrollX, scrollY: window.scrollY, frameMapping: null,
    };
  };

  if (request.source.kind === 'spotify') {
    if (spotifyEpisodeId(location.href) !== request.source.sourceKey) {
      return { ok: false, code: 'SOURCE_CHANGED', message: 'The connected source changed before capture started.' };
    }
    const durationMs = request.endMs - request.startMs;
    if (!Number.isSafeInteger(request.startMs) || request.startMs < 0 ||
        !Number.isSafeInteger(request.endMs) || durationMs < 1_000 || durationMs > 90_000) {
      return { ok: false, code: 'RANGE_INVALID', message: 'The selected range must be between 1 and 90 seconds.' };
    }
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
      let now = readSpotifyNowPlaying();
      if (now.position === null) return now;
      if (Math.abs(now.position - start) <= 2) return now;
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
            raw = duration !== null && duration > 0 ? lo + (start / duration) * span : lo;
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
      now = readSpotifyNowPlaying();
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
      now = readSpotifyNowPlaying();
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
      if (!attempted) return now;
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        now = readSpotifyNowPlaying();
        if (now.position !== null && Math.abs(now.position - start) <= 2) return now;
        await wait(50);
      }
      return readSpotifyNowPlaying();
    };
    const now = await seekNowPlaying(request.startMs / 1_000);
    if (now.position === null) {
      return { ok: false, code: 'PLAYER_NOT_READY', message: 'The Spotify now-playing time could not be read.' };
    }
    if (Math.abs(now.position * 1_000 - request.startMs) > 2_000) {
      return {
        ok: false,
        code: 'PLAYER_NOT_READY',
        message: 'The Spotify player could not seek to the clip start.',
      };
    }
    return {
      ok: true,
      prepared: {
        sourceKind: 'spotify',
        requestedStartMs: request.startMs,
        requestedEndMs: request.endMs,
        requestedDurationMs: durationMs,
        playerCurrentTimeBeforeRecordingMs: Math.round(now.position * 1_000),
        mediaDurationMs: now.duration === null ? null : Math.round(now.duration * 1_000),
        pageUrl: location.href,
        geometry: spotifyGeometry(),
      },
    };
  }

  if (!sourceMatches()) {
    return { ok: false, code: 'SOURCE_CHANGED', message: 'The connected source changed before capture started.' };
  }
  const durationMs = request.endMs - request.startMs;
  if (!Number.isSafeInteger(request.startMs) || request.startMs < 0 ||
      !Number.isSafeInteger(request.endMs) || durationMs < 1_000 || durationMs > 90_000) {
    return { ok: false, code: 'RANGE_INVALID', message: 'The selected range must be between 1 and 90 seconds.' };
  }
  const selected = selectMedia();
  if (!selected) {
    return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'A usable top-level player was not available.' };
  }
  const { media, mapping } = selected;
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
      geometry: geometryFor(media, mapping),
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
  const articleKey = (value: string) => {
    try {
      const url = new URL(value); if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hostname = url.hostname.toLowerCase(); url.hash = '';
      const tracking = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']);
      for (const key of [...url.searchParams.keys()]) if (tracking.has(key.toLowerCase())) url.searchParams.delete(key);
      url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const tiktokId = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'tiktok.com' && host !== 'm.tiktok.com') return null;
      const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
      return match?.[2] ?? null;
    } catch { return null; }
  };
  const sourceMatches = () => source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : source.kind === 'tiktok'
      ? tiktokId(location.href) === source.sourceKey
    : source.kind === 'web-video'
      ? articleKey(location.href) === source.sourceKey && articleKey(source.pageUrl) === source.sourceKey
      : comparable(location.href) === comparable(source.pageUrl);
  const selectMedia = (): HTMLMediaElement | null => {
    const digest = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const sourceFor = (element: HTMLMediaElement) => element.currentSrc ||
      element.getAttribute('src') || element.querySelector<HTMLSourceElement>('source[src]')?.src || '';
    const operableAudioVideo = (element: HTMLVideoElement) => {
      if (!element.paused && !element.ended) return true;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return element.controls && rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
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
    const videoExposed = (element: HTMLVideoElement, ownerDocument: Document = document, ownerWindow: Window = window) => {
      const rect = element.getBoundingClientRect(); const style = styleFor(ownerWindow, element);
      const left = Math.max(0, rect.left); const right = Math.min(ownerWindow.innerWidth, rect.right);
      const top = Math.max(0, rect.top); const bottom = Math.min(ownerWindow.innerHeight, rect.bottom);
      if (right <= left || bottom <= top || element.getClientRects().length === 0 ||
          style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) return false;
      return [
        [(left + right) / 2, (top + bottom) / 2],
        [left + (right - left) / 4, top + (bottom - top) / 4],
        [right - (right - left) / 4, bottom - (bottom - top) / 4],
      ].some(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(element));
    };
    if (source.kind === 'web-video') {
      const candidates: Array<{ media: HTMLVideoElement; path: string; origin: string }> = [];
      const topOrigin = new URL(location.href).origin;
      const collect = (ownerDocument: Document, ownerWindow: Window, path: string) => {
        for (const entry of ownerDocument.querySelectorAll('video')) {
          if (!sourceFor(entry) || entry.readyState < 1 ||
              entry.videoWidth <= 0 || entry.videoHeight <= 0 || !Number.isFinite(entry.duration) || entry.duration <= 0 ||
              !safeGenericSource(sourceFor(entry), ownerWindow) ||
              looksLikeAdvertisingVideo(entry) ||
              entry.mediaKeys || (entry as HTMLVideoElement & { webkitKeys?: unknown }).webkitKeys || entry.srcObject ||
              styleFor(ownerWindow, entry).transform !== 'none' || !videoExposed(entry, ownerDocument, ownerWindow) ||
              entry.getBoundingClientRect().left < -1 || entry.getBoundingClientRect().top < -1 ||
              entry.getBoundingClientRect().right > ownerWindow.innerWidth + 1 ||
              entry.getBoundingClientRect().bottom > ownerWindow.innerHeight + 1) continue;
          candidates.push({ media: entry, path, origin: ownerWindow.location.origin });
          if (candidates.length > 5) return;
        }
        const frames = [...ownerDocument.querySelectorAll('iframe, frame')];
        for (const [index, frame] of frames.entries()) {
          if (candidates.length > 5) return;
          try {
            const childWindow = (frame as HTMLIFrameElement).contentWindow; const childDocument = (frame as HTMLIFrameElement).contentDocument;
            if (!childWindow || !childDocument || childWindow.location.origin !== topOrigin) continue;
            const rect = (frame as HTMLElement).getBoundingClientRect(); const style = styleFor(ownerWindow, frame);
            const borders = [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth]
              .map((value) => Number.parseFloat(value) || 0);
            const frameExposed = [
              [rect.left + rect.width / 2, rect.top + rect.height / 2],
              [rect.left + rect.width / 4, rect.top + rect.height / 4],
              [rect.right - rect.width / 4, rect.bottom - rect.height / 4],
            ].every(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(frame));
            if (style.transform !== 'none' || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0 ||
                rect.left < -1 || rect.top < -1 || rect.right > ownerWindow.innerWidth + 1 || rect.bottom > ownerWindow.innerHeight + 1 ||
                Math.abs(rect.width - childWindow.innerWidth - borders[0]! - borders[1]!) > 1 ||
                Math.abs(rect.height - childWindow.innerHeight - borders[2]! - borders[3]!) > 1 || !frameExposed) continue;
            collect(childDocument, childWindow, path === 'top' ? `${index + 1}` : `${path}.${index + 1}`);
          } catch { /* Inaccessible frames fail closed. */ }
        }
      };
      collect(document, window, 'top');
      if (candidates.length > 5) return null;
      const pageKey = articleKey(location.href);
      const matches = candidates.filter(({ media, path, origin }, index) =>
        `web-video:${path}:${index + 1}:${digest(`${pageKey}|${origin}|${path}|video|${sourceFor(media)}|${Math.round(media.duration * 1_000)}|${media.videoWidth}x${media.videoHeight}`)}` === source.playerIdentity);
      return matches.length === 1 ? matches[0]!.media : null;
    }
    const candidates: HTMLMediaElement[] = [];
    for (const element of document.querySelectorAll('audio, video')) {
      if (!(element instanceof HTMLMediaElement) || !sourceFor(element)) continue;
      const accepted = source.kind === 'youtube' || source.kind === 'tiktok'
        ? element instanceof HTMLVideoElement && videoExposed(element)
        : element instanceof HTMLAudioElement || (
          element instanceof HTMLVideoElement && element.readyState >= 1 &&
          element.videoWidth === 0 && element.videoHeight === 0 && operableAudioVideo(element)
        );
      if (accepted) candidates.push(element);
      if (candidates.length > 5) break;
    }
    if (candidates.length > 5) return null;
    const matches = candidates.filter((element, index) => {
      const kind = element instanceof HTMLAudioElement ? 'audio'
        : source.kind === 'audio' ? 'audio-only-video' : 'video';
      return `${kind}:${index + 1}:${digest(`${kind}|${sourceFor(element)}`)}` === source.playerIdentity;
    });
    return matches.length === 1 ? matches[0]! : null;
  };
  const acknowledgedAtMs = Date.now();
  if (source.kind === 'spotify') {
    const spotifyEpisodeId = (value: string) => {
      try {
        const url = new URL(value);
        if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
        const match = url.pathname.match(
          /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
        );
        return match?.[1] ?? null;
      } catch { return null; }
    };
    const parseSpotifyClock = (value: string) => {
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
    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
    if (spotifyEpisodeId(location.href) !== source.sourceKey) {
      return { ok: false, acknowledgedAtMs, currentTimeMs: null, message: 'connected-source-changed' };
    }
    const readClock = () => ({
      position: parseSpotifyClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent)),
      duration: parseSpotifyClock(clean(document.querySelector('[data-testid="playback-duration"]')?.textContent)),
    });
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const startSeconds = startMs / 1_000;
    let now = readClock();
    if (now.position === null) {
      return { ok: false, acknowledgedAtMs, currentTimeMs: null, message: 'player-unavailable' };
    }
    if (Math.abs(now.position - startSeconds) > 2) {
      let attempted = false;
      const bar = document.querySelector('[data-testid="playback-progressbar"]');
      const input = (
        bar?.querySelector('input[type="range"]') ??
        document.querySelector('[data-testid="playback-progressbar"] input[type="range"]')
      );
      const assignRange = (node: HTMLInputElement, next: number) => {
        const value = String(next);
        const previous = node.value;
        try {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(node, value);
          else node.value = value;
        } catch {
          node.value = value;
        }
        const tracker = (node as HTMLInputElement & { _valueTracker?: { setValue?: (current: string) => void } })._valueTracker;
        if (tracker && typeof tracker.setValue === 'function') {
          try { tracker.setValue(previous); } catch { /* React 19 may omit the tracker. */ }
        }
        try {
          node.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: value,
          }));
        } catch {
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (input instanceof HTMLInputElement) {
        const lo = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
        const hi = Number(input.max);
        if (Number.isFinite(hi) && hi > lo) {
          const span = hi - lo;
          const currentRaw = Number(input.value);
          const targetMs = startSeconds * 1_000;
          const clockMs = now.position * 1_000;
          let raw: number;
          if (span <= 100.0001) {
            raw = now.duration !== null && now.duration > 0 ? lo + (startSeconds / now.duration) * span : lo;
          } else if (Number.isFinite(currentRaw) && span > 1_000) {
            const offset = clockMs - currentRaw;
            raw = Math.abs(offset) <= 2_500 ? targetMs : currentRaw + (targetMs - clockMs);
          } else if (span > 1_000) {
            raw = lo + startSeconds * 1_000;
          } else {
            raw = lo + startSeconds;
          }
          try {
            assignRange(input, Math.min(hi, Math.max(lo, raw)));
            attempted = true;
          } catch { /* Click / share-timestamp fallbacks below. */ }
        }
      }
      now = readClock();
      if (now.position === null || Math.abs(now.position - startSeconds) > 2) {
        const surface = (bar instanceof HTMLElement ? bar : null)
          ?? document.querySelector('[data-testid="progress-bar-background"]');
        const rect = surface instanceof HTMLElement ? surface.getBoundingClientRect() : null;
        const durationForClick = now.duration
          ?? (input instanceof HTMLInputElement && Number(input.max) > 1_000 ? Number(input.max) / 1_000 : null);
        if (surface instanceof HTMLElement && rect && rect.width >= 8 && durationForClick !== null && durationForClick > 0) {
          const ratio = startSeconds / durationForClick;
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
            attempted = true;
          } catch { /* Share-timestamp fallback below. */ }
        }
      }
      now = readClock();
      if (now.position === null || Math.abs(now.position - startSeconds) > 2) {
        try {
          const url = new URL(location.href);
          if (url.hostname.toLowerCase() === 'open.spotify.com') {
            const stamp = String(Math.round(startSeconds * 1_000));
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
      if (!attempted) {
        return {
          ok: false,
          acknowledgedAtMs: Date.now(),
          currentTimeMs: now.position === null ? null : Math.round(now.position * 1_000),
          message: now.position === null ? 'player-unavailable' : 'playback-failed',
        };
      }
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        now = readClock();
        if (now.position !== null && Math.abs(now.position - startSeconds) <= 2) break;
        await wait(50);
      }
    }
    now = readClock();
    if (now.position === null) {
      return { ok: false, acknowledgedAtMs: Date.now(), currentTimeMs: null, message: 'player-unavailable' };
    }
    if (Math.abs(now.position - startSeconds) > 2) {
      return { ok: false, acknowledgedAtMs: Date.now(), currentTimeMs: Math.round(now.position * 1_000), message: 'playback-failed' };
    }
    const playButton = document.querySelector<HTMLElement>('[data-testid="control-button-playpause"]');
    const playLabel = clean(playButton?.getAttribute('aria-label'));
    if (playButton && /play/i.test(playLabel) && !/pause/i.test(playLabel)) {
      try { playButton.click(); }
      catch { return { ok: false, acknowledgedAtMs: Date.now(), currentTimeMs: Math.round(now.position * 1_000), message: 'playback-failed' }; }
    }
    return { ok: true, acknowledgedAtMs: Date.now(), currentTimeMs: Math.round(now.position * 1_000) };
  }
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
  const articleKey = (value: string) => {
    try {
      const url = new URL(value); if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hostname = url.hostname.toLowerCase(); url.hash = '';
      const tracking = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']);
      for (const key of [...url.searchParams.keys()]) if (tracking.has(key.toLowerCase())) url.searchParams.delete(key);
      url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch { return null; }
  };
  const tiktokId = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'tiktok.com' && host !== 'm.tiktok.com') return null;
      const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
      return match?.[2] ?? null;
    } catch { return null; }
  };
  const sourceStillMatches = () => source.kind === 'youtube'
    ? youtubeId(location.href) === source.sourceKey
    : source.kind === 'tiktok'
      ? tiktokId(location.href) === source.sourceKey
    : source.kind === 'web-video'
      ? articleKey(location.href) === source.sourceKey && articleKey(source.pageUrl) === source.sourceKey
      : comparable(location.href) === comparable(source.pageUrl);
  type FrameMapping = NonNullable<CaptureGeometry['frameMapping']> & { offsetX: number; offsetY: number };
  const selectMedia = (): { media: HTMLMediaElement; mapping: FrameMapping | null } | null => {
    const digest = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const sourceFor = (element: HTMLMediaElement) => element.currentSrc ||
      element.getAttribute('src') || element.querySelector<HTMLSourceElement>('source[src]')?.src || '';
    const operableAudioVideo = (element: HTMLVideoElement) => {
      if (!element.paused && !element.ended) return true;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return element.controls && rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
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
    const videoExposed = (element: HTMLVideoElement, ownerDocument: Document = document, ownerWindow: Window = window) => {
      const rect = element.getBoundingClientRect(); const style = styleFor(ownerWindow, element);
      const left = Math.max(0, rect.left); const right = Math.min(ownerWindow.innerWidth, rect.right);
      const top = Math.max(0, rect.top); const bottom = Math.min(ownerWindow.innerHeight, rect.bottom);
      if (right <= left || bottom <= top || element.getClientRects().length === 0 ||
          style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) return false;
      return [
        [(left + right) / 2, (top + bottom) / 2],
        [left + (right - left) / 4, top + (bottom - top) / 4],
        [right - (right - left) / 4, bottom - (bottom - top) / 4],
      ].some(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(element));
    };
    if (source.kind === 'web-video') {
      const candidates: Array<{ media: HTMLVideoElement; mapping: FrameMapping }> = [];
      const topOrigin = new URL(location.href).origin;
      const collect = (ownerDocument: Document, ownerWindow: Window, mapping: FrameMapping) => {
        for (const entry of ownerDocument.querySelectorAll('video')) {
          if (!sourceFor(entry) || entry.readyState < 1 ||
              entry.videoWidth <= 0 || entry.videoHeight <= 0 || !Number.isFinite(entry.duration) || entry.duration <= 0 ||
              !safeGenericSource(sourceFor(entry), ownerWindow) ||
              looksLikeAdvertisingVideo(entry) ||
              entry.mediaKeys || (entry as HTMLVideoElement & { webkitKeys?: unknown }).webkitKeys || entry.srcObject ||
              styleFor(ownerWindow, entry).transform !== 'none' || !videoExposed(entry, ownerDocument, ownerWindow) ||
              entry.getBoundingClientRect().left < -1 || entry.getBoundingClientRect().top < -1 ||
              entry.getBoundingClientRect().right > ownerWindow.innerWidth + 1 ||
              entry.getBoundingClientRect().bottom > ownerWindow.innerHeight + 1) continue;
          candidates.push({ media: entry, mapping }); if (candidates.length > 5) return;
        }
        const frames = [...ownerDocument.querySelectorAll('iframe, frame')];
        for (const [index, frame] of frames.entries()) {
          if (candidates.length > 5) return;
          try {
            const childWindow = (frame as HTMLIFrameElement).contentWindow; const childDocument = (frame as HTMLIFrameElement).contentDocument;
            if (!childWindow || !childDocument || childWindow.location.origin !== topOrigin) continue;
            const rect = (frame as HTMLElement).getBoundingClientRect(); const style = styleFor(ownerWindow, frame);
            const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0; const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
            const borderTop = Number.parseFloat(style.borderTopWidth) || 0; const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
            const frameExposed = [
              [rect.left + rect.width / 2, rect.top + rect.height / 2],
              [rect.left + rect.width / 4, rect.top + rect.height / 4],
              [rect.right - rect.width / 4, rect.bottom - rect.height / 4],
            ].every(([x, y]) => ownerDocument.elementsFromPoint(x!, y!).includes(frame));
            if (style.transform !== 'none' || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0 ||
                rect.left < -1 || rect.top < -1 || rect.right > ownerWindow.innerWidth + 1 || rect.bottom > ownerWindow.innerHeight + 1 ||
                Math.abs(rect.width - childWindow.innerWidth - borderLeft - borderRight) > 1 ||
                Math.abs(rect.height - childWindow.innerHeight - borderTop - borderBottom) > 1 || !frameExposed) continue;
            collect(childDocument, childWindow, {
              path: mapping.path === 'top' ? `${index + 1}` : `${mapping.path}.${index + 1}`,
              origin: childWindow.location.origin, viewportWidth: childWindow.innerWidth, viewportHeight: childWindow.innerHeight,
              borderLeft, borderRight, borderTop, borderBottom,
              offsetX: mapping.offsetX + rect.left + borderLeft, offsetY: mapping.offsetY + rect.top + borderTop,
            });
          } catch { /* Inaccessible frames fail closed. */ }
        }
      };
      collect(document, window, { path: 'top', origin: topOrigin, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        borderLeft: 0, borderRight: 0, borderTop: 0, borderBottom: 0, offsetX: 0, offsetY: 0 });
      if (candidates.length > 5) return null;
      const pageKey = articleKey(location.href);
      const matches = candidates.filter(({ media, mapping }, index) =>
        `web-video:${mapping.path}:${index + 1}:${digest(`${pageKey}|${mapping.origin}|${mapping.path}|video|${sourceFor(media)}|${Math.round(media.duration * 1_000)}|${media.videoWidth}x${media.videoHeight}`)}` === source.playerIdentity);
      return matches.length === 1 ? matches[0]! : null;
    }
    const candidates: HTMLMediaElement[] = [];
    for (const element of document.querySelectorAll('audio, video')) {
      if (!(element instanceof HTMLMediaElement) || !sourceFor(element)) continue;
      const accepted = source.kind === 'youtube' || source.kind === 'tiktok'
        ? element instanceof HTMLVideoElement && videoExposed(element)
        : element instanceof HTMLAudioElement || (
          element instanceof HTMLVideoElement && element.readyState >= 1 &&
          element.videoWidth === 0 && element.videoHeight === 0 && operableAudioVideo(element)
        );
      if (accepted) candidates.push(element);
      if (candidates.length > 5) break;
    }
    if (candidates.length > 5) return null;
    const matches = candidates.filter((element, index) => {
      const kind = element instanceof HTMLAudioElement ? 'audio'
        : source.kind === 'audio' ? 'audio-only-video' : 'video';
      return `${kind}:${index + 1}:${digest(`${kind}|${sourceFor(element)}`)}` === source.playerIdentity;
    });
    return matches.length === 1 ? { media: matches[0]!, mapping: null } : null;
  };
  const geometryFor = (media: HTMLMediaElement, mapping: FrameMapping | null): CaptureGeometry => {
    const video = mapping ? media as HTMLVideoElement : media instanceof HTMLVideoElement ? media : null;
    const localRect = video?.getBoundingClientRect() ?? null;
    const rect = localRect && mapping ? { x: localRect.x + mapping.offsetX, y: localRect.y + mapping.offsetY,
      width: localRect.width, height: localRect.height, top: localRect.top + mapping.offsetY,
      right: localRect.right + mapping.offsetX, bottom: localRect.bottom + mapping.offsetY,
      left: localRect.left + mapping.offsetX } : localRect;
    const style = video ? (video.ownerDocument?.defaultView?.getComputedStyle(video) ?? getComputedStyle(video)) : null;
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
      frameMapping: mapping ? { path: mapping.path, origin: mapping.origin,
        viewportWidth: mapping.viewportWidth, viewportHeight: mapping.viewportHeight,
        borderLeft: mapping.borderLeft, borderRight: mapping.borderRight,
        borderTop: mapping.borderTop, borderBottom: mapping.borderBottom } : null,
    };
  };
  if (source.kind === 'spotify') {
    const spotifyEpisodeId = (value: string) => {
      try {
        const url = new URL(value);
        if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
        const match = url.pathname.match(
          /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
        );
        return match?.[1] ?? null;
      } catch { return null; }
    };
    const parseSpotifyClock = (value: string) => {
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
    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const matches = spotifyEpisodeId(location.href) === source.sourceKey;
    const position = parseSpotifyClock(clean(document.querySelector('[data-testid="playback-position"]')?.textContent));
    if (pausePlayer) {
      const playButton = document.querySelector<HTMLElement>('[data-testid="control-button-playpause"]');
      const playLabel = clean(playButton?.getAttribute('aria-label'));
      if (playButton && /pause/i.test(playLabel)) {
        try { playButton.click(); } catch { /* Best-effort pause. */ }
      }
    }
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    const rect = bar instanceof HTMLElement ? bar.getBoundingClientRect() : null;
    return {
      currentTimeMs: position === null ? null : Math.round(position * 1_000),
      sourceMatches: matches,
      geometry: {
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        boundingClientRect: rect ? {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
        } : null,
        videoWidth: null, videoHeight: null, objectFit: null, objectPosition: null,
        fullscreen: false, fullscreenElement: null,
        scrollX: window.scrollX, scrollY: window.scrollY, frameMapping: null,
      },
    };
  }
  if (!sourceStillMatches()) return { currentTimeMs: null, sourceMatches: false, geometry: null };
  const selected = selectMedia();
  if (!selected) return { currentTimeMs: null, sourceMatches: true, geometry: null };
  const { media, mapping } = selected;
  const currentTimeMs = Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 1_000) : null;
  if (pausePlayer) media.pause();
  return { currentTimeMs, sourceMatches: true, geometry: geometryFor(media, mapping) };
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
