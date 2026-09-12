import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed-out Share and Bookmark gates offer header Google and X actions", async () => {
  const [share, bookmark, actions, button, header, styles] = await Promise.all([
    readFile(new URL("../app/share-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/bookmark-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/provider-sign-in-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/provider-sign-in-button.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header-auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const source of [share, bookmark]) {
    assert.match(source, /ProviderSignInActions/);
    assert.match(source, /googleLabel="Continue with Google"/);
    assert.match(source, /xLabel="Continue with X"/);
    assert.match(source, /className="site-auth-button"/);
    assert.doesNotMatch(source, /googleLabel="Sign in to share"/);
    assert.doesNotMatch(source, /googleLabel="Sign in to bookmark"/);
    assert.doesNotMatch(source, /card-share-sign-in/);
  }

  assert.match(share, /Sign in to share to your feed/);
  assert.match(share, />Cancel</);
  assert.match(bookmark, /Sign in to bookmark\./);
  assert.match(bookmark, />Cancel</);

  assert.match(actions, /provider="google"/);
  assert.match(actions, /provider="x"/);
  assert.match(button, /Continue with Google|getAuthProviderLabel\(provider\)/);
  assert.match(button, /Continue with X/);
  assert.match(header, /provider="google"/);
  assert.match(header, /provider="x"/);
  assert.match(header, /className="site-auth-button"/);

  assert.match(styles, /\.share-signed-out/);
  assert.match(styles, /\.share-signed-out \.provider-sign-in-actions/);
  assert.doesNotMatch(styles, /\.card-share-sign-in/);
});
