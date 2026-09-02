import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { WEB_AUTH_CAPABILITIES } from "@/lib/auth/auth-capabilities";
import {
  X_WEB_AUTH_ATTEMPT_COOKIE,
  clearXWebAuthAttemptCookie,
  setXWebAuthAttemptCookie,
  startXWebAuth,
} from "@/lib/auth/x-web-auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const redirectToAuthError = () => {
    const response = NextResponse.redirect(
      new URL("/auth/error", requestUrl.origin),
      303,
    );
    clearXWebAuthAttemptCookie(
      response.cookies,
      requestUrl.protocol === "https:",
    );
    return response;
  };

  if (!WEB_AUTH_CAPABILITIES.x) {
    return redirectToAuthError();
  }

  try {
    const cookieStore = await cookies();
    const result = await startXWebAuth(
      await createClient(),
      {
        origin: requestUrl.origin,
        returnTo: requestUrl.searchParams.get("next"),
        currentAttemptCookie: cookieStore.get(X_WEB_AUTH_ATTEMPT_COOKIE)?.value,
      },
      {
        capabilities: WEB_AUTH_CAPABILITIES,
        createAttemptId: randomUUID,
        now: Date.now,
      },
    );
    const response = NextResponse.redirect(result.authorizationUrl, 303);
    setXWebAuthAttemptCookie(
      response.cookies,
      result.attemptCookie,
      requestUrl.protocol === "https:",
    );
    return response;
  } catch {
    return redirectToAuthError();
  }
}
