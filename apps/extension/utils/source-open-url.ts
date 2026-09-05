import { getYouTubeTimestampUrl } from '@annotated/shared/youtube';
import {
  ARTICLE_HOVER_ANCHOR_MAX_CHARS,
  normalizeArticleHoverText,
  takeLeadingNormalizedWindow,
  takeTrailingNormalizedWindow,
} from './article-hover-page.ts';

export type SourceOpenKind = 'article' | 'youtube' | 'audio';

export type SourceOpenInput = {
  kind: SourceOpenKind;
  canonicalUrl: string;
  selectedText?: string | null;
  startMs?: number | null;
};

export const SOURCE_OPEN_TEXT_FRAGMENT_MIN_CHARS = 20;
export const SOURCE_OPEN_ENCODED_FRAGMENT_MAX = 1800;

const WRAPPING_QUOTES = /^[\u201C\u201D\u2018\u2019"']+|[\u201C\u201D\u2018\u2019"']+$/g;

export function stripWrappingQuotes(value: string): string {
  return value.replace(WRAPPING_QUOTES, '').trim();
}

export function encodeTextFragmentValue(value: string): string {
  return encodeURIComponent(value).replace(/-/g, '%2D');
}

function articleUrlWithoutHash(canonicalUrl: string): string | null {
  try {
    const url = new URL(canonicalUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

// Scroll-To-Text Fragment for articles. A normal user-initiated navigation
// highlights and scrolls; no extra extension permissions are required.
export function buildArticleTextFragmentUrl(
  canonicalUrl: string,
  selectedText: string,
): string {
  const base = articleUrlWithoutHash(canonicalUrl);
  if (!base) return canonicalUrl;
  const normalized = stripWrappingQuotes(normalizeArticleHoverText(selectedText));
  if (normalized.length < SOURCE_OPEN_TEXT_FRAGMENT_MIN_CHARS) return base;

  let directive: string;
  if (normalized.length <= ARTICLE_HOVER_ANCHOR_MAX_CHARS) {
    directive = `text=${encodeTextFragmentValue(normalized)}`;
  } else {
    const start = takeLeadingNormalizedWindow(normalized);
    const end = takeTrailingNormalizedWindow(normalized);
    if (start.length < SOURCE_OPEN_TEXT_FRAGMENT_MIN_CHARS) return base;
    directive = end && end !== start && end.length >= SOURCE_OPEN_TEXT_FRAGMENT_MIN_CHARS
      ? `text=${encodeTextFragmentValue(start)},${encodeTextFragmentValue(end)}`
      : `text=${encodeTextFragmentValue(start)}`;
  }

  if (directive.length > SOURCE_OPEN_ENCODED_FRAGMENT_MAX) return base;
  return `${base}#:~:${directive}`;
}

export function getSourceOpenUrl(input: SourceOpenInput): string {
  if (input.kind === 'youtube') {
    return getYouTubeTimestampUrl(input.canonicalUrl, input.startMs ?? 0);
  }
  if (input.kind === 'audio') {
    // Sprint 4 owns in-page audio hover/seek. Without page scripting, Open
    // source can only load the episode URL — it cannot seek the quoted range.
    return input.canonicalUrl;
  }
  return buildArticleTextFragmentUrl(input.canonicalUrl, input.selectedText ?? '');
}
