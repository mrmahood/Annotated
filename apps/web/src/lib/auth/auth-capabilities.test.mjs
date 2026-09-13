import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_X_PRODUCTION_SUPABASE_URL,
  LIVE_X_STAGING_SUPABASE_URL,
  LIVE_X_WEB_OPT_IN_VALUE,
  LIVE_X_WEB_OPT_OUT_VALUE,
  resolveWebAuthCapabilities,
} from "./auth-capabilities.ts";

const ENABLED = { google: true, x: true };
const DISABLED = { google: true, x: false };

test("web X is enabled for the exact Staging Supabase project", () => {
  assert.deepEqual(resolveWebAuthCapabilities({
    supabaseUrl: LIVE_X_STAGING_SUPABASE_URL,
  }), ENABLED);
  assert.deepEqual(resolveWebAuthCapabilities({
    xOptIn: LIVE_X_WEB_OPT_IN_VALUE,
    supabaseUrl: LIVE_X_STAGING_SUPABASE_URL,
  }), ENABLED);
  assert.deepEqual(resolveWebAuthCapabilities({
    supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}/`,
  }), ENABLED);
});

test("web X is enabled for the exact Production Supabase project", () => {
  assert.deepEqual(resolveWebAuthCapabilities({
    supabaseUrl: LIVE_X_PRODUCTION_SUPABASE_URL,
  }), ENABLED);
  assert.deepEqual(resolveWebAuthCapabilities({
    xOptIn: LIVE_X_WEB_OPT_IN_VALUE,
    supabaseUrl: LIVE_X_PRODUCTION_SUPABASE_URL,
  }), ENABLED);
  assert.deepEqual(resolveWebAuthCapabilities({
    supabaseUrl: `${LIVE_X_PRODUCTION_SUPABASE_URL}/`,
  }), ENABLED);
});

test("web X remains disabled for Local/unknown URLs and explicit opt-out", () => {
  const disabledCases = [
    {},
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE },
    { xOptIn: LIVE_X_WEB_OPT_OUT_VALUE, supabaseUrl: LIVE_X_STAGING_SUPABASE_URL },
    { xOptIn: LIVE_X_WEB_OPT_OUT_VALUE, supabaseUrl: LIVE_X_PRODUCTION_SUPABASE_URL },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "https://production-ref.supabase.co" },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "http://nkkunkwirvfwhmpwonqz.supabase.co" },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "http://vnxjktpdzmykmqrqwvks.supabase.co" },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}/auth/v1` },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_PRODUCTION_SUPABASE_URL}/auth/v1` },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_STAGING_SUPABASE_URL}.attacker.example` },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: `${LIVE_X_PRODUCTION_SUPABASE_URL}.attacker.example` },
    { xOptIn: LIVE_X_WEB_OPT_IN_VALUE, supabaseUrl: "http://127.0.0.1:54321" },
  ];

  for (const environment of disabledCases) {
    assert.deepEqual(resolveWebAuthCapabilities(environment), DISABLED);
  }
});
