import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CI_PLACEHOLDER_KEY,
  PROD_SUPABASE_URL,
  PROD_WEB_APP_URL,
  STAGING_SUPABASE_HOST,
  STAGING_WEB_APP_HOST,
  assertProdExtensionBundleText,
  assertProdExtensionOutput,
  assertProdExtensionZip,
  pinProdExtensionOutput,
  prodExtensionChildEnv,
  extensionVersionDocument,
  packageProdExtensionZip,
  productionWebBuildRequiresZip,
  readExtensionPackageVersion,
  readZipEntry,
  resolveProdExtensionPublishableKey,
  writeExtensionVersionDocument,
  zipChromeMv3Directory,
} from "./package-prod-extension-zip.mjs";
import {
  COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
  chromeExtensionIdFromPublicKey,
} from "./prod-extension-key.mjs";

const execFileAsync = promisify(execFile);
const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_HOST}`;
const STAGING_WEB_APP_URL = `https://${STAGING_WEB_APP_HOST}`;

function prodBundleFixture({
  supabaseUrl = PROD_SUPABASE_URL,
  webAppUrl = PROD_WEB_APP_URL,
} = {}) {
  return [
    `var As={google:{label:\`Google\`},x:{label:\`X\`}},js=Object.freeze({google:!0,x:!1}),Ms=new Set([\`${STAGING_SUPABASE_URL}\`,\`${PROD_SUPABASE_URL}\`]);`,
    `var Fs=Ps({xOptIn:void 0,supabaseUrl:\`${supabaseUrl}\`});`,
    `function Vm(){let e=\`${supabaseUrl}\`;try{let t=new URL(e);if(t.protocol!==\`https:\`&&t.hostname!==\`localhost\`)throw Error(\`invalid protocol\`)}catch{throw Error(\`WXT_SUPABASE_URL must be a valid HTTPS Supabase project URL.\`)}return{url:e,publishableKey:\`sb_publishable_dummy\`}}`,
    `var Um=class extends Error{constructor(){super(\`WXT_WEB_APP_URL must be an HTTP or HTTPS origin.\`),this.name=\`WebAppUrlConfigurationError\`}};function Wm(){try{let e=new URL(\`${webAppUrl}\`),t=e.protocol===\`http:\`||e.protocol===\`https:\`;`,
    `var _=globalThis.chrome,v=h({webAppUrl:\`${webAppUrl}\`,collectorUrl:void 0});`,
  ].join("");
}

test("Prod zip packaging uses Production pins and refuses Staging or CI placeholders", () => {
  assert.equal(
    resolveProdExtensionPublishableKey({
      NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "prod-publishable-key",
    }),
    "prod-publishable-key",
  );
  assert.equal(
    resolveProdExtensionPublishableKey({
      NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-key",
    }),
    null,
  );
  assert.equal(
    resolveProdExtensionPublishableKey({
      NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CI_PLACEHOLDER_KEY,
    }),
    null,
  );
  assert.equal(
    resolveProdExtensionPublishableKey({
      ANNOTATED_PROD_EXTENSION_PUBLISHABLE_KEY: "dedicated-prod-key",
      NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-key",
    }),
    "dedicated-prod-key",
  );
  assert.equal(
    productionWebBuildRequiresZip({
      NEXT_PUBLIC_SITE_URL: PROD_WEB_APP_URL,
    }),
    true,
  );
  assert.equal(
    productionWebBuildRequiresZip({
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    }),
    false,
  );
});

test("Prod zip assert allows the Staging X-auth comparison constant when runtime pins are Production", () => {
  assert.doesNotThrow(() => assertProdExtensionBundleText(prodBundleFixture()));
});

test("Prod zip assert rejects Staging as the configured Supabase or web origin", () => {
  assert.throws(
    () => assertProdExtensionBundleText(prodBundleFixture({ supabaseUrl: STAGING_SUPABASE_URL })),
    /configured Supabase origin/,
  );
  assert.throws(
    () => assertProdExtensionBundleText(prodBundleFixture({ webAppUrl: STAGING_WEB_APP_URL })),
    /configured web origin/,
  );
  assert.throws(
    () => assertProdExtensionBundleText("no configured origins here"),
    /missing the inlined WXT_SUPABASE_URL/,
  );
});

