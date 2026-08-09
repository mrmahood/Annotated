"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GoogleSignInButton({
  returnTo,
  label = "Continue with Google",
  className = "public-button public-button-primary",
}: {
  returnTo: string;
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", returnTo);
      const { error: authError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.href },
      });
      if (authError) throw authError;
    } catch {
      setPending(false);
      setError("Google sign-in could not be started. Please try again.");
    }
  };

  return (
    <div className="inline-auth-action">
      <button className={className} type="button" onClick={signIn} disabled={pending}>
        {pending ? "Continuing…" : label}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
