import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  ExtensionAuthError,
  isAuthCancellation,
  isExpectedAuthCallback,
  parseAuthCallbackTokens,
} from './auth-callback';

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

export async function signInWithGoogle(supabase: SupabaseClient): Promise<User> {
  const redirectTo = chrome.identity.getRedirectURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      skipBrowserRedirect: true,
      redirectTo,
    },
  });

  if (error || !data.url) {
    throw new ExtensionAuthError(
      'oauth',
      'Google sign-in could not be started. Please try again.',
    );
  }

  let callbackUrl: string | undefined;

  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    });
  } catch (launchError) {
    if (isAuthCancellation(launchError)) {
      throw new ExtensionAuthError(
        'cancelled',
        'Google sign-in was cancelled. You can try again.',
      );
    }

    throw new ExtensionAuthError(
      'oauth',
      'Google sign-in could not be completed. Please try again.',
    );
  }

  if (!callbackUrl) {
    throw new ExtensionAuthError(
      'cancelled',
      'Google sign-in was cancelled. You can try again.',
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
    throw new ExtensionAuthError(
      'session',
      'The authenticated session could not be saved. Please try again.',
    );
  }

  return sessionData.user;
}
