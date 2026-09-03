import assert from "node:assert/strict";
import test from "node:test";
import {
  MEDIA_ONLY_REASON_CODES,
  MODERATION_CONFIRMATION,
  ModerationApiError,
  boundedModerationLog,
  getModerationOperatorAllowlist,
  isAllowlistedModerationOperator,
  isModerationAllowlistConfigured,
  mapModerationRpcError,
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
});
