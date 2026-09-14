import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROD_WEB_APP_URL = "https://annotated.cbandcoop.com";
export const PROD_SUPABASE_URL = "https://vnxjktpdzmykmqrqwvks.supabase.co";
export const STAGING_SUPABASE_HOST = "nkkunkwirvfwhmpwonqz.supabase.co";
export const STAGING_WEB_APP_HOST = "annotated-staging.cbandcoop.com";
export const WEB_ZIP_RELATIVE_PATH = "apps/web/public/extension.zip";
export const CI_PLACEHOLDER_KEY = "ci-local-publishable-placeholder";

const SUPABASE_CONFIG_MARKER = "WXT_SUPABASE_URL must be a valid HTTPS Supabase project URL.";
const WEB_APP_CONFIG_MARKER = "WXT_WEB_APP_URL must be an HTTP or HTTPS origin.";

const QUOTED_HTTPS_ORIGIN = /[`'"](https:\/\/[a-z0-9.-]+)[`'"]/gi;

export function isProdSupabaseUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === PROD_SUPABASE_URL &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "";
  } catch {
    return false;
  }
}

export function isProdWebAppUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === PROD_WEB_APP_URL &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "";
  } catch {
    return false;
  }
}

export function resolveProdExtensionPublishableKey(env = process.env) {
  const dedicated = env.ANNOTATED_PROD_EXTENSION_PUBLISHABLE_KEY?.trim();
  if (dedicated && dedicated !== CI_PLACEHOLDER_KEY) return dedicated;

  const nextUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const nextKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (nextKey && nextKey !== CI_PLACEHOLDER_KEY && isProdSupabaseUrl(nextUrl)) {
    return nextKey;
  }

  const wxtUrl = env.WXT_SUPABASE_URL?.trim();
  const wxtKey = env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (wxtKey && wxtKey !== CI_PLACEHOLDER_KEY && isProdSupabaseUrl(wxtUrl)) {
    return wxtKey;
  }

  return null;
}

export function productionWebBuildRequiresZip(env = process.env) {
  return isProdWebAppUrl(env.NEXT_PUBLIC_SITE_URL?.trim()) ||
    isProdSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL?.trim());
}

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`));
    });
  });
}

async function readTextFilesUnder(directory, suffixes) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readTextFilesUnder(path, suffixes));
      continue;
    }
    if (!suffixes.some((suffix) => entry.name.endsWith(suffix))) continue;
    chunks.push(await readFile(path, "utf8"));
  }

  return chunks.join("\n");
}

export function quotedHttpsOriginsInWindow(text, marker, lookBehind, lookAhead) {
  const index = text.indexOf(marker);
  if (index < 0) return [];
  const start = Math.max(0, index - lookBehind);
  const end = Math.min(text.length, index + marker.length + lookAhead);
  const window = text.slice(start, end);
  const origins = [];
  for (const match of window.matchAll(QUOTED_HTTPS_ORIGIN)) {
    try {
      origins.push(new URL(match[1]).origin);
    } catch {
      // Ignore malformed quoted URL-shaped strings.
    }
  }
  return origins;
}

export function collectAssignedHttpsOrigins(text, propertyName) {
  const origins = [];
  const prefix = `${propertyName}:`;
  let searchFrom = 0;

  while (true) {
    const index = text.indexOf(prefix, searchFrom);
    if (index < 0) break;
    const slice = text.slice(index + prefix.length, index + prefix.length + 96);
    const match = /^[`'"](https:\/\/[a-z0-9.-]+)[`'"]/.exec(slice);
    if (match) {
      try {
        origins.push(new URL(match[1]).origin);
      } catch {
        // Ignore malformed property assignments.
      }
    }
    searchFrom = index + prefix.length;
  }

  return origins;
}

