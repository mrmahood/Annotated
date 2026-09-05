export const ARTICLE_HOVER_ROOT_ID = 'annotated-article-hover-root';
export const ARTICLE_HOVER_STYLE_ID = 'annotated-article-hover-style';
export const ARTICLE_HOVER_HIGHLIGHT_NAME = 'annotated-article-hover';

export type ArticleHoverStrength = 'soft' | 'strong';

export type ArticleHoverPageRequest = {
  expectedNormalizedUrl: string;
  selectedText: string;
  strength: ArticleHoverStrength;
};

export type ArticleHoverPageResult = {
  ok: boolean;
  reason?: 'cleared' | 'source-mismatch' | 'text-unmatched' | 'invalid-request';
};

export type NormalizedTextMatch = {
  start: number;
  end: number;
};

const ARTICLE_HOVER_TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

export function normalizeArticleHoverText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Unique whitespace-normalized substring only. Zero or two-plus matches fail
// closed — v1 does not pick the first of several hits.
export function findUniqueNormalizedMatch(
  haystack: string,
  needle: string,
): NormalizedTextMatch | null {
  const normalizedHaystack = normalizeArticleHoverText(haystack);
  const normalizedNeedle = normalizeArticleHoverText(needle);
  if (!normalizedHaystack || !normalizedNeedle) return null;

  let start = -1;
  let from = 0;
  let count = 0;
  while (from <= normalizedHaystack.length - normalizedNeedle.length) {
    const index = normalizedHaystack.indexOf(normalizedNeedle, from);
    if (index === -1) break;
    count += 1;
    if (count > 1) return null;
    start = index;
    from = index + 1;
  }
  if (count !== 1 || start < 0) return null;
  return { start, end: start + normalizedNeedle.length };
}

