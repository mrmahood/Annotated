"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { followProfile, unfollowProfile } from "@/lib/data/social-mutations";
import { createClient } from "@/lib/supabase/client";
import { ProviderSignInActions } from "./provider-sign-in-actions";

export function FollowButton({
  profileId,
  currentUserId,
  initialFollowing,
  initialFollowerCount,
  returnTo,
}: {
  profileId: string;
  currentUserId: string | null;
  initialFollowing: boolean | null;
  initialFollowerCount: number | null;
  returnTo: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [following, setFollowing] = useState(initialFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [confirmingUnfollow, setConfirmingUnfollow] = useState(false);
  const [pending, setPending] = useState<"follow" | "unfollow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const countLabel = followerCount === null
    ? "Follower count unavailable"
    : `${followerCount.toLocaleString()} ${followerCount === 1 ? "follower" : "followers"}`;

  const changeFollow = async (nextFollowing: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(nextFollowing ? "follow" : "unfollow");
    setError(null);
    try {
      const supabase = createClient();
      if (nextFollowing) await followProfile(supabase, profileId);
      else await unfollowProfile(supabase, profileId);
      setFollowing(nextFollowing);
      setFollowerCount((count) =>
        count === null ? count : Math.max(0, count + (nextFollowing ? 1 : -1)),
      );
      setConfirmingUnfollow(false);
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

  return (
    <div className="follow-control">
      <span className="follower-count">{countLabel}</span>
      {currentUserId === profileId ? null : !currentUserId ? (
        <ProviderSignInActions
          returnTo={returnTo}
          googleLabel="Sign in to follow"
          xLabel="Continue with X"
          className="public-button public-button-secondary"
        />
      ) : following === null ? (
        <button className="public-button public-button-secondary" type="button" onClick={() => router.refresh()}>
          Retry follow status
        </button>
      ) : following && confirmingUnfollow ? (
        <div className="follow-confirmation" role="group" aria-label="Confirm unfollow">
          <button
            className="public-button public-button-danger"
            type="button"
            disabled={pending !== null}
            onClick={() => changeFollow(false)}
          >
            {pending === "unfollow" ? "Unfollowing…" : "Unfollow"}
          </button>
          <button
            className="public-button public-button-secondary"
            type="button"
            disabled={pending !== null}
            onClick={() => setConfirmingUnfollow(false)}
          >
            Keep following
          </button>
        </div>
      ) : (
        <button
          className={`public-button ${following ? "public-button-secondary" : "public-button-primary"}`}
          type="button"
          disabled={pending !== null}
          aria-pressed={following}
          onClick={() => following ? setConfirmingUnfollow(true) : changeFollow(true)}
        >
          {pending === "follow" ? "Following…" : following ? "Following" : "Follow"}
        </button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
