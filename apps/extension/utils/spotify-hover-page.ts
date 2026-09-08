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

    const isVisible = (element: Element) => {
      const style = getComputedStyle(element);
      return !(
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0 ||
        element.getClientRects().length === 0
      );
    };

    const isLaidOut = (element: Element, minWidth: number, minHeight: number) => {
      if (!isVisible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > minWidth && rect.height > minHeight;
    };

    // Real player chrome only. Do not treat now-playing-bar as sufficient:
    // logged-out Preview / signup upsell is often stacked inside that footer.
    const PLAYER_CHROME_TESTIDS = [
      'player-controls',
      'playback-progressbar',
      'now-playing-widget',
      'control-button-playpause',
    ];

    const chromeSelector = (testid: string) => `[data-testid="${testid}"]`;

    const isPlayerChrome = (element: Element) => {
      const testid = element.getAttribute('data-testid') ?? '';
      return PLAYER_CHROME_TESTIDS.includes(testid);
    };

    const hasPlayerChrome = (element: Element) => {
      if (isPlayerChrome(element)) return true;
      return PLAYER_CHROME_TESTIDS.some((testid) => element.querySelector(chromeSelector(testid)));
    };

    const tokenBlob = (element: Element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      return [
        element.id,
        className,
        element.getAttribute('data-testid'),
        element.getAttribute('aria-label'),
      ].filter(Boolean).join(' ');
    };

    const looksLikePromoContent = (element: Element) => {
      const blob = tokenBlob(element);
      if (
        /(?:^|[\s_-])(?:signup|upsell|preview-bar|signup-button|login-button)(?:$|[\s_-])/i
          .test(blob)
      ) return true;
      const href = element.getAttribute('href') ?? '';
      if (/\/signup/i.test(href)) return true;
      if (element.querySelector('[data-testid="signup-button"], a[href*="/signup"]')) return true;
      const text = (element.textContent ?? '').replace(/\s+/g, ' ');
      return /preview of spotify|sign up to get unlimited|sign up free/i.test(text);
    };

    const unionRects = (elements: HTMLElement[]) => {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      };
    };

    const isPromoStrip = (element: Element, reference: HTMLElement) => {
      if (hasPlayerChrome(element)) return false;
      if (!looksLikePromoContent(element)) return false;
      const rect = element.getBoundingClientRect();
      const ref = reference.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 20) return false;
      const verticallySeparate = rect.bottom <= ref.top + 8 || rect.top >= ref.bottom - 8;
      const wide = rect.width >= Math.min(window.innerWidth, Math.max(ref.width, 160)) * 0.45;
      return verticallySeparate && wide;
    };

    const ancestorAddsPromoStack = (
      ancestor: HTMLElement,
      union: { top: number; bottom: number; height: number },
      seeds: HTMLElement[],
    ) => {
      const rect = ancestor.getBoundingClientRect();
      const extraTop = union.top - rect.top;
      const extraBottom = rect.bottom - union.bottom;
      if (extraTop <= 28 && extraBottom <= 28 && rect.height <= union.height * 1.55 + 20) {
        return false;
      }
      for (const child of ancestor.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (seeds.some((seed) => child === seed || child.contains(seed))) continue;
        if (!isVisible(child)) continue;
        const childRect = child.getBoundingClientRect();
        if (childRect.height < 16 || childRect.width < 80) continue;
        const occupiesExtra =
          childRect.bottom <= union.top + 8 ||
          childRect.top >= union.bottom - 8;
        if (occupiesExtra) return true;
        if (looksLikePromoContent(child) && !hasPlayerChrome(child)) return true;
      }
      return extraTop > 40 || extraBottom > 40;
    };

    const isPageShell = (element: Element) => {
      const tag = element.tagName;
      if (tag === 'BODY' || tag === 'HTML') return true;
      const id = element.id ?? '';
      const testid = element.getAttribute('data-testid') ?? '';
      if (testid === 'now-playing-bar') return false;
      if (id === 'root' || id === 'main' || testid === 'root') return true;
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.86 && rect.height >= window.innerHeight * 0.5;
    };

    const findChromeSeeds = (): HTMLElement[] => {
      const seeds: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();
      for (const testid of PLAYER_CHROME_TESTIDS) {
        for (const candidate of document.querySelectorAll(chromeSelector(testid))) {
          if (!(candidate instanceof HTMLElement) || seen.has(candidate)) continue;
          if (!isLaidOut(candidate, 16, 8)) continue;
          seen.add(candidate);
          seeds.push(candidate);
        }
      }
      return seeds;
    };

    const measurePlayer = (): { element: HTMLElement; rect: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    } } | null => {
      const seeds = findChromeSeeds();
      const first = seeds[0];
      if (!first) return null;

      let best: HTMLElement = first;
      for (const seed of seeds) {
        const rect = seed.getBoundingClientRect();
        const current = best.getBoundingClientRect();
        if (rect.width * rect.height > current.width * current.height) best = seed;
      }

      const union = unionRects(seeds);
      let blockedAncestor: HTMLElement | null = null;
      let node = best.parentElement;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        if (!isLaidOut(node, 16, 8) || isPageShell(node)) break;
        if (looksLikePromoContent(node) && !hasPlayerChrome(node)) break;
        if (isPromoStrip(node, best) || ancestorAddsPromoStack(node, union, seeds)) {
          blockedAncestor = node;
          break;
        }
        let promoChild = false;
        for (const child of node.children) {
          if (child instanceof HTMLElement && isPromoStrip(child, best)) {
            promoChild = true;
            break;
          }
        }
        if (promoChild) {
          blockedAncestor = node;
          break;
        }
        best = node;
        if (node.getAttribute('data-testid') === 'now-playing-bar') break;
      }

      const bestRect = best.getBoundingClientRect();
      let rect = {
        left: bestRect.left,
        top: bestRect.top,
        right: bestRect.right,
        bottom: bestRect.bottom,
        width: bestRect.width,
        height: bestRect.height,
      };

      if (blockedAncestor) {
        const parentRect = blockedAncestor.getBoundingClientRect();
        const rowTop = Math.min(union.top, bestRect.top);
        const rowBottom = Math.max(union.bottom, bestRect.bottom);
        rect = {
          left: parentRect.left,
          top: rowTop,
          right: parentRect.right,
          bottom: rowBottom,
          width: parentRect.width,
          height: rowBottom - rowTop,
        };
      }

      if (rect.width < 80 || rect.height < 12) return null;
      return { element: best, rect };
    };

    const measured = measurePlayer();
    if (!measured) {
      removeRoot();
      return { ok: false, reason: 'player-unavailable' };
    }
    const player = measured.element;

    try {
      if (!(document.getElementById(rootId) instanceof HTMLElement)) {
        player.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
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
    root.setAttribute('data-annotated-hover-surface', 'player-bar');

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
    // Duplicated in every serialized injector. Keep aligned with hover-overlay-paint.ts.
    const writeCss = (element: HTMLElement & { __annotatedHoverCss?: string }, next: string) => {
      if (element.__annotatedHoverCss === next) return;
      element.__annotatedHoverCss = next;
      element.style.cssText = next;
    };
    writeCss(root, 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;');

    const position = () => {
      const next = measurePlayer();
      const rect = next?.rect ?? measured.rect;
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
      writeCss(ring, [
        'position:fixed',
        `top:${rect.top}px`,
        `left:${rect.left}px`,
        `width:${Math.max(0, rect.width)}px`,
        `height:${Math.max(0, rect.height)}px`,
        `box-shadow:0 0 0 ${ringWidth}px ${ringColor},0 0 0 ${ringWidth + 2}px ${ringContrast}`,
        'border-radius:8px',
      ].join(';'));
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
