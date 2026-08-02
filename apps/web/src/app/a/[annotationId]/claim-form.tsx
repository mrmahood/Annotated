"use client";

import { FormEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
  claimantName: "",
  claimantEmail: "",
  relationship: "",
  reason: "",
  details: "",
  goodFaithConfirmed: false,
};

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "success" };

function validateClaim(values: ClaimValues): string | null {
  const name = values.claimantName.trim();
  const email = values.claimantEmail.trim();
  const relationship = values.relationship.trim();
  const reason = values.reason.trim();

  if (!name || !email || !relationship || !reason) {
    return "Complete every required field before submitting your claim.";
  }

  if (
    name.length > LIMITS.name ||
    email.length > LIMITS.email ||
    relationship.length > LIMITS.relationship ||
    reason.length > LIMITS.reason ||
    values.details.length > LIMITS.details
  ) {
    return "One or more fields exceed the stated character limit.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }

  if (!values.goodFaithConfirmed) {
    return "Confirm that you are filing this claim in good faith.";
  }

  return null;
}

export function ClaimForm({ annotationId }: { annotationId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<ClaimValues>(EMPTY_VALUES);
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
  });
  const submissionInFlight = useRef(false);

  const updateValue = <Key extends keyof ClaimValues>(
    key: Key,
    value: ClaimValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));

    if (submission.status === "error") {
      setSubmission({ status: "idle" });
    }
  };

  const submitClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submissionInFlight.current) {
      return;
    }

    const validationError = validateClaim(values);

    if (validationError) {
      setSubmission({ status: "error", message: validationError });
      return;
    }

    submissionInFlight.current = true;
    setSubmission({ status: "submitting" });

    try {
      const supabase = createClient();
      const { error } = await supabase.from("claims").insert({
        annotation_id: annotationId,
        claimant_name: values.claimantName.trim(),
        claimant_email: values.claimantEmail.trim(),
        relationship_to_content: values.relationship.trim(),
        reason: values.reason.trim(),
        details: values.details.trim() || null,
      });

      if (error) {
        throw new Error("Claim submission failed.");
      }

      setValues(EMPTY_VALUES);
      setSubmission({ status: "success" });
    } catch {
      setSubmission({
        status: "error",
        message:
          "Your claim could not be submitted. Check your connection and try again; your entries are still here.",
      });
    } finally {
      submissionInFlight.current = false;
    }
  };

  const isSubmitting = submission.status === "submitting";

  return (
    <section className="claim-section" aria-labelledby="claim-heading">
      <div className="claim-intro">
        <div>
          <p className="section-label">Content concerns</p>
          <h2 id="claim-heading">Need to report this annotation?</h2>
          <p>
            Claims are private and reviewed separately. They are never displayed
            on this page.
          </p>
        </div>
        <button
          className="public-button public-button-claim"
          type="button"
          aria-expanded={isOpen}
          aria-controls="claim-form-panel"
          onClick={() => setIsOpen(true)}
        >
          File a claim
        </button>
      </div>

      {isOpen && (
        <div id="claim-form-panel" className="claim-form-panel">
          {submission.status === "success" ? (
            <div className="form-success" role="status">
              <h3>Claim submitted</h3>
              <p>Thank you. Your claim was received for private review.</p>
            </div>
          ) : (
            <form className="claim-form" onSubmit={submitClaim} noValidate>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="claimant-name">Your name</label>
                  <input
                    id="claimant-name"
                    name="claimantName"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={LIMITS.name}
                    value={values.claimantName}
                    onChange={(event) =>
                      updateValue("claimantName", event.target.value)
                    }
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="claimant-email">Email address</label>
                  <input
                    id="claimant-email"
                    name="claimantEmail"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={LIMITS.email}
                    value={values.claimantEmail}
                    onChange={(event) =>
                      updateValue("claimantEmail", event.target.value)
                    }
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="claim-relationship">
                  Relationship to the content
                </label>
                <select
                  id="claim-relationship"
                  name="relationship"
                  required
                  value={values.relationship}
                  onChange={(event) =>
                    updateValue("relationship", event.target.value)
                  }
                >
                  <option value="">Select a relationship</option>
                  <option value="Copyright owner">Copyright owner</option>
                  <option value="Author or creator">Author or creator</option>
                  <option value="Publisher">Publisher</option>
                  <option value="Person discussed in the content">
                    Person discussed in the content
                  </option>
                  <option value="Authorized representative">
                    Authorized representative
                  </option>
                  <option value="Other relevant party">Other relevant party</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="claim-reason">Reason for the claim</label>
                <textarea
                  id="claim-reason"
                  name="reason"
                  rows={5}
                  required
                  maxLength={LIMITS.reason}
                  value={values.reason}
                  onChange={(event) => updateValue("reason", event.target.value)}
                />
                <span className="field-count">
                  {values.reason.length.toLocaleString()} / {LIMITS.reason.toLocaleString()}
                </span>
              </div>

              <div className="form-field">
                <label htmlFor="claim-details">Additional details (optional)</label>
                <textarea
                  id="claim-details"
                  name="details"
                  rows={4}
                  maxLength={LIMITS.details}
                  value={values.details}
                  onChange={(event) => updateValue("details", event.target.value)}
                />
                <span className="field-count">
                  {values.details.length.toLocaleString()} / {LIMITS.details.toLocaleString()}
                </span>
              </div>

              <label className="confirmation-field" htmlFor="claim-good-faith">
                <input
                  id="claim-good-faith"
                  name="goodFaithConfirmed"
                  type="checkbox"
                  required
                  checked={values.goodFaithConfirmed}
                  onChange={(event) =>
                    updateValue("goodFaithConfirmed", event.target.checked)
                  }
                />
                <span>
                  I confirm that this claim is accurate to the best of my
                  knowledge and is submitted in good faith.
                </span>
              </label>

              {submission.status === "error" && (
                <p className="form-error" role="alert">
                  {submission.message}
                </p>
              )}

              <div className="claim-form-actions">
                <button
                  className="public-button public-button-secondary"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="public-button public-button-primary"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "Submit claim"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
