export type CallbackTokens = {
  accessToken: string;
  refreshToken: string;
};

export type ExtensionAuthErrorKind =
  | 'cancelled'
  | 'callback'
  | 'missing-token'
  | 'malformed-token'
  | 'oauth'
  | 'session';

export class ExtensionAuthError extends Error {
  readonly kind: ExtensionAuthErrorKind;

  constructor(
    kind: ExtensionAuthErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionAuthError';
    this.kind = kind;
  }
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

export function isExpectedAuthCallback(
  returnedUrl: string,
  expectedRedirectUrl: string,
) {
  try {
    const returned = new URL(returnedUrl);
    const expected = new URL(expectedRedirectUrl);

    return (
      expected.protocol === 'https:' &&
      expected.hostname.endsWith('.chromiumapp.org') &&
      returned.origin === expected.origin &&
      returned.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

export function parseAuthCallbackTokens(callbackUrl: string): CallbackTokens {
  let callback: URL;

  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new ExtensionAuthError(
      'callback',
      'The authentication callback was not a valid URL.',
    );
  }

  const parameters = new URLSearchParams(callback.hash.slice(1));

  if (parameters.has('error')) {
    throw new ExtensionAuthError(
      'oauth',
      'Google did not authorize the sign-in request. You can try again.',
    );
  }

  const accessToken = parameters.get('access_token');
  const refreshToken = parameters.get('refresh_token');

  if (!accessToken || !refreshToken) {
    throw new ExtensionAuthError(
      'missing-token',
      'The authentication response was incomplete. Please try again.',
    );
  }

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
