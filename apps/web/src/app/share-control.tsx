"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import {
  createAnnotationReshare,
  removeAnnotationReshare,
} from "@/lib/data/social-mutations";
import { RESHARE_COMMENT_LIMIT } from "@/lib/data/reshare";
import { createClient } from "@/lib/supabase/client";
import { ProviderSignInActions } from "./provider-sign-in-actions";

export function ShareControl({
  annotationId,
  currentUserId,
  initialShared,
  returnTo,
  variant = "card",
}: {
  annotationId: string;
  currentUserId: string | null;
  initialShared: boolean;
  returnTo: string;
  variant?: "card" | "detail";
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [shared, setShared] = useState(initialShared);
  const [mode, setMode] = useState<"idle" | "compose" | "unshare">("idle");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"share" | "unshare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const composeId = `reshare-comment-${variant}-${annotationId}`;

  const submitShare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUserId || inFlight.current) return;
    if (comment.length > RESHARE_COMMENT_LIMIT) {
      setError("Reshare comments cannot exceed 1,000 characters.");
      return;
    }
    inFlight.current = true;
    setPending("share");
    setError(null);
    setStatus(null);
    try {
      await createAnnotationReshare(createClient(), annotationId, comment);
      setShared(true);
      setMode("idle");
      setComment("");
      setStatus("Shared to your Annotated feed.");
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error
        ? mutationError.message
        : "The annotation could not be shared.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  const confirmUnshare = async () => {
    if (!currentUserId || inFlight.current) return;
    inFlight.current = true;
    setPending("unshare");
    setError(null);
    setStatus(null);
    try {
      await removeAnnotationReshare(createClient(), annotationId);
      setShared(false);
      setMode("idle");
      setStatus("Removed from your Annotated feed.");
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error
        ? mutationError.message
        : "The share could not be removed.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  const signedOut = !currentUserId;
  const heading = variant === "detail" ? "Share" : undefined;
  const cardPrompt = variant === "card" && signedOut && mode === "compose";

  return (
    <div className={variant === "detail" ? "share-control share-control-detail" : cardPrompt ? "share-control share-control-prompt" : "share-control"}>
      {heading ? (
        <div className="share-heading-row">
          <div>
            <p className="section-label">On Annotated</p>
            <h2 id="share-heading">{heading}</h2>
          </div>
          {signedOut && (
            <ProviderSignInActions
              returnTo={`${returnTo}#share`}
              googleLabel="Continue with Google"
              xLabel="Continue with X"
              className="site-auth-button"
            />
          )}
        </div>
      ) : null}

      {signedOut ? (
        variant === "detail" ? (
          <p className="share-help">
            Sign in with Google or X to reshare this annotation onto your Annotated feed.
          </p>
        ) : mode === "compose" ? (
          <div className="share-signed-out">
            <p>Sign in to share to your feed.</p>
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
          <button className="card-share-button" type="button" onClick={() => setMode("compose")}>
            Share
          </button>
        )
      ) : shared && mode === "unshare" ? (
        <div className="share-confirmation" role="group" aria-label="Confirm unshare">
          <span>Remove this share from your feed?</span>
          <button
            className={variant === "detail" ? "public-button public-button-danger" : "card-share-button"}
            type="button"
            disabled={pending !== null}
            onClick={() => void confirmUnshare()}
          >
            {pending === "unshare" ? "Removing…" : "Unshare"}
          </button>
          <button
            className={variant === "detail" ? "public-button public-button-secondary" : "card-share-button"}
            type="button"
            disabled={pending !== null}
            onClick={() => setMode("idle")}
          >
            Keep
          </button>
        </div>
      ) : shared ? (
        <button
          className={variant === "detail" ? "public-button public-button-secondary" : "card-share-button"}
          type="button"
          aria-pressed="true"
          disabled={pending !== null}
          onClick={() => {
            setMode("unshare");
            setError(null);
            setStatus(null);
          }}
        >
          Shared
        </button>
      ) : mode === "compose" ? (
        <form className="share-composer" onSubmit={(event) => void submitShare(event)}>
          <label className={variant === "detail" ? undefined : "visually-hidden"} htmlFor={composeId}>
            Optional comment
          </label>
          <textarea
            id={composeId}
            value={comment}
            rows={variant === "detail" ? 3 : 2}
            maxLength={RESHARE_COMMENT_LIMIT}
            placeholder="Add an optional comment…"
            onChange={(event) => {
              setComment(event.target.value);
              setError(null);
            }}
          />
          <div className="share-composer-footer">
            <span aria-live="polite">
              {comment.length.toLocaleString()} / {RESHARE_COMMENT_LIMIT.toLocaleString()}
            </span>
            <button
              className={variant === "detail" ? "public-button public-button-primary" : "card-share-button"}
              type="submit"
              disabled={pending !== null}
            >
              {pending === "share" ? "Sharing…" : "Share to feed"}
            </button>
            <button
              className={variant === "detail" ? "public-button public-button-secondary" : "card-share-button"}
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setMode("idle");
                setComment("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className={variant === "detail" ? "public-button public-button-secondary" : "card-share-button"}
          type="button"
          aria-pressed="false"
          disabled={pending !== null}
          onClick={() => {
            setMode("compose");
            setError(null);
            setStatus(null);
          }}
        >
          Share
        </button>
      )}

      {error && <p className={variant === "detail" ? "form-error" : "card-share-message"} role="alert">{error}</p>}
      {status && <p className={variant === "detail" ? "share-help" : "card-share-message"} role="status">{status}</p>}
    </div>
  );
}
