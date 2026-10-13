import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPassageHighlightsOnPage } from './passage-highlight-page.ts';

const PAGE = 'https://example.com/harbor';
const QUOTE = 'The harbor commission recorded that the amber lighthouse kept its beam on the north channel through the night watch.';
const ANNOTATION_ID = 'b1000000-0000-4000-8000-0000000000b2';
const OTHER_ID = 'b1000000-0000-4000-8000-0000000000c2';

function installDom(paragraphs, options = {}) {
  const listeners = [];
  const messages = [];

  class CSSStyleSheet {
    replaceSync(css) {
      if (options.csp) throw new Error('Refused to apply inline style');
      this.css = css;
    }
  }

  const createText = (value) => {
    const node = {
      nodeType: 3,
      textContent: value,
      parentNode: null,
      childNodes: [],
    };
    return node;
  };

  const createElement = (tagName) => {
    const element = {
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      parentNode: null,
      childNodes: [],
      shadowRoot: null,
      attributes: {},
      title: '',
      listeners: {},
      adoptedStyleSheets: [],
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      appendChild(child) { return insertChild(this, child, null); },
      insertBefore(child, reference) { return insertChild(this, child, reference); },
      removeChild(child) {
        this.childNodes = this.childNodes.filter((entry) => entry !== child);
        child.parentNode = null;
        return child;
      },
      addEventListener(type, listener) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type].push(listener);
      },
      attachShadow() {
        const shadow = createRoot();
        shadow.host = this;
        this.shadowRoot = shadow;
        return shadow;
      },
      remove() { this.parentNode?.removeChild(this); },
      click() {
        const event = { preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
        const originalPrevent = event.preventDefault;
        event.preventDefault = () => { event.defaultPrevented = true; originalPrevent(); };
        for (const listener of this.listeners.click ?? []) listener(event);
        return event;
      },
    };
    Object.defineProperty(element, 'textContent', {
      get() { return this.childNodes.map((child) => child.textContent).join(''); },
      set(value) {
        this.childNodes = [];
        if (value) this.appendChild(createText(String(value)));
      },
    });
    return element;
  };

  const createRoot = () => {
    const root = {
      nodeType: 11,
      parentNode: null,
      childNodes: [],
      host: null,
      adoptedStyleSheets: [],
      appendChild(child) { return insertChild(this, child, null); },
      insertBefore(child) { return insertChild(this, child, null); },
      removeChild(child) {
        this.childNodes = this.childNodes.filter((entry) => entry !== child);
        child.parentNode = null;
        return child;
      },
    };
    return root;
  };

  function insertChild(parent, child, reference) {
    if (child.nodeType === 11) {
      for (const nested of [...child.childNodes]) insertChild(parent, nested, reference);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = parent;
    const index = reference ? parent.childNodes.indexOf(reference) : -1;
    if (index >= 0) parent.childNodes.splice(index, 0, child);
    else parent.childNodes.push(child);
    return child;
  }

  const body = createElement('body');
  const documentElement = createElement('html');
  documentElement.appendChild(body);
  for (const paragraph of paragraphs) {
    if (paragraph.shadow) {
      const host = createElement('div');
      const shadow = host.attachShadow();
      const inner = createElement('p');
      inner.textContent = paragraph.text;
      shadow.appendChild(inner);
      body.appendChild(host);
      continue;
    }
    const element = createElement(paragraph.tag ?? 'p');
    element.textContent = paragraph.text;
    body.appendChild(element);
  }

  const document = {
    body,
    documentElement,
    createElement,
    createRange() {
      const range = {
        startContainer: null,
        startOffset: 0,
        endOffset: 0,
        setStart(node, offset) {
          this.startContainer = node;
          this.startOffset = offset;
        },
        setEnd(node, offset) { this.endOffset = offset; },
        extractContents() {
          const node = this.startContainer;
          const text = node.textContent;
          const before = text.slice(0, this.startOffset);
          const middle = text.slice(this.startOffset, this.endOffset);
          const after = text.slice(this.endOffset);
          node.textContent = before;
          const parent = node.parentNode;
          const siblings = parent.childNodes;
          const following = siblings[siblings.indexOf(node) + 1] ?? null;
          const afterNode = after ? createText(after) : null;
          if (afterNode) parent.insertBefore(afterNode, following);
          this.insertParent = parent;
          this.insertBeforeNode = afterNode ?? following;
          const fragment = createRoot();
          fragment.appendChild(createText(middle));
          return fragment;
        },
        insertNode(node) {
          this.insertParent.insertBefore(node, this.insertBeforeNode);
        },
      };
      return range;
    },
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener() {},
  };

  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    getComputedStyle: globalThis.getComputedStyle,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    chrome: globalThis.chrome,
  };
  globalThis.document = document;
  globalThis.location = { href: options.href ?? PAGE };
  globalThis.CSSStyleSheet = CSSStyleSheet;
  globalThis.getComputedStyle = (element) => {
    const sheet = element.shadowRoot?.adoptedStyleSheets?.[0];
    const background = String(sheet?.css || '').includes('#ffe14a')
      ? 'rgb(255, 225, 74)'
      : 'rgba(0, 0, 0, 0)';
    return { display: 'block', visibility: 'visible', backgroundColor: background };
  };
  globalThis.chrome = {
    runtime: {
      sendMessage(message) { messages.push(message); },
    },
  };

  const marks = () => {
    const found = [];
    const visit = (node) => {
      if (node?.nodeType === 1 && node.tagName === 'ANNOTATED-PASSAGE' && node.getAttribute('data-annotated-passage-probe') !== '1') {
        found.push(node);
      }
      if (node?.shadowRoot) visit(node.shadowRoot);
      for (const child of node?.childNodes ?? []) visit(child);
    };
    visit(documentElement);
    return found;
  };

  return {
    messages,
    marks,
    restore() {
      globalThis.document = previous.document;
      globalThis.location = previous.location;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.CSSStyleSheet = previous.CSSStyleSheet;
      globalThis.chrome = previous.chrome;
    },
  };
}

