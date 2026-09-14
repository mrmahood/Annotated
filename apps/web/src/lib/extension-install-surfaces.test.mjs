import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web shell shows one dismissible install callout that opens one download modal", async () => {
  const [header, nudge, styles, nextConfig, gitignore, packager, versioning, webPackage] = await Promise.all([
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/install-extension-nudge.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../../../../scripts/package-prod-extension-zip.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../../docs/product/extension-release-versioning.md", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(header, /import \{ InstallExtensionNudge \} from "\.\/install-extension-nudge"/);
  assert.match(header, /<InstallExtensionNudge \/>/);
  assert.match(nudge, /"use client"/);
  assert.match(nudge, /useSyncExternalStore/);
  assert.match(nudge, /<dialog/);
  assert.match(nudge, /showModal\(\)/);
  assert.match(nudge, /href=\{EXTENSION_DOWNLOAD_PATH\}/);
  assert.match(nudge, /download="extension\.zip"/);
  assert.match(nudge, /Dismiss install reminder/);
  assert.match(nudge, /setModalOpen\(true\)/);
  assert.doesNotMatch(nudge, /chromewebstore\.google\.com/);
  assert.doesNotMatch(nudge, /TODO|chrome-web-store-placeholder/i);
  assert.equal([...nudge.matchAll(/<dialog/g)].length, 1);

  assert.match(styles, /\.install-extension-callout \{/);
  assert.match(styles, /\.install-extension-modal \{/);
  assert.match(styles, /@media \(min-width: 1720px\)/);
  assert.match(nextConfig, /source: "\/extension\.zip"/);
  assert.match(nextConfig, /attachment; filename="extension\.zip"/);
  assert.match(gitignore, /apps\/web\/public\/extension\.zip/);

  assert.match(packager, /WXT_WEB_APP_URL: PROD_WEB_APP_URL/);
  assert.match(packager, /https:\/\/annotated\.cbandcoop\.com/);
  assert.match(packager, /vnxjktpdzmykmqrqwvks/);
  assert.match(packager, /nkkunkwirvfwhmpwonqz/);
  assert.match(packager, /apps\/web\/public\/extension\.zip/);
  assert.match(packager, /pnpm.*run.*zip/);
  assert.match(packager, /assertProdExtensionBundleText/);
  assert.match(packager, /collectConfiguredExtensionPins/);
  assert.match(packager, /WXT_SUPABASE_URL must be a valid HTTPS Supabase project URL/);
  assert.match(packager, /annotated-staging\.cbandcoop\.com/);
  assert.doesNotMatch(packager, /FORBIDDEN_HOST_MARKERS/);

  assert.match(versioning, /https:\/\/annotated\.cbandcoop\.com\/extension\.zip/);
  assert.match(versioning, /package-prod-extension-zip/);
  assert.match(webPackage, /package-prod-extension-zip\.mjs && next build/);
  assert.match(webPackage, /extension-install-surfaces\.test\.mjs/);
});
