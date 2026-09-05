import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyArticleHoverHighlightOnPage,
  ARTICLE_HOVER_HIGHLIGHT_NAME,
  ARTICLE_HOVER_PREFIX_MIN_CHARS,
  ARTICLE_HOVER_ROOT_ID,
  clearArticleHoverHighlightOnPage,
  dropIncompleteLeadingArticleToken,
  findArticleHoverNormalizedMatch,
  findLongestUniquePrefixMatch,
  findLongestUniqueSuffixMatch,
  findUniqueNormalizedMatch,
  normalizeArticleHoverPageUrl,
  normalizeArticleHoverText,
  prepareArticlePassageQuery,
  takeLeadingNormalizedWindow,
  takeTrailingNormalizedWindow,
} from './article-hover-page.ts';

const ARTICLE = 'https://example.com/story';
const OTHER = 'https://example.com/other';
const PASSAGE = 'The unique passage on this page.';
const IRAN_STORED = '. Central Command announced that as of Friday, the ongoing U.S. military blockade of Iranian ports has redirected 62 commerci';
const IRAN_CLEANED = 'Central Command announced that as of Friday, the ongoing U.S. military blockade of Iranian ports has redirected 62';
const IRAN_LIVE = 'U.S. Central Command announced that as of Friday, the ongoing U.S. military blockade of Iranian ports has redirected 62 commercial ships through the Strait of Hormuz.';
const PREFIX_STORED = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone missingtail.';
const PREFIX_LIVE = 'Intro. Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone. Outro.';
const PREFIX_MATCH = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone';
const ENES_STORED = 'dom exercised his constitutional right as an American when he attended the WNBA game in Chicago," AFPI chief legal affairs officer Leigh Ann O’Neill said in a statement. "Today, we launched an investigation, seeking critical documents that will assist in our efforts to ensure that public entities are held ac';
const ENES_CLEANED = 'exercised his constitutional right as an American when he attended the WNBA game in Chicago," AFPI chief legal affairs officer Leigh Ann O’Neill said in a statement. "Today, we launched an investigation, seeking critical documents that will assist in our efforts to ensure that public entities are held';
const ENES_LIVE_SENTENCE = 'Freedom exercised his constitutional right as an American when he attended the WNBA game in Chicago," AFPI chief legal affairs officer Leigh Ann O’Neill said in a statement.';
const ENES_LIVE = `Intro. ${ENES_LIVE_SENTENCE} The rest of the capture is not on this live excerpt.`;
const SUFFIX_STORED = 'Wrongstart Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone.';
const SUFFIX_LIVE = 'Intro. Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone. Outro.';
const SUFFIX_MATCH = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet unique landing zone.';

