import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertSeedTargetAllowed } from '../../../scripts/seed-passage-highlight-demo.mjs';
import {
  applyPublishedPassageHighlights,
  highlighterTokenForVerdict,
  installPassageHighlightOpen,
  isMissingVerdictColumnError,
  isPassageOpenMessage,
  isPassageOpenRequest,
  mapPublishedPassages,
  PASSAGE_OPEN_MESSAGE,
  PASSAGE_OPEN_STORAGE_KEY,
  queryPublishedPassages,
} from './passage-highlight.ts';

const ANNOTATION_ID = 'b1000000-0000-4000-8000-0000000000b2';
const PAGE = 'https://example.com/harbor?utm_source=newsletter';

function row(overrides = {}) {
  return {
    id: ANNOTATION_ID,
    title: 'North channel log',
    commentary_text: 'The night watch kept the north channel lit.',
    published_at: '2026-10-13T00:00:00.000Z',
    target: {
      target_type: 'text',
      selected_text: 'The harbor log.',
      text_prefix: 'Before. ',
      text_suffix: ' After.',
    },
    ...overrides,
  };
}

function supabaseFrom(responder) {
  const calls = [];
  const supabase = {
    from(table) {
      const state = { table, columns: '', filters: [] };
      const chain = {
        select(columns) { state.columns = columns; return chain; },
        eq(column, value) { state.filters.push(['eq', column, value]); return chain; },
        in(column, value) { state.filters.push(['in', column, value]); return chain; },
        order() { return chain; },
        limit() {
          calls.push(state);
          return responder(state, calls.length);
        },
      };
      return chain;
    },
  };
  return { supabase, calls };
}

test('verdict colors fall back to plain yellow', () => {
  assert.equal(highlighterTokenForVerdict(null), 'yellow');
  assert.equal(highlighterTokenForVerdict(''), 'yellow');
  assert.equal(highlighterTokenForVerdict('not-a-known-verdict'), 'yellow');
  assert.equal(highlighterTokenForVerdict('Supported'), 'green');
  assert.equal(highlighterTokenForVerdict('refuted'), 'red');
  assert.equal(highlighterTokenForVerdict('mixed'), 'amber');
});

test('published passage mapping reads verdicts defensively', () => {
  const passages = mapPublishedPassages([
    row({ verdict: { label: 'agree' } }),
    row({ id: 'not-a-uuid', verdict: 'false' }),
    row({
      id: 'b1000000-0000-4000-8000-0000000000c3',
      verdict: undefined,
      target: {
        target_type: 'text',
        selected_text: 'Second passage.',
        text_prefix: null,
        text_suffix: null,
        verdict: 'false',
      },
    }),
    row({
      id: 'b1000000-0000-4000-8000-0000000000c4',
      target: { target_type: 'time_range', selected_text: null, start_ms: 0, end_ms: 1000 },
    }),
    { id: ANNOTATION_ID },
  ]);

  assert.deepEqual(passages.map((passage) => [passage.annotationId, passage.color, passage.verdict]), [
    [ANNOTATION_ID, 'green', 'agree'],
    ['b1000000-0000-4000-8000-0000000000c3', 'red', 'false'],
  ]);
  assert.equal(passages[0].prefix, 'Before.');
  assert.equal(passages[0].suffix, 'After.');
});

test('missing verdict column is recognized without treating other errors as optional', () => {
  assert.equal(isMissingVerdictColumnError({
    code: '42703',
    message: 'column annotations.verdict does not exist',
  }), true);
  assert.equal(isMissingVerdictColumnError({
    code: 'PGRST204',
    message: "Could not find the 'verdict' column of 'annotations' in the schema cache",
  }), true);
  assert.equal(isMissingVerdictColumnError({ code: '42501', message: 'permission denied' }), false);
});

test('the public query is read-only, published, and retried without verdict', async () => {
  const { supabase, calls } = supabaseFrom((state, attempt) => {
    if (attempt === 1) {
      return {
        data: null,
        error: { code: '42703', message: 'column annotations.verdict does not exist' },
      };
    }
    return { data: [row()], error: null };
  });

  const passages = await queryPublishedPassages(supabase, PAGE);
  assert.equal(passages.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].columns.includes('verdict'), true);
  assert.equal(calls[1].columns.includes('\n  verdict,'), false);
  for (const call of calls) {
    assert.equal(call.table, 'annotations');
    assert.deepEqual(call.filters.filter(([kind]) => kind === 'eq'), [
      ['eq', 'status', 'published'],
      ['eq', 'annotation_type', 'article_text'],
      ['eq', 'source.normalized_url', 'https://example.com/harbor'],
    ]);
  }
});

