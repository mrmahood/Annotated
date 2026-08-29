import { NextResponse } from "next/server";
import {
  completeWebAuthCallback,
  readWebAuthCallbackRequest,
} from "@/lib/auth/auth-boundary";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackRequest = readWebAuthCallbackRequest(requestUrl.searchParams);

  if (callbackRequest) {
    try {
      const supabase = await createClient();
      if (await completeWebAuthCallback(supabase, callbackRequest)) {
        return NextResponse.redirect(
          new URL(callbackRequest.nextPath, requestUrl.origin),
        );
      }
    } catch {
      // Fall through to the token-safe authentication error page.
    }
  }

  return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
}
