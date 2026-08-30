import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_X_STAGING_SUPABASE_URL,
  LIVE_X_WEB_OPT_IN_VALUE,
  resolveWebAuthCapabilities,
} from "./auth-capabilities.ts";

test("web X requires the exact opt-in and exact Staging Supabase project", () => {
  assert.deepEqual(resolveWebAuthCapabilities({
    xOptIn: LIVE_X_WEB_OPT_IN_VALUE,
    supabaseUrl: LIVE_X_STAGING_SUPABASE_URL,
  }), { google: true, x: true });
  assert.deepEqual(resolveWebAuthCapabilities({
    xOptIn: LIVE_X_WEB_OPT_IN_VALUE,
    supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}/`,
  }), { google: true, x: true });
});

test("web X remains disabled for missing, approximate, and Production-like inputs", () => {
  const disabledCases = [
    {},
    { xOptIn: "true", supabaseUrl: LIVE_X_STAGING_SUPABASE_URL },
    { xOptIn: ` ${LIVE_X_WEB_OPT_IN_VALUE}`, supabaseUrl: LIVE_X_STAGING_SUPABASE_URL },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "https://production-ref.supabase.co" },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "http://nkkunkwirvfwhmpwonqz.supabase.co" },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}/auth/v1` },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}.attacker.example` },
  ];

  for (const environment of disabledCases) {
    assert.deepEqual(resolveWebAuthCapabilities(environment), { google: true, x: false });
  }
});
