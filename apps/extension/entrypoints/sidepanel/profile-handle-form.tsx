import { useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setProfileHandle } from '@annotated/shared/profile-handle';

export function ProfileHandleForm({
  supabase,
  currentHandle,
  onHandleChange,
}: {
  supabase: SupabaseClient;
  currentHandle: string | null;
  onHandleChange: (handle: string) => void;
}) {
  const inFlight = useRef(false);
  const [draft, setDraft] = useState(currentHandle ?? '');
  const [editing, setEditing] = useState(currentHandle == null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimed = currentHandle != null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await setProfileHandle(supabase, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(result.handle);
      setEditing(false);
      onHandleChange(result.handle);
    } catch {
      setError('Your handle could not be saved. Try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <section className="profile-handle" aria-labelledby="profile-handle-heading">
      <p className="section-label" id="profile-handle-heading">Public handle</p>
      {claimed && !editing ? (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setDraft(currentHandle);
            setError(null);
            setEditing(true);
          }}
        >
          Change handle
        </button>
      ) : (
        <>
          <p className="profile-handle-lede">
            {claimed
              ? 'Choose a new public handle. Your previous handle will keep working as a link.'
              : 'Choose a public handle. You can change it later.'}
          </p>
          <form className="profile-handle-form" onSubmit={submit}>
            <label htmlFor="profile-handle-input">
              Handle
              <span className="profile-handle-input-wrap">
                <span aria-hidden="true">@</span>
                <input
                  id="profile-handle-input"
                  name="handle"
                  type="text"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={30}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={pending}
                  placeholder="your-name"
                />
              </span>
            </label>
            <div className="profile-handle-actions">
              <button className="button button-primary" type="submit" disabled={pending}>
                {pending ? 'Saving…' : claimed ? 'Save handle' : 'Claim handle'}
              </button>
              {claimed ? (
                <button
                  className="text-button"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setDraft(currentHandle);
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
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  );
}
