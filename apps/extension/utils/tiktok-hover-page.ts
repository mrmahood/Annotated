export const TIKTOK_HOVER_ROOT_ID = 'annotated-tt-hover-root';

export type TikTokHoverStrength = 'soft' | 'strong';

export type TikTokHoverPageRequest = {
  expectedVideoId: string;
  strength: TikTokHoverStrength;
  startMs: number | null;
  endMs: number | null;
};

export type TikTokHoverPageResult = {
  ok: boolean;
  reason?: 'cleared' | 'source-mismatch' | 'player-unavailable' | 'invalid-request';
};

export function tiktokWatchVideoIdFromHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'tiktok.com' && host !== 'www.tiktok.com' && host !== 'm.tiktok.com') {
      return null;
    }
    const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
    return match?.[2] ?? null;
  } catch {
    return null;
  }
}

// Serialized into the explicitly connected top-level tab. Keep every helper
// inside this function. Do not close over module state or imported bindings.
export function applyTikTokHoverHighlightOnPage(
  request: TikTokHoverPageRequest,
): TikTokHoverPageResult {
  const rootId = 'annotated-tt-hover-root';
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
        if (host !== 'tiktok.com' && host !== 'www.tiktok.com' && host !== 'm.tiktok.com') {
          return null;
        }
        const match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{10,25})\/?$/i);
        return match?.[2] ?? null;
      } catch {
        return null;
      }
    };

    if (
      !request ||
      typeof request.expectedVideoId !== 'string' ||
      !/^\d{10,25}$/.test(request.expectedVideoId) ||
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
        '[data-e2e="browse-video"]',
        '[data-e2e="video-player"]',
        '#main-content-video_detail',
        '.xgplayer',
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
        const wrapper = video.closest('[data-e2e="browse-video"], [data-e2e="video-player"], .xgplayer, article, section');
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

    try {
      player.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      try { player.scrollIntoView(true); } catch { /* Scroll is best-effort. */ }
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

    const strong = request.strength === 'strong';
    const dimOpacity = strong ? 0.12 : 0.09;
    const ringWidth = strong ? 3 : 2;
    const ringColor = strong ? 'rgba(236, 241, 246, 0.92)' : 'rgba(154, 167, 181, 0.78)';

    let root = document.getElementById(rootId);
    if (!(root instanceof HTMLElement)) {
      root = document.createElement('div');
      root.id = rootId;
      root.setAttribute('data-annotated-hover', '1');
      root.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(root);
    }
    root.dataset.strength = request.strength;
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

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

    const position = () => {
      const rect = player.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      dim.style.cssText = [
        'position:fixed',
        'inset:0',
        `background:rgba(0,0,0,${dimOpacity})`,
        `clip-path:polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`,
      ].join(';');
      ring.style.cssText = [
        'position:fixed',
        `top:${rect.top}px`,
        `left:${rect.left}px`,
        `width:${Math.max(0, rect.width)}px`,
        `height:${Math.max(0, rect.height)}px`,
        `box-shadow:0 0 0 ${ringWidth}px ${ringColor}`,
        'border-radius:2px',
      ].join(';');

      const bar = player.querySelector('[class*="progress"], [class*="Progress"], [role="slider"]');
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
        range.style.cssText = [
          'position:fixed',
          `top:${barRect.top}px`,
          `left:${barRect.left + (barRect.width * cue.leftPercent) / 100}px`,
          `width:${(barRect.width * cue.widthPercent) / 100}px`,
          `height:${Math.max(3, barRect.height)}px`,
          'background:rgba(154,167,181,0.72)',
          'border-radius:999px',
        ].join(';');
        range.hidden = false;
      } else {
        range.style.cssText = 'display:none';
        range.hidden = true;
      }
    };

    position();
    const previous = (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof previous === 'function') previous();
    const onChange = () => {
      try { position(); } catch { /* Reposition is best-effort. */ }
    };
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup = () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };

    // Soft and strong hover must not seek or play the opaque TikTok player.
    return { ok: true };
  } catch {
    removeRoot();
    return { ok: false, reason: 'player-unavailable' };
  }
}

// Serialized into the explicitly connected top-level tab. Self-contained.
export function clearTikTokHoverHighlightOnPage(): TikTokHoverPageResult {
  try {
    const root = document.getElementById('annotated-tt-hover-root');
    const cleanup = root && (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof cleanup === 'function') cleanup();
    root?.remove();
    return { ok: true, reason: 'cleared' };
  } catch {
    return { ok: false };
  }
}
