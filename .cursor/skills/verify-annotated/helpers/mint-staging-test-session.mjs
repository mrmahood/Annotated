// Staging-only session mint. Never reads SUPABASE_SERVICE_ROLE_KEY and never
// prints a key, a JWT, or a session token.

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
import {
  DEDICATED_TEST_EMAIL,
  createSupabaseMintPort,
  mintDedicatedTestSession,
  redactSecrets,
} from "./mint-test-session.mjs";

export const STAGING_SUPABASE_HOST = "nkkunkwirvfwhmpwonqz.supabase.co";
export const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_HOST}`;
export const PROD_SUPABASE_REF = "vnxjktpdzmykmqrqwvks";
export const STAGING_MINT_SECRET_NAMES = [
  "STAGING_SUPABASE_SERVICE_ROLE_KEY",
  "STAGING_SUPABASE_URL",
  "STAGING_SUPABASE_PUBLISHABLE_KEY",
];

export function jwtProjectRef(token) {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof json.ref === "string" ? json.ref : null;
  } catch {
    return null;
  }
}

export function readStagingMintEnv(env) {
  const serviceRoleKey = env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "";
  const url = env.STAGING_SUPABASE_URL || "";
  const publishableKey = env.STAGING_SUPABASE_PUBLISHABLE_KEY || env.STAGING_SUPABASE_ANON_KEY || "";
  const missing = [];
  if (!serviceRoleKey) missing.push("STAGING_SUPABASE_SERVICE_ROLE_KEY");
  if (!url) missing.push("STAGING_SUPABASE_URL");
  if (!publishableKey) missing.push("STAGING_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    return {
      ok: false,
      exitCode: 3,
      missing,
      message: `set ${missing.join(", ")}`,
    };
  }

  let origin = "";
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
  } catch {
    origin = "";
  }
  if (origin !== STAGING_SUPABASE_URL) {
    return { ok: false, exitCode: 1, missing: [], message: "staging_url_refused" };
  }

  const ref = jwtProjectRef(serviceRoleKey);
  if (ref !== STAGING_SUPABASE_HOST.split(".")[0]) {
    return { ok: false, exitCode: 1, missing: [], message: "staging_key_refused" };
  }

  return {
    ok: true,
    url: origin,
    serviceRoleKey,
    publishableKey,
    email: DEDICATED_TEST_EMAIL,
    missing: [],
  };
}

function refused(config) {
  const error = new Error(config.message);
  error.code = config.message;
  error.exitCode = config.exitCode;
  error.missing = config.missing;
  return error;
}

function bounded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function mintStagingExtensionSession(env) {
  const config = readStagingMintEnv(env);
  if (!config.ok) throw refused(config);
  let createClient;
  try {
    ({ createClient } = createRequire(join(REPO_ROOT, "apps/web/package.json"))("@supabase/supabase-js"));
  } catch {
    throw bounded("mint_client_missing");
  }
  const port = createSupabaseMintPort({
    url: config.url,
    serviceRoleKey: config.serviceRoleKey,
    publishableKey: config.publishableKey,
    verifyMagicLink: async (link) => {
      const memory = new Map();
      const client = createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: (key) => memory.get(key) ?? null,
            setItem: (key, value) => { memory.set(key, value); },
            removeItem: (key) => { memory.delete(key); },
          },
          storageKey: "supabase-session",
        },
      });
      const { error } = await client.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.otpType,
      });
      if (error) throw bounded("mint_verify_failed");
      const raw = memory.get("supabase-session");
      if (typeof raw !== "string" || raw.length === 0) throw bounded("mint_verify_failed");
      return [{ name: "extension-session", value: raw }];
    },
  });
  const minted = await mintDedicatedTestSession(port, config.email);
  const sessionJson = minted.cookies.find((cookie) => cookie.name === "extension-session")?.value;
  if (typeof sessionJson !== "string" || sessionJson.length === 0) throw bounded("mint_verify_failed");
  return {
    sessionJson,
    log: redactSecrets(`session minted for ${config.email}`, [config.serviceRoleKey, config.publishableKey, sessionJson]),
  };
}

export async function mintStagingTestSession(env, { verifyMagicLink } = {}) {
  const config = readStagingMintEnv(env);
  if (!config.ok) throw refused(config);
  const port = createSupabaseMintPort({
    url: config.url,
    serviceRoleKey: config.serviceRoleKey,
    publishableKey: config.publishableKey,
    ...(verifyMagicLink ? { verifyMagicLink } : {}),
  });
  const minted = await mintDedicatedTestSession(port, config.email);
  return {
    ...minted,
    log: redactSecrets(minted.log, [config.serviceRoleKey, config.publishableKey]),
  };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  const config = readStagingMintEnv(process.env);
  if (!config.ok) {
    if (config.exitCode === 3) {
      console.log("verified-unreachable");
      console.log(`missing: ${config.missing.join(", ")}`);
      process.exit(3);
    }
    console.error(config.message);
    process.exit(config.exitCode);
  }
  try {
    const minted = await mintStagingTestSession(process.env);
    console.log(redactSecrets(minted.log, [
      config.serviceRoleKey,
      config.publishableKey,
      ...minted.cookies.map((cookie) => cookie.value),
    ]));
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "mint_failed";
    console.error(redactSecrets(code, [config.serviceRoleKey, config.publishableKey]));
    process.exit(1);
  }
}