function passage(overrides = {}) {
  return {
    annotationId: ANNOTATION_ID,
    quote: QUOTE,
    prefix: 'A later note said the amber lighthouse kept its beam on the south shoal until dawn. ',
    suffix: ' The record is the passage this demo annotation marks.',
    color: 'yellow',
    ...overrides,
  };
}

test('exact quote plus prefix and suffix highlights only the matching passage', () => {
  const dom = installDom([
    { text: 'A later note said the amber lighthouse kept its beam on the south shoal until dawn.' },
    { text: QUOTE },
    { text: 'The record is the passage this demo annotation marks.' },
    { text: `Someone misquoted the log as: ${QUOTE} That retelling left out the tide.` },
  ]);
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage()] });
    assert.equal(result.ok, true);
    assert.equal(result.highlighted, 1);
    assert.equal(result.unmatched, 0);
    const marks = dom.marks();
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, QUOTE);
    assert.equal(marks[0].getAttribute('data-annotated-color'), 'yellow');
    marks[0].click();
    assert.deepEqual(dom.messages, [{
      type: 'annotated-passage-open',
      annotationId: ANNOTATION_ID,
    }]);
  } finally {
    dom.restore();
  }
});

test('a repeated quote inside an open shadow root is not highlighted when context does not match', () => {
  const dom = installDom([
    { text: 'A later note said the amber lighthouse kept its beam on the south shoal until dawn.' },
    { text: QUOTE },
    { text: 'The record is the passage this demo annotation marks.' },
    { shadow: true, text: `Inside an open shadow root, a different telling says ${QUOTE} The shadow copy is not the seeded passage.` },
  ]);
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage()] });
    assert.equal(result.highlighted, 1);
    assert.equal(dom.marks().map((mark) => mark.textContent).join(''), QUOTE);
  } finally {
    dom.restore();
  }
});

test('shadow-root passages highlight when the quote and context live there', () => {
  const dom = installDom([
    { text: 'The light DOM does not contain the log.' },
    { shadow: true, text: `A later note said the amber lighthouse kept its beam on the south shoal until dawn. ${QUOTE} The record is the passage this demo annotation marks.` },
  ]);
  try {
    const result = applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [passage({ color: 'not-a-color' })],
    });
    assert.equal(result.highlighted, 1);
    const marks = dom.marks();
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, QUOTE);
    assert.equal(marks[0].getAttribute('data-annotated-color'), 'yellow');
    assert.match(marks[0].shadowRoot.adoptedStyleSheets[0].css, /#ffe14a/);
  } finally {
    dom.restore();
  }
});

test('verdict colors stay inside the shadow stylesheet', () => {
  const dom = installDom([{ text: 'Alpha beta gamma delta epsilon zeta eta theta.' }]);
  try {
    const result = applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [{
        annotationId: OTHER_ID,
        quote: 'Alpha beta gamma delta epsilon zeta eta theta.',
        color: 'red',
      }],
    });
    assert.equal(result.highlighted, 1);
    assert.match(dom.marks()[0].shadowRoot.adoptedStyleSheets[0].css, /#ffb3b3/);
  } finally {
    dom.restore();
  }
});

