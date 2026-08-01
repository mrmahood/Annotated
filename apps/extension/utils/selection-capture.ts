export type CapturedArticleSelection = {
  selectedText: string;
  textPrefix: string;
  textSuffix: string;
  pageTitle: string;
  sourceUrl: string;
  canonicalUrl: string;
  hostname: string;
  author: string | null;
  publisher: string | null;
  capturedAt: string;
};

export type SelectionExtractionResult =
  | {
      ok: true;
      data: CapturedArticleSelection;
    }
  | {
      ok: false;
      reason: 'NO_SELECTION' | 'SELECTION_TOO_LONG' | 'INVALID_PAGE';
      message: string;
    };

export type CaptureState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'captured'; data: CapturedArticleSelection }
  | { status: 'recoverable-error'; message: string }
  | { status: 'reconnect-required'; message: string }
  | { status: 'unexpected-error'; message: string };

// This function is serialized by chrome.scripting.executeScript. Keep every
// value and helper it uses inside the function body.
export function extractSelectionFromPage(): SelectionExtractionResult {
  const noSelectionMessage =
    'Highlight a passage on the page, then try again.';
  const selectionTooLongMessage =
    'Selections can contain up to 2,000 characters. Choose a shorter passage and try again.';
  const invalidPageMessage = 'Annotated cannot capture text from this page.';
  const maximumSelectionLength = 2_000;
  const contextLength = 120;

  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

  const isUsableTextNode = (node: Node): node is Text => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent) {
      return false;
    }

    const parent = node.parentElement;

    if (
      !parent ||
      parent.closest('script, style, noscript, template, svg, canvas')
    ) {
      return false;
    }

    const style = window.getComputedStyle(parent);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };

  const previousNode = (node: Node, traversalRoot: Node): Node | null => {
    if (node.previousSibling) {
      let candidate = node.previousSibling;

      while (candidate.lastChild) {
        candidate = candidate.lastChild;
      }

      return candidate;
    }

    const parent = node.parentNode;
    return parent && parent !== traversalRoot ? parent : null;
  };

  const nextNode = (node: Node, traversalRoot: Node): Node | null => {
    if (node.firstChild) {
      return node.firstChild;
    }

    let candidate: Node | null = node;

    while (candidate && candidate !== traversalRoot) {
      if (candidate.nextSibling) {
        return candidate.nextSibling;
      }

      candidate = candidate.parentNode;
    }

    return null;
  };

  const getTraversalRoot = (node: Node): Node => {
    const root = node.getRootNode();

    if (root instanceof ShadowRoot) {
      return root;
    }

    return document.body ?? document.documentElement;
  };

  const collectPrefix = (container: Node, offset: number): string => {
    const traversalRoot = getTraversalRoot(container);
    const chunks: string[] = [];
    let characterBudget = contextLength * 3;
    let visitedNodes = 0;
    let candidate: Node | null;

    if (container.nodeType === Node.TEXT_NODE) {
      const localText = (container.textContent ?? '').slice(0, offset);
      const localSlice = localText.slice(-characterBudget);
      chunks.unshift(localSlice);
      characterBudget -= localSlice.length;
      candidate = previousNode(container, traversalRoot);
    } else {
      const childBeforeBoundary = container.childNodes.item(offset - 1);

      if (childBeforeBoundary) {
        candidate = childBeforeBoundary;
        while (candidate.lastChild) {
          candidate = candidate.lastChild;
        }
      } else {
        candidate = previousNode(container, traversalRoot);
      }
    }

    while (candidate && characterBudget > 0 && visitedNodes < 250) {
      if (isUsableTextNode(candidate)) {
        const slice = candidate.data.slice(-characterBudget);
        chunks.unshift(slice);
        characterBudget -= slice.length;
      }

      candidate = previousNode(candidate, traversalRoot);
      visitedNodes += 1;
    }

    return normalizeText(chunks.join(' ')).slice(-contextLength).trim();
  };

  const collectSuffix = (container: Node, offset: number): string => {
    const traversalRoot = getTraversalRoot(container);
    const chunks: string[] = [];
    let characterBudget = contextLength * 3;
    let visitedNodes = 0;
    let candidate: Node | null;

    if (container.nodeType === Node.TEXT_NODE) {
      const localText = (container.textContent ?? '').slice(offset);
      const localSlice = localText.slice(0, characterBudget);
      chunks.push(localSlice);
      characterBudget -= localSlice.length;
      candidate = nextNode(container, traversalRoot);
    } else {
      candidate = container.childNodes.item(offset) ?? nextNode(container, traversalRoot);
    }

    while (candidate && characterBudget > 0 && visitedNodes < 250) {
      if (isUsableTextNode(candidate)) {
        const slice = candidate.data.slice(0, characterBudget);
        chunks.push(slice);
        characterBudget -= slice.length;
      }

      candidate = nextNode(candidate, traversalRoot);
      visitedNodes += 1;
    }

    return normalizeText(chunks.join(' ')).slice(0, contextLength).trim();
  };

  const firstMetaContent = (selectors: string[]): string | null => {
    for (const selector of selectors) {
      const content = document.querySelector<HTMLMetaElement>(selector)?.content;

      if (content?.trim()) {
        return normalizeText(content);
      }
    }

    return null;
  };

  try {
    if (
      !document.documentElement ||
      window.top !== window ||
      (location.protocol !== 'http:' && location.protocol !== 'https:')
    ) {
      return {
        ok: false,
        reason: 'INVALID_PAGE',
        message: invalidPageMessage,
      };
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return {
        ok: false,
        reason: 'NO_SELECTION',
        message: noSelectionMessage,
      };
    }

    const range = selection.getRangeAt(0);
    const selectedText = normalizeText(selection.toString());

    if (!selectedText) {
      return {
        ok: false,
        reason: 'NO_SELECTION',
        message: noSelectionMessage,
      };
    }

    if (selectedText.length > maximumSelectionLength) {
      return {
        ok: false,
        reason: 'SELECTION_TOO_LONG',
        message: selectionTooLongMessage,
      };
    }

    let textPrefix = '';
    let textSuffix = '';

    try {
      textPrefix = collectPrefix(range.startContainer, range.startOffset);
    } catch {
      // Context is best effort and must not block capture.
    }

    try {
      textSuffix = collectSuffix(range.endContainer, range.endOffset);
    } catch {
      // Context is best effort and must not block capture.
    }

    const sourceUrl = location.href;
    let canonicalUrl = sourceUrl;
    const canonicalHref = document
      .querySelector<HTMLLinkElement>('link[rel~="canonical"]')
      ?.getAttribute('href')
      ?.trim();

    if (canonicalHref) {
      try {
        const resolvedCanonicalUrl = new URL(canonicalHref, sourceUrl);

        if (
          resolvedCanonicalUrl.protocol === 'http:' ||
          resolvedCanonicalUrl.protocol === 'https:'
        ) {
          canonicalUrl = resolvedCanonicalUrl.href;
        }
      } catch {
        // Invalid canonical URLs fall back to the source URL.
      }
    }

    return {
      ok: true,
      data: {
        selectedText,
        textPrefix,
        textSuffix,
        pageTitle: document.title || '',
        sourceUrl,
        canonicalUrl,
        hostname: location.hostname,
        author: firstMetaContent([
          'meta[name="author"]',
          'meta[property="article:author"]',
          'meta[name="byl"]',
          'meta[name="parsely-author"]',
        ]),
        publisher: firstMetaContent([
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
          'meta[name="publisher"]',
        ]),
        capturedAt: new Date().toISOString(),
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'INVALID_PAGE',
      message: invalidPageMessage,
    };
  }
}
