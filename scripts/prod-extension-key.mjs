import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROD_EXTENSION_PUBLIC_KEY_RELATIVE_PATH =
  "apps/extension/prod-extension-public-key.txt";
export const PROD_EXTENSION_AUTH_CALLBACK_PATH = "auth/callback";
export const PROD_SUPABASE_VENDOR_CALLBACK =
  "https://vnxjktpdzmykmqrqwvks.supabase.co/auth/v1/callback";

const PUBLIC_KEY_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  PROD_EXTENSION_PUBLIC_KEY_RELATIVE_PATH,
);

export function normalizeManifestPublicKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Production extension public key is missing.");
  }

  const trimmed = value.trim();
  const pem = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/
    .exec(trimmed);
  const base64 = (pem ? pem[1] : trimmed).replace(/\s+/g, "");

  if (!/^[A-Za-z0-9+/]+=*$/.test(base64) || base64.length < 200) {
    throw new Error(
      "Production extension public key is not a base64 SPKI Chrome manifest key.",
    );
  }

  return base64;
}

export function chromeExtensionIdFromPublicKey(value) {
  const key = normalizeManifestPublicKey(value);
  const der = Buffer.from(key, "base64");
  if (der.length < 50 || der[0] !== 0x30) {
    throw new Error("Production extension public key is not a DER SPKI blob.");
  }

  const digest = createHash("sha256").update(der).digest().subarray(0, 16);
  return [...digest]
    .map((byte) => String.fromCharCode(97 + ((byte >> 4) & 0x0f), 97 + (byte & 0x0f)))
    .join("");
}

export function readCommittedProdExtensionPublicKey(
  publicKeyFile = PUBLIC_KEY_FILE,
) {
  return normalizeManifestPublicKey(readFileSync(publicKeyFile, "utf8"));
}

export const COMMITTED_PROD_EXTENSION_PUBLIC_KEY = readCommittedProdExtensionPublicKey();
export const PROD_EXTENSION_ID = chromeExtensionIdFromPublicKey(
  COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
);

export function resolveProdExtensionPublicKey(
  env = process.env,
  committed = COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
) {
  const fromEnv = env.ANNOTATED_PROD_EXTENSION_PUBLIC_KEY?.trim();
  if (fromEnv) return normalizeManifestPublicKey(fromEnv);
  return normalizeManifestPublicKey(committed);
}

export function pinProdExtensionManifest(
  manifest,
  publicKey = COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
) {
  return {
    ...manifest,
    key: normalizeManifestPublicKey(publicKey),
  };
}

export function assertProdExtensionManifestKey(
  manifest,
  publicKey = COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
) {
  const expected = normalizeManifestPublicKey(publicKey);
  let actual;
  try {
    actual = normalizeManifestPublicKey(manifest?.key);
  } catch {
    throw new Error("Prod extension zip must pin the Production public key.");
  }
  if (actual !== expected) {
    throw new Error("Prod extension zip public key does not match the Production pin.");
  }
}

export function prodExtensionOauthRedirects(
  extensionId = PROD_EXTENSION_ID,
) {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("Production extension ID must be 32 Chrome ID characters (a-p).");
  }

  const callback =
    `https://${extensionId}.chromiumapp.org/${PROD_EXTENSION_AUTH_CALLBACK_PATH}`;

  return {
    extensionId,
    supabaseAuthRedirectUrl: callback,
    supabaseAuthRedirectWildcard: `https://${extensionId}.chromiumapp.org/**`,
    googleCloudAuthorizedRedirectUri: PROD_SUPABASE_VENDOR_CALLBACK,
    xChromeIdentityRedirectUrl: callback,
  };
}

export function formatProdExtensionKeyReport(
  publicKey = COMMITTED_PROD_EXTENSION_PUBLIC_KEY,
) {
  const key = normalizeManifestPublicKey(publicKey);
  const extensionId = chromeExtensionIdFromPublicKey(key);
  const redirects = prodExtensionOauthRedirects(extensionId);

  return [
    `Pinned Production extension ID: ${redirects.extensionId}`,
    `Chrome identity callback: ${redirects.supabaseAuthRedirectUrl}`,
    `Supabase Prod Auth redirect URL: ${redirects.supabaseAuthRedirectUrl}`,
    `Supabase Prod Auth wildcard (optional): ${redirects.supabaseAuthRedirectWildcard}`,
    `Google Cloud OAuth authorized redirect URI (Supabase vendor callback): ${redirects.googleCloudAuthorizedRedirectUri}`,
    `X uses the same Chrome identity callback: ${redirects.xChromeIdentityRedirectUrl}`,
  ].join("\n");
}

function main() {
  const publicKey = resolveProdExtensionPublicKey();
  console.log(formatProdExtensionKeyReport(publicKey));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main();
}
