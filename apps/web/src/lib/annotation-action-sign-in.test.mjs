import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  annotationActionReturnTo,
  isAnnotationActionIntent,
  readAnnotationActionIntent,
} from "./annotation-action-intent.ts";

test("annotation action intent round-trips through a safe return path", () => {
  assert.equal(
    annotationActionReturnTo("/factdesk/the-island", "share"),
    "/factdesk/the-island?intent=share#share",
  );
  assert.equal(
    annotationActionReturnTo("/factdesk/the-island?utm=1#old", "bookmark"),
    "/factdesk/the-island?utm=1&intent=bookmark#bookmark",
  );
  assert.equal(
    annotationActionReturnTo("/factdesk/the-island", "upvote"),
    "/factdesk/the-island?intent=upvote#votes",
  );
  assert.equal(
    annotationActionReturnTo("/factdesk/the-island", "downvote"),
    "/factdesk/the-island?intent=downvote#votes",
  );
  assert.equal(
    annotationActionReturnTo("/factdesk/the-island", "comment"),
    "/factdesk/the-island?intent=comment#comments",
  );
  assert.equal(annotationActionReturnTo("https://evil.example/phish", "share"), "https://evil.example/phish");
  assert.equal(isAnnotationActionIntent("share"), true);
  assert.equal(isAnnotationActionIntent("follow"), false);
  assert.equal(readAnnotationActionIntent(["comment", "share"]), "comment");
  assert.equal(readAnnotationActionIntent("Sign in to vote"), null);
  assert.equal(readAnnotationActionIntent(undefined), null);
});

test("annotation detail uses one header-styled sign-in panel and keeps the action controls", async () => {
  const [page, gate, share, bookmark, votes, comments, styles, canonical, uuid] = await Promise.all([
    readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/annotation-action-auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/share-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/bookmark-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/vote-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/a/[annotationId]/comments-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/[creatorHandle]/[annotationSlug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/a/[annotationId]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<AnnotationActionGate/);
  assert.match(page, /actionIntent=\{actionIntent\}/);
  assert.match(gate, /Sign in to share, save, vote, or comment/);
  assert.match(gate, /className="site-auth site-auth-signed-out"/);
  assert.match(gate, /className="site-auth-button"/);
  assert.match(gate, /compactLabel="Google"/);
  assert.match(gate, /compactLabel="X"/);
  assert.match(gate, /annotationActionReturnTo\(returnTo, dialogIntent\)/);
  assert.match(gate, /requestSignIn/);
  assert.equal(gate.match(/provider="google"/g)?.length, 1);
  assert.equal(gate.match(/provider="x"/g)?.length, 1);

  assert.match(share, /requestSignIn\("share"\)/);
  assert.match(share, />\s*Share\s*</);
  assert.match(bookmark, /requestSignIn\("bookmark"\)/);
  assert.match(bookmark, />\s*Bookmark\s*</);
  assert.match(votes, /requestSignIn\(direction === 1 \? "upvote" : "downvote"\)/);
  assert.match(votes, />\s*Upvote\s*</);
  assert.match(votes, />\s*Downvote\s*</);
  assert.match(comments, /requestSignIn\("comment"\)/);
  assert.match(comments, />\s*Post comment\s*</);
  assert.match(comments, /htmlFor="comment-body"/);

  assert.doesNotMatch(votes, /ProviderSignInActions|Sign in to vote/);
  assert.doesNotMatch(comments, /ProviderSignInActions|Sign in to join the discussion/);
  assert.doesNotMatch(share, /returnTo=\{`\$\{returnTo\}#share`\}/);
  assert.doesNotMatch(bookmark, /returnTo=\{`\$\{returnTo\}#bookmark`\}/);

  assert.match(share, /googleLabel="Continue with Google"/);
  assert.match(bookmark, /Sign in to bookmark/);
  assert.match(canonical, /readAnnotationActionIntent\(query\.intent\)/);
  assert.match(uuid, /readAnnotationActionIntent\(query\.intent\)/);

  assert.match(
    styles,
    /\.annotation-action-sign-in \.site-auth-signed-out \{[^}]*grid-template-columns:\s*repeat\(2,\s*max-content\)/,
  );
  assert.match(
    styles,
    /\.annotation-action-sign-in \.site-auth-signed-out \.site-auth-button \{[^}]*height:\s*32px;[^}]*white-space:\s*nowrap/,
  );
  assert.match(styles, /\.annotation-action-sign-in \.site-auth-face-compact/);
  assert.match(styles, /\.annotation-action-resume/);
});
