import assert from "node:assert/strict";
import test from "node:test";
import {
  CI_PLACEHOLDER_KEY,
  PROD_SUPABASE_URL,
  PROD_WEB_APP_URL,
  STAGING_SUPABASE_HOST,
  STAGING_WEB_APP_HOST,
  assertProdExtensionBundleText,
  productionWebBuildRequiresZip,
  resolveProdExtensionPublishableKey,
} from "./package-prod-extension-zip.mjs";

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
