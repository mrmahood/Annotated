export type HoverOverlayBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type HoverOverlayRect = HoverOverlayBox & {
  right: number;
  bottom: number;
};

export type HoverOverlayViewport = {
  innerWidth: number;
  innerHeight: number;
};

export type HoverCssCache = {
  value: string;
};

export type HoverOverlayFrameHost = {
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  addEventListener(
    type: string,
    listener: () => void,
    options?: boolean | { capture?: boolean; passive?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: () => void,
    options?: boolean | { capture?: boolean },
  ): void;
};

export const HOVER_OVERLAY_ROOT_CSS =
  'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

export const SERIALIZED_HOVER_PAGE_FILES = [
  'youtube-hover-page.ts',
  'tiktok-hover-page.ts',
  'spotify-hover-page.ts',
  'article-hover-page.ts',
  'audio-hover-page.ts',
  'page-video-hover-page.ts',
] as const;

export function hoverOverlayHole(
  rect: HoverOverlayRect,
  viewport: HoverOverlayViewport,
): string {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.innerWidth, rect.right);
  const bottom = Math.min(viewport.innerHeight, rect.bottom);
  return `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px`;
}

export function hoverOverlayDimCss(opacity: number, hole: string): string {
  return [
    'position:fixed',
    'inset:0',
    `background:rgba(0,0,0,${opacity})`,
    hole
      ? `clip-path:polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${hole})`
      : '',
  ].filter(Boolean).join(';');
}

export function hoverOverlayRingBox(rect: HoverOverlayRect, inset: number): HoverOverlayBox {
  const insetX = Math.min(inset, Math.max(0, (rect.width - 24) / 2));
  const insetY = Math.min(inset, Math.max(0, (rect.height - 24) / 2));
  return {
    top: rect.top + insetY,
    left: rect.left + insetX,
    width: Math.max(0, rect.width - insetX * 2),
    height: Math.max(0, rect.height - insetY * 2),
  };
}

export function writeHoverCssText(
  style: { cssText: string },
  next: string,
  cache: HoverCssCache,
): boolean {
  if (cache.value === next) return false;
  cache.value = next;
  style.cssText = next;
  return true;
}

export function createHoverOverlayRepaintController(
  host: HoverOverlayFrameHost,
  paint: () => void,
) {
  let raf = 0;
  const run = () => {
    raf = 0;
    try { paint(); } catch { /* Reposition is best-effort. */ }
  };
  const schedule = () => {
    if (raf) return;
    const request = host.requestAnimationFrame;
    if (typeof request === 'function') {
      raf = request(run);
      return;
    }
    run();
  };
  const onChange = () => {
    schedule();
  };
  host.addEventListener('scroll', onChange, { capture: true, passive: true });
  host.addEventListener('resize', onChange, { passive: true });
  return {
    schedule,
    disconnect() {
      host.removeEventListener('scroll', onChange, { capture: true });
      host.removeEventListener('resize', onChange);
      const cancel = host.cancelAnimationFrame;
      if (raf && typeof cancel === 'function') cancel(raf);
      raf = 0;
    },
  };
}
