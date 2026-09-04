import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATION_HIDE_CONFIRMATION,
  ANNOTATION_MODERATION_REASON_CODES,
  ANNOTATION_REMOVE_CONFIRMATION,
  ANNOTATION_UNHIDE_CONFIRMATION,
  CLAIM_REVIEW_CONFIRMATION,
  MEDIA_ONLY_REASON_CODES,
  MODERATION_CONFIRMATION,
  ModerationApiError,
  assertModerationOperatorAllowlist,
  boundedAnnotationModerationLog,
  boundedClaimReviewLog,
  boundedModerationLog,
  claimReviewPublicJson,
  getModerationOperatorAllowlist,
  isAllowlistedModerationOperator,
  isModerationAllowlistConfigured,
  mapModerationRpcError,
  parseAnnotationHideRequest,
  parseAnnotationHideResult,
  parseAnnotationRemoveRequest,
  parseAnnotationRemoveResult,
  parseAnnotationUnhideRequest,
  parseAnnotationUnhideResult,
  parseClaimReviewGetInput,
  parseClaimReviewListQuery,
  parseClaimReviewListResult,
  parseClaimReviewUpdateRequest,
  parseClaimReviewUpdateResult,
  parseMediaOnlyWithdrawalRequest,
  parseMediaOnlyWithdrawalResult,
} from "./moderation.ts";

const annotationId = "f4100000-0000-4000-8000-000000000001";
const mediaId = "f4300000-0000-4000-8000-000000000001";
const operatorId = "f4000000-0000-4000-8000-000000000002";
const claimId = "f4400000-0000-4000-8000-000000000001";

