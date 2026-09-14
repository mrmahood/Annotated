import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROD_WEB_APP_URL = "https://annotated.cbandcoop.com";
export const PROD_SUPABASE_URL = "https://vnxjktpdzmykmqrqwvks.supabase.co";
export const STAGING_SUPABASE_HOST = "nkkunkwirvfwhmpwonqz.supabase.co";
export const WEB_ZIP_RELATIVE_PATH = "apps/web/public/extension.zip";
export const CI_PLACEHOLDER_KEY = "ci-local-publishable-placeholder";

const FORBIDDEN_HOST_MARKERS = [
  STAGING_SUPABASE_HOST,
  "annotated-staging.cbandcoop.com",
];

const REQUIRED_HOST_MARKERS = [
  "annotated.cbandcoop.com",
  "vnxjktpdzmykmqrqwvks",
];

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

export async function assertProdExtensionOutput(chromeMv3Directory) {
  const manifest = JSON.parse(
    await readFile(join(chromeMv3Directory, "manifest.json"), "utf8"),
  );
  if (manifest.manifest_version !== 3) {
    throw new Error("Prod extension zip must be Manifest V3.");
  }

  const text = await readTextFilesUnder(chromeMv3Directory, [".js", ".json", ".html"]);
  for (const marker of FORBIDDEN_HOST_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`Prod extension output contains forbidden host ${marker}.`);
    }
  }
  for (const marker of REQUIRED_HOST_MARKERS) {
    if (!text.includes(marker)) {
      throw new Error(`Prod extension output is missing required host marker ${marker}.`);
    }
  }
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