export function collectConfiguredExtensionPins(text) {
  const supabaseFromClient = quotedHttpsOriginsInWindow(text, SUPABASE_CONFIG_MARKER, 280, 40)
    .filter((origin) => origin.endsWith(".supabase.co"));
  const webFromOriginHelper = quotedHttpsOriginsInWindow(text, WEB_APP_CONFIG_MARKER, 40, 240)
    .filter((origin) => origin.includes("cbandcoop.com") || origin.includes("localhost") || origin.includes("127.0.0.1"));
  const supabaseAssignments = collectAssignedHttpsOrigins(text, "supabaseUrl");
  const webAssignments = collectAssignedHttpsOrigins(text, "webAppUrl");

  return {
    supabaseOrigins: [...new Set([...supabaseFromClient, ...supabaseAssignments])],
    webAppOrigins: [...new Set([...webFromOriginHelper, ...webAssignments])],
  };
}

export function assertProdExtensionBundleText(text) {
  const { supabaseOrigins, webAppOrigins } = collectConfiguredExtensionPins(text);

  if (supabaseOrigins.length === 0) {
    throw new Error("Prod extension output is missing the inlined WXT_SUPABASE_URL client configuration.");
  }
  if (webAppOrigins.length === 0) {
    throw new Error("Prod extension output is missing the inlined WXT_WEB_APP_URL origin configuration.");
  }

  for (const origin of supabaseOrigins) {
    if (origin !== PROD_SUPABASE_URL) {
      throw new Error(
        `Prod extension configured Supabase origin is ${origin}, expected ${PROD_SUPABASE_URL}.`,
      );
    }
  }
  for (const origin of webAppOrigins) {
    if (origin !== PROD_WEB_APP_URL) {
      throw new Error(
        `Prod extension configured web origin is ${origin}, expected ${PROD_WEB_APP_URL}.`,
      );
    }
  }
}

export async function assertProdExtensionOutput(chromeMv3Directory) {
  const manifest = JSON.parse(
    await readFile(join(chromeMv3Directory, "manifest.json"), "utf8"),
  );
  if (manifest.manifest_version !== 3) {
    throw new Error("Prod extension zip must be Manifest V3.");
  }

  const text = await readTextFilesUnder(chromeMv3Directory, [".js", ".json", ".html"]);
  assertProdExtensionBundleText(text);
}

async function findBuiltZip(outputDirectory) {
  const names = await readdir(outputDirectory);
  const zipNames = names.filter((name) => name.endsWith(".zip"));
  if (zipNames.length !== 1) {
    throw new Error(
      `Expected exactly one zip in ${outputDirectory}, found ${zipNames.join(", ") || "none"}.`,
    );
  }
  return join(outputDirectory, zipNames[0]);
}

export async function packageProdExtensionZip({
  env = process.env,
  repoRoot = repoRootFromScript(),
} = {}) {
  const publishableKey = resolveProdExtensionPublishableKey(env);
  if (!publishableKey) {
    if (productionWebBuildRequiresZip(env)) {
      throw new Error(
        "Production web build requires a Prod-flavored apps/web/public/extension.zip. Provide the Production publishable key via NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (with NEXT_PUBLIC_SUPABASE_URL pointing at the Production project) or ANNOTATED_PROD_EXTENSION_PUBLISHABLE_KEY.",
      );
    }
    console.warn(
      "Skipping Prod extension zip: Production publishable key is not available in this environment.",
    );
    return { skipped: true };
  }

  const childEnv = {
    ...process.env,
    ...env,
    WXT_WEB_APP_URL: PROD_WEB_APP_URL,
    WXT_SUPABASE_URL: PROD_SUPABASE_URL,
    WXT_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
  delete childEnv.WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH;

  await run("pnpm", ["--dir", "apps/extension", "run", "zip"], {
    cwd: repoRoot,
    env: childEnv,
  });

  const chromeMv3Directory = join(repoRoot, "apps/extension/.output/chrome-mv3");
  await assertProdExtensionOutput(chromeMv3Directory);

  const builtZip = await findBuiltZip(join(repoRoot, "apps/extension/.output"));
  const destination = join(repoRoot, WEB_ZIP_RELATIVE_PATH);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(builtZip, destination);
  console.log(`Wrote ${WEB_ZIP_RELATIVE_PATH} from Prod chrome-mv3 output.`);
  return { skipped: false, destination };
}

async function main() {
  await packageProdExtensionZip();
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
