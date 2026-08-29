export const AUTH_PROVIDER_METADATA = {
  google: { label: "Google" },
  x: { label: "X" },
} as const;

export type AuthProvider = keyof typeof AUTH_PROVIDER_METADATA;

export const ENABLED_WEB_AUTH_PROVIDERS = ["google"] as const satisfies readonly AuthProvider[];

export type WebAuthErrorKind =
  | "attempt-active"
  | "oauth"
  | "unsupported-provider";

export class WebAuthError extends Error {
  readonly kind: WebAuthErrorKind;

  constructor(kind: WebAuthErrorKind, message: string) {
    super(message);
    this.name = "WebAuthError";
    this.kind = kind;
  }
}

type AuthIdentity = { provider?: unknown };
type AuthUser = { identities?: readonly AuthIdentity[] | null };

type WebAuthStartClient = {
  auth: {
    signInWithOAuth(options: {
      provider: AuthProvider;
      options: { redirectTo: string };
    }): Promise<{ error: unknown }>;
  };
};

type CallbackSession = {
  access_token: string;
  refresh_token: string;
};

type WebAuthCallbackClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<{
      data: { session: CallbackSession | null; user: AuthUser | null };
      error: unknown;
    }>;
    setSession(tokens: {
      access_token: string;
      refresh_token: string;
    }): Promise<{
      data: { user: AuthUser | null };
      error: unknown;
    }>;
    signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  };
};

export type WebAuthCallbackRequest = {
  code: string;
  provider: AuthProvider;
  nextPath: string;
};

const DEFAULT_NEXT_PATH = "/";
const MAX_AUTH_CODE_LENGTH = 8_192;

export function isEnabledWebAuthProvider(
  value: string | null | undefined,
): value is (typeof ENABLED_WEB_AUTH_PROVIDERS)[number] {
  return value === "google";
}

export function getAuthProviderLabel(provider: AuthProvider) {
  return AUTH_PROVIDER_METADATA[provider].label;
}

export function userHasAuthProvider(user: AuthUser, provider: AuthProvider) {
  return user.identities?.some((identity) => identity.provider === provider) ?? false;
}

export function getSafeNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_NEXT_PATH,
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const baseUrl = new URL("http://annotated.local");
    const resolvedUrl = new URL(value, baseUrl);

    if (resolvedUrl.origin !== baseUrl.origin) return fallback;

    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  } catch {
    return fallback;
  }
}

function createCallbackUrl(origin: string, provider: AuthProvider, returnTo: string) {
  const originUrl = new URL(origin);
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new WebAuthError("oauth", "Sign-in could not be started. Please try again.");
  }

  const callbackUrl = new URL("/auth/callback", originUrl.origin);
  callbackUrl.searchParams.set("provider", provider);
  callbackUrl.searchParams.set("next", getSafeNextPath(returnTo));
  return callbackUrl.href;
}

export function createWebAuthStarter() {
  let attemptActive = false;

  return {
    async start(
      client: WebAuthStartClient,
      provider: AuthProvider,
      returnTo: string,
      origin: string,
    ) {
      if (!isEnabledWebAuthProvider(provider)) {
        throw new WebAuthError(
          "unsupported-provider",
          "That sign-in method is not available.",
        );
      }

      if (attemptActive) {
        throw new WebAuthError(
          "attempt-active",
          "Another sign-in attempt is already active.",
        );
      }

      attemptActive = true;

      try {
        const redirectTo = createCallbackUrl(origin, provider, returnTo);
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo },
        });

        if (error) {
          throw new WebAuthError(
            "oauth",
            "Sign-in could not be started. Please try again.",
          );
        }
      } catch (error) {
        attemptActive = false;
        if (error instanceof WebAuthError) throw error;
        throw new WebAuthError(
          "oauth",
          "Sign-in could not be started. Please try again.",
        );
      }
    },
  };
}

export const webAuthStarter = createWebAuthStarter();

function hasOneBoundedCode(values: string[]) {
  return values.length === 1 &&
    values[0].length > 0 &&
    values[0].length <= MAX_AUTH_CODE_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(values[0]);
}

export function readWebAuthCallbackRequest(
  searchParams: URLSearchParams,
): WebAuthCallbackRequest | null {
  if (searchParams.has("error")) return null;

  const codes = searchParams.getAll("code");
  const providers = searchParams.getAll("provider");
  const nextValues = searchParams.getAll("next");

  if (
    !hasOneBoundedCode(codes) ||
    providers.length !== 1 ||
    !isEnabledWebAuthProvider(providers[0]) ||
    nextValues.length > 1
  ) {
    return null;
  }

  return {
    code: codes[0],
    provider: providers[0],
    nextPath: getSafeNextPath(nextValues[0]),
  };
}

async function purgeAttemptedSession(client: WebAuthCallbackClient) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // Callback errors stay bounded and never include provider or token details.
  }
}

export async function completeWebAuthCallback(
  client: WebAuthCallbackClient,
  request: WebAuthCallbackRequest,
) {
  let sessionCreated = false;

  try {
    const { data: exchangeData, error: exchangeError } =
      await client.auth.exchangeCodeForSession(request.code);

    if (exchangeError || !exchangeData.session || !exchangeData.user) {
      if (exchangeData.session) await purgeAttemptedSession(client);
      return false;
    }

    sessionCreated = true;

    if (!userHasAuthProvider(exchangeData.user, request.provider)) {
      await purgeAttemptedSession(client);
      return false;
    }

    // Re-establish the Annotated session with only its own access/refresh pair.
    // Provider access/refresh tokens returned by OAuth are never copied into the
    // application-controlled session boundary.
    const { data: sessionData, error: sessionError } =
      await client.auth.setSession({
        access_token: exchangeData.session.access_token,
        refresh_token: exchangeData.session.refresh_token,
      });

    if (
      sessionError ||
      !sessionData.user ||
      !userHasAuthProvider(sessionData.user, request.provider)
    ) {
      await purgeAttemptedSession(client);
      return false;
    }

    return true;
  } catch {
    if (sessionCreated) await purgeAttemptedSession(client);
    return false;
  }
}
