import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
  PROD_EXTENSION_ID,
  PROD_SUPABASE_VENDOR_CALLBACK,
  assertProdExtensionManifestKey,
  chromeExtensionIdFromPublicKey,
  formatProdExtensionKeyReport,
  normalizeManifestPublicKey,
  pinProdExtensionManifest,
  prodExtensionOauthRedirects,
  resolveProdExtensionPublicKey,
} from "./prod-extension-key.mjs";

test("committed Production public key derives one stable Chrome extension ID", () => {
  const first = chromeExtensionIdFromPublicKey(COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  const second = chromeExtensionIdFromPublicKey(COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  assert.equal(first, "dgflcndninfbfgeachchbpjcdhnegcpp");
  assert.equal(first, second);
  assert.equal(PROD_EXTENSION_ID, first);
  assert.match(first, /^[a-p]{32}$/);
});

test("PEM and whitespace-wrapped public keys normalize to the same Chrome ID", () => {
  const wrapped = COMMITTED_PROD_EXTENSION_PUBLIC_KEY.match(/.{1,64}/g).join("\n");
  const pem = `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
  assert.equal(normalizeManifestPublicKey(pem), COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  assert.equal(chromeExtensionIdFromPublicKey(pem), PROD_EXTENSION_ID);
  assert.equal(
    chromeExtensionIdFromPublicKey(`  ${COMMITTED_PROD_EXTENSION_PUBLIC_KEY} \n`),
    PROD_EXTENSION_ID,
  );
});

test("a different RSA public key derives a different extension ID", () => {
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const otherId = chromeExtensionIdFromPublicKey(publicKey.toString("base64"));
  assert.match(otherId, /^[a-p]{32}$/);
  assert.notEqual(otherId, PROD_EXTENSION_ID);
});

test("Prod OAuth allowlist URLs use the pinned chromiumapp callback", () => {
  const redirects = prodExtensionOauthRedirects();
  assert.equal(redirects.extensionId, PROD_EXTENSION_ID);
  assert.equal(
    redirects.supabaseAuthRedirectUrl,
    `https://${PROD_EXTENSION_ID}.chromiumapp.org/auth/callback`,
  );
  assert.equal(
    redirects.supabaseAuthRedirectWildcard,
    `https://${PROD_EXTENSION_ID}.chromiumapp.org/**`,
  );
  assert.equal(redirects.googleCloudAuthorizedRedirectUri, PROD_SUPABASE_VENDOR_CALLBACK);
  assert.equal(redirects.xChromeIdentityRedirectUrl, redirects.supabaseAuthRedirectUrl);
  assert.match(
    formatProdExtensionKeyReport(),
    new RegExp(`${PROD_EXTENSION_ID}\\.chromiumapp\\.org/auth/callback`),
  );
  assert.doesNotMatch(formatProdExtensionKeyReport(), /chromewebstore\.google\.com/);
});

test("manifest pin writes the Production key and rejects a missing or foreign key", () => {
  const pinned = pinProdExtensionManifest({ manifest_version: 3, name: "Annotated" });
  assert.equal(pinned.key, COMMITTED_PROD_EXTENSION_PUBLIC_KEY);
  assert.doesNotThrow(() => assertProdExtensionManifestKey(pinned));
  assert.throws(
    () => assertProdExtensionManifestKey({ manifest_version: 3 }),
    /pin the Production public key/,
  );
  assert.throws(
    () => assertProdExtensionManifestKey({ key: `${COMMITTED_PROD_EXTENSION_PUBLIC_KEY}A` }),
    /does not match the Production pin/,
  );
});

test("Vercel/build env can override the committed public key", () => {
  assert.equal(
    resolveProdExtensionPublicKey({}),
    COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
  );
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const override = publicKey.toString("base64");
  assert.equal(
    resolveProdExtensionPublicKey({
      ANNOTATED_PROD_EXTENSION_PUBLIC_KEY: override,
    }),
    override,
  );
});