export function normalizeArticleHoverPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (
      ((host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
        url.pathname === '/watch') ||
      host === 'youtu.be'
    ) {
      return null;
    }

    url.hostname = host;
    url.hash = '';
    for (const parameter of [...url.searchParams.keys()]) {
      if (ARTICLE_HOVER_TRACKING_PARAMETERS.has(parameter.toLowerCase())) {
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

// Serialized into the explicitly connected top-level tab. Keep every helper
// inside this function. Do not close over module state or imported bindings.
export function applyArticleHoverHighlightOnPage(
  request: ArticleHoverPageRequest,
): ArticleHoverPageResult {
  const rootId = 'annotated-article-hover-root';
  const styleId = 'annotated-article-hover-style';
  const highlightName = 'annotated-article-hover';
  const trackingParameters = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
  ]);

  const removePaint = () => {
    try {
      const root = document.getElementById(rootId);
      const cleanup = root &&
        (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
      if (typeof cleanup === 'function') cleanup();
      root?.remove();
      document.getElementById(styleId)?.remove();
      const highlights = (globalThis as {
        CSS?: { highlights?: { delete?: (name: string) => void } };
      }).CSS?.highlights;
      highlights?.delete?.(highlightName);
    } catch {
      // Best-effort cleanup must not throw into the page.
    }
  };

  try {
    const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
    const normalizePageUrl = (value: string) => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        if (
          ((host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
            url.pathname === '/watch') ||
          host === 'youtu.be'
        ) {
          return null;
        }
        url.hostname = host;
        url.hash = '';
        for (const parameter of [...url.searchParams.keys()]) {
          if (trackingParameters.has(parameter.toLowerCase())) url.searchParams.delete(parameter);
        }
        url.searchParams.sort();
        if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href;
      } catch {
        return null;
      }
    };

    const selectedText = request && typeof request.selectedText === 'string'
      ? normalizeText(request.selectedText)
      : '';
    const expectedNormalizedUrl = request && typeof request.expectedNormalizedUrl === 'string'
      ? request.expectedNormalizedUrl
      : '';
    if (
      !selectedText ||
      !expectedNormalizedUrl ||
      (request.strength !== 'soft' && request.strength !== 'strong')
    ) {
      removePaint();
      return { ok: false, reason: 'invalid-request' };
    }

    if (normalizePageUrl(location.href) !== expectedNormalizedUrl) {
      removePaint();
      return { ok: false, reason: 'source-mismatch' };
    }

    const skipSelector = 'script, style, noscript, template, svg, canvas';
    const isUsableTextNode = (node: Node): node is Text => {
      if (node.nodeType !== 3 || !node.textContent) return false;
      const parent = node.parentElement;
      if (!parent || parent.closest(skipSelector) || parent.closest('[data-annotated-hover]')) {
        return false;
      }
      const style = getComputedStyle(parent);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };

    const parts: { node: Text; text: string }[] = [];
    const visit = (node: Node) => {
      if (isUsableTextNode(node)) {
        parts.push({ node, text: node.textContent ?? '' });
        return;
      }
      const children = node.childNodes;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) visit(children[index]!);
    };
    visit(document.body ?? document.documentElement);

    let normalized = '';
    const map: { node: Text; offset: number }[] = [];
    let lastWasSpace = true;
    for (const part of parts) {
      for (let offset = 0; offset < part.text.length; offset += 1) {
        const character = part.text[offset]!;
        if (/\s/.test(character)) {
          if (lastWasSpace) continue;
          normalized += ' ';
          map.push({ node: part.node, offset });
          lastWasSpace = true;
          continue;
        }
        normalized += character;
        map.push({ node: part.node, offset });
        lastWasSpace = false;
      }
    }
    if (normalized.endsWith(' ')) {
      normalized = normalized.slice(0, -1);
      map.pop();
    }

    let matchStart = -1;
    let from = 0;
    let matchCount = 0;
    while (from <= normalized.length - selectedText.length) {
      const index = normalized.indexOf(selectedText, from);
      if (index === -1) break;
      matchCount += 1;
      if (matchCount > 1) {
        removePaint();
        return { ok: false, reason: 'text-unmatched' };
      }
      matchStart = index;
      from = index + 1;
    }
    if (matchCount !== 1 || matchStart < 0) {
      removePaint();
      return { ok: false, reason: 'text-unmatched' };
    }

    const startPoint = map[matchStart];
    const endPoint = map[matchStart + selectedText.length - 1];
    if (!startPoint || !endPoint || typeof document.createRange !== 'function') {
      removePaint();
      return { ok: false, reason: 'text-unmatched' };
    }

    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset + 1);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) {
      removePaint();
      return { ok: false, reason: 'text-unmatched' };
    }

    const strong = request.strength === 'strong';
    const dimOpacity = strong ? 0.12 : 0.09;
    const ringWidth = strong ? 3 : 2;
    const ringColor = strong ? 'rgba(180, 130, 0, 0.95)' : 'rgba(212, 160, 20, 0.85)';
    const fillColor = strong ? 'rgba(255, 214, 74, 0.72)' : 'rgba(255, 214, 74, 0.55)';

    let style = document.getElementById(styleId);
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = styleId;
      style.setAttribute('data-annotated-hover', '1');
      (document.head ?? document.documentElement).appendChild(style);
    }
    style.textContent =
      `::highlight(${highlightName}){background-color:${fillColor};color:inherit;}`;

    const HighlightCtor = (globalThis as { Highlight?: new (value: Range) => unknown }).Highlight;
    const highlights = (globalThis as {
      CSS?: { highlights?: { set?: (name: string, value: unknown) => void } };
    }).CSS?.highlights;
    if (typeof HighlightCtor === 'function' && highlights?.set) {
      try {
        highlights.set(highlightName, new HighlightCtor(range));
      } catch {
        // Overlay outline still paints when the Highlight API is unavailable.
      }
    }

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
    root.replaceChildren();

    const dim = document.createElement('div');
    dim.setAttribute('data-annotated-hover-dim', '1');
    root.appendChild(dim);
    const rings = document.createElement('div');
    rings.setAttribute('data-annotated-hover-rings', '1');
    root.appendChild(rings);

    const position = () => {
      const nextRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const holes = nextRects.map((rect) => {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px`;
      }).join(', ');
      dim.style.cssText = [
        'position:fixed',
        'inset:0',
        `background:rgba(0,0,0,${dimOpacity})`,
        holes
          ? `clip-path:polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${holes})`
          : '',
      ].filter(Boolean).join(';');

      rings.replaceChildren();
      for (const rect of nextRects) {
        const ring = document.createElement('div');
        ring.setAttribute('data-annotated-hover-ring', '1');
        ring.style.cssText = [
          'position:fixed',
          `top:${rect.top}px`,
          `left:${rect.left}px`,
          `width:${Math.max(0, rect.width)}px`,
          `height:${Math.max(0, rect.height)}px`,
          `box-shadow:0 0 0 ${ringWidth}px ${ringColor}`,
          `background:${fillColor}`,
          'border-radius:2px',
        ].join(';');
        rings.appendChild(ring);
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

    return { ok: true };
  } catch {
    removePaint();
    return { ok: false, reason: 'text-unmatched' };
  }
}

// Serialized into the explicitly connected top-level tab. Self-contained.
export function clearArticleHoverHighlightOnPage(): ArticleHoverPageResult {
  try {
    const root = document.getElementById('annotated-article-hover-root');
    const cleanup = root &&
      (root as HTMLElement & { __annotatedHoverCleanup?: () => void }).__annotatedHoverCleanup;
    if (typeof cleanup === 'function') cleanup();
    root?.remove();
    document.getElementById('annotated-article-hover-style')?.remove();
    const highlights = (globalThis as {
      CSS?: { highlights?: { delete?: (name: string) => void } };
    }).CSS?.highlights;
    highlights?.delete?.('annotated-article-hover');
    return { ok: true, reason: 'cleared' };
  } catch {
    return { ok: false };
  }
}