function withPage(callback, overrides = {}) {
  const names = [
    'location', 'document', 'window', 'history', 'HTMLElement', 'HTMLStyleElement',
    'getComputedStyle', 'CSS', 'Highlight',
  ];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const listeners = { scroll: [], resize: [] };
  const nodes = new Map();
  const highlights = new Map();
  const scrollCalls = [];

  class ElementStub {
    constructor(tagName, id = '') {
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.children = [];
      this.childNodes = [];
      this.parentElement = null;
      this.attributes = {};
      this.dataset = {};
      this.hidden = false;
      this.style = { cssText: '' };
      this.className = '';
      this.textContent = '';
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') {
        this.id = String(value);
        nodes.set(String(value), this);
      }
    }
    appendChild(child) {
      child.parentElement = this;
      this.childNodes.push(child);
      if (child.nodeType === 1) this.children.push(child);
      if (child.id) nodes.set(child.id, child);
      return child;
    }
    replaceChildren(...next) {
      for (const child of this.childNodes) child.parentElement = null;
      this.childNodes = [];
      this.children = [];
      for (const child of next) this.appendChild(child);
    }
    remove() {
      if (this.id) nodes.delete(this.id);
      if (this.parentElement) {
        this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this);
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
      }
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        if (node.nodeType === 1 && matchesSelector(node, selector)) matches.push(node);
        for (const child of node.childNodes) visit(child);
      };
      for (const child of this.childNodes) visit(child);
      return matches;
    }
    closest(selector) {
      let node = this;
      while (node) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    }
    getBoundingClientRect() {
      return this.rect ?? { left: 40, top: 80, right: 400, bottom: 104, width: 360, height: 24 };
    }
    getClientRects() { return [{}]; }
    scrollIntoView(options) {
      scrollCalls.push({ id: this.id, tagName: this.tagName, options });
    }
  }

  class StyleStub extends ElementStub {
    constructor() {
      super('style');
    }
  }

  class TextStub {
    constructor(text) {
      this.nodeType = 3;
      this.textContent = text;
      this.parentElement = null;
      this.childNodes = [];
    }
  }

  function matchesSelector(node, selector) {
    if (node.nodeType !== 1) return false;
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => {
      if (part.startsWith('#')) return node.id === part.slice(1);
      if (part.startsWith('.')) return node.className.split(/\s+/).includes(part.slice(1));
      if (part.includes('#')) {
        const [tag, id] = part.split('#');
        return node.tagName === tag.toUpperCase() && node.id === id;
      }
      if (part.includes('[')) {
        const name = part.slice(part.indexOf('[') + 1, part.indexOf('='));
        const value = part.slice(part.indexOf('"') + 1, part.lastIndexOf('"'));
        return node.attributes[name] === value;
      }
      return node.tagName === part.toUpperCase();
    });
  }

  const documentElement = new ElementStub('html');
  const head = new ElementStub('head');
  const body = new ElementStub('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const paragraph = new ElementStub('p');
  const text = new TextStub(overrides.bodyText ?? `Intro. ${PASSAGE} Outro.`);
  paragraph.appendChild(text);
  if (!overrides.emptyBody) body.appendChild(paragraph);

  class HighlightStub {
    constructor(range) {
      this.range = range;
    }
  }

  const locationState = {
    href: overrides.url ?? ARTICLE,
    hash: overrides.hash ?? '',
  };
  const historyCalls = [];
  const values = {
    location: locationState,
    HTMLElement: ElementStub,
    HTMLStyleElement: StyleStub,
    Highlight: HighlightStub,
    CSS: { highlights },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement,
      head,
      body,
      createElement: (tag) => tag === 'style' ? new StyleStub() : new ElementStub(tag),
      createRange: () => ({
        startContainer: null,
        startOffset: 0,
        endContainer: null,
        endOffset: 0,
        setStart(node, offset) {
          this.startContainer = node;
          this.startOffset = offset;
        },
        setEnd(node, offset) {
          this.endContainer = node;
          this.endOffset = offset;
        },
        getClientRects() {
          return overrides.noRects
            ? []
            : [{ left: 40, top: 80, right: 400, bottom: 104, width: 360, height: 24 }];
        },
        getBoundingClientRect() {
          return { left: 40, top: 80, right: 400, bottom: 104, width: 360, height: 24 };
        },
      }),
      getElementById: (id) => nodes.get(id) ?? null,
      querySelector: (selector) => documentElement.querySelector(selector),
      querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    },
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (name, fn) => { listeners[name]?.push(fn); },
      removeEventListener: (name, fn) => {
        if (!listeners[name]) return;
        listeners[name] = listeners[name].filter((entry) => entry !== fn);
      },
    },
    history: {
      state: null,
      replaceState(state, title, url) {
        historyCalls.push({ state, title, url });
        if (typeof url === 'string') {
          const next = new URL(url, locationState.href);
          locationState.href = next.href;
          locationState.hash = next.hash;
        }
      },
    },
  };

  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    return callback({
      documentElement, body, highlights, listeners, nodes, text, scrollCalls, historyCalls, locationState,
    });
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('normalizes hover search text and page URLs the same way as article identity', () => {
  assert.equal(normalizeArticleHoverText('  The   unique\npassage  '), 'The unique passage');
  assert.equal(normalizeArticleHoverPageUrl(ARTICLE), ARTICLE);
  assert.equal(
    normalizeArticleHoverPageUrl('https://Example.com/story/?utm_source=feed#quote'),
    ARTICLE,
  );
  assert.equal(normalizeArticleHoverPageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(normalizeArticleHoverPageUrl('https://youtu.be/dQw4w9WgXcQ'), null);
  assert.equal(normalizeArticleHoverPageUrl('javascript:alert(1)'), null);
});

test('safe text match requires a unique whitespace-normalized substring', () => {
  assert.deepEqual(
    findUniqueNormalizedMatch('Intro. The unique passage on this page. Outro.', PASSAGE),
    { start: 7, end: 39 },
  );
  assert.deepEqual(
    findUniqueNormalizedMatch('Intro.\nThe   unique passage on this page.\nOutro.', PASSAGE),
    { start: 7, end: 39 },
  );
  assert.equal(findUniqueNormalizedMatch('No such words here.', PASSAGE), null);
  assert.equal(
    findUniqueNormalizedMatch(`${PASSAGE} and later ${PASSAGE}`, PASSAGE),
    null,
  );
  assert.equal(findUniqueNormalizedMatch('   ', PASSAGE), null);
  assert.equal(findUniqueNormalizedMatch('A page of words.', '   '), null);
});

test('page injector paints an idempotent outline and dim on a unique passage', () => {
  withPage(({ documentElement, highlights, scrollCalls }) => {
    const first = applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    });
    assert.equal(first.ok, true);
    const root = documentElement.querySelector('#annotated-article-hover-root');
    assert.ok(root);
    assert.equal(root.dataset.strength, 'soft');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.09\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /box-shadow:0 0 0 2px rgba\(212, 160, 20, 0\.85\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /background:rgba\(255, 214, 74, 0\.55\)/);
    assert.match(
      documentElement.querySelector('#annotated-article-hover-style').textContent,
      /background-color:rgba\(255, 214, 74, 0\.55\)/,
    );
    assert.equal(highlights.has(ARTICLE_HOVER_HIGHLIGHT_NAME), true);
    assert.ok(scrollCalls.length >= 1);
    assert.deepEqual(scrollCalls[0].options, { block: 'center', inline: 'nearest', behavior: 'smooth' });

    const second = applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: `  ${PASSAGE}  `,
      strength: 'strong',
    });
    assert.equal(second.ok, true);
    assert.equal(documentElement.querySelectorAll('#annotated-article-hover-root').length, 1);
    assert.equal(root.dataset.strength, 'strong');
    assert.match(root.querySelector('[data-annotated-hover-dim="1"]').style.cssText, /rgba\(0,0,0,0\.12\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /box-shadow:0 0 0 3px rgba\(180, 130, 0, 0\.95\)/);
    assert.match(root.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /background:rgba\(255, 214, 74, 0\.72\)/);
    assert.match(
      documentElement.querySelector('#annotated-article-hover-style').textContent,
      /background-color:rgba\(255, 214, 74, 0\.72\)/,
    );

    assert.deepEqual(clearArticleHoverHighlightOnPage(), { ok: true, reason: 'cleared' });
    assert.equal(documentElement.querySelector('#annotated-article-hover-root'), null);
    assert.equal(highlights.has(ARTICLE_HOVER_HIGHLIGHT_NAME), false);
  });
});

