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
        tag === 'TEXTAREA' || tag === 'ANNOTATED-PASSAGE'
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

  const locatePassage = (
    haystack: string,
    quoteValue: string,
    prefixValue: string,
    suffixValue: string,
  ): { start: number; end: number } | null => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const quote = normalize(quoteValue).replace(/^[\u201C\u201D\u2018\u2019"']+|[\u201C\u201D\u2018\u2019"']+$/g, '').trim();
    const prefix = normalize(prefixValue);
    const suffix = normalize(suffixValue);
    if (!haystack || !quote) return null;

    const lowerIfSameLength = (value: string) => {
      const lower = value.toLowerCase();
      return lower.length === value.length ? lower : null;
    };

    const allIndexes = (needle: string, caseFold: boolean): number[] => {
      if (!needle || needle.length > haystack.length) return [];
      const source = caseFold ? lowerIfSameLength(haystack) : haystack;
      const target = caseFold ? lowerIfSameLength(needle) : needle;
      if (!source || !target) return [];
      const indexes: number[] = [];
      let from = 0;
      while (from <= source.length - target.length && indexes.length < 12) {
        const index = source.indexOf(target, from);
        if (index < 0) break;
        indexes.push(index);
        from = index + 1;
      }
      return indexes;
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

    const pickExact = (indexes: number[]) => {
      if (indexes.length === 0) return null;
      const hits = indexes.map((start) => ({ start, end: start + quote.length, score: contextScore(start, start + quote.length) }));
      if (hits.length === 1) return hits[0];
      if (!prefix && !suffix) return null;
      const ranked = [...hits].sort((left, right) => right.score - left.score);
      const best = ranked[0];
      const second = ranked[1];
      if (!best || best.score < 0.72) return null;
      if (second && best.score - second.score < 0.2) return null;
      return best;
    };

    const exact = pickExact(allIndexes(quote, false)) ?? pickExact(allIndexes(quote, true));
    if (exact) return { start: exact.start, end: exact.end };
    if (allIndexes(quote, false).length > 0 || allIndexes(quote, true).length > 0) return null;

    const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
    const dice = (left: string, right: string) => {
      if (!left || !right) return 0;
      if (left === right) return 1;
      if (left.length < 2 || right.length < 2) return 0;
      const counts = new Map<string, number>();
      for (let index = 0; index < left.length - 1; index += 1) {
        const gram = left.slice(index, index + 2);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
      let hits = 0;
      for (let index = 0; index < right.length - 1; index += 1) {
        const gram = right.slice(index, index + 2);
        const count = counts.get(gram) ?? 0;
        if (count > 0) {
          hits += 1;
          counts.set(gram, count - 1);
        }
      }
      return (2 * hits) / (left.length + right.length - 2);
    };

    const separated = (
      left: { start: number; end: number },
      right: { start: number; end: number },
    ) => left.end <= right.start || right.end <= left.start;

    const chooseFuzzy = (
      candidates: { start: number; end: number; score: number }[],
      minimum: number,
    ) => {
      const ranked = candidates.filter((candidate) => candidate.score >= minimum)
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      if (!best) return null;
      const rival = ranked.find((candidate) => separated(candidate, best));
      if (rival && best.score - rival.score < 0.05) return null;
      return best;
    };

    if (prefix.length >= 8 && suffix.length >= 8) {
      const prefixIndexes = allIndexes(prefix, true);
      const foldedQuote = fold(quote);
      const candidates: { start: number; end: number; score: number }[] = [];
      for (const prefixStart of prefixIndexes) {
        const from = prefixStart + prefix.length;
        const window = haystack.slice(from, from + Math.min(4000, Math.max(quote.length * 2, 80) + suffix.length));
        const suffixFold = lowerIfSameLength(suffix);
        const windowFold = lowerIfSameLength(window);
        const suffixAt = suffixFold && windowFold ? windowFold.indexOf(suffixFold) : -1;
        if (suffixAt < 0) continue;
        const leading = window.slice(0, suffixAt).match(/^\s*/)?.[0].length ?? 0;
        const start = from + leading;
        const end = from + suffixAt;
        const candidate = haystack.slice(start, end).trim();
        if (candidate.length < quote.length * 0.5 || candidate.length > quote.length * 1.8) continue;
        candidates.push({ start, end, score: dice(fold(candidate), foldedQuote) });
      }
      const bracket = chooseFuzzy(candidates, 0.62);
      if (bracket) {
        let start = bracket.start;
        let end = bracket.end;
        while (start < end && /\s/.test(haystack[start] ?? '')) start += 1;
        while (end > start && /\s/.test(haystack[end - 1] ?? '')) end -= 1;
        return { start, end };
      }
    }

    const words = quote.split(' ').filter(Boolean);
    if (words.length < 4 && quote.length < 40) return null;
    const spans: { start: number; end: number }[] = [];
    const wordPattern = /\S+/g;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordPattern.exec(haystack))) {
      spans.push({ start: wordMatch.index, end: wordMatch.index + wordMatch[0].length });
    }
    const foldedQuote = fold(quote);
    const widths = words.length >= 4 ? [words.length - 1, words.length, words.length + 1] : [words.length];
    const fuzzyCandidates: { start: number; end: number; score: number }[] = [];
    for (const width of widths) {
      if (width < 3) continue;
      for (let index = 0; index <= spans.length - width; index += 1) {
        const start = spans[index]?.start ?? 0;
        const end = spans[index + width - 1]?.end ?? start;
        const score = dice(fold(haystack.slice(start, end)), foldedQuote);
        if (score >= 0.78) fuzzyCandidates.push({ start, end, score });
      }
    }
    const fuzzy = chooseFuzzy(fuzzyCandidates, 0.78);
    if (!fuzzy) return null;
    if ((prefix || suffix) && contextScore(fuzzy.start, fuzzy.end) < 0.34) return null;
    return { start: fuzzy.start, end: fuzzy.end };
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

    let highlighted = 0;
    let unmatched = 0;
    for (const passage of passages) {
      let painted = false;
      for (const root of roots) {
        const { normalized, map } = buildNormalized(collectText(root));
        const located = locatePassage(normalized, passage.quote, passage.prefix, passage.suffix);
        if (!located) continue;
        const slices: { node: Text; startOffset: number; endOffset: number }[] = [];
        let index = located.start;
        let slicesValid = true;
        while (index < located.end) {
          const point = map[index];
          if (!point) {
            slicesValid = false;
            break;
          }
          let next = index + 1;
          while (next < located.end && map[next]?.node === point.node) next += 1;
          const endPoint = map[next - 1];
          if (!endPoint) {
            slicesValid = false;
            break;
          }
          slices.push({
            node: point.node,
            startOffset: point.offset,
            endOffset: endPoint.offset + 1,
          });
          index = next;
        }
        if (!slicesValid || slices.length === 0) continue;
        for (let sliceIndex = slices.length - 1; sliceIndex >= 0; sliceIndex -= 1) {
          const slice = slices[sliceIndex];
          if (!slice || slice.startOffset >= slice.endOffset) continue;
          paintSlice(slice.node, slice.startOffset, slice.endOffset, passage);
        }
        painted = true;
        break;
      }
      if (painted) highlighted += 1;
      else unmatched += 1;
    }
    return { ok: true, highlighted, unmatched };
  } catch {
    try { clearHighlights(); } catch { /* The page is left unmarked when painting fails. */ }
    return { ok: false, reason: 'invalid-request' };
  }
}