test('CSP blockage becomes a side-panel list and a painted page does not', async () => {
  const { supabase } = supabaseFrom(() => ({ data: [row({ verdict: 'supported' })], error: null }));
  const scripting = {
    async executeScript(injection) {
      assert.equal(injection.func.name, 'applyPassageHighlightsOnPage');
      assert.equal(injection.args[0].passages[0].color, 'green');
      assert.deepEqual(injection.target, { tabId: 7, frameIds: [0] });
      return [{ result: { ok: false, reason: 'csp-blocked', highlighted: 0, unmatched: 1 } }];
    },
  };
  const blocked = await applyPublishedPassageHighlights({
    supabase, scripting, tabId: 7, pageUrl: PAGE,
  });
  assert.equal(blocked.status, 'list');
  assert.equal(blocked.reason, 'csp-blocked');
  assert.equal(blocked.passages[0].color, 'green');

  const painted = await applyPublishedPassageHighlights({
    supabase,
    scripting: {
      async executeScript() {
        return [{ result: { ok: true, highlighted: 1, unmatched: 0 } }];
      },
    },
    tabId: 7,
    pageUrl: PAGE,
  });
  assert.deepEqual(painted, { status: 'highlighted', highlighted: 1, unmatched: 0 });
});

test('a click stores the annotation and asks the side panel to open', async () => {
  const stored = [];
  const opened = [];
  installPassageHighlightOpen({
    runtime: {
      onMessage: {
        addListener(listener) {
          listener(
            { type: PASSAGE_OPEN_MESSAGE, annotationId: ANNOTATION_ID },
            { tab: { id: 9 } },
          );
          listener({ type: 'other' }, { tab: { id: 9 } });
        },
      },
    },
    storage: { session: { async set(items) { stored.push(items); } } },
    sidePanel: { async open(options) { opened.push(options); } },
  });
  assert.equal(isPassageOpenMessage({ type: PASSAGE_OPEN_MESSAGE, annotationId: ANNOTATION_ID }), true);
  assert.equal(stored.length, 1);
  assert.equal(isPassageOpenRequest(stored[0][PASSAGE_OPEN_STORAGE_KEY]), true);
  assert.deepEqual(opened, [{ tabId: 9 }]);
});

test('the demo seed refuses Production and any page other than the fixture', async () => {
  assert.throws(
    () => assertSeedTargetAllowed(
      'https://vnxjktpdzmykmqrqwvks.supabase.co',
      'http://127.0.0.1:3000/demo/passage-highlight',
    ),
    /Refusing to seed Production/,
  );
  assert.throws(
    () => assertSeedTargetAllowed(
      'https://nkkunkwirvfwhmpwonqz.supabase.co',
      'https://annotated.cbandcoop.com/demo/passage-highlight',
    ),
    /Refusing to seed Production/,
  );
  assert.throws(
    () => assertSeedTargetAllowed(
      'http://127.0.0.1:54321',
      'http://127.0.0.1:3000/privacy',
    ),
    /demo\/passage-highlight/,
  );
  const allowed = assertSeedTargetAllowed(
    'https://nkkunkwirvfwhmpwonqz.supabase.co',
    'http://127.0.0.1:3000/demo/passage-highlight?utm_source=demo#log',
  );
  assert.equal(allowed.page.href, 'http://127.0.0.1:3000/demo/passage-highlight');
  const [fixture, seed] = await Promise.all([
    readFile(new URL('../../../apps/web/src/app/demo/passage-highlight/fixture.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../scripts/seed-passage-highlight-demo.mjs', import.meta.url), 'utf8'),
  ]);
  const shared = [
    'The harbor commission recorded that the amber lighthouse kept its beam on the north channel through the night watch.',
    'A later note said the amber lighthouse kept its beam on the south shoal until dawn.',
    'The record is the passage this demo annotation marks.',
  ];
  for (const sentence of shared) {
    assert.equal(fixture.includes(sentence), true);
    assert.equal(seed.includes(sentence), true);
  }
});

test('passage highlights are injected, not registered as persistent content scripts', async () => {
  const [config, background, app, page, orchestrator] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./passage-highlight-page.ts', import.meta.url), 'utf8'),
    readFile(new URL('./passage-highlight.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(background, /defineContentScript|content_scripts/);
  assert.match(background, /installPassageHighlightOpen/);
  assert.match(app, /applyPublishedPassageHighlights/);
  assert.match(app, /PassageHighlightList/);
  assert.match(app, /isPassageOpenMessage/);
  assert.doesNotMatch(page, /defineContentScript|content_scripts/);
  assert.match(orchestrator, /status', 'published'/);
  assert.doesNotMatch(orchestrator, /service_role|SERVICE_ROLE/);
});
