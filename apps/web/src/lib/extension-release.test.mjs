import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extensionVersionDocument,
  readExtensionPackageVersion,
} from "./extension-package-version.ts";
import {
  EXTENSION_CHANGELOG,
  EXTENSION_DOWNLOAD_PATH,
  EXTENSION_UPDATE_GUIDE,
  EXTENSION_VERSION_PATH,
  WHATS_NEW_HEADING,
  WHATS_NEW_PATH,
} from "./extension-release.ts";

test("what's new publishes the extension package version and the zip download", async () => {
  const [page, footer, nudge, extensionUpdate, packageJson] = await Promise.all([
    readFile(new URL("../app/whats-new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-footer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/install-extension-nudge.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/utils/extension-update.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/package.json", import.meta.url), "utf8"),
  ]);
  const version = readExtensionPackageVersion();
  const publishedVersion = JSON.parse(
    await readFile(new URL("../../public/extension-version.json", import.meta.url), "utf8"),
  );
  assert.equal(version, JSON.parse(packageJson).version);
  assert.deepEqual(publishedVersion, { name: "Annotated", version });
  assert.equal(version, "0.2.1");
  assert.deepEqual(extensionVersionDocument(version), { name: "Annotated", version });
  assert.equal(EXTENSION_DOWNLOAD_PATH, "/extension.zip");
  assert.equal(EXTENSION_VERSION_PATH, "/extension-version.json");
  assert.equal(WHATS_NEW_PATH, "/whats-new");
  assert.match(extensionUpdate, /export const WHATS_NEW_PATH = '\/whats-new'/);
  assert.match(extensionUpdate, /export const EXTENSION_VERSION_PATH = '\/extension-version\.json'/);

  assert.match(page, /WHATS_NEW_HEADING/);
  assert.match(page, /readExtensionPackageVersion/);
  assert.match(page, /Download zip/);
  assert.match(page, /href=\{EXTENSION_DOWNLOAD_PATH\}/);
  assert.match(page, /download="extension\.zip"/);
  assert.match(page, /Update in 30 seconds/);
  assert.match(page, /EXTENSION_CHANGELOG/);
  assert.equal(WHATS_NEW_HEADING, "What's new");
  assert.equal(EXTENSION_UPDATE_GUIDE.length, 5);
  assert.equal(EXTENSION_UPDATE_GUIDE[2].code, "chrome://extensions");
  assert.match(EXTENSION_UPDATE_GUIDE.map((step) => step.text).join(" "), /Unzip it over the old folder/);
  assert.match(EXTENSION_UPDATE_GUIDE.map((step) => step.text).join(" "), /Click Reload on Annotated/);
  assert.match(EXTENSION_UPDATE_GUIDE.map((step) => step.text).join(" "), /sign-in stays/i);
  assert.equal(EXTENSION_CHANGELOG[0].version, version);
  assert.match(EXTENSION_CHANGELOG[0].items.join(" "), /dark mode/);
  assert.match(EXTENSION_CHANGELOG[0].items.join(" "), /toolbar icon/);
  assert.equal(EXTENSION_CHANGELOG[1].version, "0.2.0");
  assert.match(EXTENSION_CHANGELOG[1].items.join(" "), /fact-check layer/);
  assert.match(EXTENSION_CHANGELOG[1].items.join(" "), /Wikipedia/);
  assert.match(EXTENSION_CHANGELOG[1].items.join(" "), /microphone/);

  assert.match(footer, /WHATS_NEW_PATH/);
  assert.match(footer, /What's new/);
  assert.match(nudge, /EXTENSION_WHATS_NEW_PATH/);
  assert.match(nudge, /What's new/);
  assert.doesNotMatch(nudge, /extension-release/);
});
