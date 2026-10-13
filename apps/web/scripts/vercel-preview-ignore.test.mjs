import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IGNORE_COMMAND,
  STAGING_VERCEL_PROJECT_ID,
  decideIgnoredBuild,
  resolveIgnoreDecision,
} from "./vercel-preview-ignore.mjs";

const PROD_PROJECT_ID = "prj_ctC6OfEnEKSQ73unB7D1mz3GysaS";

test("ignore command fits the Vercel setting and matches apps/web/vercel.json", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(vercel.ignoreCommand, IGNORE_COMMAND);
  assert.ok(IGNORE_COMMAND.length <= 256, `ignore command is ${IGNORE_COMMAND.length} characters`);
  assert.equal(IGNORE_COMMAND.includes("||"), false);
});

test("staging builds the bounty/integration branch and pull requests into it", () => {
  assert.equal(decideIgnoredBuild({
    projectId: STAGING_VERCEL_PROJECT_ID,
    ref: "bounty/integration",
    pullRequestId: "",
    baseRef: null,
    baseKnown: false,
    changedPaths: ["apps/extension/entrypoints/sidepanel/App.tsx"],
  }).exitCode, 1);
  assert.equal(decideIgnoredBuild({
    projectId: STAGING_VERCEL_PROJECT_ID,
    ref: "cursor/drag-trim-only-ccd3",
    pullRequestId: "162",
    baseRef: "bounty/integration",
    baseKnown: true,
    changedPaths: ["apps/extension/entrypoints/sidepanel/App.tsx"],
  }).reason, "staging-bounty-integration");
});

test("staging builds when a pull request base cannot be read", () => {
  assert.equal(decideIgnoredBuild({
    projectId: STAGING_VERCEL_PROJECT_ID,
    ref: "cursor/example",
    pullRequestId: "170",
    baseRef: null,
    baseKnown: false,
    changedPaths: ["apps/extension/wxt.config.ts"],
  }).exitCode, 1);
});

test("production skips extension-only bounty/integration previews", () => {
  const decision = decideIgnoredBuild({
    projectId: PROD_PROJECT_ID,
    ref: "cursor/drag-trim-only-ccd3",
    pullRequestId: "162",
    baseRef: "bounty/integration",
    baseKnown: true,
    changedPaths: ["apps/extension/entrypoints/sidepanel/App.tsx"],
  });
  assert.equal(decision.exitCode, 0);
  assert.equal(decision.reason, "prod-integration-extension-only");
});

test("production still builds a web change on bounty/integration", () => {
  assert.equal(decideIgnoredBuild({
    projectId: PROD_PROJECT_ID,
    ref: "bounty/integration",
    pullRequestId: "",
    baseRef: null,
    baseKnown: false,
    changedPaths: ["apps/web/src/app/page.tsx"],
  }).exitCode, 1);
});

test("an unknown diff builds, except a production integration preview", () => {
  assert.equal(decideIgnoredBuild({
    projectId: STAGING_VERCEL_PROJECT_ID,
    ref: "main",
    pullRequestId: "",
    baseRef: null,
    baseKnown: false,
    changedPaths: null,
  }).reason, "diff-unknown");
  assert.equal(decideIgnoredBuild({
    projectId: PROD_PROJECT_ID,
    ref: "bounty/integration",
    pullRequestId: "",
    baseRef: null,
    baseKnown: false,
    changedPaths: null,
  }).exitCode, 0);
});

test("shared package and lockfile changes build a normal preview", () => {
  assert.equal(decideIgnoredBuild({
    projectId: PROD_PROJECT_ID,
    ref: "cursor/web-fix",
    pullRequestId: "9",
    baseRef: "main",
    baseKnown: true,
    changedPaths: ["packages/shared/src/media-time.ts"],
  }).reason, "web-preview-changed");
  assert.equal(decideIgnoredBuild({
    projectId: STAGING_VERCEL_PROJECT_ID,
    ref: "cursor/web-fix",
    pullRequestId: "9",
    baseRef: "main",
    baseKnown: true,
    changedPaths: ["docs/product/roadmap.md"],
  }).exitCode, 0);
});

test("resolveIgnoreDecision reads the pull request base and the git diff", async () => {
  const decision = await resolveIgnoreDecision({
    VERCEL_PROJECT_ID: STAGING_VERCEL_PROJECT_ID,
    VERCEL_GIT_COMMIT_REF: "cursor/drag-trim-only-ccd3",
    VERCEL_GIT_PULL_REQUEST_ID: "162",
    VERCEL_GIT_PREVIOUS_SHA: "abc123",
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ base: { ref: "bounty/integration" } }),
    }),
    diffImpl: () => ["apps/extension/entrypoints/sidepanel/App.tsx"],
  });
  assert.equal(decision.reason, "staging-bounty-integration");
});
