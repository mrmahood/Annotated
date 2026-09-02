"use client";

import { useState } from "react";
import {
  getAuthProviderLabel,
  isEnabledWebAuthProvider,
  type AuthProvider,
  webAuthStarter,
} from "@/lib/auth/auth-boundary";
import { WEB_AUTH_CAPABILITIES } from "@/lib/auth/auth-capabilities";
import { createClient } from "@/lib/supabase/client";

export function ProviderSignInButton({
  provider,
  returnTo,
  label,
  className = "public-button public-button-primary",
}: {
  provider: AuthProvider;
  returnTo: string;
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isEnabledWebAuthProvider(provider, WEB_AUTH_CAPABILITIES)) return null;

  if (provider === "x") {
    const startPath = `/auth/x/start?${new URLSearchParams({ next: returnTo })}`;
    return (
      <form
        className="inline-auth-action"
        action={startPath}
        method="post"
        onSubmit={() => setPending(true)}
      >
        <button className={className} type="submit" disabled={pending}>
          {pending ? "Continuing…" : label ?? "Continue with X"}
        </button>
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
      <button className={className} type="button" onClick={signIn} disabled={pending}>
        {pending ? "Continuing…" : label ?? `Continue with ${getAuthProviderLabel(provider)}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
