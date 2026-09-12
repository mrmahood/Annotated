import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANNOTATION_HIDE_CONFIRMATION,
  ANNOTATION_REMOVE_CONFIRMATION,
  ANNOTATION_UNHIDE_CONFIRMATION,
  CLAIM_REVIEW_CONFIRMATION,
  MODERATION_CONFIRMATION,
  parseAnnotationHideRequest,
  parseAnnotationRemoveRequest,
  parseAnnotationUnhideRequest,
  parseClaimReviewUpdateRequest,
  parseMediaOnlyWithdrawalRequest,
} from "./moderation.ts";
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
  canAccessOperatorConsole,
  claimReviewActionsForStatus,
  claimReviewGetPath,
  claimReviewListPath,
  isAnnotationHideReady,
  isAnnotationRemoveReady,
  isAnnotationUnhideReady,
  isClaimReviewActionEnabled,
  isMediaOnlyWithdrawReady,
  isTypedConfirmationReady,
  parseBoundedModerationError,
  parseOpsClaim,
  parseOpsClaimList,
} from "./ops-console.ts";

const operatorId = "f4000000-0000-4000-8000-000000000002";
const annotationId = "f4100000-0000-4000-8000-000000000001";
const mediaId = "f4300000-0000-4000-8000-000000000001";
const claimId = "f4400000-0000-4000-8000-000000000001";

test("operator console gate is fail-closed and never trusts a client-supplied id", () => {
  assert.equal(canAccessOperatorConsole(null, {
    ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
  }), false);
  assert.equal(canAccessOperatorConsole({ id: operatorId, email: "matt@example.test" }, {}), false);
  assert.equal(canAccessOperatorConsole({ id: operatorId, email: "matt@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: "not-a-uuid",
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "not-an-email",
  }), false);
  assert.equal(canAccessOperatorConsole({ id: annotationId, email: "other@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "matt@example.test",
  }), false);
  assert.equal(canAccessOperatorConsole({ id: operatorId, email: "other@example.test" }, {
    ANNOTATED_MODERATION_OPERATOR_IDS: operatorId,
  }), true);
  assert.equal(canAccessOperatorConsole({ id: annotationId, email: "Matt@Example.TEST" }, {
    ANNOTATED_MODERATION_OPERATOR_EMAILS: "matt@example.test",
  }), true);
});

test("typed confirmation enablement is exact and required before claim or annotation actions", () => {
  assert.equal(isTypedConfirmationReady("", CLAIM_REVIEW_CONFIRMATION), false);
  assert.equal(isTypedConfirmationReady("claim_review_update", CLAIM_REVIEW_CONFIRMATION), false);
  assert.equal(isTypedConfirmationReady(` ${CLAIM_REVIEW_CONFIRMATION}`, CLAIM_REVIEW_CONFIRMATION), false);
  assert.equal(isTypedConfirmationReady(CLAIM_REVIEW_CONFIRMATION, CLAIM_REVIEW_CONFIRMATION), true);

  assert.deepEqual(claimReviewActionsForStatus("submitted"), ["reviewing", "rejected"]);
  assert.deepEqual(claimReviewActionsForStatus("reviewing"), ["resolved", "rejected"]);
  assert.deepEqual(claimReviewActionsForStatus("resolved"), []);
  assert.deepEqual(claimReviewActionsForStatus("rejected"), []);

  assert.equal(isClaimReviewActionEnabled("submitted", "reviewing", ""), false);
  assert.equal(isClaimReviewActionEnabled("submitted", "resolved", CLAIM_REVIEW_CONFIRMATION), false);
  assert.equal(isClaimReviewActionEnabled("submitted", "reviewing", CLAIM_REVIEW_CONFIRMATION), true);
  assert.equal(isClaimReviewActionEnabled("reviewing", "resolved", CLAIM_REVIEW_CONFIRMATION), true);
  assert.equal(isClaimReviewActionEnabled("resolved", "rejected", CLAIM_REVIEW_CONFIRMATION), false);

  const readyIds = { annotationId, mediaId, claimId: "" };
  assert.equal(isMediaOnlyWithdrawReady({ ...readyIds, typedConfirm: "" }), false);
  assert.equal(isMediaOnlyWithdrawReady({ ...readyIds, mediaId: "", typedConfirm: MODERATION_CONFIRMATION }), false);
  assert.equal(isMediaOnlyWithdrawReady({ ...readyIds, typedConfirm: MODERATION_CONFIRMATION }), true);
  assert.equal(isAnnotationHideReady({ annotationId, claimId: "", typedConfirm: ANNOTATION_HIDE_CONFIRMATION }), true);
  assert.equal(isAnnotationHideReady({ annotationId: "not-a-uuid", claimId: "", typedConfirm: ANNOTATION_HIDE_CONFIRMATION }), false);
  assert.equal(isAnnotationUnhideReady({ annotationId, claimId: "", typedConfirm: ANNOTATION_UNHIDE_CONFIRMATION }), true);
  assert.equal(isAnnotationRemoveReady({
    annotationId,
    claimId: "",
    typedConfirm: ANNOTATION_REMOVE_CONFIRMATION,
    resolveClaim: false,
  }), true);
  assert.equal(isAnnotationRemoveReady({
    annotationId,
    claimId: "",
    typedConfirm: ANNOTATION_REMOVE_CONFIRMATION,
    resolveClaim: true,
  }), false);
  assert.equal(isAnnotationRemoveReady({
    annotationId,
    claimId,
    typedConfirm: ANNOTATION_REMOVE_CONFIRMATION,
    resolveClaim: true,
  }), true);
});

