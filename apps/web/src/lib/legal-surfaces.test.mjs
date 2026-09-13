import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web legal pages keep the published policy text and Vercel hosting disclosure", async () => {
  const [privacy, terms, index, document, footer, layout, routes, styles] = await Promise.all([
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal-document.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-footer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /August 30, 2026/);
  assert.match(privacy, /The CB & Cooper Limited Liability Company/);
  assert.match(privacy, /matt@cbandcoop.com/);
  assert.match(privacy, /120 Academy Street, Suite 102-105/);
  assert.match(privacy, /Fort Mill, SC 29715/);
  assert.match(privacy, /including these legal pages, and the Annotated Chrome side-panel extension/);
  assert.match(privacy, /<strong>Vercel<\/strong>/);
  assert.match(privacy, /hosting for the Annotated web application, including these[\s\S]*legal pages/);
  assert.doesNotMatch(privacy, /Lovable/);
  assert.doesNotMatch(privacy, /separate legal-information website/);
  assert.match(privacy, /the Annotated web application does not intentionally set nonessential cookies/);
  assert.match(privacy, /Selected hosted media ranges are between 1 and 90 seconds/);
  assert.match(privacy, /does not use user content to train models/);

  assert.match(terms, /Terms of Service/);
  assert.match(terms, /You retain ownership of the content you create/);
  assert.match(terms, /York County, South Carolina/);
  assert.match(terms, /LEGAL_PATHS.privacy/);
  assert.match(terms, /as is/);
  assert.match(terms, /US \$100/);
  assert.match(terms, /no arbitration clause and no class-action waiver/);

  assert.match(index, /Legal center/);
  assert.match(index, /LEGAL_PATHS.privacy/);
  assert.match(index, /LEGAL_PATHS.terms/);
  assert.match(document, /LEGAL_EFFECTIVE_DATE/);
  assert.match(document, /aria-label="Contents"/);
  assert.match(footer, /href=\{LEGAL_PATHS.index\}/);
  assert.match(footer, /href=\{LEGAL_PATHS.privacy\}/);
  assert.match(footer, /href=\{LEGAL_PATHS.terms\}/);
  assert.match(layout, /<SiteFooter \/>/);
  assert.match(layout, /skip-to-main/);
  assert.match(routes, /"privacy"/);
  assert.match(routes, /"terms"/);
  assert.match(routes, /"legal"/);
  assert.match(styles, /\.legal-main \{/);
  assert.match(styles, /\.site-footer \{/);
  assert.match(styles, /scroll-margin-top: 72px/);
});

test("auth, Me, and extension Me surfaces link to in-app Privacy and Terms", async () => {
  const [me, authError, links, extensionApp] = await Promise.all([
    readFile(new URL("../app/me/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/error/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal-links.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/entrypoints/sidepanel/App.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(me, /LEGAL_PATHS.terms/);
  assert.match(me, /LEGAL_PATHS.privacy/);
  assert.match(me, /By continuing you agree/);
  assert.match(authError, /LegalLinks/);
  assert.match(links, /LEGAL_PATHS.privacy/);
  assert.match(links, /LEGAL_PATHS.terms/);
  assert.match(extensionApp, /getPublicUrl\('\/privacy'\)/);
  assert.match(extensionApp, /getPublicUrl\('\/terms'\)/);
  assert.match(extensionApp, /AccountLegalLinks/);
  assert.match(extensionApp, /AccountLegalNote/);
  assert.doesNotMatch(me + authError + links + extensionApp, /annotated\.cbandcoop\.com\/privacy|annotated\.cbandcoop\.com\/terms/);
});
