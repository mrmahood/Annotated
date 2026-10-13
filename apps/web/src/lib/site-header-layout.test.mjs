import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("narrow header keeps every nav link and equal single-line provider buttons", async () => {
  const [header, auth, button, styles] = await Promise.all([
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header-auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/provider-sign-in-button.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(header, /className="site-header-start"/);
  assert.match(header, /aria-label="Primary navigation"/);
  assert.match(header, />\s*Feed\s*</);
  assert.match(header, />\s*Trending\s*</);
  assert.match(header, />\s*Follow\s*</);
  assert.match(header, />\s*Me\s*</);
  assert.match(header, /className="site-wordmark-text"/);

  assert.match(auth, /site-auth-signed-out/);
  assert.match(auth, /compactLabel="Google"/);
  assert.match(auth, /compactLabel="X"/);
  assert.match(auth, /className="site-auth-button"/);

  assert.match(button, /Continue with Google/);
  assert.match(button, /Continue with X/);
  assert.match(button, /aria-label=\{compactLabel \? accessibleLabel : undefined\}/);
  assert.match(button, /site-auth-width-full/);
  assert.match(button, /site-auth-face-compact/);
  assert.match(button, /white-space: nowrap|site-auth-provider-icon/);

  assert.match(
    styles,
    /\.site-header \.site-auth-signed-out \{[^}]*grid-template-columns:\s*repeat\(2,\s*max-content\)/,
  );
  assert.match(
    styles,
    /\.site-header \.site-auth-signed-out \.site-auth-button \{[^}]*height:\s*32px;[^}]*white-space:\s*nowrap/,
  );
  assert.match(
    styles,
    /@media \(max-width: 739px\) \{[\s\S]*\.site-header \.site-nav \{[^}]*overflow-x: auto;/,
  );
  assert.match(styles, /@media \(max-width: 639px\)/);
  assert.match(styles, /\.site-header \.site-auth-face-compact,\s*\.site-header \.site-auth-width > \.site-auth-width-compact \{ display: inline-flex; \}/);
  assert.doesNotMatch(styles, /\.site-auth-button \{ max-width: 142px; white-space: normal; \}/);
  assert.doesNotMatch(styles, /\.site-feed-link \{ display: none; \}/);
});
