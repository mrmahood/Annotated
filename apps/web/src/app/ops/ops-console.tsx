"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANNOTATION_HIDE_CONFIRMATION,
  ANNOTATION_MODERATION_REASON_CODES,
  ANNOTATION_REMOVE_CONFIRMATION,
  ANNOTATION_UNHIDE_CONFIRMATION,
  CLAIM_REVIEW_CONFIRMATION,
  MEDIA_ONLY_REASON_CODES,
  MODERATION_CONFIRMATION,
  type AnnotationModerationReasonCode,
  type ClaimReviewToStatus,
  type MediaOnlyReasonCode,
} from "@/lib/moderation";
import {
  MEDIA_ONLY_WITHDRAWAL_PATH,
  annotationHidePath,
  annotationRemovePath,
  annotationUnhidePath,
  buildAnnotationHideBody,
  buildAnnotationRemoveBody,
  buildAnnotationUnhideBody,
  buildClaimReviewUpdateBody,
  buildMediaOnlyWithdrawalBody,
  claimActionLabel,
  claimReviewActionsForStatus,
  claimReviewGetPath,
  claimReviewListPath,
  isAnnotationHideReady,
  isAnnotationRemoveReady,
  isAnnotationUnhideReady,
  isClaimReviewActionEnabled,
  isMediaOnlyWithdrawReady,
  operatorActionMessage,
  parseBoundedModerationError,
  parseOpsClaimDetail,
  parseOpsClaimList,
  type OpsClaim,
} from "@/lib/ops-console";
import {
  TRENDING_BOOST_CONFIRMATION,
  TRENDING_BOOSTS_PATH,
  buildTrendingBoostBody,
  isTrendingBoostReady,
  parseTrendingBoostList,
  type TrendingBoostRow,
} from "@/lib/data/trending";
import { createClient } from "@/lib/supabase/client";

type ConsoleTab = "claims" | "annotations" | "trending";

type ActionState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

async function operatorFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error("AUTH_REQUIRED");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().replace(".000Z", "Z");
}

