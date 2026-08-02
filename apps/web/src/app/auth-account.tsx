"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const WEB_AUTH_CALLBACK_URL = "http://localhost:3000/auth/callback";

type AccountUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
};

type AuthAccountProps = {
  user: AccountUser | null;
  serverError: string | null;
  profileError: string | null;
};

function getInitials(name: string, email: string) {
  const source = name.trim() || email.trim();
  return source.slice(0, 1).toLocaleUpperCase() || "A";
}

export function AuthAccount({
  user,
  serverError,
  profileError,
}: AuthAccountProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"sign-in" | "sign-out" | null>(
    null,
  );
  const [clientError, setClientError] = useState<string | null>(null);

  const signIn = async () => {
    setClientError(null);
    setPendingAction("sign-in");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: WEB_AUTH_CALLBACK_URL },
      });

      if (error) {
        setClientError("Google sign-in could not be started. Please try again.");
        setPendingAction(null);
      }
    } catch {
      setClientError(
        process.env.NODE_ENV === "development"
          ? "Supabase is not configured. Check apps/web/.env.local."
          : "Google sign-in could not be started. Please try again.",
      );
      setPendingAction(null);
    }
  };

  const signOut = async () => {
    setClientError(null);
    setPendingAction("sign-out");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });

      if (error) {
        setClientError("Sign-out did not finish. Please try again.");
        return;
      }

      router.refresh();
    } catch {
      setClientError("Sign-out did not finish. Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  const displayedError = clientError ?? serverError;

  if (!user) {
    return (
      <div className="account-content">
        <button
          className="button button-primary"
          type="button"
          onClick={signIn}
          disabled={pendingAction !== null}
        >
          {pendingAction === "sign-in" ? "Continuing..." : "Continue with Google"}
        </button>
        {displayedError && (
          <p className="auth-error" role="alert">
            {displayedError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="account-content">
      <div className="identity">
        {user.avatarUrl ? (
          // The URL is restricted to HTTP(S) by the server component.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="avatar"
            src={user.avatarUrl}
            alt=""
            width="52"
            height="52"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="avatar avatar-fallback" aria-hidden="true">
            {getInitials(user.name, user.email)}
          </span>
        )}
        <div className="identity-copy">
          <p className="identity-name">{user.name}</p>
          <p className="identity-email">{user.email}</p>
        </div>
      </div>

      {profileError && <p className="auth-error" role="alert">{profileError}</p>}
      {displayedError && <p className="auth-error" role="alert">{displayedError}</p>}

      <button
        className="button button-secondary"
        type="button"
        onClick={signOut}
        disabled={pendingAction !== null}
      >
        {pendingAction === "sign-out" ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
