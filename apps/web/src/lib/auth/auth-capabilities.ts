import {
  DEFAULT_WEB_AUTH_CAPABILITIES,
  type WebAuthCapabilities,
} from "./auth-boundary.ts";

export const LIVE_X_STAGING_PROJECT_REF = "nkkunkwirvfwhmpwonqz";
export const LIVE_X_STAGING_SUPABASE_URL =
  `https://${LIVE_X_STAGING_PROJECT_REF}.supabase.co`;
export const LIVE_X_WEB_OPT_IN_VALUE = "1";

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
    x: environment.xOptIn === LIVE_X_WEB_OPT_IN_VALUE &&
      isExactStagingSupabaseUrl(environment.supabaseUrl),
  });
}

export const WEB_AUTH_CAPABILITIES = resolveWebAuthCapabilities({
  xOptIn: process.env.NEXT_PUBLIC_ANNOTATED_STAGING_X_WEB_AUTH,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});
