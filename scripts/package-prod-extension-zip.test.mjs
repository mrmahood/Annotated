import assert from "node:assert/strict";
import test from "node:test";
import {
  CI_PLACEHOLDER_KEY,
  PROD_SUPABASE_URL,
  PROD_WEB_APP_URL,
  STAGING_SUPABASE_HOST,
  productionWebBuildRequiresZip,
  resolveProdExtensionPublishableKey,
} from "./package-prod-extension-zip.mjs";

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
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_HOST}`,
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
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_HOST}`,
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
