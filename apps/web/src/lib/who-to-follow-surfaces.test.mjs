import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web Feed side rail and Follow tab stay on the curated Who to Follow contract", async () => {
  const [home, page, rail, card, header, routes, social, mutations, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/who-to-follow/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/who-to-follow-rail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/who-to-follow-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/social.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/social-mutations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(home, /getWhoToFollowSuggestions\(currentUserId\)/);
  assert.match(home, /shouldShowWhoToFollowRail/);
  assert.match(home, /discovery-main-with-rail/);
  assert.match(home, /WhoToFollowRail/);
  assert.match(home, /discovery-feed-column/);
  assert.doesNotMatch(home, /getWhoToFollowSuggestions\(null\)/);

  assert.match(page, /WHO_TO_FOLLOW_PATH/);
  assert.match(page, /active="who-to-follow"/);
  assert.match(page, /WhoToFollowList/);
  assert.match(page, /No suggestions right now/);
  assert.match(page, /continue with Google or X/i);

  assert.match(rail, /who-to-follow-rail/);
  assert.match(rail, /Suggested accounts/);
  assert.match(card, /followProfile/);
  assert.match(card, /unfollowProfile/);
  assert.match(card, /getWhoToFollowProfilePath/);
  assert.match(card, /@{suggestion\.handle}/);
  assert.match(card, /Sign in to follow\./);
  assert.match(card, /googleLabel="Continue with Google"/);
  assert.match(card, /xLabel="Continue with X"/);
  assert.match(card, /className="site-auth-button"/);
  assert.doesNotMatch(card, /googleLabel="Sign in to follow"/);
  assert.doesNotMatch(card, /href=\{`\/@/);

  assert.match(header, /href="\/who-to-follow"/);
  assert.match(header, /site-who-to-follow-link/);
  assert.match(header, />\s*Follow\s*</);
  assert.match(routes, /"who-to-follow"/);

  assert.match(social, /is_following_profile/);
  assert.match(social, /from\("profiles"\)/);
  assert.match(social, /WHO_TO_FOLLOW_SEED_HANDLES/);
  assert.match(social, /WHO_TO_FOLLOW_SEED_PROFILE_IDS/);
  assert.doesNotMatch(social, /from\("profile_follows"\)/);
  assert.match(mutations, /from\("profile_follows"\)\.insert/);
  assert.match(mutations, /unfollow_profile/);

  assert.match(styles, /\.who-to-follow-rail \{ display: none; \}/);
  assert.match(styles, /@media \(min-width: 1100px\)/);
  assert.match(styles, /\.discovery-main-with-rail/);
  assert.match(styles, /\.site-feed-link\.site-who-to-follow-link \{ display: inline; \}/);
  assert.doesNotMatch(styles, /who-to-follow-rail[^{]*\{[^}]*order:\s*2/);
});

test("Who to Follow stays off the extension and /ops surfaces", async () => {
  const [opsConsole, extensionSocial] = await Promise.all([
    readFile(new URL("../app/ops/ops-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../extension/utils/social-data.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(opsConsole, /Who to Follow|who-to-follow/i);
  assert.doesNotMatch(extensionSocial, /Who to Follow|who-to-follow|WHO_TO_FOLLOW/i);
});