test("media-only request requires confirmation and rejects client-supplied operator identity", () => {
  assert.deepEqual(
    parseMediaOnlyWithdrawalRequest({
      annotationId,
      mediaId,
      reasonCode: "copyright",
      confirm: MODERATION_CONFIRMATION,
    }),
    { annotationId, mediaId, reasonCode: "copyright", claimId: null },
  );
  assert.deepEqual(
    parseMediaOnlyWithdrawalRequest({
      annotationId,
      mediaId,
      reasonCode: "excerpt_claim",
      confirm: MODERATION_CONFIRMATION,
      claimId,
    }),
    { annotationId, mediaId, reasonCode: "excerpt_claim", claimId },
  );
  for (const invalid of [
    null,
    {},
    { annotationId, mediaId, reasonCode: "copyright" },
    { annotationId, mediaId, reasonCode: "copyright", confirm: "yes" },
    { annotationId, mediaId, reasonCode: "copyright", confirm: MODERATION_CONFIRMATION, operatorId },
    { annotationId, mediaId, reasonCode: "copyright", confirm: MODERATION_CONFIRMATION, actorId: operatorId },
    { annotationId, mediaId, reasonCode: "copyright", confirm: MODERATION_CONFIRMATION, email: "matt@example.test" },
    { annotationId, mediaId, reasonCode: "vote_score", confirm: MODERATION_CONFIRMATION },
    { annotationId, mediaId, reasonCode: "copyright", confirm: MODERATION_CONFIRMATION, claimId: "not-a-uuid" },
  ]) {
    assert.throws(
      () => parseMediaOnlyWithdrawalRequest(invalid),
      (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
    );
  }
  assert.deepEqual(MEDIA_ONLY_REASON_CODES, ["copyright", "excerpt_claim", "operator_request"]);
});

test("operator allowlist is fail-closed and never trusts a client-supplied id", () => {
  assert.equal(isModerationAllowlistConfigured({}), false);
  assert.equal(isAllowlistedModerationOperator({ id: operatorId, email: "matt@example.test" }, {}), false);
  assert.equal(isAllowlistedModerationOperator({ id: operatorId, email: "matt@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: "not-a-uuid",
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "not-an-email",
  }), false);
  assert.equal(isAllowlistedModerationOperator({ id: operatorId, email: "matt@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
  }), true);
  assert.equal(isAllowlistedModerationOperator({ id: operatorId, email: "Matt@Example.TEST" }, {
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "matt@example.test",
  }), true);
  assert.equal(isAllowlistedModerationOperator({ id: annotationId, email: "other@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "matt@example.test",
  }), false);
  const allowlist = getModerationOperatorAllowlist({
    ANNOTATED_MODERATION_OPERATOR_IDS: `${operatorId}, ${operatorId}`,
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "matt@example.test, second@example.test",
  });
  assert.equal(allowlist.ids.size, 1);
  assert.equal(allowlist.emails.size, 2);
});

test("withdrawal results and logs stay on the allow-listed field set", () => {
  const result = parseMediaOnlyWithdrawalResult([{
    annotation_id: annotationId,
    media_id: mediaId,
    claim_id: claimId,
    reason_code: "copyright",
    result_code: "withdrawn",
    removed_at: "2026-09-03T00:00:00.000Z",
    audit_id: "f4500000-0000-4000-8000-000000000001",
    annotation_status: "published",
    processing_status: "removed",
    transcript_content_cleared: true,
  }]);
  const log = boundedModerationLog(result);
  assert.deepEqual(Object.keys(log).sort(), [
    "annotationId",
    "annotationStatus",
    "auditId",
    "claimId",
    "mediaId",
    "processingStatus",
    "reasonCode",
    "resultCode",
    "transcriptContentCleared",
  ]);
  assert.equal(JSON.stringify(log).includes("excerpt"), false);
  assert.equal(JSON.stringify(log).includes("@"), false);
  const stripped = parseMediaOnlyWithdrawalResult([{
    annotation_id: annotationId,
    media_id: mediaId,
    claim_id: claimId,
    reason_code: "copyright",
    result_code: "withdrawn",
    removed_at: "2026-09-03T00:00:00.000Z",
    audit_id: "f4500000-0000-4000-8000-000000000001",
    annotation_status: "published",
    processing_status: "removed",
    transcript_content_cleared: true,
    transcript_text: "secret excerpt",
    claimant_email: "f4-claimant@example.test",
  }]);
  assert.equal(JSON.stringify(boundedModerationLog(stripped)).includes("secret excerpt"), false);
  assert.equal(JSON.stringify(boundedModerationLog(stripped)).includes("f4-claimant@example.test"), false);
});

test("RPC errors stay bounded and never surface claimant or transcript payloads", () => {
  assert.equal(mapModerationRpcError({ code: "42501" }).code, "FORBIDDEN");
  assert.equal(mapModerationRpcError({ code: "22023" }).code, "INVALID_REQUEST");
  assert.equal(mapModerationRpcError({ code: "55000", message: "f4-claimant@example.test" }).code, "WITHDRAWAL_UNAVAILABLE");
  assert.equal(mapModerationRpcError({ code: "55000", message: "f4-claimant@example.test" }).message, "WITHDRAWAL_UNAVAILABLE");
  assert.equal(
    mapModerationRpcError({ code: "55000", message: "f2-claimant-a@example.test" }, "CLAIM_REVIEW_UNAVAILABLE").code,
    "CLAIM_REVIEW_UNAVAILABLE",
  );
  assert.equal(
    mapModerationRpcError({ code: "55000", message: "f3-claimant@example.test" }, "ANNOTATION_MODERATION_UNAVAILABLE").code,
    "ANNOTATION_MODERATION_UNAVAILABLE",
  );
});

const reviewClaimId = "f2400000-0000-4000-8000-000000000001";
const reviewAnnotationId = "f2100000-0000-4000-8000-000000000001";

test("claim review list query is exact, paginated, and rejects client-supplied operator identity", () => {
  assert.deepEqual(parseClaimReviewListQuery(new URLSearchParams()), {
    status: null,
    includeClaimantPii: false,
    limit: 50,
    afterCreatedAt: null,
    afterId: null,
  });
  assert.deepEqual(parseClaimReviewListQuery(new URLSearchParams({
    status: "submitted",
    limit: "2",
    afterCreatedAt: "2026-09-04T02:02:00.000Z",
    afterId: reviewClaimId,
    includeClaimantPii: "true",
  })), {
    status: "submitted",
    includeClaimantPii: true,
    limit: 2,
    afterCreatedAt: "2026-09-04T02:02:00.000Z",
    afterId: reviewClaimId,
  });
  for (const invalid of [
    new URLSearchParams({ operatorId: operatorId }),
    new URLSearchParams({ actorId: operatorId }),
    new URLSearchParams({ email: "matt@example.test" }),
    new URLSearchParams({ status: "vote_score" }),
    new URLSearchParams({ includeClaimantPii: "false" }),
    new URLSearchParams({ afterId: reviewClaimId }),
    new URLSearchParams({ afterCreatedAt: "2026-09-04T02:02:00.000Z" }),
    new URLSearchParams({ limit: "0" }),
    new URLSearchParams({ limit: "101" }),
  ]) {
    assert.throws(
      () => parseClaimReviewListQuery(invalid),
      (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
    );
  }
});

test("claim get and update require confirmation and never accept operator identity from the client", () => {
  assert.deepEqual(
    parseClaimReviewGetInput(reviewClaimId, new URLSearchParams()),
    { claimId: reviewClaimId, includeClaimantPii: false },
  );
  assert.deepEqual(
    parseClaimReviewGetInput(reviewClaimId, new URLSearchParams({ includeClaimantPii: "true" })),
    { claimId: reviewClaimId, includeClaimantPii: true },
  );
  assert.throws(
    () => parseClaimReviewGetInput(reviewClaimId, new URLSearchParams({ operatorId })),
    (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
  );
  assert.deepEqual(
    parseClaimReviewUpdateRequest({
      toStatus: "reviewing",
      confirm: CLAIM_REVIEW_CONFIRMATION,
    }),
    { toStatus: "reviewing", operatorNotes: null, clearOperatorNotes: false, includeClaimantPii: false },
  );
  assert.deepEqual(
    parseClaimReviewUpdateRequest({
      toStatus: "rejected",
      confirm: CLAIM_REVIEW_CONFIRMATION,
      operatorNotes: "  spam  ",
    }),
    { toStatus: "rejected", operatorNotes: "spam", clearOperatorNotes: false, includeClaimantPii: false },
  );
  for (const invalid of [
    { toStatus: "reviewing" },
    { toStatus: "reviewing", confirm: "yes" },
    { toStatus: "submitted", confirm: CLAIM_REVIEW_CONFIRMATION },
    { toStatus: "reviewing", confirm: CLAIM_REVIEW_CONFIRMATION, operatorId },
    { toStatus: "reviewing", confirm: CLAIM_REVIEW_CONFIRMATION, actorId: operatorId },
    { toStatus: "reviewing", confirm: CLAIM_REVIEW_CONFIRMATION, email: "matt@example.test" },
    {
      toStatus: "reviewing",
      confirm: CLAIM_REVIEW_CONFIRMATION,
      operatorNotes: "note",
      clearOperatorNotes: true,
    },
  ]) {
    assert.throws(
      () => parseClaimReviewUpdateRequest(invalid),
      (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
    );
  }
});

test("claim review responses omit claimant PII unless explicitly requested", () => {
  const listed = parseClaimReviewListResult([{
    claim_id: reviewClaimId,
    annotation_id: reviewAnnotationId,
    status: "submitted",
    relationship_to_content: "rights holder",
    reason: "Please review excerpt A.",
    operator_notes: null,
    created_at: "2026-09-04T02:01:00.000Z",
    updated_at: "2026-09-04T02:01:00.000Z",
    claimant_name: null,
    claimant_email: null,
    details: null,
    claimant_email_extra: "f2-claimant-a@example.test",
  }]);
  const publicJson = claimReviewPublicJson(listed[0], false);
  assert.equal(Object.hasOwn(publicJson, "claimantEmail"), false);
  assert.equal(Object.hasOwn(publicJson, "claimantName"), false);
  assert.equal(Object.hasOwn(publicJson, "details"), false);
  assert.equal(JSON.stringify(publicJson).includes("@"), false);
  const withPii = claimReviewPublicJson({
    ...listed[0],
    claimantName: "F2 Claimant A",
    claimantEmail: "f2-claimant-a@example.test",
    details: "Private details",
  }, true);
  assert.equal(withPii.claimantEmail, "f2-claimant-a@example.test");
  const updated = parseClaimReviewUpdateResult([{
    claim_id: reviewClaimId,
    annotation_id: reviewAnnotationId,
    status: "reviewing",
    previous_status: "submitted",
    relationship_to_content: "rights holder",
    reason: "Please review excerpt A.",
    operator_notes: "Moving A into review.",
    created_at: "2026-09-04T02:01:00.000Z",
    updated_at: "2026-09-04T02:05:00.000Z",
    claimant_name: null,
    claimant_email: "f2-claimant-a@example.test",
    details: null,
    audit_id: "f2500000-0000-4000-8000-000000000001",
    result_code: "reviewing",
  }]);
  const log = boundedClaimReviewLog(updated);
  assert.equal(JSON.stringify(log).includes("f2-claimant-a@example.test"), false);
  assert.equal(JSON.stringify(log).includes("Private"), false);
  assert.equal(JSON.stringify(claimReviewPublicJson(updated, false)).includes("@"), false);
});

test("claim review allowlist gating matches F4 fail-closed behavior", () => {
  assert.throws(
    () => assertModerationOperatorAllowlist({ id: operatorId, email: "matt@example.test" }, {}),
    (error) => error instanceof ModerationApiError && error.code === "SERVER_MISCONFIGURED" && error.status === 500,
  );
  assert.throws(
    () => assertModerationOperatorAllowlist({ id: annotationId, email: "other@example.test" }, {
      ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
    }),
    (error) => error instanceof ModerationApiError && error.code === "FORBIDDEN" && error.status === 403,
  );
  assert.doesNotThrow(() => assertModerationOperatorAllowlist(
    { id: operatorId, email: "matt@example.test" },
    { ANNOTATED_MODERATION_OPERATOR_IDS: operatorId },
  ));
});

const hideAnnotationId = "f3100000-0000-4000-8000-000000000001";
const hideClaimId = "f3400000-0000-4000-8000-000000000001";

test("hide and unhide require confirmation and reject client-supplied operator identity", () => {
  assert.deepEqual(
    parseAnnotationHideRequest({
      reasonCode: "commentary",
      confirm: ANNOTATION_HIDE_CONFIRMATION,
    }, hideAnnotationId),
    { annotationId: hideAnnotationId, reasonCode: "commentary", claimId: null },
  );
  assert.deepEqual(
    parseAnnotationHideRequest({
      reasonCode: "excerpt_claim",
      confirm: ANNOTATION_HIDE_CONFIRMATION,
      claimId: hideClaimId,
    }, hideAnnotationId),
    { annotationId: hideAnnotationId, reasonCode: "excerpt_claim", claimId: hideClaimId },
  );
  assert.deepEqual(
    parseAnnotationUnhideRequest({
      reasonCode: "operator_request",
      confirm: ANNOTATION_UNHIDE_CONFIRMATION,
    }, hideAnnotationId),
    { annotationId: hideAnnotationId, reasonCode: "operator_request", claimId: null },
  );
  for (const invalid of [
    [{ reasonCode: "commentary" }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: "yes" }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION, operatorId }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION, actorId: operatorId }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION, email: "matt@example.test" }, hideAnnotationId],
    [{ reasonCode: "vote_score", confirm: ANNOTATION_HIDE_CONFIRMATION }, hideAnnotationId],
    [{ reasonCode: "operator_request", confirm: ANNOTATION_UNHIDE_CONFIRMATION }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION, annotationId: hideAnnotationId }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION }, "not-a-uuid"],
  ]) {
    assert.throws(
      () => parseAnnotationHideRequest(invalid[0], invalid[1]),
      (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
    );
  }
  assert.throws(
    () => parseAnnotationUnhideRequest({
      reasonCode: "operator_request",
      confirm: ANNOTATION_UNHIDE_CONFIRMATION,
      operatorId,
    }, hideAnnotationId),
    (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
  );
  assert.deepEqual(
    parseAnnotationRemoveRequest({
      reasonCode: "commentary",
      confirm: ANNOTATION_REMOVE_CONFIRMATION,
    }, hideAnnotationId),
    { annotationId: hideAnnotationId, reasonCode: "commentary", claimId: null, resolveClaim: false },
  );
  assert.deepEqual(
    parseAnnotationRemoveRequest({
      reasonCode: "commentary",
      confirm: ANNOTATION_REMOVE_CONFIRMATION,
      claimId: hideClaimId,
      resolveClaim: true,
    }, hideAnnotationId),
    {
      annotationId: hideAnnotationId,
      reasonCode: "commentary",
      claimId: hideClaimId,
      resolveClaim: true,
    },
  );
  for (const invalid of [
    [{ reasonCode: "commentary" }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: "yes" }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, operatorId }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, actorId: operatorId }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, email: "matt@example.test" }, hideAnnotationId],
    [{ reasonCode: "vote_score", confirm: ANNOTATION_REMOVE_CONFIRMATION }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_HIDE_CONFIRMATION }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, resolveClaim: true }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, claimId: null, resolveClaim: true }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, resolveClaim: false }, hideAnnotationId],
    [{ reasonCode: "commentary", confirm: ANNOTATION_REMOVE_CONFIRMATION, annotationId: hideAnnotationId }, hideAnnotationId],
  ]) {
    assert.throws(
      () => parseAnnotationRemoveRequest(invalid[0], invalid[1]),
      (error) => error instanceof ModerationApiError && error.code === "INVALID_REQUEST",
    );
  }
  assert.deepEqual(
    ANNOTATION_MODERATION_REASON_CODES,
    ["copyright", "excerpt_claim", "operator_request", "commentary"],
  );
});

