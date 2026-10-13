// Vercel ignoreCommand: exit 0 skips the deployment, exit 1 builds it.
// Staging project previews for bounty/integration always build, including
// extension-only commits. Every other project, including production, builds
// only when the web app or shared package changed.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STAGING_VERCEL_PROJECT_ID = "prj_09I3ZlXqCUE8DSEEFljWUjlHvnqc";
export const INTEGRATION_BRANCH = "bounty/integration";
export const GITHUB_REPOSITORY = "mrmahood/Annotated";

export const IGNORE_COMMAND = "bash -lc 'if [ -f apps/web/scripts/vercel-preview-ignore.mjs ]; then exec node apps/web/scripts/vercel-preview-ignore.mjs; elif [ -f scripts/vercel-preview-ignore.mjs ]; then exec node scripts/vercel-preview-ignore.mjs; else exit 1; fi'";

const WEB_PREFIXES = [
  "apps/web/",
  "packages/shared/",
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
];

export function pathAffectsWebPreview(filePath) {
  return WEB_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

export function decideIgnoredBuild({
  projectId,
  ref,
  pullRequestId,
  baseRef,
  baseKnown,
  changedPaths,
}) {
  const staging = projectId === STAGING_VERCEL_PROJECT_ID;
  const hasPullRequest = Boolean(pullRequestId) && pullRequestId !== "0";
  const integrationBranch = ref === INTEGRATION_BRANCH;
  const integrationPullRequest = hasPullRequest && baseKnown && baseRef === INTEGRATION_BRANCH;
  const unknownPullRequestBase = hasPullRequest && !baseKnown;

  if (staging && (integrationBranch || integrationPullRequest || unknownPullRequestBase)) {
    return { exitCode: 1, reason: "staging-bounty-integration" };
  }

  const productionIntegration = !staging && (integrationBranch || integrationPullRequest);
  if (changedPaths == null) {
    return productionIntegration
      ? { exitCode: 0, reason: "prod-integration-diff-unknown" }
      : { exitCode: 1, reason: "diff-unknown" };
  }

  if (changedPaths.some(pathAffectsWebPreview)) {
    return { exitCode: 1, reason: "web-preview-changed" };
  }
  return {
    exitCode: 0,
    reason: productionIntegration ? "prod-integration-extension-only" : "unaffected",
  };
}

export async function fetchPullRequestBase(pullRequestId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${pullRequestId}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "annotated-vercel-preview-ignore",
      },
    },
  );
  if (!response.ok) return null;
  const body = await response.json();
  const ref = body?.base?.ref;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

export function changedPathsSince(previousSha, spawnImpl = spawnSync) {
  if (!previousSha || /^0+$/.test(previousSha)) return null;
  const root = spawnImpl("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const cwd = root.status === 0 ? root.stdout.trim() : process.cwd();
  const diff = spawnImpl("git", ["diff", "--name-only", previousSha, "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (diff.status !== 0) return null;
  return diff.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function resolveIgnoreDecision(env, {
  fetchImpl = globalThis.fetch,
  diffImpl = changedPathsSince,
} = {}) {
  const pullRequestId = env.VERCEL_GIT_PULL_REQUEST_ID || "";
  const hasPullRequest = Boolean(pullRequestId) && pullRequestId !== "0";
  let baseRef = null;
  let baseKnown = false;
  if (hasPullRequest) {
    try {
      baseRef = await fetchPullRequestBase(pullRequestId, fetchImpl);
      baseKnown = typeof baseRef === "string";
    } catch {
      baseKnown = false;
    }
  }
  return decideIgnoredBuild({
    projectId: env.VERCEL_PROJECT_ID || "",
    ref: env.VERCEL_GIT_COMMIT_REF || "",
    pullRequestId,
    baseRef,
    baseKnown,
    changedPaths: diffImpl(env.VERCEL_GIT_PREVIOUS_SHA || ""),
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const decision = await resolveIgnoreDecision(process.env);
  console.log(`vercel-preview-ignore: ${decision.reason}`);
  process.exit(decision.exitCode);
}
