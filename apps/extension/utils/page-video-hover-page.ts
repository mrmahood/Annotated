export const PAGE_VIDEO_HOVER_ROOT_ID = 'annotated-page-video-hover-root';

export type PageVideoHoverStrength = 'soft' | 'strong' | 'range';

export type PageVideoHoverPageRequest = {
  expectedNormalizedUrl: string;
  strength: PageVideoHoverStrength;
  startMs: number | null;
  endMs: number | null;
};

export type PageVideoHoverPageResult = {
  ok: boolean;
  reason?: 'cleared' | 'source-mismatch' | 'player-unavailable' | 'invalid-request';
};

const PAGE_VIDEO_HOVER_TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
]);

const PAGE_VIDEO_HOVER_PLAYBACK_PARAMETERS = new Set([
  't',
  'time',
  'timestamp',
  'start',
  'start_time',
  'seek',
  'position',
  'playback_position',
]);

function isPlaybackLocationValue(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(value) ||
    /^\d{1,3}:\d{2}(?::\d{2})?$/.test(value) ||
    /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(value);
}

export function normalizePageVideoHoverPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (
      ((host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
        url.pathname === '/watch') ||
      host === 'youtu.be' ||
      ((host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'm.tiktok.com') &&
        /\/@[^/]+\/video\/\d+/.test(url.pathname))
    ) {
      return null;
    }

    url.hostname = host;
    url.hash = '';
    for (const parameter of [...url.searchParams.keys()]) {
      const key = parameter.toLowerCase();
      const raw = url.searchParams.get(parameter) ?? '';
      if (
        key.startsWith('utm_') ||
        PAGE_VIDEO_HOVER_TRACKING_PARAMETERS.has(key) ||
        (PAGE_VIDEO_HOVER_PLAYBACK_PARAMETERS.has(key) && isPlaybackLocationValue(raw))
      ) {
        url.searchParams.delete(parameter);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.href;
  } catch {
    return null;
  }
}

export function pageVideoScrubberRangePercent(
  startMs: number,
  endMs: number,
  durationMs: number,
): { leftPercent: number; widthPercent: number } | null {
  if (
    !Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(durationMs) ||
    startMs < 0 || endMs <= startMs || durationMs <= 0
  ) {
    return null;
  }
  const leftPercent = Math.min(100, Math.max(0, (startMs / durationMs) * 100));
  const rawWidth = ((endMs - startMs) / durationMs) * 100;
  const widthPercent = Math.min(100 - leftPercent, Math.max(0.4, rawWidth));
  return { leftPercent, widthPercent };
}

// Serialized into the explicitly connected top-level tab. Keep every helper
// inside this function. Do not close over module state or imported bindings.
export function applyPageVideoHoverHighlightOnPage(
  request: PageVideoHoverPageRequest,
): PageVideoHoverPageResult {
  const rootId = 'annotated-page-video-hover-root';
  const removeRoot = () => {
    try {
      document.getElementById(rootId)?.remove();
    } catch {
      // Best-effort cleanup must not throw into the page.
    }
  };

  try {
    const trackingParameters = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'mc_cid',
      'mc_eid',
    ]);
    const playbackParameters = new Set([
      't',
      'time',
      'timestamp',
      'start',
      'start_time',
      'seek',
      'position',
      'playback_position',
    ]);
    const isPlaybackValue = (value: string) =>
      /^\d+(?:\.\d+)?(?:ms|s)?$/i.test(value) ||
      /^\d{1,3}:\d{2}(?::\d{2})?$/.test(value) ||
      /^(?:\d+h)?(?:\d+m)?(?:\d+s)$/i.test(value);

    const normalizePageUrl = (value: string): string | null => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        if (
          ((host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
            url.pathname === '/watch') ||
          host === 'youtu.be' ||
          ((host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'm.tiktok.com') &&
            /\/@[^/]+\/video\/\d+/.test(url.pathname))
        ) {
          return null;
        }
        url.hostname = host;
        url.hash = '';
        for (const parameter of [...url.searchParams.keys()]) {
          const key = parameter.toLowerCase();
          const raw = url.searchParams.get(parameter) ?? '';
          if (
            key.startsWith('utm_') ||
            trackingParameters.has(key) ||
            (playbackParameters.has(key) && isPlaybackValue(raw))
          ) {
            url.searchParams.delete(parameter);
          }
        }
        url.searchParams.sort();
        if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href;
      } catch {
        return null;
      }
    };

    if (
      !request ||
      typeof request.expectedNormalizedUrl !== 'string' ||
      !request.expectedNormalizedUrl.trim() ||
      (request.strength !== 'soft' && request.strength !== 'strong' && request.strength !== 'range')
    ) {
      removeRoot();
      return { ok: false, reason: 'invalid-request' };
    }

    if (normalizePageUrl(location.href) !== request.expectedNormalizedUrl) {
      removeRoot();
      return { ok: false, reason: 'source-mismatch' };
    }

    const isLaidOut = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0 ||
        element.getClientRects().length === 0
      ) return false;
      return rect.width > 8 && rect.height > 8;
    };

    // Viewport intersection only. Do not use this to reject a laid-out player
    // or to gate scroll — below-fold chrome must still paint and scroll-to.
    const visibleArea = (element: Element) => {
      if (!isLaidOut(element)) return 0;
      const rect = element.getBoundingClientRect();
      const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      return width > 8 && height > 8 ? width * height : 0;
    };

    const inFlowPosition = (element: Element) => {
      const position = getComputedStyle(element).position;
      return position !== 'fixed' && position !== 'sticky';
    };

    const tokenBlob = (element: Element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      return [
        element.id,
        className,
        element.getAttribute('aria-label'),
        element.getAttribute('aria-labelledby'),
        element.getAttribute('role'),
        element.getAttribute('data-testid'),
        element.getAttribute('title'),
        element.getAttribute('name'),
      ].filter(Boolean).join(' ');
    };

    const looksLikeVideoPlayerName = (value: string) =>
      /\b(?:video|watch|clip)[-_]?(?:player|wrap(?:per)?|container|box|frame|embed)?\b|\b(?:media[-_]?player|player[-_]?(?:chrome|controls|wrapper|container|box)|hero[-_]?video|featured[-_]?video)\b/i
        .test(value);

    const looksLikeAudioOnlyName = (value: string) =>
      /\b(?:audio|podcast|episode|listen)[-_]?(?:player|bar|dock|controls|chrome)?\b|\b(?:now[-_]?playing)\b/i
        .test(value) && !/\bvideo\b/i.test(value);

    const looksLikeAdvertising = (value: string) =>
      /(?:^|[\s_-])(?:ad|ads|advert|advertisement|advertising|preroll|midroll|postroll|sponsored|vast|vpaid)(?:$|[\s_-])/i
        .test(value);

    const isPlayControl = (element: Element) => {
      const label = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.textContent,
      ].filter(Boolean).join(' ');
      return /(?:^|\b)(?:play|pause|watch)(?:\b|$)/i.test(label);
    };

    const isScrubber = (element: Element) => {
      if (element instanceof HTMLInputElement && element.type === 'range') return true;
      if (element instanceof HTMLProgressElement) return true;
      if (element.getAttribute('role') === 'slider') return true;
      const blob = tokenBlob(element);
      return /\b(?:progress|scrubber|seek(?:bar)?|timeline|track[-_]?bar|playback[-_]?bar)\b/i.test(blob) &&
        element.getBoundingClientRect().width > 24;
    };

    const scrubberVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0 ||
        element.getClientRects().length === 0
      ) return false;
      return rect.width > 16 && rect.height > 2;
    };

    const findScrubber = (root: Element): HTMLElement | null => {
      const selectors = [
        'input[type="range"]',
        '[role="slider"]',
        'progress',
      ];
      for (const selector of selectors) {
        for (const candidate of root.querySelectorAll(selector)) {
          if (candidate instanceof HTMLElement && scrubberVisible(candidate)) return candidate;
        }
      }
      for (const candidate of root.querySelectorAll('[class], [id]')) {
        if (!(candidate instanceof HTMLElement) || !isScrubber(candidate)) continue;
        if (scrubberVisible(candidate) && candidate.getBoundingClientRect().width > 24) {
          return candidate;
        }
      }
      return null;
    };

    const videoSized = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 90) return false;
      const ratio = rect.width / rect.height;
      return ratio >= 0.4 && ratio <= 2.6;
    };

    const playerChrome = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 90) return false;
      if (rect.width > window.innerWidth * 0.99 && rect.height > window.innerHeight * 0.92) {
        return false;
      }
      return true;
    };

    const isVisualVideo = (media: HTMLVideoElement) => {
      if (media.readyState >= 1 && media.videoWidth === 0 && media.videoHeight === 0) return false;
      if (media.videoWidth === 0 && media.videoHeight === 0 && media.paused) return videoSized(media);
      return media.videoWidth > 0 || videoSized(media);
    };

    const surfaceFromMedia = (media: HTMLVideoElement): HTMLElement | null => {
      const selfVisible = isLaidOut(media) && videoSized(media);
      let node: HTMLElement | null = media.parentElement;
      let best: HTMLElement | null = selfVisible ? media : null;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if (!isLaidOut(node) || !playerChrome(node)) continue;
        const blob = tokenBlob(node);
        if (looksLikeAdvertising(blob) || looksLikeAudioOnlyName(blob)) continue;
        const named = looksLikeVideoPlayerName(blob);
        const hasScrubber = Boolean(findScrubber(node));
        const hasPlay = [...node.querySelectorAll('button, [role="button"]')].some(isPlayControl);
        if (named || hasScrubber || hasPlay || (best === null && playerChrome(node))) {
          best = node;
          if (named && (hasScrubber || hasPlay || videoSized(node))) break;
        }
      }
      return best;
    };

    const mediaDurationMs = (media: HTMLMediaElement | null) => {
      if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;
      return media.duration * 1_000;
    };

    const sliderDurationMs = (scrubber: HTMLElement | null) => {
      if (!scrubber) return null;
      const rawMax = scrubber.getAttribute('aria-valuemax') ??
        (scrubber instanceof HTMLInputElement ? scrubber.max : null) ??
        (scrubber instanceof HTMLProgressElement ? String(scrubber.max) : null);
      if (rawMax == null || rawMax === '') return null;
      const value = Number(rawMax);
      if (!Number.isFinite(value) || value <= 0) return null;
      if (value >= 10 && value <= 7_200) return value * 1_000;
      if (value >= 10_000 && value <= 7_200_000) return value;
      return null;
    };

    type Candidate = {
      surface: HTMLElement;
      media: HTMLVideoElement | null;
      score: number;
    };

    const candidates: Candidate[] = [];
    const seen = new Set<HTMLElement>();
    const addCandidate = (surface: HTMLElement, media: HTMLVideoElement | null, extra = 0) => {
      if (seen.has(surface) || looksLikeAdvertising(tokenBlob(surface))) return;
      if (looksLikeAudioOnlyName(tokenBlob(surface))) return;
      if (!isLaidOut(surface)) return;
      seen.add(surface);
      const blob = tokenBlob(surface);
      const named = looksLikeVideoPlayerName(blob);
      const scrubber = findScrubber(surface);
      const hasPlay = [...surface.querySelectorAll('button, [role="button"]')].some(isPlayControl);
      const playing = Boolean(media && !media.paused && !media.ended);
      const rect = surface.getBoundingClientRect();
      let score = extra;
      if (playing) score += 100;
      if (media) score += 50;
      if (scrubber) score += 30;
      if (hasPlay) score += 20;
      if (named) score += 25;
      if (videoSized(surface)) score += 20;
      if (visibleArea(surface) > 0) score += 8;
      if (inFlowPosition(surface)) score += 12;
      if (rect.width * rect.height > 80_000) score += 10;
      if (!playerChrome(surface) && !playing) score -= 40;
      candidates.push({ surface, media, score });
    };

    for (const entry of document.querySelectorAll('video')) {
      if (!(entry instanceof HTMLVideoElement) || !isVisualVideo(entry)) continue;
      const surface = surfaceFromMedia(entry);
      if (surface) addCandidate(surface, entry, 10);
    }

    for (const named of document.querySelectorAll('[aria-label], [role="region"], [role="group"], [id], [class]')) {
      if (!(named instanceof HTMLElement) || seen.has(named)) continue;
      const blob = tokenBlob(named);
      if (!looksLikeVideoPlayerName(blob) || looksLikeAdvertising(blob) || looksLikeAudioOnlyName(blob)) {
        continue;
      }
      if (!isLaidOut(named) || !playerChrome(named)) continue;
      const nestedVideo = named.querySelector('video');
      addCandidate(
        named,
        nestedVideo instanceof HTMLVideoElement && isVisualVideo(nestedVideo) ? nestedVideo : null,
        5,
      );
    }

    for (const frame of document.querySelectorAll('iframe')) {
      if (!(frame instanceof HTMLIFrameElement) || !isLaidOut(frame) || !videoSized(frame)) continue;
      const allow = frame.getAttribute('allow') ?? '';
      const blob = [
        tokenBlob(frame),
        allow,
      ].join(' ');
      if (looksLikeAdvertising(blob) || looksLikeAudioOnlyName(blob)) continue;
      const named = looksLikeVideoPlayerName(blob) ||
        /autoplay|encrypted-media|picture-in-picture/i.test(allow);
      if (!named && !playerChrome(frame)) continue;
      let surface: HTMLElement = frame;
      const parent = frame.parentElement;
      if (parent && isLaidOut(parent) && playerChrome(parent) && !looksLikeAdvertising(tokenBlob(parent))) {
        surface = parent;
      }
      addCandidate(surface, null, named ? 15 : 5);
    }

    let best: Candidate | null = null;
    for (const candidate of candidates) {
      if (candidate.score < 40) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }

    if (!best) {
      removeRoot();
      return { ok: false, reason: 'player-unavailable' };
    }

    const player = best.surface;
    const media = best.media;
    const rangeStyle = (startMs: number, endMs: number, durationMs: number) => {
      if (
        !Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(durationMs) ||
        startMs < 0 || endMs <= startMs || durationMs <= 0
      ) return null;
      const leftPercent = Math.min(100, Math.max(0, (startMs / durationMs) * 100));
      const rawWidth = ((endMs - startMs) / durationMs) * 100;
      return {
        leftPercent,
        widthPercent: Math.min(100 - leftPercent, Math.max(0.4, rawWidth)),
      };
    };

    const rangeOnly = request.strength === 'range';
    const strong = request.strength === 'strong';
    const dimOpacity = strong ? 0.12 : 0.09;
    const ringWidth = strong ? 3 : 2;
    const ringColor = strong ? 'rgba(236, 241, 246, 0.92)' : 'rgba(154, 167, 181, 0.78)';

    let root = document.getElementById(rootId);
    const hadRoot = root instanceof HTMLElement;
    if (!(root instanceof HTMLElement)) {
      root = document.createElement('div');
      root.id = rootId;
      root.setAttribute('data-annotated-hover', '1');
      root.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(root);
    }
    root.dataset.strength = request.strength;

    const layer = (selector: string, attribute: string): HTMLElement => {
      const existing = root.querySelector(selector);
      if (existing instanceof HTMLElement) return existing;
      const created = document.createElement('div');
      created.setAttribute(attribute, '1');
      root.appendChild(created);
      return created;
    };
    const dim = layer('[data-annotated-hover-dim="1"]', 'data-annotated-hover-dim');
    const ring = layer('[data-annotated-hover-ring="1"]', 'data-annotated-hover-ring');
    const range = layer('[data-annotated-hover-range="1"]', 'data-annotated-hover-range');
    // Duplicated in every serialized injector. Keep aligned with hover-overlay-paint.ts.
    const writeCss = (element: HTMLElement & { __annotatedHoverCss?: string }, next: string) => {
      if (element.__annotatedHoverCss === next) return;
      element.__annotatedHoverCss = next;
      element.style.cssText = next;
    };
    writeCss(root, 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;');

    const position = () => {
      const rect = player.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (rangeOnly) {
        writeCss(dim, 'display:none');
        writeCss(ring, 'display:none');
      } else {
        writeCss(dim, [
          'position:fixed',
          'inset:0',
          `background:rgba(0,0,0,${dimOpacity})`,
          `clip-path:polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`,
        ].join(';'));
        writeCss(ring, [
          'position:fixed',
          `top:${rect.top}px`,
          `left:${rect.left}px`,
          `width:${Math.max(0, rect.width)}px`,
          `height:${Math.max(0, rect.height)}px`,
          `box-shadow:0 0 0 ${ringWidth}px ${ringColor}`,
          'border-radius:2px',
        ].join(';'));
      }

      const bar = findScrubber(player);
      const durationMs = mediaDurationMs(media) ?? sliderDurationMs(bar);
      const cue = durationMs !== null &&
        typeof request.startMs === 'number' &&
        typeof request.endMs === 'number'
        ? rangeStyle(request.startMs, request.endMs, durationMs)
        : null;
      const barVisible = bar instanceof HTMLElement &&
        bar.getClientRects().length > 0 &&
        bar.getBoundingClientRect().width > 16;
      if (barVisible && cue) {
        const barRect = bar.getBoundingClientRect();
        writeCss(range, [
          'position:fixed',
          `top:${barRect.top}px`,
          `left:${barRect.left + (barRect.width * cue.leftPercent) / 100}px`,
          `width:${(barRect.width * cue.widthPercent) / 100}px`,
          `height:${Math.max(3, barRect.height)}px`,
          'background:rgba(154,167,181,0.72)',
          'border-radius:999px',
        ].join(';'));
        range.hidden = false;
      } else {
        writeCss(range, 'display:none');
        range.hidden = true;
      }
    };

    position();
    const previous = (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof previous === 'function') previous();
    let raf = 0;
    const onChange = () => {
      if (raf) return;
      const requestFrame = window.requestAnimationFrame;
      if (typeof requestFrame === 'function') {
        raf = requestFrame(() => {
          raf = 0;
          try { position(); } catch { /* Reposition is best-effort. */ }
        });
      } else {
        try { position(); } catch { /* Reposition is best-effort. */ }
      }
    };
    window.addEventListener('scroll', onChange, { capture: true, passive: true });
    window.addEventListener('resize', onChange, { passive: true });
    (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup = () => {
      window.removeEventListener('scroll', onChange, { capture: true });
      window.removeEventListener('resize', onChange);
      const cancel = window.cancelAnimationFrame;
      if (raf && typeof cancel === 'function') cancel(raf);
      raf = 0;
    };

    try {
      if (!hadRoot) {
        const scrollOptions: ScrollIntoViewOptions = {
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        };
        const bar = findScrubber(player);
        const scrollableChrome = (start: HTMLElement | null): HTMLElement | null => {
          let node: HTMLElement | null = start;
          for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
            if (!isLaidOut(node) || !inFlowPosition(node)) continue;
            return node;
          }
          return start instanceof HTMLElement && isLaidOut(start) ? start : null;
        };
        const chromeTarget = (bar instanceof HTMLElement && scrubberVisible(bar)
          ? scrollableChrome(bar)
          : null) ??
          scrollableChrome(player) ??
          (isLaidOut(player) ? player : null);
        if (chromeTarget && typeof chromeTarget.scrollIntoView === 'function') {
          chromeTarget.scrollIntoView(scrollOptions);
        }
        if (ring && typeof ring.scrollIntoView === 'function') {
          ring.scrollIntoView(scrollOptions);
        }
      }
    } catch {
      // Scroll is best-effort after a successful paint. Leave debounce must
      // not cancel this attempt — apply already succeeded.
    }

    return { ok: true };
  } catch {
    removeRoot();
    return { ok: false, reason: 'player-unavailable' };
  }
}

// Serialized into the explicitly connected top-level tab. Self-contained.
export function clearPageVideoHoverHighlightOnPage(): PageVideoHoverPageResult {
  try {
    const root = document.getElementById('annotated-page-video-hover-root');
    const cleanup = root &&
      (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof cleanup === 'function') cleanup();
    root?.remove();
    return { ok: true, reason: 'cleared' };
  } catch {
    return { ok: false };
  }
}
