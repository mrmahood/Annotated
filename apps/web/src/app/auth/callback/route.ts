import { NextResponse } from "next/server";
import { getSafeNextPath } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
      }
    } catch {
      // Fall through to the token-safe authentication error page.
    }
  }

  return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
}