test("hide and unhide results stay on the allow-listed field set", () => {
  const hidden = parseAnnotationHideResult([{
    annotation_id: hideAnnotationId,
    media_id: mediaId,
    claim_id: hideClaimId,
    reason_code: "commentary",
    result_code: "hidden",
    audit_id: "f3500000-0000-4000-8000-000000000001",
    annotation_status: "hidden",
    previous_status: "published",
    processing_status: "ready",
    transcript_text: "secret excerpt",
    claimant_email: "f3-claimant@example.test",
  }]);
  const hideLog = boundedAnnotationModerationLog(hidden);
  assert.equal(hideLog.resultCode, "hidden");
  assert.equal(JSON.stringify(hideLog).includes("secret excerpt"), false);
  assert.equal(JSON.stringify(hideLog).includes("@"), false);
  const unhidden = parseAnnotationUnhideResult([{
    annotation_id: hideAnnotationId,
    media_id: mediaId,
    claim_id: null,
    reason_code: "operator_request",
    result_code: "unhidden",
    audit_id: "f3500000-0000-4000-8000-000000000002",
    annotation_status: "published",
    previous_status: "hidden",
    processing_status: "removed",
    transcript_content_restored: false,
    transcript_text: "secret excerpt",
    claimant_email: "f3-claimant@example.test",
  }]);
  assert.equal(unhidden.transcriptContentRestored, false);
  assert.equal(JSON.stringify(boundedAnnotationModerationLog(unhidden)).includes("secret excerpt"), false);
  assert.throws(
    () => parseAnnotationUnhideResult([{
      annotation_id: hideAnnotationId,
      media_id: mediaId,
      claim_id: null,
      reason_code: "operator_request",
      result_code: "unhidden",
      audit_id: "f3500000-0000-4000-8000-000000000002",
      annotation_status: "published",
      previous_status: "hidden",
      processing_status: "removed",
      transcript_content_restored: true,
    }]),
    (error) => error instanceof ModerationApiError && error.code === "ANNOTATION_MODERATION_UNAVAILABLE",
  );
});

