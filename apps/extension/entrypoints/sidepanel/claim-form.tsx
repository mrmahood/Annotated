import { useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const LIMITS = {
  name: 200,
  email: 320,
  relationship: 200,
  reason: 2000,
  details: 5000,
} as const;

type ClaimValues = {
  claimantName: string;
  claimantEmail: string;
  relationship: string;
  reason: string;
  details: string;
  goodFaithConfirmed: boolean;
};

const EMPTY_VALUES: ClaimValues = {
  claimantName: '',
  claimantEmail: '',
  relationship: '',
  reason: '',
  details: '',
  goodFaithConfirmed: false,
};

function validateClaim(values: ClaimValues): string | null {
  const name = values.claimantName.trim();
  const email = values.claimantEmail.trim();
  const relationship = values.relationship.trim();
  const reason = values.reason.trim();
  if (!name || !email || !relationship || !reason) {
    return 'Complete every required field before submitting your claim.';
  }
  if (
    name.length > LIMITS.name ||
    email.length > LIMITS.email ||
    relationship.length > LIMITS.relationship ||
    reason.length > LIMITS.reason ||
    values.details.length > LIMITS.details
  ) {
    return 'One or more fields exceed the stated character limit.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!values.goodFaithConfirmed) return 'Confirm that you are filing this claim in good faith.';
  return null;
}

export function ClaimForm({
  supabase,
  annotationId,
}: {
  supabase: SupabaseClient;
  annotationId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<ClaimValues>(EMPTY_VALUES);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submitClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const validationError = validateClaim(values);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const { error } = await supabase.from('claims').insert({
        annotation_id: annotationId,
        claimant_name: values.claimantName.trim(),
        claimant_email: values.claimantEmail.trim(),
        relationship_to_content: values.relationship.trim(),
        reason: values.reason.trim(),
        details: values.details.trim() || null,
      });
      if (error) throw new Error('Claim submission failed.');
      setValues(EMPTY_VALUES);
      setSuccess(true);
    } catch {
      setMessage('Your claim could not be submitted. Check your connection and try again; your entries are still here.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="claim-section" aria-labelledby="claim-heading">
      <p className="section-label">Content concerns</p>
      <h2 id="claim-heading">Need to report this annotation?</h2>
      <p>Claims are private and reviewed separately. They are never displayed on this page.</p>
      {!isOpen && (
        <button className="button button-secondary" type="button" onClick={() => setIsOpen(true)}>
          File a claim
        </button>
      )}
      {isOpen && success && <p role="status">Thank you. Your claim was received for private review.</p>}
      {isOpen && !success && (
        <form className="claim-form" onSubmit={(event) => void submitClaim(event)} noValidate>
          <label htmlFor="claimant-name">Your name</label>
          <input id="claimant-name" required maxLength={LIMITS.name} value={values.claimantName} onChange={(event) => setValues({ ...values, claimantName: event.target.value })} />
          <label htmlFor="claimant-email">Email</label>
          <input id="claimant-email" type="email" required maxLength={LIMITS.email} value={values.claimantEmail} onChange={(event) => setValues({ ...values, claimantEmail: event.target.value })} />
          <label htmlFor="claim-relationship">Relationship to the content</label>
          <input id="claim-relationship" required maxLength={LIMITS.relationship} value={values.relationship} onChange={(event) => setValues({ ...values, relationship: event.target.value })} />
          <label htmlFor="claim-reason">Reason</label>
          <textarea id="claim-reason" required maxLength={LIMITS.reason} rows={3} value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} />
          <label htmlFor="claim-details">Details (optional)</label>
          <textarea id="claim-details" maxLength={LIMITS.details} rows={3} value={values.details} onChange={(event) => setValues({ ...values, details: event.target.value })} />
          <label className="claim-confirm">
            <input
              type="checkbox"
              checked={values.goodFaithConfirmed}
              onChange={(event) => setValues({ ...values, goodFaithConfirmed: event.target.checked })}
            />
            I am filing this claim in good faith.
          </label>
          {message && <p className="inline-error" role="alert">{message}</p>}
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit claim'}
          </button>
        </form>
      )}
    </section>
  );
}
