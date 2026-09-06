export const SPOTIFY_HOVER_ROOT_ID = 'annotated-sp-hover-root';

export type SpotifyHoverStrength = 'soft' | 'strong';

export type SpotifyHoverPageRequest = {
  expectedEpisodeId: string;
  strength: SpotifyHoverStrength;
  startMs: number | null;
  endMs: number | null;
};

export type SpotifyHoverPageResult = {
  ok: boolean;
  reason?: 'cleared' | 'source-mismatch' | 'player-unavailable' | 'invalid-request';
};

export function spotifyEpisodeIdFromHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
    const match = url.pathname.match(
      /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// Serialized into the explicitly connected top-level tab.
export function applySpotifyHoverHighlightOnPage(
  request: SpotifyHoverPageRequest,
): SpotifyHoverPageResult {
  const rootId = 'annotated-sp-hover-root';
  const removeRoot = () => {
    try {
      document.getElementById(rootId)?.remove();
    } catch {
      // Best-effort cleanup must not throw into the page.
    }
  };

  try {
    const episodeIdFromHref = (value: string) => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
        const match = url.pathname.match(
          /^(?:\/intl-[a-z]{2}(?:-[a-z0-9]{2,8})?)?(?:\/embed)?\/episode\/([A-Za-z0-9]{22})(?:\/|$)/i,
        );
        return match?.[1] ?? null;
      } catch {
        return null;
      }
    };

    if (
      !request ||
      typeof request.expectedEpisodeId !== 'string' ||
      !/^[A-Za-z0-9]{22}$/.test(request.expectedEpisodeId) ||
      (request.strength !== 'soft' && request.strength !== 'strong')
    ) {
      removeRoot();
      return { ok: false, reason: 'invalid-request' };
    }

    if (episodeIdFromHref(location.href) !== request.expectedEpisodeId) {
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
      return rect.width > 80 && rect.height > 24;
    };

    const findBar = (): HTMLElement | null => {
      const selectors = [
        '[data-testid="now-playing-bar"]',
        '[data-testid="player-controls"]',
        '[data-testid="playback-progressbar"]',
      ];
      for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate instanceof HTMLElement && isLaidOut(candidate)) return candidate;
      }
      return null;
    };

    const player = findBar();
    if (!player) {
      removeRoot();
      return { ok: false, reason: 'player-unavailable' };
    }

    try {
      player.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch {
      try { player.scrollIntoView(true); } catch { /* Scroll is best-effort. */ }
    }

    const strong = request.strength === 'strong';
    const dimOpacity = strong ? 0.12 : 0.08;
    const ringWidth = strong ? 4 : 3;
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
        `box-shadow:0 0 0 ${ringWidth}px ${ringColor},0 0 0 ${ringWidth + 2}px ${ringContrast}`,
        'border-radius:8px',
      ].join(';');
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
    return { ok: true };
  } catch {
    removeRoot();
    return { ok: false, reason: 'player-unavailable' };
  }
}

export function clearSpotifyHoverHighlightOnPage(): SpotifyHoverPageResult {
  try {
    const root = document.getElementById('annotated-sp-hover-root');
    const cleanup = root && (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof cleanup === 'function') cleanup();
    root?.remove();
    return { ok: true, reason: 'cleared' };
  } catch {
    return { ok: false };
  }
}
