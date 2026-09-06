import {
  DEFAULT_WEB_AUTH_CAPABILITIES,
  type WebAuthCapabilities,
} from "./auth-boundary.ts";

export const LIVE_X_STAGING_PROJECT_REF = "nkkunkwirvfwhmpwonqz";
export const LIVE_X_STAGING_SUPABASE_URL =
  `https://${LIVE_X_STAGING_PROJECT_REF}.supabase.co`;
export const LIVE_X_WEB_OPT_IN_VALUE = "1";
export const LIVE_X_WEB_OPT_OUT_VALUE = "0";

type WebAuthCapabilityEnvironment = {
  xOptIn?: string;
  supabaseUrl?: string;
};

function isExactStagingSupabaseUrl(value: string | undefined) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.origin === LIVE_X_STAGING_SUPABASE_URL &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

export function resolveWebAuthCapabilities(
  environment: WebAuthCapabilityEnvironment,
): WebAuthCapabilities {
  return Object.freeze({
    google: DEFAULT_WEB_AUTH_CAPABILITIES.google,
    // Staging-only: exact Staging URL enables X. Exact "0" hides it.
    // Production and Local URLs stay fail-closed even if an opt-in is set.
    x: isExactStagingSupabaseUrl(environment.supabaseUrl) &&
      environment.xOptIn !== LIVE_X_WEB_OPT_OUT_VALUE,
  });
}

export const WEB_AUTH_CAPABILITIES = resolveWebAuthCapabilities({
  xOptIn: process.env.NEXT_PUBLIC_ANNOTATED_STAGING_X_WEB_AUTH,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});