test('page injector fails closed off-source, unmatched, or ambiguous text', () => {
  withPage(() => {
    assert.deepEqual(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }), { ok: false, reason: 'source-mismatch' });
  }, { url: OTHER });
  withPage(() => {
    assert.deepEqual(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }), { ok: false, reason: 'source-mismatch' });
  }, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  withPage(() => {
    assert.deepEqual(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: 'This sentence is not on the page.',
      strength: 'soft',
    }), { ok: false, reason: 'text-unmatched' });
  });
  withPage(() => {
    assert.deepEqual(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }), { ok: false, reason: 'text-unmatched' });
  }, { bodyText: `${PASSAGE} then ${PASSAGE}` });
  withPage(() => {
    assert.deepEqual(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }), { ok: false, reason: 'text-unmatched' });
  }, { noRects: true });
});

test('page injector clears a leftover Chrome text-fragment hash after amber apply', () => {
  withPage(({ historyCalls, locationState }) => {
    assert.equal(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }).ok, true);
    assert.equal(historyCalls.length, 1);
    assert.equal(historyCalls[0].url, '/story');
    assert.equal(locationState.hash, '');
  }, {
    url: `${ARTICLE}#:~:text=${encodeURIComponent(PASSAGE)}`,
    hash: `#:~:text=${encodeURIComponent(PASSAGE)}`,
  });

  withPage(({ historyCalls, locationState }) => {
    assert.equal(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }).ok, true);
    assert.equal(historyCalls.length, 1);
    assert.equal(historyCalls[0].url, '/story#intro');
    assert.equal(locationState.hash, '#intro');
  }, {
    url: `${ARTICLE}#intro:~:text=${encodeURIComponent(PASSAGE)}`,
    hash: `#intro:~:text=${encodeURIComponent(PASSAGE)}`,
  });

  withPage(({ historyCalls }) => {
    assert.equal(applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }).ok, true);
    assert.equal(historyCalls.length, 0);
  }, { url: `${ARTICLE}#intro`, hash: '#intro' });
});

