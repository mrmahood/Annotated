import { getNewMediaPublicationRangeError } from '@annotated/shared/media-time';

export const YOUTUBE_AD_HEADING = 'Ad playing';
export const YOUTUBE_AD_BLOCKED_COPY =
  'Ad playing — wait until it ends, then try again.';
export const YOUTUBE_AD_CAPTURE_ABORT_COPY =
  'A YouTube ad started during capture. Wait until it ends, then publish again.';
export const YOUTUBE_AD_CAPTURE_WATCH_MS = 400;

const LINEAR_AD_CLASS = /(?:^|\s)(?:ad-showing|ad-interrupting)(?:\s|$)/;
const LINEAR_AD_OVERLAY =
  '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-skip-ad-button, .ytp-ad-skip-button-container, .ytp-ad-preview-container';

function classTokens(element: Element): string {
  const className = typeof (element as HTMLElement).className === 'string'
    ? (element as HTMLElement).className
    : '';
  const listValue = element.classList && typeof element.classList.value === 'string'
    ? element.classList.value
    : '';
  return `${className} ${listValue}`.trim();
}

function overlayIsVisible(overlay: Element): boolean {
  try {
    const view = overlay.ownerDocument?.defaultView;
    const style = view && typeof view.getComputedStyle === 'function'
      ? view.getComputedStyle(overlay)
      : getComputedStyle(overlay);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  } catch {
    return true;
  }
}

function queryYouTubePlayer(root: ParentNode): Element | null {
  if (typeof root.querySelector !== 'function') return null;
  return root.querySelector('#movie_player')
    ?? root.querySelector('.html5-video-player');
}

/**
 * Linear pre-roll / mid-roll ads that own the watch player timeline.
 *
 * Chosen signals (current YouTube watch UI):
 * - `#movie_player` / `.html5-video-player` classes `ad-showing` and
 *   `ad-interrupting` — the player marks linear ads that replace the content
 *   clock (`currentTime` / `duration` become the ad).
 * - Visible linear overlays (Skip Ad / ad countdown / player overlay). Banner
 *   and `ytp-ad-module` chrome alone are ignored so overlay ads do not block
 *   Create.
 *
 * Isolated-world DOM only. Does not skip ads or use the player API.
 */
export function detectYouTubeLinearAdShowing(root: ParentNode = document): boolean {
  try {
    const player = queryYouTubePlayer(root);
    if (!player) return false;
    const list = player.classList;
    if (list && typeof list.contains === 'function' &&
        (list.contains('ad-showing') || list.contains('ad-interrupting'))) {
      return true;
    }
    if (LINEAR_AD_CLASS.test(classTokens(player))) return true;
    if (typeof player.querySelector !== 'function') return false;
    const overlay = player.querySelector(LINEAR_AD_OVERLAY);
    return overlay instanceof Element && overlayIsVisible(overlay);
  } catch {
    return false;
  }
}

// Serialized into the connected tab during YouTube capture. Keep this function
// self-contained: Chrome executeScript cannot close over module bindings.
export function readYouTubeAdShowingOnPage(): { adShowing: boolean } {
  try {
    const player = document.querySelector('#movie_player')
      ?? document.querySelector('.html5-video-player');
    if (!player) return { adShowing: false };
    const list = player.classList;
    if (list && typeof list.contains === 'function' &&
        (list.contains('ad-showing') || list.contains('ad-interrupting'))) {
      return { adShowing: true };
    }
    const tokens = `${typeof (player as HTMLElement).className === 'string' ? (player as HTMLElement).className : ''} ${list && typeof list.value === 'string' ? list.value : ''}`;
    if (/(?:^|\s)(?:ad-showing|ad-interrupting)(?:\s|$)/.test(tokens)) {
      return { adShowing: true };
    }
    if (typeof player.querySelector !== 'function') return { adShowing: false };
    const overlay = player.querySelector(
      '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-skip-ad-button, .ytp-ad-skip-button-container, .ytp-ad-preview-container',
    );
    if (!overlay) return { adShowing: false };
    const view = overlay.ownerDocument?.defaultView;
    const style = view && typeof view.getComputedStyle === 'function'
      ? view.getComputedStyle(overlay)
      : getComputedStyle(overlay);
    return {
      adShowing: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
    };
  } catch {
    return { adShowing: false };
  }
}

export type YouTubeFrozenMediaTimes = {
  durationMs: number | null;
  playerTimeMs: number | null;
  playerIdentity: string | null;
};

export function freezeYouTubeMediaTimesWhileAd(input: {
  adShowing: boolean;
  previous: YouTubeFrozenMediaTimes;
  next: YouTubeFrozenMediaTimes;
}): YouTubeFrozenMediaTimes {
  if (!input.adShowing) return input.next;
  return {
    durationMs: input.previous.durationMs,
    playerTimeMs: input.previous.playerTimeMs,
    playerIdentity: input.previous.playerIdentity ?? input.next.playerIdentity,
  };
}

export function youtubeClipRangeAfterAdCleared(
  startMs: number | null,
  endMs: number | null,
  contentDurationMs: number | null,
): string | null {
  return getNewMediaPublicationRangeError(startMs, endMs, contentDurationMs);
}

export function isYouTubeAdBlockedCopy(value: unknown): boolean {
  return value === YOUTUBE_AD_BLOCKED_COPY || value === YOUTUBE_AD_CAPTURE_ABORT_COPY;
}
