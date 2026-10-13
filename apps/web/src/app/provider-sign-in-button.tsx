"use client";

import { useState, type ReactNode } from "react";
import {
  getAuthProviderLabel,
  isEnabledWebAuthProvider,
  type AuthProvider,
  webAuthStarter,
} from "@/lib/auth/auth-boundary";
import { WEB_AUTH_CAPABILITIES } from "@/lib/auth/auth-capabilities";
import { createClient } from "@/lib/supabase/client";

const HEADER_WIDTH_LABEL = "Continue with Google";
const HEADER_COMPACT_WIDTH_LABEL = "Google";

export function ProviderSignInButton({
  provider,
  returnTo,
  label,
  compactLabel,
  className = "public-button public-button-primary",
}: {
  provider: AuthProvider;
  returnTo: string;
  label?: string;
  compactLabel?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isEnabledWebAuthProvider(provider, WEB_AUTH_CAPABILITIES)) return null;

  const fullLabel = label ?? (
    provider === "x" ? "Continue with X" : `Continue with ${getAuthProviderLabel(provider)}`
  );
  const accessibleLabel = pending ? "Continuing…" : fullLabel;

  if (provider === "x") {
    const startPath = `/auth/x/start?${new URLSearchParams({ next: returnTo })}`;
    return (
      <form
        className="inline-auth-action"
        action={startPath}
        method="post"
        onSubmit={() => setPending(true)}
      >
        <SignInButton
          className={className}
          type="submit"
          pending={pending}
          accessibleLabel={accessibleLabel}
          fullLabel={fullLabel}
          compactLabel={compactLabel}
          provider={provider}
        />
      </form>
    );
  }

  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      await webAuthStarter.start(
        createClient(),
        provider,
        returnTo,
        window.location.origin,
      );
    } catch {
      setPending(false);
      setError("Sign-in could not be started. Please try again.");
    }
  };

  return (
    <div className="inline-auth-action">
      <SignInButton
        className={className}
        type="button"
        pending={pending}
        accessibleLabel={accessibleLabel}
        fullLabel={fullLabel}
        compactLabel={compactLabel}
        provider={provider}
        onClick={signIn}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function SignInButton({
  className,
  type,
  pending,
  accessibleLabel,
  fullLabel,
  compactLabel,
  provider,
  onClick,
}: {
  className: string;
  type: "button" | "submit";
  pending: boolean;
  accessibleLabel: string;
  fullLabel: string;
  compactLabel?: string;
  provider: AuthProvider;
  onClick?: () => void;
}) {
  return (
    <button
      className={className}
      type={type}
      disabled={pending}
      aria-label={compactLabel ? accessibleLabel : undefined}
      onClick={onClick}
    >
      {compactLabel ? (
        <HeaderSignInFace
          pending={pending}
          fullLabel={fullLabel}
          compactLabel={compactLabel}
          provider={provider}
        />
      ) : accessibleLabel}
    </button>
  );
}

function HeaderSignInFace({
  pending,
  fullLabel,
  compactLabel,
  provider,
}: {
  pending: boolean;
  fullLabel: string;
  compactLabel: string;
  provider: AuthProvider;
}) {
  return (
    <>
      <span className="site-auth-width" aria-hidden="true">
        <span className="site-auth-width-full">{HEADER_WIDTH_LABEL}</span>
        <span className="site-auth-width-compact">
          <ProviderMark provider="google" />
          {HEADER_COMPACT_WIDTH_LABEL}
        </span>
        <span className="site-auth-width-pending">Continuing…</span>
      </span>
      <span className="site-auth-face">
        {pending ? <span className="site-auth-face-pending">Continuing…</span> : (
          <>
            <span className="site-auth-face-full">{fullLabel}</span>
            <span className="site-auth-face-compact">
              <ProviderMark provider={provider} />
              {compactLabel}
            </span>
          </>
        )}
      </span>
    </>
  );
}

function ProviderMark({ provider }: { provider: AuthProvider }): ReactNode {
  if (provider === "x") {
    return (
      <svg className="site-auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </svg>
    );
  }

  return (
    <svg className="site-auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
