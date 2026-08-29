import type { SupabaseClient, User } from '@supabase/supabase-js';

export const AUTH_PROVIDER_METADATA = {
  google: { label: 'Google' },
  x: { label: 'X' },
} as const;

export type AuthProvider = keyof typeof AUTH_PROVIDER_METADATA;

export const ENABLED_EXTENSION_AUTH_PROVIDERS = ['google'] as const satisfies readonly AuthProvider[];

export type CallbackTokens = {
  accessToken: string;
  refreshToken: string;
};

export type ExtensionAuthErrorKind =
  | 'attempt-active'
  | 'callback'
  | 'cancelled'
  | 'malformed-token'
  | 'missing-token'
  | 'oauth'
  | 'provider-mismatch'
  | 'session'
  | 'timeout'
  | 'unsupported-provider';

export class ExtensionAuthError extends Error {
  readonly kind: ExtensionAuthErrorKind;

  constructor(kind: ExtensionAuthErrorKind, message: string) {
    super(message);
    this.name = 'ExtensionAuthError';
    this.kind = kind;
  }
}

export type ExtensionAuthRuntime = {
  getRedirectURL(path: string): string;
  launchWebAuthFlow(options: { url: string; interactive: boolean }): Promise<string | undefined>;
  timeoutMs?: number;
};

const DEFAULT_AUTH_TIMEOUT_MS = 120_000;
const MAX_AUTH_URL_LENGTH = 24_576;

function isEnabledProvider(provider: AuthProvider) {
  return ENABLED_EXTENSION_AUTH_PROVIDERS.includes(
    provider as (typeof ENABLED_EXTENSION_AUTH_PROVIDERS)[number],
  );
}

function isWellFormedAccessToken(value: string) {
  const segments = value.split('.');
  return (
    value.length <= 8_192 &&
    segments.length === 3 &&
    segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))
  );
}

function isWellFormedRefreshToken(value: string) {
  return (
    value.length >= 12 &&
    value.length <= 8_192 &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

function isSafeOAuthStartUrl(value: string) {
  if (!value || value.length > MAX_AUTH_URL_LENGTH) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

export function isExpectedAuthCallback(
  returnedUrl: string,
  expectedRedirectUrl: string,
) {
  if (
    !returnedUrl ||
    !expectedRedirectUrl ||
    returnedUrl.length > MAX_AUTH_URL_LENGTH ||
    expectedRedirectUrl.length > 2_048
  ) {
    return false;
  }

  try {
    const returned = new URL(returnedUrl);
    const expected = new URL(expectedRedirectUrl);

    return (
      expected.protocol === 'https:' &&
      expected.hostname.endsWith('.chromiumapp.org') &&
      expected.username === '' &&
      expected.password === '' &&
      returned.username === '' &&
      returned.password === '' &&
      returned.origin === expected.origin &&
      returned.pathname === expected.pathname &&
      returned.search === expected.search
    );
  } catch {
    return false;
  }
}

export function parseAuthCallbackTokens(callbackUrl: string): CallbackTokens {
  let callback: URL;

  if (!callbackUrl || callbackUrl.length > MAX_AUTH_URL_LENGTH) {
    throw new ExtensionAuthError(
      'callback',
      'The authentication callback was invalid. Please try again.',
    );
  }

  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new ExtensionAuthError(
      'callback',
      'The authentication callback was invalid. Please try again.',
    );
  }

  const parameters = new URLSearchParams(callback.hash.slice(1));

  if (parameters.has('error')) {
    throw new ExtensionAuthError(
      'oauth',
      'The sign-in request was not authorized. You can try again.',
    );
  }

  const accessTokens = parameters.getAll('access_token');
  const refreshTokens = parameters.getAll('refresh_token');

  if (
    accessTokens.length !== 1 ||
    refreshTokens.length !== 1 ||
    !accessTokens[0] ||
    !refreshTokens[0]
  ) {
    throw new ExtensionAuthError(
      'missing-token',
      'The authentication response was incomplete. Please try again.',
    );
  }

  const accessToken = accessTokens[0];
  const refreshToken = refreshTokens[0];

  if (
    !isWellFormedAccessToken(accessToken) ||
    !isWellFormedRefreshToken(refreshToken)
  ) {
    throw new ExtensionAuthError(
      'malformed-token',
      'The authentication response was malformed. Please try again.',
    );
  }

  return { accessToken, refreshToken };
}

export function isAuthCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');

  return /cancel(?:led|ed)|user (?:did not approve|denied)|access denied|window (?:was )?closed|interaction.*closed/i.test(
    message,
  );
}

export function userHasAuthProvider(user: Pick<User, 'identities'>, provider: AuthProvider) {
  return user.identities?.some((identity) => identity.provider === provider) ?? false;
}

export function userHasEnabledAuthProvider(user: Pick<User, 'identities'>) {
  return ENABLED_EXTENSION_AUTH_PROVIDERS.some((provider) =>
    userHasAuthProvider(user, provider));
}

export async function clearLocalAuthSession(supabase: SupabaseClient) {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    // A purge failure must not expose provider or session details to the caller.
    return false;
  }
}