test('serialized hover functions stay closure-free and do not throw', () => {
  const apply = Function(`return (${applyArticleHoverHighlightOnPage.toString()})`)();
  const clear = Function(`return (${clearArticleHoverHighlightOnPage.toString()})`)();
  assert.doesNotMatch(applyArticleHoverHighlightOnPage.toString(), /chrome\.|import /);
  withPage(() => {
    assert.equal(apply({
      expectedNormalizedUrl: ARTICLE,
      selectedText: PASSAGE,
      strength: 'soft',
    }).ok, true);
    assert.equal(clear().ok, true);
  });
  withPage(() => {
    assert.equal(apply(null).ok, false);
  });
  assert.equal(ARTICLE_HOVER_ROOT_ID, 'annotated-article-hover-root');
});

const ABC7_PREFIX = 'Because they did not allow him to do a credible fear interview with respect to Guyana, the country that they said they were going to send him to and he was under supervision, it was depriving him of his right to due process, so that is the basis of our habeas corpus, meaning you don\'t have a right to hold him without due process,';
const ABC7_SUFFIX = 'He cannot be removed from the detention center to any country at any time until we are fully finished with these submissions.';
const ABC7_STORED_MIDDLE = "said Alex's attorney Jane Oak";
const ABC7_LIVE_MIDDLE = "said Pereira-Alves' attorney, Jane Oak";
const ABC7_STORED = `${ABC7_PREFIX} ${ABC7_STORED_MIDDLE}. ${ABC7_SUFFIX}`;
const ABC7_LIVE = `${ABC7_PREFIX} ${ABC7_LIVE_MIDDLE}. ${ABC7_SUFFIX}`;

test('exact unique match still wins before anchor recovery', () => {
  assert.deepEqual(
    findArticleHoverNormalizedMatch(`Intro. ${PASSAGE} Outro.`, PASSAGE),
    findUniqueNormalizedMatch(`Intro. ${PASSAGE} Outro.`, PASSAGE),
  );
  assert.ok(takeLeadingNormalizedWindow(ABC7_STORED).length >= 80);
  assert.ok(takeTrailingNormalizedWindow(ABC7_STORED).length >= 80);
});

test('ABC7-style edited middle recovers a unique prefix-to-suffix span', () => {
  assert.equal(findUniqueNormalizedMatch(ABC7_LIVE, ABC7_STORED), null);
  const recovered = findArticleHoverNormalizedMatch(ABC7_LIVE, ABC7_STORED);
  assert.ok(recovered);
  assert.equal(ABC7_LIVE.slice(recovered.start, recovered.end), ABC7_LIVE);
});

test('a single unique long-enough window recovers that window only', () => {
  const leading = takeLeadingNormalizedWindow(ABC7_PREFIX);
  const live = `${ABC7_PREFIX} said Pereira-Alves' attorney, Jane Oak. Completely different closing words live here.`;
  const recovered = findArticleHoverNormalizedMatch(live, ABC7_STORED);
  assert.ok(recovered);
  assert.equal(live.slice(recovered.start, recovered.end), leading);
});

test('anchor recovery fails closed when windows are ambiguous or too short', () => {
  const ambiguous = `${ABC7_LIVE} later copy ${ABC7_LIVE}`;
  assert.equal(findArticleHoverNormalizedMatch(ambiguous, ABC7_STORED), null);
  assert.equal(
    findArticleHoverNormalizedMatch('A short live page without the quote.', 'tiny edit xx'),
    null,
  );
  assert.equal(
    findArticleHoverNormalizedMatch('Hello world this is a short edited quote here.', 'Hello world this is a SHORT edited quote here.'),
    null,
  );
});

