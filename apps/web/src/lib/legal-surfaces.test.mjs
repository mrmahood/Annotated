import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legal metadata keeps the published operator, dates, and in-app paths", async () => {
  const source = await readFile(new URL("./legal.ts", import.meta.url), "utf8");
  assert.match(source, /privacy: "\/privacy"/);
  assert.match(source, /terms: "\/terms"/);
  assert.match(source, /center: "\/legal"/);
  assert.match(source, /LEGAL_EFFECTIVE_ON = "August 30, 2026"/);
  assert.match(source, /LEGAL_UPDATED_ON = "August 30, 2026"/);
  assert.match(source, /person: "Matt Mahood"/);
  assert.match(source, /company: "The CB & Cooper Limited Liability Company"/);
  assert.match(source, /street: "120 Academy Street, Suite 102-105"/);
  assert.match(source, /locality: "Fort Mill, SC 29715"/);
  assert.match(source, /email: "matt@cbandcoop.com"/);
  assert.match(source, /id: "service-providers"/);
  assert.match(source, /id: "privacy"/);
});

test("web legal pages keep policy substance and Vercel hosting, not Lovable", async () => {
  const [
    privacy,
    terms,
    center,
    footer,
    layout,
    routes,
    handles,
    errorPage,
    styles,
    extensionApp,
    extensionHelpers,
  ] = await Promise.all([
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-footer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../packages/shared/src/profile-handle.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/error/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/entrypoints/sidepanel/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/utils/social-helpers.ts", import.meta.url), "utf8"),
  ]);

  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /public web application/);
  assert.match(privacy, /Chrome side-panel[\s\S]*extension/);
  assert.match(privacy, /including these legal pages/);
  assert.doesNotMatch(privacy, /legal-information website/);
  assert.match(privacy, /Vercel — hosting for the Annotated web application, including these legal pages/);
  assert.doesNotMatch(privacy, /Lovable/);
  assert.match(privacy, /Supabase — authentication, database services, and storage/);
  assert.match(privacy, /OpenAI — transcription of selected excerpts/);
  assert.match(privacy, /minimum age is 18/);
  assert.match(privacy, /does not use user content to train models/);
  assert.match(privacy, /LEGAL_PATHS\.privacy/);

  assert.match(terms, /Terms of Service/);
  assert.match(terms, /public web application[\s\S]*Chrome side-panel[\s\S]*extension/);
  assert.match(terms, /York County, South Carolina/);
  assert.match(terms, /no[\s\S]*arbitration clause and no class-action waiver/);
  assert.match(terms, /LEGAL_PATHS\.privacy/);
  assert.match(terms, /US \$100/);

  assert.match(center, /LEGAL_HEADING/);
  assert.match(center, /LEGAL_LEDE/);
  assert.match(center, /LEGAL_PATHS\.privacy/);
  assert.match(center, /LEGAL_PATHS\.terms/);

  assert.match(footer, /LEGAL_PATHS\.privacy/);
  assert.match(footer, /LEGAL_PATHS\.terms/);
  assert.match(footer, /LEGAL_PATHS\.center/);
  assert.match(footer, /LEGAL_OPERATOR\.email/);
  assert.match(layout, /SiteFooter/);
  assert.match(layout, /className="site-app"/);
  assert.match(errorPage, /LEGAL_PATHS\.privacy/);
  assert.match(errorPage, /LEGAL_PATHS\.terms/);

  assert.match(routes, /isReservedProfileHandle/);
  assert.match(handles, /'privacy'/);
  assert.match(handles, /'terms'/);
  assert.match(handles, /'legal'/);

  assert.match(styles, /\.skip-link/);
  assert.match(styles, /\.site-footer/);
  assert.match(styles, /\.legal-toc/);
  assert.match(styles, /\.legal-section \{ scroll-margin-top/);

  assert.match(extensionApp, /privacyUrl = getPublicUrl\('\/privacy'\)/);
  assert.match(extensionApp, /termsUrl = getPublicUrl\('\/terms'\)/);
  assert.match(extensionApp, /account-legal/);
  assert.match(extensionHelpers, /isReservedProfileHandle/);
  assert.match(extensionHelpers, /PROFILE_HANDLE_PATTERN/);

  const surfaced = privacy + terms + center + footer + layout + errorPage + extensionApp;
  assert.doesNotMatch(surfaced, /annotated\.cbandcoop\.com\/(privacy|terms|legal)/);
  assert.doesNotMatch(surfaced, /legal-annotation-buddy/);
});
