"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setProfileHandle } from "@annotated/shared/profile-handle";
import { createClient } from "@/lib/supabase/client";

export function ProfileHandleForm({
  currentHandle,
}: {
  currentHandle: string | null;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [draft, setDraft] = useState(currentHandle ?? "");
  const [editing, setEditing] = useState(currentHandle == null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHandle, setSavedHandle] = useState(currentHandle);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await setProfileHandle(createClient(), draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedHandle(result.handle);
      setDraft(result.handle);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Your handle could not be saved. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const headingId = "profile-handle-heading";
  const claimed = savedHandle != null;

  return (
    <section className="profile-handle" aria-labelledby={headingId}>
      <p className="eyebrow" id={headingId}>Public handle</p>
      {claimed && !editing ? (
        <>
          <p className="profile-handle-current">
            Your public handle is <strong>@{savedHandle}</strong>.
          </p>
          <button
            className="public-button public-button-secondary"
            type="button"
            onClick={() => {
              setDraft(savedHandle);
              setError(null);
              setEditing(true);
            }}
          >
            Change handle
          </button>
        </>
      ) : (
        <>
          <p className="profile-handle-lede">
            {claimed
              ? "Choose a new public handle. Your previous handle will keep working as a link."
              : "Choose a public handle for your Annotated profile. You can change it later."}
          </p>
          <form className="profile-handle-form" onSubmit={submit}>
            <label className="form-field" htmlFor="profile-handle-input">
              Handle
              <span className="profile-handle-input-wrap">
                <span aria-hidden="true">@</span>
                <input
                  id="profile-handle-input"
                  name="handle"
                  type="text"
                  autoComplete="username"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={30}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={pending}
                  placeholder="your-name"
                />
              </span>
            </label>
            <div className="profile-handle-actions">
              <button
                className="public-button public-button-primary"
                type="submit"
                disabled={pending}
              >
                {pending ? "Saving…" : claimed ? "Save handle" : "Claim handle"}
              </button>
              {claimed ? (
                <button
                  className="public-button public-button-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setDraft(savedHandle);
                    setError(null);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