test('prepareArticlePassageQuery strips leading crumbs and a mid-word tail', () => {
  assert.equal(prepareArticlePassageQuery(IRAN_STORED), IRAN_CLEANED);
  assert.equal(
    prepareArticlePassageQuery(`“${IRAN_STORED}”`),
    IRAN_CLEANED,
  );
  assert.equal(
    prepareArticlePassageQuery('• Central Command announced more than twenty characters here.'),
    'Central Command announced more than twenty characters here.',
  );
  assert.equal(
    prepareArticlePassageQuery('- Central Command announced more than twenty characters here.'),
    'Central Command announced more than twenty characters here.',
  );
  assert.equal(prepareArticlePassageQuery(PASSAGE), PASSAGE);
  assert.equal(IRAN_CLEANED.includes('commerci'), false);
  assert.match(IRAN_CLEANED, /62$/);
});

test('prepareArticlePassageQuery drops a leading mid-word token and the Enes tail', () => {
  assert.equal(dropIncompleteLeadingArticleToken('dom exercised his constitutional right'), 'exercised his constitutional right');
  assert.equal(dropIncompleteLeadingArticleToken('Freedom exercised his constitutional right'), 'Freedom exercised his constitutional right');
  assert.equal(dropIncompleteLeadingArticleToken('62 commercial ships redirected here'), '62 commercial ships redirected here');
  assert.equal(prepareArticlePassageQuery(ENES_STORED), ENES_CLEANED);
  assert.match(ENES_CLEANED, /^exercised /);
  assert.equal(ENES_CLEANED.startsWith('dom'), false);
  assert.equal(ENES_CLEANED.includes('held ac'), false);
  assert.match(ENES_CLEANED, /held$/);
  assert.equal(prepareArticlePassageQuery(IRAN_STORED), IRAN_CLEANED);
});

test('Iran-style truncated commerci recovers a unique cleaned prefix', () => {
  const recovered = findArticleHoverNormalizedMatch(IRAN_LIVE, IRAN_STORED);
  assert.ok(recovered);
  assert.equal(IRAN_LIVE.slice(recovered.start, recovered.end), IRAN_CLEANED);
  assert.equal(IRAN_LIVE.slice(recovered.start, recovered.end).includes('commerci'), false);
  assert.ok(IRAN_LIVE.slice(recovered.start, recovered.end).length >= ARTICLE_HOVER_PREFIX_MIN_CHARS);

  const liveWithoutUsPeriod = IRAN_LIVE.replace('U.S. Central Command', 'US Central Command');
  assert.equal(findUniqueNormalizedMatch(liveWithoutUsPeriod, IRAN_STORED), null);
  const recoveredWithoutPeriod = findArticleHoverNormalizedMatch(liveWithoutUsPeriod, IRAN_STORED);
  assert.ok(recoveredWithoutPeriod);
  assert.equal(liveWithoutUsPeriod.slice(recoveredWithoutPeriod.start, recoveredWithoutPeriod.end), IRAN_CLEANED);
});

test('longest unique prefix walks back by words and fails closed when ambiguous', () => {
  assert.equal(findUniqueNormalizedMatch(PREFIX_LIVE, PREFIX_STORED), null);
  assert.equal(findUniqueNormalizedMatch(PREFIX_LIVE, prepareArticlePassageQuery(PREFIX_STORED)), null);
  const recovered = findArticleHoverNormalizedMatch(PREFIX_LIVE, PREFIX_STORED);
  assert.ok(recovered);
  assert.equal(PREFIX_LIVE.slice(recovered.start, recovered.end), PREFIX_MATCH);
  assert.deepEqual(
    findLongestUniquePrefixMatch(PREFIX_LIVE, prepareArticlePassageQuery(PREFIX_STORED)),
    recovered,
  );
  assert.equal(
    findArticleHoverNormalizedMatch(`${PREFIX_LIVE} later ${PREFIX_LIVE}`, PREFIX_STORED),
    null,
  );
  assert.equal(
    findLongestUniquePrefixMatch('short haystack', 'also short leftover.'),
    null,
  );
});

