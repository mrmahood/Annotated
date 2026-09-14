import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web Me is a private newest-first bookmark list with sign-in prompt", async () => {
  const [page, header, control, mutations, discovery, routes, handles] = await Promise.all([
    readFile(new URL("../app/me/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/bookmark-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/social-mutations.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/public-discovery.ts", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../packages/shared/src/profile-handle.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getCurrentUserBookmarksPage/);
  assert.match(page, /Sign in to see your bookmarks/);
  assert.match(page, /ProviderSignInActions/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /initialBookmarked=\{item\.viewerHasBookmarked\}/);
  assert.match(header, /href="\/me"/);
  assert.match(header, />\s*Me\s*</);
  assert.match(control, /createAnnotationBookmark/);
  assert.match(control, /removeAnnotationBookmark/);
  assert.match(control, /Sign in to bookmark/);
  assert.match(control, /googleLabel="Continue with Google"/);
  assert.match(control, /xLabel="Continue with X"/);
  assert.doesNotMatch(control, /googleLabel="Sign in to bookmark"/);
  assert.match(control, /Unbookmark/);
  assert.doesNotMatch(control, /folder|note|save count/i);
  assert.match(mutations, /create_annotation_bookmark/);
  assert.match(mutations, /remove_annotation_bookmark/);
  assert.doesNotMatch(mutations, /from\("annotation_bookmarks"\)/);
  assert.match(discovery, /list_current_annotation_bookmarks/);
  assert.match(discovery, /viewerHasBookmarked: true/);
  assert.doesNotMatch(discovery, /from\("annotation_bookmarks"\)/);
  assert.match(routes, /isReservedProfileHandle/);
  assert.match(handles, /'me'/);
});

test("web Me signed-in account area links Send feedback to the Tally form", async () => {
  const [page, header, feed, styles] = await Promise.all([
    readFile(new URL("../app/me/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /currentUserId \? \(/);
  assert.match(page, /href="https:\/\/tally\.so\/r\/1ALx44"/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, />\s*Send feedback\s*</);
  assert.match(page, /className="me-feedback"/);
  assert.match(styles, /\.me-feedback \{/);
  assert.doesNotMatch(header, /Send feedback|tally\.so/);
  assert.doesNotMatch(feed, /Send feedback|tally\.so/);
});
