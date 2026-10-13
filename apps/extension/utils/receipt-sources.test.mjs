import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  attachApprovedReceiptSource,
  loadReceiptAssistAvailability,
  parseReceiptSuggestionResponse,
} from './receipt-sources.ts';

const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE = {
  url: 'https://www.congress.gov/bill/118th-congress/house-bill/1',
  title: 'House bill 1',
  publisher: 'Congress.gov',
  origin: 'ai-suggested',
};

test('suggestions without the AI-suggested label are dropped', () => {
  assert.equal(parseReceiptSuggestionResponse({
    claimSummary: 'The passage states a legislative claim.',
    sources: [
      { ...SOURCE, origin: 'model' },
      { ...SOURCE, url: 'https://www.govinfo.gov/bill', title: 'Bill text' },
    ],
  }), null);
  const parsed = parseReceiptSuggestionResponse({
    claimSummary: 'The passage states a legislative claim.',
    sources: [
      SOURCE,
      { url: 'https://www.govinfo.gov/content/pkg/BILLS-118hr1ih/html/BILLS-118hr1ih.htm', title: 'Bill text', publisher: 'GovInfo', origin: 'ai-suggested' },
    ],
  });
  assert.equal(parsed?.sources.length, 2);
  assert.equal(parsed?.sources.every((source) => source.origin === 'ai-suggested'), true);
});

test('the assist hides when the server reports it disabled', async () => {
  assert.equal(await loadReceiptAssistAvailability('https://annotated.example', async () => ({
    ok: true,
    async json() { return { enabled: false }; },
  })), false);
  assert.equal(await loadReceiptAssistAvailability('https://annotated.example', async () => {
    throw new Error('offline');
  }), false);
});

test('approved sources use annotations.sources when that column exists', async () => {
  const writes = [];
  const client = {
    from(table) {
      assert.equal(table, 'annotations');
      return {
        select() {
          return { eq() { return { async maybeSingle() { return { data: { sources: [] }, error: null }; } }; } };
        },
        update(value) {
          writes.push(value);
          return { eq() { return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
  assert.equal(await attachApprovedReceiptSource(client, ANNOTATION_ID, SOURCE), 'attached');
  assert.equal(writes[0].sources[0].origin, 'ai-suggested');
  assert.equal(writes[0].sources[0].url, SOURCE.url);
});

test('a missing sources column falls back to the receipt table', async () => {
  const inserted = [];
  const client = {
    from(table) {
      if (table === 'annotations') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: null,
                      error: { code: 'PGRST204', message: "Could not find the 'sources' column of 'annotations' in the schema cache" },
                    };
                  },
                };
              },
            };
          },
        };
      }
      assert.equal(table, 'annotation_receipt_sources');
      return {
        insert(row) {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  assert.equal(await attachApprovedReceiptSource(client, ANNOTATION_ID, SOURCE), 'attached');
  assert.equal(inserted[0].origin, 'ai-suggested');
  assert.equal(inserted[0].annotation_id, ANNOTATION_ID);
});

test('the side panel labels suggestions and adds a source only from a click', async () => {
  const [panel, app] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/receipt-assist.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(panel, /AI-suggested/);
  assert.match(panel, /Add source/);
  assert.match(panel, /Suggest sources/);
  assert.doesNotMatch(panel, /attachApprovedReceiptSource/);
  assert.match(app, /attachApprovedReceiptSources\(supabase, annotationId, approvedReceipts\)/);
  assert.ok(app.indexOf('attachApprovedReceiptSources') < app.indexOf("kind: 'text'"));
});