test("Prod zip child env pins Production endpoints and the public key", () => {
  const childEnv = prodExtensionChildEnv({
    env: {
      WXT_WEB_APP_URL: STAGING_WEB_APP_URL,
      WXT_SUPABASE_URL: STAGING_SUPABASE_URL,
      WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH: "1",
    },
    publishableKey: "prod-publishable-key",
  });

  assert.equal(childEnv.WXT_WEB_APP_URL, PROD_WEB_APP_URL);
  assert.equal(childEnv.WXT_SUPABASE_URL, PROD_SUPABASE_URL);
  assert.equal(childEnv.WXT_SUPABASE_PUBLISHABLE_KEY, "prod-publishable-key");
  assert.equal(childEnv.ANNOTATED_PROD_EXTENSION_PUBLIC_KEY, COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  assert.equal(childEnv.WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH, undefined);
});

test("Prod zip output pins the public key and still rejects Staging runtime pins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "annotated-prod-zip-"));
  await writeFile(
    join(directory, "background.js"),
    prodBundleFixture(),
  );
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ manifest_version: 3, name: "Annotated" }, null, 2)}\n`,
  );

  await assert.rejects(
    () => assertProdExtensionOutput(directory),
    /pin the Production public key/,
  );

  const pinned = await pinProdExtensionOutput(directory);
  assert.equal(pinned.key, COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  assert.equal(
    chromeExtensionIdFromPublicKey(pinned.key),
    chromeExtensionIdFromPublicKey(COMMITTED_PROD_EXTENSION_PUBLIC_KEY),
  );
  const written = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(written.key, COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  await assert.doesNotReject(() => assertProdExtensionOutput(directory));

  await writeFile(join(directory, "background.js"), prodBundleFixture({
    supabaseUrl: STAGING_SUPABASE_URL,
  }));
  await assert.rejects(
    () => assertProdExtensionOutput(directory),
    /configured Supabase origin/,
  );
});

test("two Prod zips of the pinned chrome-mv3 output keep the same extension ID", async () => {
  const parent = await mkdtemp(join(tmpdir(), "annotated-prod-zip-id-"));
  const directory = join(parent, "chrome-mv3");
  await mkdir(directory);
  await writeFile(join(directory, "background.js"), prodBundleFixture());
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ manifest_version: 3, name: "Annotated" }, null, 2)}\n`,
  );
  await pinProdExtensionOutput(directory);

  const firstZip = join(parent, "first.zip");
  const secondZip = join(parent, "second.zip");
  await zipChromeMv3Directory(directory, firstZip);
  await zipChromeMv3Directory(directory, secondZip);
  await assertProdExtensionZip(firstZip);
  await assertProdExtensionZip(secondZip);

  const firstKey = JSON.parse(await readZipEntry(firstZip, "manifest.json")).key;
  const secondKey = JSON.parse(await readZipEntry(secondZip, "manifest.json")).key;
  assert.equal(firstKey, secondKey);
  assert.equal(
    chromeExtensionIdFromPublicKey(firstKey),
    chromeExtensionIdFromPublicKey(COMMITTED_PROD_EXTENSION_PUBLIC_KEY),
  );
});

test("Prod zip ignores mp4 files such as the public demo video", async () => {
  const parent = await mkdtemp(join(tmpdir(), "annotated-prod-zip-mp4-"));
  const directory = join(parent, "chrome-mv3");
  await mkdir(join(directory, "chunks"), { recursive: true });
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ manifest_version: 3, name: "Annotated" })}\n`,
  );
  await writeFile(join(directory, "demo.mp4"), "demo-video");
  await writeFile(join(directory, "chunks", "clip.mp4"), "nested-video");
  await writeFile(join(directory, "background.js"), "console.log('ok');\n");

  const zipPath = join(parent, "extension.zip");
  await zipChromeMv3Directory(directory, zipPath);
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
  const names = stdout.split("\n").filter(Boolean);
  assert.equal(names.includes("manifest.json"), true);
  assert.equal(names.includes("background.js"), true);
  assert.equal(names.some((name) => name.endsWith(".mp4")), false);
});

test("extension version JSON is written from the package version even when the Prod zip is skipped", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "annotated-extension-version-"));
  await mkdir(join(repoRoot, "apps/extension"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/extension/package.json"),
    `${JSON.stringify({ name: "annotated", version: "0.2.0" })}\n`,
  );

  assert.equal(await readExtensionPackageVersion(repoRoot), "0.2.0");
  const written = await writeExtensionVersionDocument(repoRoot);
  const document = JSON.parse(await readFile(written.destination, "utf8"));
  assert.deepEqual(document, extensionVersionDocument("0.2.0"));
  assert.equal(document.version, "0.2.0");

  const skipped = await packageProdExtensionZip({
    env: {},
    repoRoot,
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.version, "0.2.0");
  const again = JSON.parse(
    await readFile(join(repoRoot, "apps/web/public/extension-version.json"), "utf8"),
  );
  assert.deepEqual(again, { name: "Annotated", version: "0.2.0" });

  await writeFile(
    join(repoRoot, "apps/extension/package.json"),
    `${JSON.stringify({ version: "0.2" })}\n`,
  );
  await assert.rejects(() => readExtensionPackageVersion(repoRoot), /semver X\.Y\.Z/);
});
