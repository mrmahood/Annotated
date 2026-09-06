"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  createComment,
  deleteComment,
} from "@/lib/data/social-mutations";
import {
  COMMENT_BODY_LIMIT,
  queryPublicComments,
  type PublicComment,
  type PublicCommentPage,
} from "@/lib/data/social-query";
import { getInitial } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/client";
import { ProviderSignInActions } from "../../provider-sign-in-actions";

export function CommentsSection({
  annotationId,
  currentUserId,
  initialPage,
  returnTo,
}: {
  annotationId: string;
  currentUserId: string | null;
  initialPage: PublicCommentPage | null;
  returnTo: string;
}) {
  const router = useRouter();
  const postInFlight = useRef(false);
  const deleteInFlight = useRef(false);
  const successRef = useRef<HTMLParagraphElement>(null);
  const [comments, setComments] = useState<PublicComment[]>(initialPage?.comments ?? []);
  const [total, setTotal] = useState(initialPage?.total ?? 0);
  const [hasMore, setHasMore] = useState(initialPage?.hasMore ?? false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await queryPublicComments(createClient(), annotationId, comments.length);
      setComments((current) => {
        const existingIds = new Set(current.map((comment) => comment.id));
        return [...current, ...page.comments.filter((comment) => !existingIds.has(comment.id))];
      });
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch {
      setError("More comments could not be loaded. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (postInFlight.current) return;
    if (!draft.trim()) {
      setError("Write a comment before posting.");
      return;
    }
    if (draft.length > COMMENT_BODY_LIMIT) {
      setError("Comments cannot exceed 1,000 characters.");
      return;
    }

    postInFlight.current = true;
    setPosting(true);
    setError(null);
    setSuccess(null);
    try {
      await createComment(createClient(), annotationId, draft);
      setDraft("");
      setTotal((count) => count + 1);
      setSuccess("Comment posted.");
      router.refresh();
    } catch {
      setError("Your comment could not be posted. Your draft is still here; please try again.");
    } finally {
      postInFlight.current = false;
      setPosting(false);
    }
  };

  const removeComment = async (commentId: string) => {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeletingId(commentId);
    setError(null);
    setSuccess(null);
    try {
      await deleteComment(createClient(), commentId);
      setComments((current) => current.filter((comment) => comment.id !== commentId));
      setTotal((count) => Math.max(0, count - 1));
      setConfirmDeleteId(null);
      setSuccess("Comment deleted.");
      router.refresh();
    } catch {
      setError("The comment could not be deleted. Please try again.");
    } finally {
      deleteInFlight.current = false;
      setDeletingId(null);
    }
  };

  return (
    <section className="comments-section" id="comments" aria-labelledby="comments-heading">
      <div className="comments-heading-row">
        <div>
          <p className="section-label">Discussion</p>
          <h2 id="comments-heading">Comments</h2>
        </div>
        <span className="comment-total">
          {initialPage ? total.toLocaleString() : "Unavailable"}
        </span>
      </div>

      {!initialPage ? (
        <div className="comments-state discovery-error" role="alert">
          Comments are temporarily unavailable. Please try again later.
        </div>
      ) : comments.length === 0 ? (
        <p className="comments-empty">No comments yet. Start the conversation.</p>
      ) : (
        <ol className="comment-list">
          {comments.map((comment) => {
            const dateLabel = new Intl.DateTimeFormat("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(comment.createdAt));
            return (
              <li className="comment-item" key={comment.id}>
                <Link className="comment-avatar-link" href={`/p/${comment.userId}`} aria-label={`View ${comment.author.displayName}’s profile`}>
                  {comment.author.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="comment-avatar" src={comment.author.avatarUrl} alt="" width="38" height="38" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="comment-avatar public-avatar-fallback" aria-hidden="true">
                      {getInitial(comment.author.displayName)}
                    </span>
                  )}
                </Link>
                <div className="comment-content">
                  <div className="comment-meta">
                    <Link href={`/p/${comment.userId}`}>{comment.author.displayName}</Link>
                    <time dateTime={comment.createdAt}>{dateLabel}</time>
                  </div>
                  <p className="comment-body">{comment.body}</p>
                  {currentUserId === comment.userId && (
                    <div className="comment-delete">
                      {confirmDeleteId === comment.id ? (
                        <div className="comment-delete-confirm" role="group" aria-label="Confirm comment deletion">
                          <span>Delete this comment?</span>
                          <button type="button" disabled={deletingId !== null} onClick={() => removeComment(comment.id)}>
                            {deletingId === comment.id ? "Deleting…" : "Yes, delete"}
                          </button>
                          <button type="button" disabled={deletingId !== null} onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(comment.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {initialPage && hasMore && (
        <button
          className="public-button public-button-secondary comments-more"
          type="button"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Loading…" : `Show more comments (${Math.max(total - comments.length, 0).toLocaleString()} remaining)`}
        </button>
      )}

      {error && <p className="form-error comments-message" role="alert">{error}</p>}
      {success && (
        <p className="form-success-message comments-message" role="status" tabIndex={-1} ref={successRef}>
          {success}
        </p>
      )}

      <div className="comment-composer">
        <h3>Add a comment</h3>
        {currentUserId ? (
          <form onSubmit={submit} noValidate>
            <label htmlFor="comment-body">Comment</label>
            <textarea
              id="comment-body"
              name="commentBody"
              rows={5}
              maxLength={COMMENT_BODY_LIMIT}
              required
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
                setSuccess(null);
              }}
            />
            <div className="comment-form-footer">
              <span className="field-count" aria-live="polite">
                {draft.length.toLocaleString()} / {COMMENT_BODY_LIMIT.toLocaleString()}
              </span>
              <button
                className="public-button public-button-primary"
                type="submit"
                disabled={posting}
              >
                {posting ? "Posting…" : "Post comment"}
              </button>
            </div>
          </form>
        ) : (
          <div className="comment-sign-in">
            <p>Sign in to join the discussion.</p>
            <ProviderSignInActions
              returnTo={returnTo}
              googleLabel="Continue with Google"
              xLabel="Continue with X"
            />
          </div>
        )}
      </div>
    </section>
  );
}
