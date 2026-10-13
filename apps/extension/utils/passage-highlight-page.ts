export const PASSAGE_HIGHLIGHT_LIMIT = 40;

export const PASSAGE_HIGHLIGHTER_COLORS = {
  yellow: '#ffe14a',
  green: '#b6f0a2',
  red: '#ffb3b3',
  amber: '#ffd59a',
} as const;

export type PassageHighlighterToken = keyof typeof PASSAGE_HIGHLIGHTER_COLORS;

export type PassageHighlightPagePassage = {
  annotationId: string;
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
  color?: string | null;
};

export type PassageHighlightPageRequest = {
  pageUrl: string;
  passages: PassageHighlightPagePassage[];
};

export type PassageHighlightPageResult = {
  ok: boolean;
  reason?: 'csp-blocked' | 'source-mismatch' | 'invalid-request' | 'cleared';
  highlighted?: number;
  unmatched?: number;
};

// Serialized into the connected tab by chrome.scripting.executeScript.
// Keep every helper inside this function. Do not close over imports.
export function applyPassageHighlightsOnPage(
  request: PassageHighlightPageRequest,
): PassageHighlightPageResult {
  const colors: Record<string, string> = {
    yellow: '#ffe14a',
    green: '#b6f0a2',
    red: '#ffb3b3',
    amber: '#ffd59a',
  };
  const trackingParameters = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
  ]);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const normalizePageUrl = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hostname = url.hostname.toLowerCase();
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

  const parentElementOf = (node: Node | null): Element | null => {
    let current: Node | null = node;
    while (current) {
      const parent: Node | null = current.parentNode;
      if (!parent) return null;
      if (parent.nodeType === 1) return parent as Element;
      const host = (parent as ShadowRoot).host;
      if (parent.nodeType === 11 && host) return host;
      current = parent;
    }
    return null;
  };

  const tagNameOf = (node: Node | null): string => {
    if (!node || node.nodeType !== 1) return '';
    return ((node as Element).tagName || '').toUpperCase();
  };

  const isSkippedText = (node: Text): boolean => {
    let parent = parentElementOf(node);
    while (parent) {
      const tag = tagNameOf(parent);
      if (
        tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' ||
        tag === 'TEMPLATE' || tag === 'SVG' || tag === 'CANVAS' ||
        tag === 'TEXTAREA'
      ) {
        return true;
      }
      if (parent.getAttribute?.('data-annotated-passage-probe') === '1') return true;
      parent = parentElementOf(parent);
    }
    const parentElement = parentElementOf(node);
    if (!parentElement || typeof getComputedStyle !== 'function') return false;
    try {
      const style = getComputedStyle(parentElement);
      return style.display === 'none' || style.visibility === 'hidden';
    } catch {
      return false;
    }
  };

  const collectText = (root: Node): Text[] => {
    const parts: Text[] = [];
    const visit = (node: Node) => {
      if (node.nodeType === 3) {
        if (node.textContent && !isSkippedText(node as Text)) parts.push(node as Text);
        return;
      }
      const children = node.childNodes;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child) visit(child);
      }
    };
    visit(root);
    return parts;
  };

  const buildNormalized = (parts: Text[]) => {
    let normalized = '';
    const map: { node: Text; offset: number }[] = [];
    let lastWasSpace = true;
    for (const node of parts) {
      const text = node.textContent ?? '';
      if (normalized.length > 200_000) break;
      for (let offset = 0; offset < text.length; offset += 1) {
        const character = text[offset] ?? '';
        if (/\s/.test(character)) {
          if (lastWasSpace) continue;
          normalized += ' ';
          map.push({ node, offset });
          lastWasSpace = true;
          continue;
        }
        normalized += character;
        map.push({ node, offset });
        lastWasSpace = false;
        if (normalized.length > 200_000) break;
      }
    }
    if (normalized.endsWith(' ')) {
      normalized = normalized.slice(0, -1);
      map.pop();
    }
    return { normalized, map };
  };

  const normalizeAnchor = (value: string) => value.replace(/\s+/g, ' ').trim();
  const stripEdgeQuotes = (value: string) =>
    value.replace(/^[\u201C\u201D\u2018\u2019"']+|[\u201C\u201D\u2018\u2019"']+$/g, '').trim();

  const lowerIfSameLength = (value: string) => {
    const lower = value.toLowerCase();
    return lower.length === value.length ? lower : null;
  };

  const ratio = (expected: string, actual: string, fromEnd: boolean) => {
    if (!expected || !actual) return 0;
    const left = expected.toLowerCase();
    const right = actual.toLowerCase();
    const length = Math.min(left.length, right.length);
    let same = 0;
    for (let size = 1; size <= length; size += 1) {
      const expectedSlice = fromEnd ? left.slice(-size) : left.slice(0, size);
      const actualSlice = fromEnd ? right.slice(-size) : right.slice(0, size);
      if (expectedSlice === actualSlice) same = size;
      else break;
    }
    return same / expected.length;
  };

  type PassageHit = {
    start: number;
    end: number;
    score: number;
    map: { node: Text; offset: number }[];
  };

  const exactHitsIn = (
    haystack: string,
    map: { node: Text; offset: number }[],
    quote: string,
    prefix: string,
    suffix: string,
    caseFold: boolean,
  ): PassageHit[] => {
    if (!haystack || !quote || quote.length > haystack.length) return [];
    const source = caseFold ? lowerIfSameLength(haystack) : haystack;
    const target = caseFold ? lowerIfSameLength(quote) : quote;
    if (!source || !target) return [];
    const contextScore = (start: number, end: number) => {
      const parts: number[] = [];
      if (prefix) {
        let boundary = start;
        if (haystack[boundary - 1] === ' ') boundary -= 1;
        const before = haystack.slice(Math.max(0, boundary - prefix.length), boundary);
        parts.push(ratio(prefix, before, true));
      }
      if (suffix) {
        let boundary = end;
        if (haystack[boundary] === ' ') boundary += 1;
        const after = haystack.slice(boundary, boundary + suffix.length);
        parts.push(ratio(suffix, after, false));
      }
      if (parts.length === 0) return 1;
      return parts.reduce((sum, part) => sum + part, 0) / parts.length;
    };
    const hits: PassageHit[] = [];
    let from = 0;
    while (from <= source.length - target.length && hits.length < 12) {
      const index = source.indexOf(target, from);
      if (index < 0) break;
      const end = index + target.length;
      hits.push({ start: index, end, score: contextScore(index, end), map });
      from = index + 1;
    }
    return hits;
  };

  // Choice is page-wide. A root that contains the quote once is still ambiguous
  // when another root contains it too. Case-fold runs only when the page has
  // no case-sensitive hit, so a rejected exact match cannot fall through.
  const choosePassageHit = (hits: PassageHit[], prefix: string, suffix: string): PassageHit | null => {
    if (hits.length === 0) return null;
    if (!prefix && !suffix) return hits.length === 1 ? hits[0] ?? null : null;
    const ranked = [...hits].sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 0.72) return null;
    if (second && best.score - second.score < 0.2) return null;
    return best;
  };

  const unwrap = (host: Element) => {
    const parent = host.parentNode;
    if (!parent) return;
    for (const child of [...host.childNodes]) parent.insertBefore(child, host);
    parent.removeChild(host);
  };

  const clearHighlights = () => {
    const hosts: Element[] = [];
    const visit = (node: Node) => {
      if (tagNameOf(node) === 'ANNOTATED-PASSAGE') hosts.push(node as Element);
      const shadow = (node as Element).shadowRoot;
      if (shadow) visit(shadow);
      const children = node.childNodes;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child) visit(child);
      }
    };
    visit(document.documentElement);
    for (const host of hosts) unwrap(host);
  };

  const stylesStick = (): boolean => {
    const StyleSheetCtor = (globalThis as { CSSStyleSheet?: new () => CSSStyleSheet }).CSSStyleSheet;
    if (typeof StyleSheetCtor !== 'function' || typeof document.createElement !== 'function') return false;
    const host = document.createElement('annotated-passage');
    host.setAttribute('data-annotated-passage-probe', '1');
    host.textContent = 'probe';
    let blocked = false;
    try {
      const shadow = host.attachShadow({ mode: 'open' });
      const sheet = new StyleSheetCtor();
      sheet.replaceSync(':host{background-color:#ffe14a !important;color:#1a170c}');
      shadow.adoptedStyleSheets = [sheet];
      shadow.appendChild(document.createElement('slot'));
      (document.body ?? document.documentElement).appendChild(host);
      const computed = getComputedStyle(host).backgroundColor;
      const text = String(computed || '').toLowerCase().replace(/\s+/g, '');
      blocked = !text.includes('255,225,74') && text !== '#ffe14a';
    } catch {
      blocked = true;
    } finally {
      host.remove();
    }
    return !blocked;
  };

  const paintSlice = (
    node: Text,
    startOffset: number,
    endOffset: number,
    passage: { annotationId: string; color: string },
  ) => {
    const range = document.createRange();
    range.setStart(node, startOffset);
    range.setEnd(node, endOffset);
    const host = document.createElement('annotated-passage');
    host.setAttribute('data-annotated-passage', passage.annotationId);
    host.setAttribute('data-annotated-color', passage.color);
    host.title = 'Open this annotation in Annotated';
    const shadow = host.attachShadow({ mode: 'open' });
    const StyleSheetCtor = (globalThis as { CSSStyleSheet?: new () => CSSStyleSheet }).CSSStyleSheet;
    if (typeof StyleSheetCtor !== 'function') throw new Error('stylesheet');
    const sheet = new StyleSheetCtor();
    const color = colors[passage.color] ?? colors.yellow;
    sheet.replaceSync(`:host{background-color:${color};color:#1a170c;cursor:pointer;border-radius:2px}`);
    shadow.adoptedStyleSheets = [sheet];
    shadow.appendChild(document.createElement('slot'));
    host.appendChild(range.extractContents());
    range.insertNode(host);
    host.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: (message: unknown) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({
        type: 'annotated-passage-open',
        annotationId: passage.annotationId,
      });
    });
  };

  try {
    if (
      !request || typeof request.pageUrl !== 'string' || !Array.isArray(request.passages) ||
      !document.body
    ) {
      return { ok: false, reason: 'invalid-request' };
    }
    const live = normalizePageUrl(location.href);
    const expected = normalizePageUrl(request.pageUrl);
    if (!live || !expected || live !== expected) {
      clearHighlights();
      return { ok: false, reason: 'source-mismatch' };
    }

    const passages = request.passages.slice(0, 40).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const annotationId = value.annotationId;
      const quote = typeof value.quote === 'string' ? value.quote : '';
      if (typeof annotationId !== 'string' || !uuidPattern.test(annotationId)) return [];
      if (!quote.trim() || quote.length > 2000) return [];
      const color = value.color === 'green' || value.color === 'red' || value.color === 'amber' || value.color === 'yellow'
        ? value.color
        : 'yellow';
      return [{
        annotationId,
        quote,
        prefix: typeof value.prefix === 'string' ? value.prefix.slice(0, 500) : '',
        suffix: typeof value.suffix === 'string' ? value.suffix.slice(0, 500) : '',
        color,
      }];
    });

    clearHighlights();
    if (passages.length === 0) return { ok: true, reason: 'cleared', highlighted: 0, unmatched: 0 };
    if (!stylesStick()) return { ok: false, reason: 'csp-blocked', highlighted: 0, unmatched: passages.length };

    const roots: Node[] = [document.body];
    const collectRoots = (node: Node) => {
      const children = node.childNodes;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (!child || child.nodeType !== 1) continue;
        const shadow = (child as Element).shadowRoot;
        if (shadow) {
          roots.push(shadow);
          collectRoots(shadow);
        }
        collectRoots(child);
      }
    };
    collectRoots(document.body);

    const paintHit = (located: PassageHit, passage: { annotationId: string; color: string }): boolean => {
      const slices: { node: Text; startOffset: number; endOffset: number }[] = [];
      let index = located.start;
      while (index < located.end) {
        const point = located.map[index];
        if (!point) return false;
        let next = index + 1;
        while (next < located.end && located.map[next]?.node === point.node) next += 1;
        const endPoint = located.map[next - 1];
        if (!endPoint) return false;
        slices.push({
          node: point.node,
          startOffset: point.offset,
          endOffset: endPoint.offset + 1,
        });
        index = next;
      }
      if (slices.length === 0) return false;
      for (let sliceIndex = slices.length - 1; sliceIndex >= 0; sliceIndex -= 1) {
        const slice = slices[sliceIndex];
        if (!slice || slice.startOffset >= slice.endOffset) continue;
        paintSlice(slice.node, slice.startOffset, slice.endOffset, passage);
      }
      return true;
    };

    let highlighted = 0;
    let unmatched = 0;
    for (const passage of passages) {
      const quote = stripEdgeQuotes(normalizeAnchor(passage.quote));
      const prefix = normalizeAnchor(passage.prefix);
      const suffix = normalizeAnchor(passage.suffix);
      const built = roots.map((root) => buildNormalized(collectText(root)));
      let hits: PassageHit[] = [];
      for (const { normalized, map } of built) {
        hits.push(...exactHitsIn(normalized, map, quote, prefix, suffix, false));
      }
      if (hits.length === 0) {
        for (const { normalized, map } of built) {
          hits.push(...exactHitsIn(normalized, map, quote, prefix, suffix, true));
        }
      }
      const chosen = choosePassageHit(hits, prefix, suffix);
      if (chosen && paintHit(chosen, passage)) highlighted += 1;
      else unmatched += 1;
    }
    return { ok: true, highlighted, unmatched };
  } catch {
    try { clearHighlights(); } catch { /* The page is left unmarked when painting fails. */ }
    return { ok: false, reason: 'invalid-request' };
  }
}