test("operator console request bodies match the existing moderation parsers", () => {
  assert.deepEqual(
    parseClaimReviewUpdateRequest(buildClaimReviewUpdateBody({
      toStatus: "reviewing",
      operatorNotes: "",
      includeClaimantPii: false,
    })),
    { toStatus: "reviewing", operatorNotes: null, clearOperatorNotes: false, includeClaimantPii: false },
  );
  assert.deepEqual(
    parseClaimReviewUpdateRequest(buildClaimReviewUpdateBody({
      toStatus: "rejected",
      operatorNotes: "  spam  ",
      includeClaimantPii: true,
    })),
    { toStatus: "rejected", operatorNotes: "spam", clearOperatorNotes: false, includeClaimantPii: true },
  );
  assert.deepEqual(
    parseMediaOnlyWithdrawalRequest(buildMediaOnlyWithdrawalBody({
      annotationId,
      mediaId,
      reasonCode: "copyright",
      claimId: "",
    })),
    { annotationId, mediaId, reasonCode: "copyright", claimId: null },
  );
  assert.deepEqual(
    parseMediaOnlyWithdrawalRequest(buildMediaOnlyWithdrawalBody({
      annotationId,
      mediaId,
      reasonCode: "excerpt_claim",
      claimId,
    })),
    { annotationId, mediaId, reasonCode: "excerpt_claim", claimId },
  );
  assert.deepEqual(
    parseAnnotationHideRequest(buildAnnotationHideBody({
      reasonCode: "commentary",
      claimId: "",
    }), annotationId),
    { annotationId, reasonCode: "commentary", claimId: null },
  );
  assert.deepEqual(
    parseAnnotationUnhideRequest(buildAnnotationUnhideBody({
      reasonCode: "operator_request",
      claimId,
    }), annotationId),
    { annotationId, reasonCode: "operator_request", claimId },
  );
  assert.deepEqual(
    parseAnnotationRemoveRequest(buildAnnotationRemoveBody({
      reasonCode: "copyright",
      claimId,
      resolveClaim: true,
    }), annotationId),
    { annotationId, reasonCode: "copyright", claimId, resolveClaim: true },
  );
  assert.equal(claimReviewListPath(false), "/api/moderation/claims");
  assert.equal(claimReviewListPath(true), "/api/moderation/claims?includeClaimantPii=true");
  assert.equal(claimReviewGetPath(claimId, true), `/api/moderation/claims/${claimId}?includeClaimantPii=true`);
  assert.equal(annotationHidePath(annotationId), `/api/moderation/annotations/${annotationId}/hide`);
  assert.equal(annotationUnhidePath(annotationId), `/api/moderation/annotations/${annotationId}/unhide`);
  assert.equal(annotationRemovePath(annotationId), `/api/moderation/annotations/${annotationId}/remove`);
  assert.equal(MEDIA_ONLY_WITHDRAWAL_PATH, "/api/moderation/media-only-withdrawal");
});

test("claim list JSON omits claimant PII unless the public payload includes it", () => {
  const listed = parseOpsClaimList({
    claims: [{
      claimId,
      annotationId,
      status: "submitted",
      relationshipToContent: "rights holder",
      reason: "Please review excerpt A.",
      operatorNotes: null,
      createdAt: "2026-09-04T02:01:00.000Z",
      updatedAt: "2026-09-04T02:01:00.000Z",
    }],
  });
  assert.equal(listed?.length, 1);
  assert.equal(Object.hasOwn(listed[0], "claimantEmail"), false);
  assert.equal(JSON.stringify(listed).includes("@"), false);
  const withPii = parseOpsClaim({
    ...listed[0],
    claimantName: "F2 Claimant A",
    claimantEmail: "f2-claimant-a@example.test",
    details: "Private details",
  });
  assert.equal(withPii?.claimantEmail, "f2-claimant-a@example.test");
  assert.equal(parseBoundedModerationError({ error: "FORBIDDEN" }), "FORBIDDEN");
  assert.equal(parseBoundedModerationError({ message: "secret" }), "UNAVAILABLE");
});

test("ops route is gated with notFound and is not linked from public navigation", async () => {
  const [page, header, consoleSource, routes, styles] = await Promise.all([
    readFile(new URL("../app/ops/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ops/ops-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /notFound\(\)/);
  assert.match(page, /canAccessOperatorConsole/);
  assert.match(page, /getUser\(\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.doesNotMatch(page, /href="\/ops"/);
  assert.doesNotMatch(header, /\/ops|\/moderation/);
  assert.match(header, /site-feed-link/);
  assert.match(consoleSource, /isClaimReviewActionEnabled/);
  assert.match(consoleSource, /isMediaOnlyWithdrawReady/);
  assert.match(consoleSource, /isAnnotationHideReady/);
  assert.match(consoleSource, /isAnnotationUnhideReady/);
  assert.match(consoleSource, /isAnnotationRemoveReady/);
  assert.match(consoleSource, /claimReviewListPath/);
  assert.match(consoleSource, /includeClaimantPii/);
  assert.match(consoleSource, /CLAIM_REVIEW_CONFIRMATION/);
  assert.match(consoleSource, /MODERATION_CONFIRMATION/);
  assert.match(consoleSource, /ANNOTATION_HIDE_CONFIRMATION/);
  assert.match(consoleSource, /ANNOTATION_UNHIDE_CONFIRMATION/);
  assert.match(consoleSource, /ANNOTATION_REMOVE_CONFIRMATION/);
  assert.match(consoleSource, /TRENDING_BOOST_CONFIRMATION/);
  assert.match(consoleSource, /Set boost/);
  assert.match(consoleSource, /Authorization/);
  assert.doesNotMatch(consoleSource + page, /SUPABASE_SERVICE_ROLE_KEY|createServiceClient/);
  assert.match(routes, /"ops"/);
  assert.match(styles, /\.ops-main/);
  assert.match(styles, /\.ops-confirm/);
});
