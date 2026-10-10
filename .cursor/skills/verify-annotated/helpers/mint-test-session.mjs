// Mints a Supabase session for the dedicated test user only.
// Never print the service-role key, publishable key, OTP, or cookie values.

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEDICATED_TEST_EMAIL = "cbandcooptest@gmail.com";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OTP_TYPES = new Set(["magiclink", "email", "signup"]);

export function assertDedicatedTestEmail(email) {
  if (email !== DEDICATED_TEST_EMAIL) {
    throw bounded("mint_refused_email");
  }
}

export function readMintEnv(env) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!serviceRoleKey) {
    return { ok: false, exitCode: 3, message: "set SUPABASE_SERVICE_ROLE_KEY" };
  }
  if (!url || !publishableKey) {
    return {
      ok: false,
      exitCode: 3,
      message: "set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    };
  }
  return { ok: true, url, serviceRoleKey, publishableKey, email: DEDICATED_TEST_EMAIL };
}

export function redactSecrets(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

export function parseGenerateLink(status, body) {
  const hashed = body?.properties?.hashed_token;
  if (Number.isInteger(status) && status >= 200 && status < 300 && typeof hashed === "string" && hashed.length > 0) {
    const verificationType = body?.properties?.verification_type;
    return {
      status: "ok",
      tokenHash: hashed,
      otpType: OTP_TYPES.has(verificationType) ? verificationType : "magiclink",
    };
  }
  const code = `${body?.error_code || ""} ${body?.error || ""} ${body?.code || ""} ${body?.msg || ""} ${body?.message || ""}`;
  if (status === 404 || /not[_ ]found|user not found/i.test(code)) return { status: "user_not_found" };
  return { status: "error" };
}

export function userAlreadyExists(status, body) {
  const code = `${body?.error_code || ""} ${body?.error || ""} ${body?.code || ""} ${body?.msg || ""} ${body?.message || ""}`;
  return status === 422 || /already|email_exists|duplicate/i.test(code);
}

function bounded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function mintDedicatedTestSession(port, email) {
  assertDedicatedTestEmail(email);
  let link = await port.generateMagicLink(email);
  if (link?.status === "user_not_found") {
    await port.createConfirmedUser(email);
    link = await port.generateMagicLink(email);
  }
  if (link?.status !== "ok" || typeof link.tokenHash !== "string" || link.tokenHash.length === 0) {
    throw bounded("mint_link_failed");
  }
  const cookies = await port.verifyMagicLink(link);
  if (!Array.isArray(cookies) || cookies.length === 0 || cookies.some((cookie) => !cookie?.name || !cookie?.value)) {
    throw bounded("mint_verify_failed");
  }
  return {
    cookies,
    log: `session minted for ${DEDICATED_TEST_EMAIL}; cookie count ${cookies.length}`,
  };
}

export function createSupabaseMintPort({
  url,
  serviceRoleKey,
  publishableKey,
  fetchImpl = globalThis.fetch,
  verifyMagicLink,
}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
    throw bounded("mint_url_refused");
  }
  const authRoot = `${endpoint.origin}/auth/v1`;

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  return {
    async generateMagicLink(email) {
      assertDedicatedTestEmail(email);
      const response = await fetchImpl(`${authRoot}/admin/generate_link`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "magiclink", email }),
      });
      return parseGenerateLink(response.status, await readJson(response));
    },
    async createConfirmedUser(email) {
      assertDedicatedTestEmail(email);
      const response = await fetchImpl(`${authRoot}/admin/users`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (response.ok) return;
      const body = await readJson(response);
      if (userAlreadyExists(response.status, body)) return;
      throw bounded("mint_create_failed");
    },
    verifyMagicLink(link) {
      if (verifyMagicLink) return verifyMagicLink(link, { url: endpoint.origin, publishableKey });
      return verifyWithServerClient({ url: endpoint.origin, publishableKey, link });
    },
  };
}

export function toPlaywrightCookies(cookies, baseUrl) {
  const origin = new URL(baseUrl);
  return cookies.map((cookie) => {
    const sameSite = String(cookie.options?.sameSite || "lax").toLowerCase();
    return {
      name: cookie.name,
      value: cookie.value,
      url: origin.origin,
      path: cookie.options?.path || "/",
      httpOnly: Boolean(cookie.options?.httpOnly),
      secure: origin.protocol === "https:",
      sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax",
    };
  });
}

async function verifyWithServerClient({ url, publishableKey, link }) {
  let createServerClient;
  try {
    const requireFromWeb = createRequire(join(REPO_ROOT, "apps/web/package.json"));
    ({ createServerClient } = requireFromWeb("@supabase/ssr"));
  } catch {
    throw bounded("mint_client_missing");
  }
  const jar = [];
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return jar.map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = jar.findIndex((item) => item.name === cookie.name);
          if (index >= 0) jar[index] = cookie;
          else jar.push(cookie);
        }
      },
    },
  });
  const { error } = await supabase.auth.verifyOtp({
    token_hash: link.tokenHash,
    type: link.otpType,
  });
  if (error) throw bounded("mint_verify_failed");
  const sessionCookies = jar.filter((cookie) => cookie.name && cookie.value);
  if (sessionCookies.length === 0) throw bounded("mint_verify_failed");
  return sessionCookies;
}
