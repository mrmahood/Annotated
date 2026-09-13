import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_UPDATED,
  LEGAL_OPERATOR_STATEMENT,
  LEGAL_PATHS,
  getConfiguredLegalPageUrl,
} from "./legal.ts";

test("legal constants keep the published operator, dates, and routes", () => {
  assert.equal(LEGAL_EFFECTIVE_DATE, "August 30, 2026");
  assert.equal(LEGAL_LAST_UPDATED, "August 30, 2026");
  assert.equal(LEGAL_CONTACT_EMAIL, "matt@cbandcoop.com");
  assert.match(LEGAL_OPERATOR_STATEMENT, /The CB & Cooper Limited Liability Company/);
  assert.deepEqual(LEGAL_PATHS, {
    index: "/legal",
    privacy: "/privacy",
    terms: "/terms",
  });
});

test("configured legal URLs accept HTTPS or loopback HTTP origins", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.equal(getConfiguredLegalPageUrl("/privacy"), "http://localhost:3000/privacy");
    process.env.NEXT_PUBLIC_SITE_URL = "https://annotated.example";
    assert.equal(getConfiguredLegalPageUrl("/terms"), "https://annotated.example/terms");
    for (const value of [
      "http://annotated.example",
      "https://user:pass@annotated.example",
      "https://annotated.example/base",
      "not-a-url",
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = value;
      assert.equal(getConfiguredLegalPageUrl("/legal"), undefined, value);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});