async function launchWithTimeout(runtime: ExtensionAuthRuntime, url: string) {
  const timeoutMs = runtime.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;

  return await new Promise<string | undefined>((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      settled = true;
      reject(new ExtensionAuthError(
        'timeout',
        'The sign-in attempt timed out. Please try again.',
      ));
    }, timeoutMs);

    void runtime.launchWebAuthFlow({ url, interactive: true }).then(
      (callbackUrl) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(callbackUrl);
      },
      (error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createExtensionAuthController(runtime: ExtensionAuthRuntime) {
  let activeAttempt: symbol | null = null;

  return {
    async signInWithProvider(
      supabase: SupabaseClient,
      provider: AuthProvider,
    ): Promise<User> {
      if (!isEnabledProvider(provider)) {
        throw new ExtensionAuthError(
          'unsupported-provider',
          'That sign-in method is not available.',
        );
      }

      if (activeAttempt) {
        throw new ExtensionAuthError(
          'attempt-active',
          'Another sign-in attempt is already active.',
        );
      }

      const attemptId = Symbol(provider);
      activeAttempt = attemptId;

      try {
        const redirectTo = runtime.getRedirectURL('auth/callback');
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            skipBrowserRedirect: true,
            redirectTo,
          },
        });

        if (error || !data.url || !isSafeOAuthStartUrl(data.url)) {
          throw new ExtensionAuthError(
            'oauth',
            'Sign-in could not be started. Please try again.',
          );
        }

        let callbackUrl: string | undefined;

        try {
          callbackUrl = await launchWithTimeout(runtime, data.url);
        } catch (launchError) {
          if (launchError instanceof ExtensionAuthError) throw launchError;
          if (isAuthCancellation(launchError)) {
            throw new ExtensionAuthError(
              'cancelled',
              'Sign-in was cancelled. You can try again.',
            );
          }

          throw new ExtensionAuthError(
            'oauth',
            'Sign-in could not be completed. Please try again.',
          );
        }

        if (activeAttempt !== attemptId) {
          throw new ExtensionAuthError(
            'callback',
            'The authentication callback was no longer active.',
          );
        }

        if (!callbackUrl) {
          throw new ExtensionAuthError(
            'cancelled',
            'Sign-in was cancelled. You can try again.',
          );
        }

        if (!isExpectedAuthCallback(callbackUrl, redirectTo)) {
          throw new ExtensionAuthError(
            'callback',
            'The authentication callback did not match this extension.',
          );
        }

        const { accessToken, refreshToken } = parseAuthCallbackTokens(callbackUrl);
        callbackUrl = undefined;

        const { data: sessionData, error: sessionError } =
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

        if (sessionError || !sessionData.user) {
          await clearLocalAuthSession(supabase);
          throw new ExtensionAuthError(
            'session',
            'The authenticated session could not be saved. Please try again.',
          );
        }

        if (!userHasAuthProvider(sessionData.user, provider)) {
          await clearLocalAuthSession(supabase);
          throw new ExtensionAuthError(
            'provider-mismatch',
            'The authenticated account did not match the requested sign-in method.',
          );
        }

        return sessionData.user;
      } finally {
        if (activeAttempt === attemptId) activeAttempt = null;
      }
    },
  };
}

function getChromeIdentity() {
  const identity = (globalThis as typeof globalThis & {
    chrome?: {
      identity?: {
        getRedirectURL(path?: string): string;
        launchWebAuthFlow(options: { url: string; interactive: boolean }): Promise<string | undefined>;
      };
    };
  }).chrome?.identity;

  if (!identity) {
    throw new ExtensionAuthError(
      'oauth',
      'Sign-in is temporarily unavailable. Please try again.',
    );
  }

  return identity;
}

const extensionAuthController = createExtensionAuthController({
  getRedirectURL(path) {
    return getChromeIdentity().getRedirectURL(path);
  },
  launchWebAuthFlow(options) {
    return getChromeIdentity().launchWebAuthFlow(options);
  },
});

export function signInWithProvider(
  supabase: SupabaseClient,
  provider: AuthProvider,
) {
  return extensionAuthController.signInWithProvider(supabase, provider);
}
