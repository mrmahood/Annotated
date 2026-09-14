import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_CALLOUT_DISMISSED_STORAGE_KEY,
  EXTENSION_CALLOUT_DISMISSED_VALUE,
  EXTENSION_DOWNLOAD_PATH,
  EXTENSION_INSTALL_COPY,
  EXTENSION_INSTALL_STEPS,
  isInstallCalloutDismissed,
  isLikelyGoogleChrome,
  persistInstallCalloutDismissed,
} from "./extension-install.ts";

test("install callout dismissal persists only the localStorage flag", () => {
  const storage = new Map();
  assert.equal(isInstallCalloutDismissed({
    getItem: (key) => storage.get(key) ?? null,
  }), false);

  persistInstallCalloutDismissed({
    setItem: (key, value) => storage.set(key, value),
  });

  assert.equal(storage.get(EXTENSION_CALLOUT_DISMISSED_STORAGE_KEY), EXTENSION_CALLOUT_DISMISSED_VALUE);
  assert.equal(isInstallCalloutDismissed({
    getItem: (key) => storage.get(key) ?? null,
  }), true);
  persistInstallCalloutDismissed(null);
});

test("Chrome detection treats Chrome as Chrome and other browsers as not", () => {
  assert.equal(
    isLikelyGoogleChrome(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    ),
    true,
  );
  assert.equal(
    isLikelyGoogleChrome(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    isLikelyGoogleChrome(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    ),
    false,
  );
  assert.equal(
    isLikelyGoogleChrome(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0",
    ),
    false,
  );
  assert.equal(isLikelyGoogleChrome(""), false);
});

test("install copy keeps the hosted zip path and no Chrome Web Store URL", () => {
  assert.equal(EXTENSION_DOWNLOAD_PATH, "/extension.zip");
  assert.equal(EXTENSION_INSTALL_STEPS.length, 5);
  assert.equal(EXTENSION_INSTALL_STEPS[1].code, "chrome://extensions");
  assert.match(EXTENSION_INSTALL_COPY.calloutTitle, /Install for Chrome/);
  assert.match(EXTENSION_INSTALL_COPY.downloadCta, /Download extension/);
  assert.match(EXTENSION_INSTALL_COPY.calloutBody, /not on the Chrome Web Store yet/);
  assert.match(EXTENSION_INSTALL_COPY.calloutBodyNonChrome, /works best in Google Chrome/);
  assert.match(EXTENSION_INSTALL_COPY.modalPitchNonChrome, /You can still download the package/);
  assert.match(EXTENSION_INSTALL_COPY.footer, /Keep the unzipped folder/);
  const surfaced = JSON.stringify(EXTENSION_INSTALL_COPY) + JSON.stringify(EXTENSION_INSTALL_STEPS);
  assert.doesNotMatch(surfaced, /chromewebstore\.google\.com/);
  assert.doesNotMatch(surfaced, /TODO|placeholder store/i);
});
