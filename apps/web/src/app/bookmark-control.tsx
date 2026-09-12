"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  createAnnotationBookmark,
  removeAnnotationBookmark,
} from "@/lib/data/social-mutations";
import { createClient } from "@/lib/supabase/client";
import { ProviderSignInActions } from "./provider-sign-in-actions";

export function BookmarkControl({
  annotationId,
  currentUserId,
  initialBookmarked,
  returnTo,
  variant = "card",
}: {
  annotationId: string;
  currentUserId: string | null;
  initialBookmarked: boolean;
  returnTo: string;
  variant?: "card" | "detail";
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [mode, setMode] = useState<"idle" | "sign-in" | "remove">("idle");
  const [pending, setPending] = useState<"bookmark" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const saveBookmark = async () => {
    if (!currentUserId || inFlight.current) return;
    inFlight.current = true;
    setPending("bookmark");
    setError(null);
    setStatus(null);
    try {
      await createAnnotationBookmark(createClient(), annotationId);
      setBookmarked(true);
      setMode("idle");
      setStatus("Saved to your bookmarks.");
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error
        ? mutationError.message
        : "The annotation could not be bookmarked.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  const confirmRemove = async () => {
    if (!currentUserId || inFlight.current) return;
    inFlight.current = true;
    setPending("remove");
    setError(null);
    setStatus(null);
    try {
      await removeAnnotationBookmark(createClient(), annotationId);
      setBookmarked(false);
      setMode("idle");
      setStatus("Removed from your bookmarks.");
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error
        ? mutationError.message
        : "The bookmark could not be removed.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  const signedOut = !currentUserId;
  const heading = variant === "detail" ? "Bookmark" : undefined;
  const buttonClass = variant === "detail" ? "public-button public-button-secondary" : "card-share-button";

  return (
    <div className={variant === "detail" ? "share-control share-control-detail" : "share-control"}>
      {heading ? (
        <div className="share-heading-row">
          <div>
            <p className="section-label">On Annotated</p>
            <h2 id="bookmark-heading">{heading}</h2>
          </div>
          {signedOut && (
            <ProviderSignInActions
              returnTo={`${returnTo}#bookmark`}
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
            Sign in with Google or X to save this annotation privately on Me.
          </p>
        ) : mode === "sign-in" ? (
          <div className="share-signed-out">
            <p>Sign in to bookmark.</p>
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
          <button className="card-share-button" type="button" onClick={() => setMode("sign-in")}>
            Bookmark
          </button>
        )
      ) : bookmarked && mode === "remove" ? (
        <div className="share-confirmation" role="group" aria-label="Confirm remove bookmark">
          <span>Remove this bookmark?</span>
          <button
            className={variant === "detail" ? "public-button public-button-danger" : "card-share-button"}
            type="button"
            disabled={pending !== null}
            onClick={() => void confirmRemove()}
          >
            {pending === "remove" ? "Removing…" : "Unbookmark"}
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={pending !== null}
            onClick={() => setMode("idle")}
          >
            Keep
          </button>
        </div>
      ) : bookmarked ? (
        <button
          className={buttonClass}
          type="button"
          aria-pressed="true"
          disabled={pending !== null}
          onClick={() => {
            setMode("remove");
            setError(null);
            setStatus(null);
          }}
        >
          Bookmarked
        </button>
      ) : (
        <button
          className={buttonClass}
          type="button"
          aria-pressed="false"
          disabled={pending !== null}
          onClick={() => void saveBookmark()}
        >
          {pending === "bookmark" ? "Saving…" : "Bookmark"}
        </button>
      )}

      {error && <p className={variant === "detail" ? "form-error" : "card-share-message"} role="alert">{error}</p>}
      {status && <p className={variant === "detail" ? "share-help" : "card-share-message"} role="status">{status}</p>}
    </div>
  );
}
