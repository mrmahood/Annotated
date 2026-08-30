"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getInitial } from "@/lib/public-content";
import { ProviderSignInButton } from "./provider-sign-in-button";

export type HeaderUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export function SiteHeaderAuth({
  user,
  returnTo,
}: {
  user: HeaderUser | null;
  returnTo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"sign-out" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const signOut = async () => {
    setPending("sign-out");
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      router.refresh();
    } catch {
      setErrorMessage("Sign-out did not finish. Please try again.");
    } finally {
      setPending(null);
    }
  };

  if (!user) {
    return (
      <div className="site-auth">
        <ProviderSignInButton provider="google" returnTo={returnTo} className="site-auth-button" />
        <ProviderSignInButton provider="x" returnTo={returnTo} className="site-auth-button" />
      </div>
    );
  }

  return (
    <div className="site-auth site-auth-signed-in">
      <Link className="site-account-link" href={`/p/${user.id}`}>
        {user.avatarUrl ? (
          // External avatar hosts vary, and URLs are restricted to HTTP(S).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="site-account-avatar"
            src={user.avatarUrl}
            alt=""
            width="30"
            height="30"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="site-account-avatar avatar-fallback" aria-hidden="true">
            {getInitial(user.displayName)}
          </span>
        )}
        <span>{user.displayName}</span>
      </Link>
      <button
        className="site-sign-out"
        type="button"
        onClick={signOut}
        disabled={pending !== null}
      >
        {pending === "sign-out" ? "Signing out…" : "Sign out"}
      </button>
      {errorMessage && <p className="site-auth-error" role="alert">{errorMessage}</p>}
    </div>
  );
}
