import assert from "node:assert/strict";
import test from "node:test";
import {
  RECEIPTS_GATEWAY_URL,
  parseReceiptSuggestion,
  publicReceiptSourcesFrom,
  receiptsAssistEnabled,
  requestReceiptSuggestion,
} from "./receipts.ts";

test("the assist is hidden when the gateway key is unset", () => {
  assert.equal(receiptsAssistEnabled({}), false);
  assert.equal(receiptsAssistEnabled({ AI_GATEWAY_API_KEY: "   " }), false);
  assert.equal(receiptsAssistEnabled({ AI_GATEWAY_API_KEY: "gateway-key" }), true);
});

test("model output is labeled AI-suggested and drops the cited page", () => {
  const suggestion = parseReceiptSuggestion({
    claimSummary: "The passage attributes a figure to an official report.",
    sources: [
      { title: "Same page", url: "https://news.example/story", publisher: "News" },
      { title: "Official report", url: "https://agency.example/report", publisher: "Agency" },
      { title: "Dataset", url: "https://data.example/set", publisher: "" },
      { title: "Not https", url: "http://data.example/other", publisher: "Data" },
    ],
  }, "https://news.example/story");
  assert.deepEqual(suggestion?.sources.map((source) => source.title), ["Official report", "Dataset"]);
  assert.equal(suggestion?.sources.every((source) => source.origin === "ai-suggested"), true);
});

test("the gateway request uses the key and does not echo it back", async () => {
  let seen = null;
  const suggestion = await requestReceiptSuggestion(
    { passage: "A highlighted claim about a statute.", pageUrl: "https://news.example/story" },
    {
      apiKey: "gateway-secret",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    claimSummary: "The passage describes a statutory requirement.",
                    sources: [
                      { title: "Statute", url: "https://www.congress.gov/bill/1", publisher: "Congress" },
                      { title: "Text", url: "https://www.govinfo.gov/bill", publisher: "GovInfo" },
                    ],
                  }),
                },
              }],
            };
          },
        };
      },
    },
  );
  assert.equal(seen.url, RECEIPTS_GATEWAY_URL);
  assert.equal(seen.init.headers.authorization, "Bearer gateway-secret");
  assert.equal(JSON.stringify(suggestion).includes("gateway-secret"), false);
  assert.equal(suggestion.sources[0].origin, "ai-suggested");
});

test("permalink sources merge the receipt table with an annotations.sources column", () => {
  const sources = publicReceiptSourcesFrom(
    [{ url: "https://a.example/1", title: "Table", publisher: null, origin: "ai-suggested" }],
    [{ url: "https://b.example/2", title: "Column", publisher: "Bureau" }],
  );
  assert.deepEqual(sources.map((source) => [source.title, source.origin]), [
    ["Table", "ai-suggested"],
    ["Column", "approved"],
  ]);
});
