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

    const isLaidOut = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0 ||
        element.getClientRects().length === 0
      ) return false;
      return rect.width > 32 && rect.height > 32;
    };

    const visibleArea = (element: Element) => {
      if (!isLaidOut(element)) return 0;
      const rect = element.getBoundingClientRect();
      const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      return width > 32 && height > 32 ? width * height : 0;
    };

    const tokenBlob = (element: Element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      return [
        element.id,
        className,
        element.getAttribute('data-e2e'),
        element.getAttribute('aria-label'),
      ].filter(Boolean).join(' ');
    };

    const isNavOrUnrelatedChrome = (element: Element) => {
      const blob = tokenBlob(element);
      if (
        /(?:^|[\s_-])(?:nav-side|side-nav|sidebar|header-container|bottom-bar|recommend|you-may-like|search-card)(?:$|[\s_-])/i
          .test(blob)
      ) return true;
      const e2e = element.getAttribute('data-e2e') ?? '';
      if (/^(?:recommend|search-card|nav|bottom-nav)/i.test(e2e)) return true;
      const rect = element.getBoundingClientRect();
      return rect.left < 24 &&
        rect.width > 0 &&
        rect.width <= 140 &&
        rect.height >= window.innerHeight * 0.65;
    };

    const isPageShell = (element: Element) => {
      if (element.id === 'main-content-video_detail' || element.id === 'app') return true;
      const e2e = element.getAttribute('data-e2e') ?? '';
      const rect = element.getBoundingClientRect();
      const viewportShell = rect.width >= window.innerWidth * 0.86 &&
        rect.height >= window.innerHeight * 0.78;
      if (e2e === 'browse-video' && (
        viewportShell ||
        (rect.height >= window.innerHeight * 0.75 && rect.width >= window.innerWidth * 0.4)
      )) return true;
      const video = element.querySelector('video');
      if (video instanceof HTMLVideoElement && isLaidOut(video)) {
        const videoRect = video.getBoundingClientRect();
        const videoArea = Math.max(1, videoRect.width * videoRect.height);
        const elementArea = Math.max(1, rect.width * rect.height);
        if (elementArea / videoArea > 1.55) return true;
      }
      const namedPlayer = e2e === 'video-player' || /\bxgplayer\b/i.test(tokenBlob(element));
      return viewportShell && !namedPlayer;
    };

    const isPlayerSized = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 160) return false;
      const ratio = rect.width / rect.height;
      return ratio >= 0.35 && ratio <= 2.4;
    };

    const looksNamedPlayer = (element: Element) => {
      const e2e = element.getAttribute('data-e2e') ?? '';
      if (e2e === 'video-player') return true;
      return /\bxgplayer\b|DivVideoPlayer|VideoPlayer/i.test(tokenBlob(element));
    };

    const surfaceFromVideo = (video: HTMLVideoElement): HTMLElement => {
      const named = video.closest('[data-e2e="video-player"], .xgplayer');
      if (
        named instanceof HTMLElement &&
        isLaidOut(named) &&
        !isNavOrUnrelatedChrome(named) &&
        !isPageShell(named)
      ) {
        return named;
      }
      let best: HTMLElement = video;
      let node = video.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if (!isLaidOut(node) || isNavOrUnrelatedChrome(node) || isPageShell(node)) break;
        if (!isPlayerSized(node)) continue;
        const videoRect = video.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const videoArea = Math.max(1, videoRect.width * videoRect.height);
        const nodeArea = Math.max(1, nodeRect.width * nodeRect.height);
        if (nodeArea / videoArea > 1.7) continue;
        best = node;
        if (looksNamedPlayer(node)) break;
      }
      return best;
    };

    const findPlayer = (): HTMLElement | null => {
      let bestVideo: HTMLVideoElement | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const entry of document.querySelectorAll('video')) {
        if (!(entry instanceof HTMLVideoElement) || !isLaidOut(entry)) continue;
        let ancestor: HTMLElement | null = entry.parentElement;
        let unrelated = isNavOrUnrelatedChrome(entry);
        for (let depth = 0; ancestor && depth < 10 && !unrelated; depth += 1, ancestor = ancestor.parentElement) {
          if (isNavOrUnrelatedChrome(ancestor)) unrelated = true;
        }
        if (unrelated) continue;
        const rect = entry.getBoundingClientRect();
        if (rect.width < 140 || rect.height < 160) continue;
        const visible = visibleArea(entry);
        const area = rect.width * rect.height;
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const centerBias = Math.hypot(cx - window.innerWidth / 2, cy - window.innerHeight / 2);
        const score = (visible > 0 ? visible : area * 0.35) - centerBias * 40;
        if (score <= bestScore) continue;
        bestVideo = entry;
        bestScore = score;
      }
      if (bestVideo) return surfaceFromVideo(bestVideo);

      const namedPlayers = [
        '[data-e2e="video-player"]',
        '.xgplayer',
      ];
      for (const selector of namedPlayers) {
        for (const candidate of document.querySelectorAll(selector)) {
          if (!(candidate instanceof HTMLElement) || !isLaidOut(candidate)) continue;
          if (isNavOrUnrelatedChrome(candidate) || isPageShell(candidate)) continue;
          if (isPlayerSized(candidate) || looksNamedPlayer(candidate)) return candidate;
        }
      }

      const shells = [
        '[data-e2e="browse-video"]',
        '#main-content-video_detail',
      ];
      for (const selector of shells) {
        for (const candidate of document.querySelectorAll(selector)) {
          if (!(candidate instanceof HTMLElement) || !isLaidOut(candidate)) continue;
          const nested = candidate.querySelector('video, [data-e2e="video-player"], .xgplayer');
          if (nested instanceof HTMLVideoElement && isLaidOut(nested)) {
            return surfaceFromVideo(nested);
          }
          if (
            nested instanceof HTMLElement &&
            isLaidOut(nested) &&
            !isPageShell(nested) &&
            (isPlayerSized(nested) || looksNamedPlayer(nested))
          ) {
            return nested;
          }
        }
      }
      return null;
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
    root.dataset.surface = player.getAttribute('data-e2e') ||
      player.id ||
      (/\bxgplayer\b/i.test(typeof player.className === 'string' ? player.className : '') ? 'xgplayer' : player.tagName.toLowerCase());
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
      const insetX = Math.min(ringInset, Math.max(0, (rect.width - 24) / 2));
      const insetY = Math.min(ringInset, Math.max(0, (rect.height - 24) / 2));
      ring.style.cssText = [
        'position:fixed',
        `top:${rect.top + insetY}px`,
        `left:${rect.left + insetX}px`,
        `width:${Math.max(0, rect.width - insetX * 2)}px`,
        `height:${Math.max(0, rect.height - insetY * 2)}px`,
        `box-shadow:0 0 0 ${ringWidth}px ${ringColor},0 0 0 ${ringWidth + 2}px ${ringContrast}`,
        'border-radius:4px',
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
