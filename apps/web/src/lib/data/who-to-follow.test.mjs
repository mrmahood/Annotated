import assert from "node:assert/strict";
import test from "node:test";
import {
  WHO_TO_FOLLOW_MAX,
  WHO_TO_FOLLOW_MIN_VISIBLE,
  WHO_TO_FOLLOW_PATH,
  WHO_TO_FOLLOW_SEED_HANDLES,
  WHO_TO_FOLLOW_SEED_PROFILE_IDS,
  collectWhoToFollowProfiles,
  getWhoToFollowProfilePath,
  normalizeWhoToFollowHandle,
  parseWhoToFollowProfile,
  selectWhoToFollowSuggestions,
  shouldShowWhoToFollowRail,
  uniqueWhoToFollowHandles,
} from "./who-to-follow.ts";

const jason = {
  id: "61000000-0000-4000-8000-000000000001",
  username: "jason",
  display_name: "Jason Calacanis",
  avatar_url: "https://example.test/jason.png",
};
const david = {
  id: "61000000-0000-4000-8000-000000000002",
  username: "davidscornik",
  display_name: "David Scornik",
  avatar_url: null,
};
const matt = {
  id: "3e3882b6-7c94-46aa-9a6d-583b734536e2",
  username: "matt-mahood-3e3882b6",
  display_name: "Matt Mahood",
  avatar_url: null,
};

test("Who to Follow v1 keeps the locked seed set and 3-5 card cap", () => {
  assert.deepEqual([...WHO_TO_FOLLOW_SEED_HANDLES], [
    "jason",
    "davidscornik",
    "chamath",
    "friedberg",
    "matt",
  ]);
  assert.deepEqual([...WHO_TO_FOLLOW_SEED_PROFILE_IDS], [
    "3e3882b6-7c94-46aa-9a6d-583b734536e2",
  ]);
  assert.equal(WHO_TO_FOLLOW_MAX, 5);
  assert.equal(WHO_TO_FOLLOW_MIN_VISIBLE, 1);
  assert.equal(WHO_TO_FOLLOW_PATH, "/who-to-follow");
  assert.equal(shouldShowWhoToFollowRail(0), false);
  assert.equal(shouldShowWhoToFollowRail(1), true);
  assert.equal(shouldShowWhoToFollowRail(5), true);
  assert.equal(shouldShowWhoToFollowRail(5.5), false);
});

test("handle normalization strips @ and skips reserved or invalid roots", () => {
  assert.equal(normalizeWhoToFollowHandle("@Jason"), "jason");
  assert.equal(normalizeWhoToFollowHandle("  davidscornik  "), "davidscornik");
  assert.equal(normalizeWhoToFollowHandle("who-to-follow"), null);
  assert.equal(normalizeWhoToFollowHandle("trending"), null);
  assert.equal(normalizeWhoToFollowHandle("ab"), null);
  assert.deepEqual(uniqueWhoToFollowHandles(["@Jason", "jason", "chamath"]), [
    "jason",
    "chamath",
  ]);
});

test("profile parse requires a public handle and never puts @ in the path", () => {
  assert.deepEqual(parseWhoToFollowProfile(jason), {
    profileId: jason.id,
    displayName: "Jason Calacanis",
    handle: "jason",
    avatarUrl: "https://example.test/jason.png",
  });
  assert.equal(parseWhoToFollowProfile({ ...jason, username: null }), null);
  assert.equal(getWhoToFollowProfilePath(jason.id), `/p/${jason.id}`);
  assert.throws(() => getWhoToFollowProfilePath("not-a-uuid"), /Invalid Who to Follow/);
});

test("collector preserves seed order, skips missing rows, and dedupes Matt", () => {
  const resolved = collectWhoToFollowProfiles({
    handleRows: [jason, { username: "missing" }, david, { ...matt, username: "matt" }],
    idRows: [matt],
    seedHandles: uniqueWhoToFollowHandles(WHO_TO_FOLLOW_SEED_HANDLES),
    seedIds: WHO_TO_FOLLOW_SEED_PROFILE_IDS,
  });
  assert.deepEqual(resolved.map((profile) => profile.handle), [
    "jason",
    "davidscornik",
    "matt",
  ]);
});

test("selector hides the viewer and already-followed accounts, then caps at five", () => {
  const extras = [3, 4, 5, 6].map((index) => ({
    profileId: `61000000-0000-4000-8000-00000000000${index}`,
    displayName: `Seed ${index}`,
    handle: `seed${index}`,
    avatarUrl: null,
  }));
  const resolved = [
    { profileId: jason.id, displayName: "Jason", handle: "jason", avatarUrl: null },
    { profileId: david.id, displayName: "David", handle: "davidscornik", avatarUrl: null },
    { profileId: matt.id, displayName: "Matt", handle: "matt-mahood-3e3882b6", avatarUrl: null },
    ...extras,
  ];
  const selected = selectWhoToFollowSuggestions(resolved, {
    viewerId: matt.id,
    followedIds: new Set([david.id]),
  });
  assert.deepEqual(selected.map((profile) => profile.handle), [
    "jason",
    "seed3",
    "seed4",
    "seed5",
    "seed6",
  ]);
  assert.equal(selected.length, WHO_TO_FOLLOW_MAX);
  assert.equal(
    selectWhoToFollowSuggestions(resolved, { viewerId: null, followedIds: new Set() }).length,
    WHO_TO_FOLLOW_MAX,
  );
});
