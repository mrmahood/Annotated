import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSelectionFromPage } from './selection-capture.ts';

const QUOTE = '"Not a single drop has come through our taps for the last three months... Our water supply had been reliable until the data centres came," Dewi Susanti, one of the protesters, told the BBC.';
const BEFORE = 'Residents had described reliable taps before the centres arrived.';
const AFTER = 'The utility and BP Batam point to other causes for the shortage today.';

function installCaptureDom(paragraphs, selectedText, buildRange) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    window: globalThis.window,
    Node: globalThis.Node,
    ShadowRoot: globalThis.ShadowRoot,
  };

  class ShadowRoot {}
  globalThis.ShadowRoot = ShadowRoot;
  globalThis.Node = { TEXT_NODE: 3 };

  const createText = (value) => ({
    nodeType: 3,
    textContent: value,
    data: value,
    parentNode: null,
    parentElement: null,
    childNodes: [],
    previousSibling: null,
    nextSibling: null,
    firstChild: null,
    lastChild: null,
    getRootNode() { return document; },
  });

  const createElement = (tagName) => {
    const element = {
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      parentNode: null,
      parentElement: null,
      childNodes: [],
      previousSibling: null,
      nextSibling: null,
      firstChild: null,
      lastChild: null,
      closest() { return null; },
      getRootNode() { return document; },
    };
    element.childNodes.item = (index) => element.childNodes[index] ?? null;
    return element;
  };

  const appendChild = (parent, child) => {
    const previousChild = parent.childNodes[parent.childNodes.length - 1] ?? null;
    if (previousChild) {
      previousChild.nextSibling = child;
      child.previousSibling = previousChild;
    }
    parent.childNodes.push(child);
    parent.firstChild = parent.childNodes[0];
    parent.lastChild = child;
    child.parentNode = parent;
    child.parentElement = parent.nodeType === 1 ? parent : parent.parentElement;
    return child;
  };

  const body = createElement('body');
  const documentElement = createElement('html');
  appendChild(documentElement, body);
  const blocks = paragraphs.map((paragraph) => {
    const element = createElement('p');
    appendChild(element, createText(paragraph));
    appendChild(body, element);
    return element;
  });

  const document = {
    body,
    documentElement,
    title: 'Capture fixture',
    querySelector() { return null; },
  };
  for (const block of blocks) {
    for (const child of block.childNodes) child.getRootNode = () => document;
    block.getRootNode = () => document;
  }
  body.getRootNode = () => document;

  globalThis.document = document;
  globalThis.location = {
    protocol: 'https:',
    href: 'https://www.bbc.com/news/articles/cqj6j7wlxd5eo',
    hostname: 'www.bbc.com',
  };
  const range = buildRange(blocks);
  const window = {
    top: null,
    getSelection() {
      return {
        rangeCount: 1,
        toString() { return selectedText; },
        getRangeAt() { return range; },
      };
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
  };
  window.top = window;
  globalThis.window = window;

  return {
    blocks,
    restore() {
      globalThis.document = previous.document;
      globalThis.location = previous.location;
      globalThis.window = previous.window;
      globalThis.Node = previous.Node;
      globalThis.ShadowRoot = previous.ShadowRoot;
    },
  };
}

test('a selection that ends on the paragraph element takes the suffix from the text after it', () => {
  const dom = installCaptureDom([BEFORE, QUOTE, AFTER], QUOTE, (blocks) => {
    const quoteParagraph = blocks[1];
    return {
      startContainer: quoteParagraph.firstChild,
      startOffset: 0,
      endContainer: quoteParagraph,
      endOffset: quoteParagraph.childNodes.length,
    };
  });
  try {
    const result = extractSelectionFromPage();
    assert.equal(result.ok, true);
    assert.equal(result.data.selectedText, QUOTE);
    assert.equal(result.data.textPrefix, BEFORE);
    assert.equal(result.data.textSuffix, AFTER);
    assert.equal(result.data.textSuffix.startsWith(QUOTE.slice(0, 120)), false);
  } finally {
    dom.restore();
  }
});

test('a selection that ends inside a text node keeps the suffix after that offset', () => {
  const passage = `${BEFORE} ${QUOTE} ${AFTER}`;
  const start = passage.indexOf(QUOTE);
  const dom = installCaptureDom([passage], QUOTE, (blocks) => {
    const text = blocks[0].firstChild;
    return {
      startContainer: text,
      startOffset: start,
      endContainer: text,
      endOffset: start + QUOTE.length,
    };
  });
  try {
    const result = extractSelectionFromPage();
    assert.equal(result.ok, true);
    assert.equal(result.data.textPrefix, BEFORE);
    assert.equal(result.data.textSuffix, AFTER);
  } finally {
    dom.restore();
  }
});

test('an element boundary at offset 0 still starts the suffix at that element', () => {
  const dom = installCaptureDom([BEFORE, AFTER], BEFORE, (blocks) => ({
    startContainer: blocks[0].firstChild,
    startOffset: 0,
    endContainer: blocks[1],
    endOffset: 0,
  }));
  try {
    const result = extractSelectionFromPage();
    assert.equal(result.ok, true);
    assert.equal(result.data.selectedText, BEFORE);
    assert.equal(result.data.textSuffix, AFTER);
  } finally {
    dom.restore();
  }
});
