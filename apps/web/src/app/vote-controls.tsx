"use client";

import { useRef, useState } from "react";
import {
  getOptimisticVoteSnapshot,
  parseVoteSnapshotResponse,
  type VoteSnapshot,
  type VoteValue,
} from "@/lib/voting";
import { GoogleSignInButton } from "./google-sign-in-button";

type VoteErrorBody = Partial<VoteSnapshot> & {
  error?: unknown;
  retryAfterSeconds?: unknown;
};

function countLabel(count: number, direction: "upvote" | "downvote") {
  return `${count.toLocaleString()} ${count === 1 ? direction : `${direction}s`}`;
}

export function VoteControls({
  annotationId,
  creatorId,
  currentUserId,
  initialSnapshot,
  returnTo,
}: {
  annotationId: string;
  creatorId: string;
  currentUserId: string | null;
  initialSnapshot: VoteSnapshot | null;
  returnTo: string;
}) {
  const inFlight = useRef(false);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pendingVote, setPendingVote] = useState<VoteValue | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const isCreator = currentUserId === creatorId;

  const refreshAuthoritativeSnapshot = async (fallback: VoteSnapshot) => {
    try {
      const response = await fetch(`/api/annotations/${annotationId}/vote`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const parsed = response.ok ? parseVoteSnapshotResponse(await response.json()) : null;
      setSnapshot(parsed ?? fallback);
    } catch {
      setSnapshot(fallback);
    }
  };

  const changeVote = async (direction: -1 | 1) => {
    if (!snapshot || inFlight.current || !currentUserId || isCreator) return;
    inFlight.current = true;
    const previous = snapshot;
    const requestedVote: VoteValue = snapshot.currentVote === direction ? null : direction;
    setPendingVote(requestedVote);
    setMessage(null);
    setSnapshot(getOptimisticVoteSnapshot(snapshot, requestedVote));

    try {
      const response = await fetch(`/api/annotations/${annotationId}/vote`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: requestedVote }),
      });
      const body = await response.json().catch(() => null) as VoteErrorBody | null;
      const authoritative = parseVoteSnapshotResponse(body);
      if (response.ok && authoritative) {
        setSnapshot(authoritative);
        setMessage(requestedVote === null
          ? "Vote cleared."
          : requestedVote === 1 ? "Upvote saved." : "Downvote saved.");
      } else {
        if (authoritative) setSnapshot(authoritative);
        else await refreshAuthoritativeSnapshot(previous);
        if (response.status === 429 && body?.error === "RATE_LIMITED") {
          const retry = typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
          setMessage(retry
            ? `Too many vote changes. Try again in ${retry} seconds.`
            : "Too many vote changes. Please try again later.");
        } else if (body?.error === "SELF_VOTE_FORBIDDEN") {
          setMessage("Creators cannot vote on their own annotations.");
        } else {
          setMessage("Your vote was not saved. The current vote has been restored.");
        }
      }
    } catch {
      await refreshAuthoritativeSnapshot(previous);
      setMessage("Your vote was not saved. The current vote has been restored.");
    } finally {
      inFlight.current = false;
      setPendingVote(undefined);
    }
  };

  return (
    <section className="vote-section" aria-labelledby="vote-heading">
      <div className="vote-heading-row">
        <div>
          <p className="section-label">Community response</p>
          <h2 id="vote-heading">Votes</h2>
        </div>
        {!currentUserId && initialSnapshot && (
          <GoogleSignInButton
            returnTo={`${returnTo}#votes`}
            label="Sign in to vote"
            className="public-button public-button-secondary"
          />
        )}
      </div>

      {!snapshot ? (
        <p className="vote-unavailable" role="alert">Vote totals are temporarily unavailable.</p>
      ) : (
        <div className="vote-controls" id="votes" role="group" aria-label="Vote on this annotation">
          <button
            className="vote-button"
            type="button"
            aria-pressed={snapshot.currentVote === 1}
            aria-label={`Upvote; ${countLabel(snapshot.upvoteCount, "upvote")}`}
            disabled={!currentUserId || isCreator || pendingVote !== undefined}
            onClick={() => changeVote(1)}
          >
            <span aria-hidden="true">↑</span>
            <span>Upvote</span>
            <strong>{snapshot.upvoteCount.toLocaleString()}</strong>
          </button>
          <button
            className="vote-button"
            type="button"
            aria-pressed={snapshot.currentVote === -1}
            aria-label={`Downvote; ${countLabel(snapshot.downvoteCount, "downvote")}`}
            disabled={!currentUserId || isCreator || pendingVote !== undefined}
            onClick={() => changeVote(-1)}
          >
            <span aria-hidden="true">↓</span>
            <span>Downvote</span>
            <strong>{snapshot.downvoteCount.toLocaleString()}</strong>
          </button>
        </div>
      )}

      {isCreator && snapshot && (
        <p className="vote-help">Creators cannot vote on their own annotations.</p>
      )}
      {!currentUserId && snapshot && (
        <p className="vote-help">Separate totals are public. Sign in to add or change your vote.</p>
      )}
      {pendingVote !== undefined && (
        <p className="vote-message" role="status">Saving your vote…</p>
      )}
      {pendingVote === undefined && message && (
        <p className="vote-message" role="status">{message}</p>
      )}
    </section>
  );
}