test('Enes-style leading truncation matches the unique exercised span', () => {
  assert.equal(findUniqueNormalizedMatch(ENES_LIVE, ENES_STORED), null);
  // `dom exercised` is a false substring of `Freedom exercised`. A highlight
  // that starts there would paint inside Freedom; drop the remnant instead.
  const falseHead = findUniqueNormalizedMatch(ENES_LIVE, 'dom exercised his constitutional right');
  assert.ok(falseHead);
  assert.equal(ENES_LIVE.slice(falseHead.start - 4, falseHead.start + 3), 'Freedom');
  const recovered = findArticleHoverNormalizedMatch(ENES_LIVE, ENES_STORED);
  assert.ok(recovered);
  const span = ENES_LIVE.slice(recovered.start, recovered.end);
  assert.match(span, /^exercised his constitutional right/);
  assert.equal(span.startsWith('dom'), false);
  assert.equal(span.includes('Freedom'), false);
  assert.equal(span.includes('held ac'), false);
  assert.ok(span.length >= ARTICLE_HOVER_PREFIX_MIN_CHARS);
  assert.equal(ENES_LIVE.slice(recovered.start - 8, recovered.start), 'Freedom ');
});

test('longest unique suffix walks forward by words and fails closed when ambiguous', () => {
  assert.equal(findUniqueNormalizedMatch(SUFFIX_LIVE, SUFFIX_STORED), null);
  assert.equal(findLongestUniquePrefixMatch(SUFFIX_LIVE, SUFFIX_STORED), null);
  const recovered = findArticleHoverNormalizedMatch(SUFFIX_LIVE, SUFFIX_STORED);
  assert.ok(recovered);
  assert.equal(SUFFIX_LIVE.slice(recovered.start, recovered.end), SUFFIX_MATCH);
  assert.deepEqual(
    findLongestUniqueSuffixMatch(SUFFIX_LIVE, SUFFIX_STORED),
    recovered,
  );
  assert.equal(
    findArticleHoverNormalizedMatch(`${SUFFIX_LIVE} later ${SUFFIX_LIVE}`, SUFFIX_STORED),
    null,
  );
  assert.equal(
    findLongestUniqueSuffixMatch('short haystack', 'also short leftover.'),
    null,
  );
});

test('page injector recovers Iran-style truncated text and scrolls it into view', () => {
  withPage(({ documentElement, scrollCalls }) => {
    const result = applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: IRAN_STORED,
      strength: 'soft',
    });
    assert.equal(result.ok, true);
    assert.ok(documentElement.querySelector('#annotated-article-hover-root'));
    assert.match(documentElement.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /rgba\(255, 214, 74/);
    assert.ok(scrollCalls.some((call) => (
      call.options.block === 'center' &&
      call.options.inline === 'nearest' &&
      call.options.behavior === 'smooth'
    )));
  }, { bodyText: IRAN_LIVE });
});

test('page injector recovers Enes-style leading truncation and scrolls it into view', () => {
  withPage(({ documentElement, scrollCalls }) => {
    const result = applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: ENES_STORED,
      strength: 'soft',
    });
    assert.equal(result.ok, true);
    assert.ok(documentElement.querySelector('#annotated-article-hover-root'));
    assert.match(documentElement.querySelector('[data-annotated-hover-ring="1"]').style.cssText, /rgba\(255, 214, 74/);
    assert.ok(scrollCalls.some((call) => (
      call.options.block === 'center' &&
      call.options.inline === 'nearest' &&
      call.options.behavior === 'smooth'
    )));
  }, { bodyText: ENES_LIVE });
});

test('article hover matching has no audio-commentary skip path', () => {
  assert.doesNotMatch(applyArticleHoverHighlightOnPage.toString(), /audio/);
  assert.doesNotMatch(findArticleHoverNormalizedMatch.toString(), /audio/);
  assert.doesNotMatch(prepareArticlePassageQuery.toString(), /audio/);
  const recovered = findArticleHoverNormalizedMatch(IRAN_LIVE, IRAN_STORED);
  assert.ok(recovered);
});

test('page injector recovers an edited-middle passage and scrolls it into view', () => {
  withPage(({ documentElement, scrollCalls }) => {
    const result = applyArticleHoverHighlightOnPage({
      expectedNormalizedUrl: ARTICLE,
      selectedText: ABC7_STORED,
      strength: 'soft',
    });
    assert.equal(result.ok, true);
    assert.ok(documentElement.querySelector('#annotated-article-hover-root'));
    assert.ok(scrollCalls.some((call) => (
      call.options.block === 'center' &&
      call.options.inline === 'nearest' &&
      call.options.behavior === 'smooth'
    )));
  }, { bodyText: ABC7_LIVE });
});
