import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APPEARANCE_COOKIE_NAME,
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  appearanceCookieString,
  persistAppearancePreference,
  readStoredAppearancePreference,
} from "./appearance.ts";

test("web preference helper persists localStorage and a SameSite cookie", () => {
  const storage = new Map();
  const cookies = [];

  assert.equal(readStoredAppearancePreference({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }, ""), "system");

  persistAppearancePreference(
    "light",
    {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    (value) => cookies.push(value),
    true,
  );

  assert.equal(storage.get(APPEARANCE_STORAGE_KEY), "light");
  assert.equal(readStoredAppearancePreference({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }), "light");
  assert.equal(cookies.at(-1), appearanceCookieString("light", true));
  assert.match(cookies.at(-1), new RegExp(`${APPEARANCE_COOKIE_NAME}=light`));
  assert.match(cookies.at(-1), /SameSite=Lax/);
  assert.match(cookies.at(-1), /Secure/);
  assert.equal(persistAppearancePreference("nope"), "system");
});

test("web header, layout, and profile chrome wire the shared appearance control", async () => {
  const [layout, header, control, profile, styles] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/appearance-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/p/[profileId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /getAppearanceBootstrapScript/);
  assert.match(layout, /dangerouslySetInnerHTML/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /data-theme=\{/);
  assert.match(layout, /data-appearance=\{/);
  assert.match(layout, /<AppearanceRuntime \/>/);
  assert.match(header, /import \{ AppearanceControl \} from "\.\/appearance-control"/);
  assert.match(header, /<AppearanceControl compact \/>/);
  assert.match(header, /className="site-chrome"/);
  assert.match(control, /APPEARANCE_PREFERENCES\.map/);
  assert.match(control, /role="radiogroup"/);
  assert.match(control, /aria-label="Appearance"/);
  assert.match(control, /type="radio"/);
  assert.match(control, /persistAppearancePreference/);
  assert.match(control, /applyStoredAppearance/);
  assert.match(control, /matchMedia/);
  assert.match(profile, /currentUserId === profile\.id && <AppearanceControl \/>/);
  assert.match(styles, /:root\[data-theme="light"\]/);
  assert.match(styles, /color-scheme: light/);
  assert.match(styles, /\.appearance-segmented/);
  assert.match(styles, /\.site-chrome/);
  assert.match(styles, /color-scheme: inherit/);
  assert.doesNotMatch(styles, /\.card-hosted-media audio[^}]*color-scheme: dark/);
  assert.deepEqual(APPEARANCE_PREFERENCES, ["system", "light", "dark"]);
});
