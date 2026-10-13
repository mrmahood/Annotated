"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  type ReactNode,
} from "react";
import {
  annotationActionReturnTo,
  type AnnotationActionIntent,
} from "@/lib/annotation-action-intent";
import { ProviderSignInButton } from "./provider-sign-in-button";

type AnnotationActionAuthValue = {
  requestSignIn: (intent: AnnotationActionIntent) => void;
  resumeIntent: AnnotationActionIntent | null;
};

const AnnotationActionAuthContext = createContext<AnnotationActionAuthValue | null>(null);

export function useAnnotationActionAuth() {
  return useContext(AnnotationActionAuthContext);
}

function AnnotationActionSignInPanel({
  returnTo,
  headingId,
}: {
  returnTo: string;
  headingId: string;
}) {
  return (
    <div className="annotation-action-sign-in">
      <h2 id={headingId}>Sign in to share, save, vote, or comment</h2>
      <div className="site-auth site-auth-signed-out">
        <ProviderSignInButton
          provider="google"
          returnTo={returnTo}
          className="site-auth-button"
          compactLabel="Google"
        />
        <ProviderSignInButton
          provider="x"
          returnTo={returnTo}
          className="site-auth-button"
          compactLabel="X"
        />
      </div>
    </div>
  );
}

export function AnnotationActionGate({
  currentUserId,
  returnTo,
  actionIntent,
  children,
}: {
  currentUserId: string | null;
  returnTo: string;
  actionIntent: AnnotationActionIntent | null;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogIntent, setDialogIntent] = useState<AnnotationActionIntent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const signedOut = !currentUserId;
  const resumeIntent = signedOut ? null : actionIntent;

  const requestSignIn = useCallback((intent: AnnotationActionIntent) => {
    setDialogIntent(intent);
    setDialogOpen(true);
  }, []);

  const value = useMemo(() => ({
    requestSignIn,
    resumeIntent,
  }), [requestSignIn, resumeIntent]);

  useEffect(() => {
    if (!resumeIntent) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("intent")) return;
    url.searchParams.delete("intent");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next);
  }, [resumeIntent]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialogOpen) return;
    if (!dialog.open) dialog.showModal();
  }, [dialogOpen, dialogIntent]);

  const dialogReturnTo = dialogIntent
    ? annotationActionReturnTo(returnTo, dialogIntent)
    : returnTo;

  return (
    <AnnotationActionAuthContext.Provider value={value}>
      {signedOut && (
        <section className="annotation-action-sign-in-slot" aria-labelledby="annotation-sign-in-heading">
          <AnnotationActionSignInPanel
            returnTo={returnTo}
            headingId="annotation-sign-in-heading"
          />
        </section>
      )}
      {children}
      {signedOut && dialogOpen && dialogIntent && (
        <dialog
          ref={dialogRef}
          className="annotation-action-sign-in-dialog"
          aria-labelledby="annotation-sign-in-dialog-heading"
          onClose={() => setDialogOpen(false)}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <div className="annotation-action-sign-in-dialog-bar">
            <button
              className="annotation-action-sign-in-close"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>
          <AnnotationActionSignInPanel
            returnTo={dialogReturnTo}
            headingId="annotation-sign-in-dialog-heading"
          />
        </dialog>
      )}
    </AnnotationActionAuthContext.Provider>
  );
}
