import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web Me claims and changes handles through set_profile_handle only", async () => {
  const [page, form, social, routes] = await Promise.all([
    readFile(new URL("../app/me/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/profile-handle-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/social.ts", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getCurrentUserBookmarksPage/);
  assert.match(page, /ProfileHandleForm/);
  assert.match(page, /currentHandle=\{currentHandle\}/);
  assert.match(page, /Sign in to see your bookmarks/);
  assert.doesNotMatch(page, /set_profile_handle/);
  assert.match(form, /"use client"/);
  assert.match(form, /setProfileHandle/);
  assert.match(form, /Claim handle/);
  assert.match(form, /Change handle/);
  assert.match(form, /from "@annotated\/shared\/profile-handle"/);
  assert.doesNotMatch(form, /from\("profiles"\)/);
  assert.doesNotMatch(form, /\.update\(/);
  assert.match(social, /getCurrentUserProfileHandle/);
  assert.match(social, /\.select\("username"\)/);
  assert.doesNotMatch(social, /\.update\(/);
  assert.match(routes, /isReservedProfileHandle/);
  assert.match(routes, /PROFILE_HANDLE_PATTERN/);
});

test("web Me keeps first-Create auto-handle and signed-out sign-in only", async () => {
  const [page, form] = await Promise.all([
    readFile(new URL("../app/me/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/profile-handle-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /currentUserId \? <ProfileHandleForm/);
  assert.doesNotMatch(page, /ensure_profile_handle/);
  assert.doesNotMatch(form, /twitter|x\.com|provider handle/i);
  assert.doesNotMatch(form, /from\("profiles"\)\.update/);
});
