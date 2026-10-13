import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "../public-content.ts";

export const FOLLOW_INSERT_PREFER = "return=minimal";

export function followInsertHeaders(accessToken: string): {
  Authorization: string;
  Prefer: string;
} {
  return {
    Authorization: `Bearer ${accessToken}`,
    Prefer: FOLLOW_INSERT_PREFER,
  };
}

// The browser client reads the session from document.cookie during initialize().
// The first mutation can observe an empty session if it races that read, then
// succeed on the next click once the cookie is visible. Retry once after the
// client has finished initializing. The returned token is the one getUser
// validated, so the insert does not depend on a later session read.
export async function requireFollowSession(
  supabase: SupabaseClient,
): Promise<{ userId: string; accessToken: string }> {
  if (typeof supabase.auth.initialize === "function") {
    await supabase.auth.initialize();
  }
  let accessToken = "";
  for (let attempt = 0; attempt < 2 && !accessToken; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!error && typeof token === "string" && token.length > 0) {
      accessToken = token;
      break;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!accessToken) throw new Error("Authentication is required.");
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user || !isUuid(data.user.id)) {
    throw new Error("Authentication is required.");
  }
  return { userId: data.user.id, accessToken };
}
