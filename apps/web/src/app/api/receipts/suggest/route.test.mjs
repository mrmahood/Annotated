import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the receipts route stays hidden unless the gateway key is set", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /return json\(\{ enabled: receiptsAssistEnabled\(\) \}\)/);
  assert.match(source, /if \(!receiptsAssistEnabled\(\)\) throw new ReceiptAssistError\("RECEIPTS_UNAVAILABLE"\)/);
  assert.match(source, /origin: "ai-suggested"|AI_SUGGESTED_ORIGIN|requestReceiptSuggestion/);
  assert.doesNotMatch(source, /AI_GATEWAY_API_KEY\s*=\s*["'][^"']+/);
  assert.doesNotMatch(source, /console\.(log|debug|info)/);
});
