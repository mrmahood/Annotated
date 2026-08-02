"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnvironment } from "./env";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    const { url, publishableKey } = getSupabaseEnvironment();
    browserClient = createBrowserClient(url, publishableKey);
  }

  return browserClient;
}