function ActionBanner({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  if (state.status === "working") {
    return <p className="ops-status" role="status">Working…</p>;
  }
  if (state.status === "error") {
    return <p className="form-error" role="alert">{state.message}</p>;
  }
  return <p className="form-success-message" role="status">{state.message}</p>;
}

export function OpsConsole() {
  const [tab, setTab] = useState<ConsoleTab>("claims");
  const [annotationId, setAnnotationId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [claimId, setClaimId] = useState("");

  const openAnnotationTools = (next: {
    annotationId: string;
    claimId?: string;
  }) => {
    setAnnotationId(next.annotationId);
    if (next.claimId) setClaimId(next.claimId);
    setTab("annotations");
  };

  return (
    <div className="ops-console">
      <div className="ops-tabs" role="tablist" aria-label="Operator console">
        <button
          className="ops-tab"
          type="button"
          role="tab"
          id="ops-tab-claims"
          aria-selected={tab === "claims"}
          aria-controls="ops-panel-claims"
          onClick={() => setTab("claims")}
        >
          Claim queue
        </button>
        <button
          className="ops-tab"
          type="button"
          role="tab"
          id="ops-tab-annotations"
          aria-selected={tab === "annotations"}
          aria-controls="ops-panel-annotations"
          onClick={() => setTab("annotations")}
        >
          Annotation tools
        </button>
        <button
          className="ops-tab"
          type="button"
          role="tab"
          id="ops-tab-trending"
          aria-selected={tab === "trending"}
          aria-controls="ops-panel-trending"
          onClick={() => setTab("trending")}
        >
          Trending boosts
        </button>
      </div>

      <div
        className="ops-panel"
        id="ops-panel-claims"
        role="tabpanel"
        aria-labelledby="ops-tab-claims"
        hidden={tab !== "claims"}
      >
        <ClaimQueue
          active={tab === "claims"}
          onUseInAnnotationTools={openAnnotationTools}
        />
      </div>

      <div
        className="ops-panel"
        id="ops-panel-annotations"
        role="tabpanel"
        aria-labelledby="ops-tab-annotations"
        hidden={tab !== "annotations"}
      >
        <AnnotationTools
          annotationId={annotationId}
          mediaId={mediaId}
          claimId={claimId}
          onAnnotationIdChange={setAnnotationId}
          onMediaIdChange={setMediaId}
          onClaimIdChange={setClaimId}
        />
      </div>

      <div
        className="ops-panel"
        id="ops-panel-trending"
        role="tabpanel"
        aria-labelledby="ops-tab-trending"
        hidden={tab !== "trending"}
      >
        <TrendingBoostTools active={tab === "trending"} />
      </div>
    </div>
  );
}

function ClaimQueue({
  active,
  onUseInAnnotationTools,
}: {
  active: boolean;
  onUseInAnnotationTools: (next: { annotationId: string; claimId?: string }) => void;
}) {
  const [includeClaimantPii, setIncludeClaimantPii] = useState(false);
  const [claims, setClaims] = useState<OpsClaim[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsClaim | null>(null);
  const [loadState, setLoadState] = useState<ActionState>({ status: "idle" });
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  const [confirm, setConfirm] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const loadedOnce = useRef(false);
  const queueInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const loadQueue = useCallback(async (showPii: boolean, selectedClaimId: string | null) => {
    if (queueInFlight.current) return;
    queueInFlight.current = true;
    setLoadState({ status: "working" });
    try {
      const listResponse = await operatorFetch(claimReviewListPath(showPii));
      const listBody = await readJson(listResponse);
      if (!listResponse.ok) {
        setClaims([]);
        setDetail(null);
        setLoadState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(listBody)),
        });
        return;
      }
      const parsed = parseOpsClaimList(listBody);
      if (!parsed) {
        setClaims([]);
        setDetail(null);
        setLoadState({ status: "error", message: operatorActionMessage("CLAIM_REVIEW_UNAVAILABLE") });
        return;
      }
      setClaims(parsed);
      if (!selectedClaimId) {
        setDetail(null);
        setLoadState({ status: "idle" });
        return;
      }
      const detailResponse = await operatorFetch(claimReviewGetPath(selectedClaimId, showPii));
      const detailBody = await readJson(detailResponse);
      if (!detailResponse.ok) {
        setDetail(null);
        setLoadState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(detailBody)),
        });
        return;
      }
      const nextDetail = parseOpsClaimDetail(detailBody);
      setDetail(nextDetail);
      if (nextDetail?.operatorNotes) setOperatorNotes(nextDetail.operatorNotes);
      setLoadState({ status: "idle" });
    } catch (error) {
      setLoadState({
        status: "error",
        message: operatorActionMessage(error instanceof Error ? error.message : "UNAVAILABLE"),
      });
    } finally {
      queueInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || loadedOnce.current) return;
    loadedOnce.current = true;
    void loadQueue(false, null);
  }, [active, loadQueue]);

  const openClaim = async (claimId: string) => {
    setSelectedId(claimId);
    setActionState({ status: "idle" });
    setConfirm("");
    const listed = claims.find((claim) => claim.claimId === claimId) ?? null;
    if (listed) {
      setDetail(listed);
      setOperatorNotes(listed.operatorNotes ?? "");
    }
    await loadQueue(includeClaimantPii, claimId);
  };

  const updateClaim = async (toStatus: ClaimReviewToStatus) => {
    if (!detail || actionInFlight.current) return;
    if (!isClaimReviewActionEnabled(detail.status, toStatus, confirm)) return;
    actionInFlight.current = true;
    setActionState({ status: "working" });
    try {
      const response = await operatorFetch(`/api/moderation/claims/${detail.claimId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildClaimReviewUpdateBody({
          toStatus,
          operatorNotes,
          includeClaimantPii,
        })),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setActionState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(body)),
        });
        return;
      }
      const updated = parseOpsClaimDetail(body);
      if (updated) {
        setDetail(updated);
        setOperatorNotes(updated.operatorNotes ?? "");
        setClaims((current) => current.map((claim) => (
          claim.claimId === updated.claimId ? updated : claim
        )));
      }
      setConfirm("");
      setActionState({
        status: "success",
        message: updated
          ? `Claim moved to ${updated.status}.`
          : "Claim review updated.",
      });
      await loadQueue(includeClaimantPii, detail.claimId);
    } catch (error) {
      setActionState({
        status: "error",
        message: operatorActionMessage(error instanceof Error ? error.message : "UNAVAILABLE"),
      });
    } finally {
      actionInFlight.current = false;
    }
  };

  const togglePii = async (next: boolean) => {
    setIncludeClaimantPii(next);
    await loadQueue(next, selectedId);
  };

  const availableActions = detail ? claimReviewActionsForStatus(detail.status) : [];

  return (
    <section className="ops-section" aria-labelledby="ops-claims-heading">
      <div className="ops-section-head">
        <div>
          <p className="section-label">Open claims</p>
          <h2 id="ops-claims-heading">Submitted and reviewing</h2>
        </div>
        <div className="ops-toolbar">
          <label className="ops-toggle" htmlFor="ops-show-pii">
            <input
              id="ops-show-pii"
              type="checkbox"
              checked={includeClaimantPii}
              onChange={(event) => void togglePii(event.target.checked)}
            />
            <span>Show claimant PII</span>
          </label>
          <button
            className="public-button public-button-secondary"
            type="button"
            onClick={() => void loadQueue(includeClaimantPii, selectedId)}
          >
            Refresh
          </button>
        </div>
      </div>

      <ActionBanner state={loadState} />

      {claims.length === 0 && loadState.status !== "working" && loadState.status !== "error" ? (
        <p className="ops-empty">No open claims.</p>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <caption className="visually-hidden">Open claims</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Annotation</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr
                  key={claim.claimId}
                  className="ops-claim-row"
                  data-selected={selectedId === claim.claimId ? "true" : undefined}
                  onClick={() => void openClaim(claim.claimId)}
                >
                  <td>
                    <button
                      className="ops-row-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openClaim(claim.claimId);
                      }}
                    >
                      {claim.status}
                    </button>
                  </td>
                  <td>
                    <time dateTime={claim.createdAt}>{formatTimestamp(claim.createdAt)}</time>
                  </td>
                  <td className="ops-mono">{claim.annotationId}</td>
                  <td>{claim.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <article className="ops-detail" aria-labelledby="ops-claim-detail-heading">
          <p className="section-label">Selected claim</p>
          <h3 id="ops-claim-detail-heading">{detail.claimId}</h3>
          <dl className="ops-facts">
            <div>
              <dt>Status</dt>
              <dd>{detail.status}</dd>
            </div>
            <div>
              <dt>Annotation</dt>
              <dd className="ops-mono">{detail.annotationId}</dd>
            </div>
            <div>
              <dt>Relationship</dt>
              <dd>{detail.relationshipToContent}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{detail.reason}</dd>
            </div>
            {includeClaimantPii && (
              <>
                <div>
                  <dt>Claimant name</dt>
                  <dd>{detail.claimantName || "—"}</dd>
                </div>
                <div>
                  <dt>Claimant email</dt>
                  <dd>{detail.claimantEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Details</dt>
                  <dd>{detail.details || "—"}</dd>
                </div>
              </>
            )}
          </dl>

          <div className="form-field">
            <label htmlFor="ops-operator-notes">Operator notes (optional)</label>
            <textarea
              id="ops-operator-notes"
              rows={3}
              maxLength={4000}
              value={operatorNotes}
              onChange={(event) => setOperatorNotes(event.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="ops-claim-confirm">
              Type {CLAIM_REVIEW_CONFIRMATION} to enable review actions
            </label>
            <input
              id="ops-claim-confirm"
              className="ops-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          <ActionBanner state={actionState} />

          <div className="ops-actions">
            {availableActions.map((toStatus) => (
              <button
                key={toStatus}
                className={toStatus === "rejected" ? "public-button public-button-danger" : "public-button public-button-primary"}
                type="button"
                disabled={!isClaimReviewActionEnabled(detail.status, toStatus, confirm) || actionState.status === "working"}
                onClick={() => void updateClaim(toStatus)}
              >
                {claimActionLabel(toStatus)}
              </button>
            ))}
            <button
              className="public-button public-button-secondary"
              type="button"
              onClick={() => onUseInAnnotationTools({
                annotationId: detail.annotationId,
                claimId: detail.claimId,
              })}
            >
              Use in annotation tools
            </button>
          </div>
          {availableActions.length === 0 && (
            <p className="ops-help">This claim is already closed.</p>
          )}
        </article>
      )}
    </section>
  );
}

function AnnotationTools({
  annotationId,
  mediaId,
  claimId,
  onAnnotationIdChange,
  onMediaIdChange,
  onClaimIdChange,
}: {
  annotationId: string;
  mediaId: string;
  claimId: string;
  onAnnotationIdChange: (value: string) => void;
  onMediaIdChange: (value: string) => void;
  onClaimIdChange: (value: string) => void;
}) {
  const [reasonCode, setReasonCode] = useState<AnnotationModerationReasonCode>("operator_request");
  const [withdrawReason, setWithdrawReason] = useState<MediaOnlyReasonCode>("operator_request");
  const [resolveClaim, setResolveClaim] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState("");
  const [hideConfirm, setHideConfirm] = useState("");
  const [unhideConfirm, setUnhideConfirm] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState("");
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const inFlight = useRef(false);

  const runAction = async (
    path: string,
    body: Record<string, unknown>,
    success: (result: unknown) => string,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: "working" });
    try {
      const response = await operatorFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(payload)),
        });
        return;
      }
      setState({ status: "success", message: success(payload) });
    } catch (error) {
      setState({
        status: "error",
        message: operatorActionMessage(error instanceof Error ? error.message : "UNAVAILABLE"),
      });
    } finally {
      inFlight.current = false;
    }
  };

  const resultCode = (payload: unknown) => {
    if (payload && typeof payload === "object" && "resultCode" in payload) {
      const code = (payload as { resultCode?: unknown }).resultCode;
      if (typeof code === "string") return code;
    }
    return "completed";
  };

  return (
    <section className="ops-section" aria-labelledby="ops-annotation-heading">
      <p className="section-label">Existing routes only</p>
      <h2 id="ops-annotation-heading">Annotation tools</h2>
      <p className="ops-help">
        Each destructive action stays disabled until the exact confirmation
        phrase is typed. Media-only withdrawal also needs a media UUID.
      </p>

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="ops-annotation-id">Annotation UUID</label>
          <input
            id="ops-annotation-id"
            className="ops-mono"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={annotationId}
            onChange={(event) => onAnnotationIdChange(event.target.value.trim())}
          />
        </div>
        <div className="form-field">
          <label htmlFor="ops-media-id">Media UUID (withdrawal)</label>
          <input
            id="ops-media-id"
            className="ops-mono"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={mediaId}
            onChange={(event) => onMediaIdChange(event.target.value.trim())}
          />
        </div>
        <div className="form-field">
          <label htmlFor="ops-claim-id">Claim UUID (optional)</label>
          <input
            id="ops-claim-id"
            className="ops-mono"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={claimId}
            onChange={(event) => onClaimIdChange(event.target.value.trim())}
          />
        </div>
        <div className="form-field">
          <label htmlFor="ops-reason-code">Reason code</label>
          <select
            id="ops-reason-code"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value as AnnotationModerationReasonCode)}
          >
            {ANNOTATION_MODERATION_REASON_CODES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>
      </div>

      <ActionBanner state={state} />

      <div className="ops-tool-grid">
        <article className="ops-tool">
          <h3>Media-only withdraw</h3>
          <p className="ops-help">Keeps the annotation published and withdraws playable media.</p>
          <div className="form-field">
            <label htmlFor="ops-withdraw-reason">Withdrawal reason</label>
            <select
              id="ops-withdraw-reason"
              value={withdrawReason}
              onChange={(event) => setWithdrawReason(event.target.value as MediaOnlyReasonCode)}
            >
              {MEDIA_ONLY_REASON_CODES.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ops-withdraw-confirm">Type {MODERATION_CONFIRMATION}</label>
            <input
              id="ops-withdraw-confirm"
              className="ops-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={withdrawConfirm}
              onChange={(event) => setWithdrawConfirm(event.target.value)}
            />
          </div>
          <button
            className="public-button public-button-danger"
            type="button"
            disabled={!isMediaOnlyWithdrawReady({
              annotationId,
              mediaId,
              typedConfirm: withdrawConfirm,
              claimId,
            }) || state.status === "working"}
            onClick={() => {
              void runAction(
                MEDIA_ONLY_WITHDRAWAL_PATH,
                buildMediaOnlyWithdrawalBody({
                  annotationId: annotationId.trim(),
                  mediaId: mediaId.trim(),
                  reasonCode: withdrawReason,
                  claimId,
                }),
                (payload) => `Media withdrawal ${resultCode(payload)}.`,
              );
              setWithdrawConfirm("");
            }}
          >
            Withdraw media
          </button>
        </article>

        <article className="ops-tool">
          <h3>Hide</h3>
          <div className="form-field">
            <label htmlFor="ops-hide-confirm">Type {ANNOTATION_HIDE_CONFIRMATION}</label>
            <input
              id="ops-hide-confirm"
              className="ops-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={hideConfirm}
              onChange={(event) => setHideConfirm(event.target.value)}
            />
          </div>
          <button
            className="public-button public-button-danger"
            type="button"
            disabled={!isAnnotationHideReady({
              annotationId,
              typedConfirm: hideConfirm,
              claimId,
            }) || state.status === "working"}
            onClick={() => {
              void runAction(
                annotationHidePath(annotationId.trim()),
                buildAnnotationHideBody({ reasonCode, claimId }),
                (payload) => `Hide ${resultCode(payload)}.`,
              );
              setHideConfirm("");
            }}
          >
            Hide annotation
          </button>
        </article>

        <article className="ops-tool">
          <h3>Unhide</h3>
          <div className="form-field">
            <label htmlFor="ops-unhide-confirm">Type {ANNOTATION_UNHIDE_CONFIRMATION}</label>
            <input
              id="ops-unhide-confirm"
              className="ops-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={unhideConfirm}
              onChange={(event) => setUnhideConfirm(event.target.value)}
            />
          </div>
          <button
            className="public-button public-button-primary"
            type="button"
            disabled={!isAnnotationUnhideReady({
              annotationId,
              typedConfirm: unhideConfirm,
              claimId,
            }) || state.status === "working"}
            onClick={() => {
              void runAction(
                annotationUnhidePath(annotationId.trim()),
                buildAnnotationUnhideBody({ reasonCode, claimId }),
                (payload) => `Unhide ${resultCode(payload)}.`,
              );
              setUnhideConfirm("");
            }}
          >
            Unhide annotation
          </button>
        </article>

        <article className="ops-tool">
          <h3>Full remove</h3>
          <label className="ops-toggle" htmlFor="ops-resolve-claim">
            <input
              id="ops-resolve-claim"
              type="checkbox"
              checked={resolveClaim}
              onChange={(event) => setResolveClaim(event.target.checked)}
            />
            <span>Also resolve the linked claim</span>
          </label>
          <div className="form-field">
            <label htmlFor="ops-remove-confirm">Type {ANNOTATION_REMOVE_CONFIRMATION}</label>
            <input
              id="ops-remove-confirm"
              className="ops-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={removeConfirm}
              onChange={(event) => setRemoveConfirm(event.target.value)}
            />
          </div>
          <button
            className="public-button public-button-danger"
            type="button"
            disabled={!isAnnotationRemoveReady({
              annotationId,
              typedConfirm: removeConfirm,
              claimId,
              resolveClaim,
            }) || state.status === "working"}
            onClick={() => {
              void runAction(
                annotationRemovePath(annotationId.trim()),
                buildAnnotationRemoveBody({ reasonCode, claimId, resolveClaim }),
                (payload) => `Remove ${resultCode(payload)}.`,
              );
              setRemoveConfirm("");
            }}
          >
            Remove annotation
          </button>
        </article>
      </div>
    </section>
  );
}

function TrendingBoostTools({ active }: { active: boolean }) {
  const [annotationId, setAnnotationId] = useState("");
  const [boost, setBoost] = useState("5");
  const [confirm, setConfirm] = useState("");
  const [boosts, setBoosts] = useState<TrendingBoostRow[]>([]);
  const [loadState, setLoadState] = useState<ActionState>({ status: "idle" });
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  const loadedOnce = useRef(false);
  const queueInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const loadBoosts = useCallback(async () => {
    if (queueInFlight.current) return;
    queueInFlight.current = true;
    setLoadState({ status: "working" });
    try {
      const response = await operatorFetch(TRENDING_BOOSTS_PATH);
      const body = await readJson(response);
      if (!response.ok) {
        setBoosts([]);
        setLoadState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(body)),
        });
        return;
      }
      const parsed = parseTrendingBoostList(body);
      if (!parsed) {
        setBoosts([]);
        setLoadState({ status: "error", message: operatorActionMessage("TRENDING_BOOST_UNAVAILABLE") });
        return;
      }
      setBoosts(parsed);
      setLoadState({ status: "idle" });
    } catch (error) {
      setLoadState({
        status: "error",
        message: operatorActionMessage(error instanceof Error ? error.message : "UNAVAILABLE"),
      });
    } finally {
      queueInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || loadedOnce.current) return;
    loadedOnce.current = true;
    void loadBoosts();
  }, [active, loadBoosts]);

  const runBoost = async (action: "set" | "clear") => {
    if (actionInFlight.current) return;
    if (!isTrendingBoostReady({ annotationId, typedConfirm: confirm, action, boost })) return;
    actionInFlight.current = true;
    setActionState({ status: "working" });
    try {
      const response = await operatorFetch(TRENDING_BOOSTS_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTrendingBoostBody({ annotationId, action, boost })),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setActionState({
          status: "error",
          message: operatorActionMessage(parseBoundedModerationError(payload)),
        });
        return;
      }
      setConfirm("");
      setActionState({
        status: "success",
        message: action === "set" ? "Trending boost set." : "Trending boost cleared.",
      });
      await loadBoosts();
    } catch (error) {
      setActionState({
        status: "error",
        message: operatorActionMessage(error instanceof Error ? error.message : "UNAVAILABLE"),
      });
    } finally {
      actionInFlight.current = false;
    }
  };

  return (
    <section className="ops-section" aria-labelledby="ops-trending-heading">
      <div className="ops-section-head">
        <div>
          <p className="section-label">What’s Trending</p>
          <h2 id="ops-trending-heading">Manual ranking boost</h2>
        </div>
        <button
          className="public-button public-button-secondary"
          type="button"
          onClick={() => void loadBoosts()}
        >
          Refresh
        </button>
      </div>
      <p className="ops-help">
        Adds a positive number to the 7-day trending score for one published
        annotation. Clear removes the boost. Type {TRENDING_BOOST_CONFIRMATION}
        before set or clear.
      </p>

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="ops-trending-annotation-id">Annotation UUID</label>
          <input
            id="ops-trending-annotation-id"
            className="ops-mono"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={annotationId}
            onChange={(event) => setAnnotationId(event.target.value.trim())}
          />
        </div>
        <div className="form-field">
          <label htmlFor="ops-trending-boost">Boost (0.01–100)</label>
          <input
            id="ops-trending-boost"
            className="ops-mono"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={boost}
            onChange={(event) => setBoost(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="ops-trending-confirm">Type {TRENDING_BOOST_CONFIRMATION}</label>
          <input
            id="ops-trending-confirm"
            className="ops-confirm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
      </div>

      <ActionBanner state={actionState} />
      <div className="ops-actions">
        <button
          className="public-button public-button-primary"
          type="button"
          disabled={!isTrendingBoostReady({
            annotationId,
            typedConfirm: confirm,
            action: "set",
            boost,
          }) || actionState.status === "working"}
          onClick={() => void runBoost("set")}
        >
          Set boost
        </button>
        <button
          className="public-button public-button-secondary"
          type="button"
          disabled={!isTrendingBoostReady({
            annotationId,
            typedConfirm: confirm,
            action: "clear",
            boost,
          }) || actionState.status === "working"}
          onClick={() => void runBoost("clear")}
        >
          Clear boost
        </button>
      </div>

      <ActionBanner state={loadState} />
      {boosts.length === 0 && loadState.status !== "working" && loadState.status !== "error" ? (
        <p className="ops-empty">No active trending boosts.</p>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <caption className="visually-hidden">Active trending boosts</caption>
            <thead>
              <tr>
                <th scope="col">Annotation</th>
                <th scope="col">Boost</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {boosts.map((row) => (
                <tr key={row.annotationId}>
                  <td>
                    <button
                      className="ops-row-button"
                      type="button"
                      onClick={() => setAnnotationId(row.annotationId)}
                    >
                      {row.annotationId}
                    </button>
                  </td>
                  <td>{row.boost}</td>
                  <td>{formatTimestamp(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