test("remove requires confirmation, optional resolveClaim, and never leaks claimant PII", () => {
  const removed = parseAnnotationRemoveResult([{
    annotation_id: hideAnnotationId,
    media_id: mediaId,
    claim_id: hideClaimId,
    reason_code: "commentary",
    result_code: "removed",
    audit_id: "f5500000-0000-4000-8000-000000000001",
    annotation_status: "removed",
    previous_status: "published",
    processing_status: "removed",
    transcript_content_cleared: true,
    claim_status: "resolved",
    claim_resolved: true,
    transcript_text: "secret excerpt",
    claimant_email: "f5-claimant@example.test",
    claimant_name: "F5 Claimant",
    details: "Private details",
  }]);
  const removeLog = boundedAnnotationModerationLog(removed);
  assert.equal(removed.resultCode, "removed");
  assert.equal(removed.claimResolved, true);
  assert.equal(removed.claimStatus, "resolved");
  assert.equal(JSON.stringify(removeLog).includes("secret excerpt"), false);
  assert.equal(JSON.stringify(removeLog).includes("@"), false);
  assert.equal(JSON.stringify(removeLog).includes("Private details"), false);
  assert.deepEqual(Object.keys(removeLog).sort(), [
    "annotationId",
    "annotationStatus",
    "auditId",
    "claimId",
    "claimResolved",
    "claimStatus",
    "mediaId",
    "previousStatus",
    "processingStatus",
    "reasonCode",
    "resultCode",
    "transcriptContentCleared",
  ]);
  const already = parseAnnotationRemoveResult([{
    annotation_id: hideAnnotationId,
    media_id: mediaId,
    claim_id: hideClaimId,
    reason_code: "commentary",
    result_code: "already_removed",
    audit_id: "f5500000-0000-4000-8000-000000000001",
    annotation_status: "removed",
    previous_status: "removed",
    processing_status: "removed",
    transcript_content_cleared: true,
    claim_status: "submitted",
    claim_resolved: false,
  }]);
  assert.equal(already.resultCode, "already_removed");
  assert.equal(already.claimResolved, false);
});
