import {
  DEFAULT_WEB_AUTH_CAPABILITIES,
  WebAuthError,
  getSafeNextPath,
  isEnabledWebAuthProvider,
  type WebAuthCallbackRequest,
  type WebAuthCapabilities,
} from "./auth-boundary.ts";

export const X_WEB_AUTH_ATTEMPT_COOKIE = "annotated-x-web-auth-attempt";
export const X_WEB_AUTH_ATTEMPT_TTL_MS = 10 * 60 * 1_000;
export const X_WEB_AUTH_ATTEMPT_COOKIE_PATH = "/auth";

type XWebAuthAttemptCookieWriter = {
  set(
    name: string,
    value: string,
    options: {
      expires?: Date;
      httpOnly: boolean;
      maxAge: number;
      path: string;
      sameSite: "lax";
      secure: boolean;
    },
  ): unknown;
};

function getXWebAuthAttemptCookieOptions(secure: boolean, maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: X_WEB_AUTH_ATTEMPT_COOKIE_PATH,
    sameSite: "lax" as const,
    secure,
  };
}

export function setXWebAuthAttemptCookie(
  cookies: XWebAuthAttemptCookieWriter,
  value: string,
  secure: boolean,
) {
  cookies.set(
    X_WEB_AUTH_ATTEMPT_COOKIE,
    value,
    getXWebAuthAttemptCookieOptions(
      secure,
      Math.floor(X_WEB_AUTH_ATTEMPT_TTL_MS / 1_000),
    ),
  );
}

export function clearXWebAuthAttemptCookie(
  cookies: XWebAuthAttemptCookieWriter,
  secure: boolean,
) {
  cookies.set(X_WEB_AUTH_ATTEMPT_COOKIE, "", {
    ...getXWebAuthAttemptCookieOptions(secure, 0),
    expires: new Date(0),
  });
}

const MAX_ATTEMPT_COOKIE_LENGTH = 1_024;
const MAX_CALLBACK_VALUE_LENGTH = 8_192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type XWebAuthAttempt = {
  version: 1;
  id: string;
  provider: "x";
  nextPath: string;
  createdAt: number;
};

type XWebAuthStartClient = {
  auth: {
    signInWithOAuth(options: {
      provider: "x";
      options: {
        redirectTo: string;
        skipBrowserRedirect: true;
      };
    }): Promise<{ data: { url: string | null }; error: unknown }>;
  };
};

export type XWebAuthStartResult = {
  authorizationUrl: string;
  attemptCookie: string;
};

export type XWebAuthCallbackResult =
  | { kind: "exchange"; request: WebAuthCallbackRequest }
  | { kind: "cancelled"; nextPath: string }
  | { kind: "invalid" };

function encodeAttempt(attempt: XWebAuthAttempt) {
  return Buffer.from(JSON.stringify(attempt), "utf8").toString("base64url");
}

function decodeAttempt(value: string | null | undefined): XWebAuthAttempt | null {
  if (!value || value.length > MAX_ATTEMPT_COOKIE_LENGTH) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<XWebAuthAttempt>;
    if (
      parsed.version !== 1 ||
      parsed.provider !== "x" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      typeof parsed.nextPath !== "string" ||
      getSafeNextPath(parsed.nextPath) !== parsed.nextPath ||
      !Number.isSafeInteger(parsed.createdAt)
    ) {
      return null;
    }

    return parsed as XWebAuthAttempt;
  } catch {
    return null;
  }
}

function isCurrentAttempt(attempt: XWebAuthAttempt, now: number) {
  const age = now - attempt.createdAt;
  return age >= 0 && age <= X_WEB_AUTH_ATTEMPT_TTL_MS;
}

function hasOneBoundedValue(values: string[]) {
  return values.length === 1 &&
    values[0].length > 0 &&
    values[0].length <= MAX_CALLBACK_VALUE_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(values[0]);
}

export async function startXWebAuth(
  client: XWebAuthStartClient,
  input: {
    origin: string;
    returnTo: string | null | undefined;
    currentAttemptCookie?: string | null;
  },
  dependencies: {
    capabilities?: WebAuthCapabilities;
    createAttemptId: () => string;
    now: () => number;
  },
): Promise<XWebAuthStartResult> {
  const capabilities = dependencies.capabilities ?? DEFAULT_WEB_AUTH_CAPABILITIES;
  if (!isEnabledWebAuthProvider("x", capabilities)) {
    throw new WebAuthError("unsupported-provider", "That sign-in method is not available.");
  }

  const now = dependencies.now();
  const currentAttempt = decodeAttempt(input.currentAttemptCookie);
  if (currentAttempt && isCurrentAttempt(currentAttempt, now)) {
    throw new WebAuthError("attempt-active", "Another sign-in attempt is already active.");
  }

  const attemptId = dependencies.createAttemptId();
  if (!UUID_PATTERN.test(attemptId)) {
    throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
  }

  let originUrl: URL;
  try {
    originUrl = new URL(input.origin);
  } catch {
    throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
  }

  const attempt: XWebAuthAttempt = {
    version: 1,
    id: attemptId,
    provider: "x",
    nextPath: getSafeNextPath(input.returnTo),
    createdAt: now,
  };
  const callbackUrl = new URL("/auth/callback", originUrl.origin);
  callbackUrl.searchParams.set("provider", "x");
  callbackUrl.searchParams.set("attempt", attempt.id);

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "x",
      options: {
        redirectTo: callbackUrl.href,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
    }

    const authorizationUrl = new URL(data.url);
    const isLoopbackHttp = authorizationUrl.protocol === "http:" &&
      (authorizationUrl.hostname === "localhost" || authorizationUrl.hostname === "127.0.0.1");
    if (authorizationUrl.protocol !== "https:" && !isLoopbackHttp) {
      throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
    }

    return {
      authorizationUrl: authorizationUrl.href,
      attemptCookie: encodeAttempt(attempt),
    };
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
  }
}

export function readXWebAuthCallback(
  searchParams: URLSearchParams,
  attemptCookie: string | null | undefined,
  now: number,
  capabilities: WebAuthCapabilities = DEFAULT_WEB_AUTH_CAPABILITIES,
): XWebAuthCallbackResult {
  if (!isEnabledWebAuthProvider("x", capabilities)) return { kind: "invalid" };

  const attempt = decodeAttempt(attemptCookie);
  if (!attempt || !isCurrentAttempt(attempt, now)) return { kind: "invalid" };

  const providers = searchParams.getAll("provider");
  const attempts = searchParams.getAll("attempt");
  if (
    providers.length !== 1 ||
    providers[0] !== "x" ||
    !hasOneBoundedValue(attempts) ||
    attempts[0] !== attempt.id
  ) {
    return { kind: "invalid" };
  }

  const errors = searchParams.getAll("error");
  const codes = searchParams.getAll("code");
  if (
    errors.length === 1 &&
    errors[0].length > 0 &&
    errors[0].length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(errors[0]) &&
    codes.length === 0
  ) {
    return { kind: "cancelled", nextPath: attempt.nextPath };
  }
  if (errors.length > 0 || !hasOneBoundedValue(codes)) return { kind: "invalid" };

  return {
    kind: "exchange",
    request: {
      code: codes[0],
      provider: "x",
      nextPath: attempt.nextPath,
    },
  };
}
