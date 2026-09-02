import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  completeWebAuthCallback,
  readWebAuthCallbackRequest,
} from "@/lib/auth/auth-boundary";
import { WEB_AUTH_CAPABILITIES } from "@/lib/auth/auth-capabilities";
import {
  X_WEB_AUTH_ATTEMPT_COOKIE,
  clearXWebAuthAttemptCookie,
  readXWebAuthCallback,
} from "@/lib/auth/x-web-auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const redirectAfterXAttempt = (destination: URL) => {
    const response = NextResponse.redirect(destination);
    clearXWebAuthAttemptCookie(
      response.cookies,
      requestUrl.protocol === "https:",
    );
    return response;
  };
  const callbackProviders = requestUrl.searchParams.getAll("provider");
  const cookieStore = await cookies();
  const xAttemptCookie = cookieStore.get(X_WEB_AUTH_ATTEMPT_COOKIE)?.value;

  if (callbackProviders.includes("x") || xAttemptCookie) {
    const callback = readXWebAuthCallback(
      requestUrl.searchParams,
      xAttemptCookie,
      Date.now(),
      WEB_AUTH_CAPABILITIES,
    );

    if (callback.kind === "exchange") {
      try {
        const supabase = await createClient();
        if (await completeWebAuthCallback(supabase, callback.request)) {
          return redirectAfterXAttempt(
            new URL(callback.request.nextPath, requestUrl.origin),
          );
        }
      } catch {
        // Fall through to the token-safe authentication error page.
      }
    }

    return redirectAfterXAttempt(new URL("/auth/error", requestUrl.origin));
  }

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
