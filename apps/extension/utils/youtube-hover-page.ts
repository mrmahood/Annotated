export const YOUTUBE_HOVER_ROOT_ID = 'annotated-yt-hover-root';

export type YouTubeHoverStrength = 'soft' | 'strong';

export type YouTubeHoverPageRequest = {
  expectedVideoId: string;
  strength: YouTubeHoverStrength;
  startMs: number | null;
  endMs: number | null;
  seekMs: number | null;
};

export type YouTubeHoverPageResult = {
  ok: boolean;
  reason?: 'cleared' | 'source-mismatch' | 'player-unavailable' | 'invalid-request';
};

export function scrubberRangePercent(
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
export function applyYouTubeHoverHighlightOnPage(
  request: YouTubeHoverPageRequest,
): YouTubeHoverPageResult {
  const rootId = 'annotated-yt-hover-root';
  const removeRoot = () => {
    try {
      document.getElementById(rootId)?.remove();
    } catch {
      // Best-effort cleanup must not throw into the page.
    }
  };

  try {
    const watchVideoId = (value: string) => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        if (
          (host !== 'youtube.com' && host !== 'www.youtube.com' && host !== 'm.youtube.com') ||
          url.pathname !== '/watch'
        ) return null;
        const videoId = url.searchParams.get('v');
        return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
      } catch {
        return null;
      }
    };

    if (
      !request ||
      typeof request.expectedVideoId !== 'string' ||
      !/^[A-Za-z0-9_-]{11}$/.test(request.expectedVideoId) ||
      (request.strength !== 'soft' && request.strength !== 'strong')
    ) {
      removeRoot();
      return { ok: false, reason: 'invalid-request' };
    }

    if (watchVideoId(location.href) !== request.expectedVideoId) {
      removeRoot();
      return { ok: false, reason: 'source-mismatch' };
    }

    const visibleArea = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0 ||
        element.getClientRects().length === 0
      ) return 0;
      const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      return width > 32 && height > 32 ? width * height : 0;
    };

    const findPlayer = (): HTMLElement | null => {
      const named = [
        '#movie_player',
        'ytd-player#ytd-player',
        'ytd-player',
        '#player-container-inner',
        '#player-container',
        '#player',
      ];
      for (const selector of named) {
        const candidate = document.querySelector(selector);
        if (candidate instanceof HTMLElement && visibleArea(candidate) > 0) return candidate;
      }
      let best: HTMLElement | null = null;
      let bestArea = 0;
      for (const video of document.querySelectorAll('video')) {
        if (!(video instanceof HTMLVideoElement)) continue;
        const area = visibleArea(video);
        if (area <= bestArea) continue;
        const wrapper = video.closest('#movie_player, ytd-player, #player, #player-container');
        best = wrapper instanceof HTMLElement
          ? wrapper
          : video.parentElement instanceof HTMLElement
            ? video.parentElement
            : video;
        bestArea = area;
      }
      return best;
    };

    const player = findPlayer();
    if (!player) {
      removeRoot();
      return { ok: false, reason: 'player-unavailable' };
    }

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

    // Same inset amber grammar as TikTok Feed hover. Keep these tokens
    // duplicated here: this function is serialized into the tab and must
    // stay self-contained.
    const strong = request.strength === 'strong';
    const dimOpacity = strong ? 0.14 : 0.1;
    const ringWidth = strong ? 4 : 3;
    const ringInset = strong ? 6 : 5;
    const ringColor = strong ? 'rgba(255, 196, 56, 0.96)' : 'rgba(255, 184, 40, 0.92)';
    const ringContrast = 'rgba(20, 16, 8, 0.72)';

    let root = document.getElementById(rootId);
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
      writeCss(dim, [
        'position:fixed',
        'inset:0',
        `background:rgba(0,0,0,${dimOpacity})`,
        `clip-path:polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`,
      ].join(';'));
      const insetX = Math.min(ringInset, Math.max(0, (rect.width - 24) / 2));
      const insetY = Math.min(ringInset, Math.max(0, (rect.height - 24) / 2));
      writeCss(ring, [
        'position:fixed',
        `top:${rect.top + insetY}px`,
        `left:${rect.left + insetX}px`,
        `width:${Math.max(0, rect.width - insetX * 2)}px`,
        `height:${Math.max(0, rect.height - insetY * 2)}px`,
        `box-shadow:0 0 0 ${ringWidth}px ${ringColor},0 0 0 ${ringWidth + 2}px ${ringContrast}`,
        'border-radius:4px',
      ].join(';'));

      const bar = player.querySelector('.ytp-progress-bar, .ytp-progress-bar-container, .ytp-chrome-bottom');
      const video = player.querySelector('video') ?? document.querySelector('video');
      const durationMs = video instanceof HTMLVideoElement && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1_000
        : null;
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

    if (
      request.strength !== 'soft' &&
      typeof request.seekMs === 'number' &&
      Number.isFinite(request.seekMs) &&
      request.seekMs >= 0
    ) {
      const video = player.querySelector('video') ?? document.querySelector('video');
      if (video instanceof HTMLVideoElement) {
        const nextSeconds = request.seekMs / 1_000;
        const currentSeconds = video.currentTime;
        const nearSeconds = 1;
        const alreadyNear = Number.isFinite(currentSeconds) &&
          Math.abs(currentSeconds - nextSeconds) <= nearSeconds;
        const startSeconds = typeof request.startMs === 'number' && Number.isFinite(request.startMs)
          ? request.startMs / 1_000
          : null;
        const endSeconds = typeof request.endMs === 'number' && Number.isFinite(request.endMs)
          ? request.endMs / 1_000
          : null;
        const alreadyInRange = startSeconds !== null &&
          endSeconds !== null &&
          endSeconds > startSeconds &&
          Number.isFinite(currentSeconds) &&
          currentSeconds >= startSeconds &&
          currentSeconds <= endSeconds;
        const now = Date.now();
        const lastSeekMs = Number(root.dataset.annotatedSeekMs);
        const lastSeekAt = Number(root.dataset.annotatedSeekAt);
        const sameSeekRecent = lastSeekMs === request.seekMs &&
          Number.isFinite(lastSeekAt) &&
          now - lastSeekAt < 250;
        // Hover re-enters must not replay from seekMs. Never call play().
        if (
          !alreadyNear &&
          !alreadyInRange &&
          !sameSeekRecent &&
          (!Number.isFinite(video.duration) || nextSeconds <= video.duration + 0.25)
        ) {
          try {
            video.currentTime = nextSeconds;
            root.dataset.annotatedSeekMs = String(request.seekMs);
            root.dataset.annotatedSeekAt = String(now);
          } catch { /* Seek is optional. */ }
        }
      }
    }

    return { ok: true };
  } catch {
    removeRoot();
    return { ok: false, reason: 'player-unavailable' };
  }
}

// Serialized into the explicitly connected top-level tab. Self-contained.
export function clearYouTubeHoverHighlightOnPage(): YouTubeHoverPageResult {
  try {
    const root = document.getElementById('annotated-yt-hover-root');
    const cleanup = root && (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof cleanup === 'function') cleanup();
    root?.remove();
    return { ok: true, reason: 'cleared' };
  } catch {
    return { ok: false };
  }
}