test('a stored prefix that no longer matches does not highlight the remaining quote', () => {
  const dom = installDom([{ text: `Edited introduction. ${QUOTE} Edited ending.` }]);
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage()] });
    assert.equal(result.highlighted, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('an edited passage is not highlighted approximately', () => {
  const live = 'The harbor commission noted that the amber lighthouse kept its beam on the north channel through the night watch.';
  const dom = installDom([{ text: `Intro. ${live} Outro stays in place for the rest of the page.` }]);
  try {
    const result = applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [passage({ prefix: '', suffix: '' })],
    });
    assert.equal(result.ok, true);
    assert.equal(result.highlighted, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('a quote that no longer matches exactly is not bracketed by its prefix and suffix', () => {
  const live = 'The harbor commission noted that the amber lighthouse kept its beam on the north channel through the night watch.';
  const dom = installDom([{
    text: `A later note said the amber lighthouse kept its beam on the south shoal until dawn. ${live} The record is the passage this demo annotation marks.`,
  }]);
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage()] });
    assert.equal(result.highlighted, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('two annotations sharing one quote do not paint the misquote', () => {
  const dom = installDom([
    { text: 'A later note said the amber lighthouse kept its beam on the south shoal until dawn.' },
    { text: QUOTE },
    { text: 'The record is the passage this demo annotation marks.' },
    { tag: 'blockquote', text: `Someone misquoted the log as: ${QUOTE} That retelling left out the tide.` },
  ]);
  try {
    const result = applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [
        passage({ color: 'green' }),
        passage({ annotationId: OTHER_ID, color: 'red' }),
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.highlighted, 2);
    assert.equal(result.unmatched, 0);
    const marks = dom.marks();
    assert.equal(marks.length, 2);
    assert.deepEqual(
      marks.map((mark) => mark.getAttribute('data-annotated-passage')).sort(),
      [ANNOTATION_ID, OTHER_ID].sort(),
    );
    for (const mark of marks) {
      assert.equal(mark.textContent, QUOTE);
      let parent = mark.parentNode;
      const tags = [];
      while (parent) {
        if (parent.tagName) tags.push(parent.tagName);
        parent = parent.parentNode;
      }
      assert.equal(tags.includes('BLOCKQUOTE'), false);
      assert.equal(tags.includes('P'), true);
    }
    const blockquote = globalThis.document.body.childNodes.find((node) => node.tagName === 'BLOCKQUOTE');
    assert.equal(blockquote.textContent.includes(QUOTE), true);
    assert.equal(blockquote.childNodes.some((node) => node.tagName === 'ANNOTATED-PASSAGE'), false);
  } finally {
    dom.restore();
  }
});

test('repeated exact quotes with no context are left unmarked', () => {
  const dom = installDom([
    { text: QUOTE },
    { tag: 'blockquote', text: `Someone misquoted the log as: ${QUOTE} That retelling left out the tide.` },
  ]);
  try {
    const result = applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [passage({ prefix: '', suffix: '' })],
    });
    assert.equal(result.highlighted, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('CSP style failure leaves the page unmarked', () => {
  const dom = installDom([{ text: QUOTE }], { csp: true });
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage({ prefix: '', suffix: '' })] });
    assert.deepEqual(result, {
      ok: false,
      reason: 'csp-blocked',
      highlighted: 0,
      unmatched: 1,
    });
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('a navigated page is not highlighted', () => {
  const dom = installDom([{ text: QUOTE }], { href: 'https://example.com/other' });
  try {
    const result = applyPassageHighlightsOnPage({ pageUrl: PAGE, passages: [passage({ prefix: '', suffix: '' })] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'source-mismatch');
    assert.equal(dom.marks().length, 0);
  } finally {
    dom.restore();
  }
});

test('reapplying highlights does not nest marks', () => {
  const dom = installDom([{ text: QUOTE }]);
  try {
    applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [passage({ prefix: '', suffix: '' })],
    });
    applyPassageHighlightsOnPage({
      pageUrl: PAGE,
      passages: [passage({ prefix: '', suffix: '' })],
    });
    const marks = dom.marks();
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, QUOTE);
    assert.equal(marks[0].query?.() ?? marks[0].childNodes.some((child) => child.tagName === 'ANNOTATED-PASSAGE'), false);
  } finally {
    dom.restore();
  }
});
