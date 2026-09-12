"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { followProfile, unfollowProfile } from "@/lib/data/social-mutations";
import {
  getWhoToFollowProfilePath,
  type WhoToFollowProfile,
} from "@/lib/data/who-to-follow";
import { getInitial } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/client";
import { ProviderSignInActions } from "./provider-sign-in-actions";

export function WhoToFollowCard({
  suggestion,
  currentUserId,
  returnTo,
}: {
  suggestion: WhoToFollowProfile;
  currentUserId: string | null;
  returnTo: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [hidden, setHidden] = useState(false);
  const [following, setFollowing] = useState(false);
  const [mode, setMode] = useState<"idle" | "sign-in" | "unfollow">("idle");
  const [pending, setPending] = useState<"follow" | "unfollow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profilePath = getWhoToFollowProfilePath(suggestion.profileId);
  const signedOut = !currentUserId;
  const prompt = signedOut && mode === "sign-in";

  const changeFollow = async (nextFollowing: boolean) => {
    if (!currentUserId || inFlight.current) return;
    inFlight.current = true;
    setPending(nextFollowing ? "follow" : "unfollow");
    setError(null);
    try {
      const supabase = createClient();
      if (nextFollowing) await followProfile(supabase, suggestion.profileId);
      else await unfollowProfile(supabase, suggestion.profileId);
      setFollowing(nextFollowing);
      setMode("idle");
      if (nextFollowing) setHidden(true);
      router.refresh();
    } catch {
      setError(nextFollowing
        ? "Follow did not complete. Please try again."
        : "Unfollow did not complete. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  if (hidden) return null;

  return (
    <article className={prompt ? "who-to-follow-card who-to-follow-card-prompt" : "who-to-follow-card"}>
      <Link
        className="who-to-follow-identity"
        href={profilePath}
        aria-label={`View ${suggestion.displayName}’s profile`}
      >
        {suggestion.avatarUrl ? (
          // External avatar hosts vary, and URLs are restricted to HTTP(S).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="card-avatar"
            src={suggestion.avatarUrl}
            alt=""
            width="40"
            height="40"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="card-avatar public-avatar-fallback" aria-hidden="true">
            {getInitial(suggestion.displayName)}
          </span>
        )}
        <span className="who-to-follow-copy">
          <span className="who-to-follow-name">{suggestion.displayName}</span>
          <span className="who-to-follow-handle">@{suggestion.handle}</span>
        </span>
      </Link>

      {signedOut ? (
        prompt ? (
          <div className="who-to-follow-signed-out">
            <p>Sign in to follow.</p>
            <ProviderSignInActions
              returnTo={returnTo}
              googleLabel="Continue with Google"
              xLabel="Continue with X"
              className="site-auth-button"
            />
            <button className="card-share-button" type="button" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="public-button public-button-primary who-to-follow-button"
            type="button"
            onClick={() => setMode("sign-in")}
          >
            Follow
          </button>
        )
      ) : following && mode === "unfollow" ? (
        <div className="follow-confirmation" role="group" aria-label="Confirm unfollow">
          <button
            className="public-button public-button-danger who-to-follow-button"
            type="button"
            disabled={pending !== null}
            onClick={() => void changeFollow(false)}
          >
            {pending === "unfollow" ? "Unfollowing…" : "Unfollow"}
          </button>
          <button
            className="public-button public-button-secondary who-to-follow-button"
            type="button"
            disabled={pending !== null}
            onClick={() => setMode("idle")}
          >
            Keep
          </button>
        </div>
      ) : (
        <button
          className={`public-button ${following ? "public-button-secondary" : "public-button-primary"} who-to-follow-button`}
          type="button"
          disabled={pending !== null}
          aria-pressed={following}
          onClick={() => following ? setMode("unfollow") : void changeFollow(true)}
        >
          {pending === "follow" ? "Following…" : following ? "Following" : "Follow"}
        </button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </article>
  );
}
