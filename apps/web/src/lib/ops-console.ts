import { isUuid } from "./public-content.ts";
import {
  ANNOTATION_HIDE_CONFIRMATION,
  ANNOTATION_REMOVE_CONFIRMATION,
  ANNOTATION_UNHIDE_CONFIRMATION,
  CLAIM_REVIEW_CONFIRMATION,
  CLAIM_REVIEW_STATUSES,
  MODERATION_CONFIRMATION,
  isAllowlistedModerationOperator,
  type AnnotationModerationReasonCode,
  type ClaimReviewStatus,
  type ClaimReviewToStatus,
  type MediaOnlyReasonCode,
  type MediaOnlyWithdrawalInput,
} from "./moderation.ts";

export const OPS_CONSOLE_PATH = "/ops";

export type OpsSessionUser = {
  id: string;
  email?: string | null;
};

export type OpsClaim = {
  claimId: string;
  annotationId: string;
  status: ClaimReviewStatus;
  relationshipToContent: string;
  reason: string;
  operatorNotes: string | null;
  createdAt: string;
  updatedAt: string;
  claimantName?: string | null;
  claimantEmail?: string | null;
  details?: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaimReviewStatus(value: unknown): value is ClaimReviewStatus {
  return typeof value === "string"
    && (CLAIM_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function canAccessOperatorConsole(
  user: OpsSessionUser | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!user) return false;
  return isAllowlistedModerationOperator(user, env);
}

export function isTypedConfirmationReady(typed: string, expected: string): boolean {
  return typed === expected;
}

export function claimReviewActionsForStatus(
  status: ClaimReviewStatus,
): ClaimReviewToStatus[] {
  if (status === "submitted") return ["reviewing", "rejected"];
  if (status === "reviewing") return ["resolved", "rejected"];
  return [];
}

export function isClaimReviewActionEnabled(
  status: ClaimReviewStatus,
  toStatus: ClaimReviewToStatus,
  typedConfirm: string,
): boolean {
  return claimReviewActionsForStatus(status).includes(toStatus)
    && isTypedConfirmationReady(typedConfirm, CLAIM_REVIEW_CONFIRMATION);
}

export function claimReviewListPath(includeClaimantPii: boolean): string {
  return includeClaimantPii
    ? "/api/moderation/claims?includeClaimantPii=true"
    : "/api/moderation/claims";
}

export function claimReviewGetPath(
  claimId: string,
  includeClaimantPii: boolean,
): string {
  const path = `/api/moderation/claims/${claimId}`;
  return includeClaimantPii ? `${path}?includeClaimantPii=true` : path;
}

export function annotationHidePath(annotationId: string): string {
  return `/api/moderation/annotations/${annotationId}/hide`;
}

export function annotationUnhidePath(annotationId: string): string {
  return `/api/moderation/annotations/${annotationId}/unhide`;
}

export function annotationRemovePath(annotationId: string): string {
  return `/api/moderation/annotations/${annotationId}/remove`;
}

export const MEDIA_ONLY_WITHDRAWAL_PATH = "/api/moderation/media-only-withdrawal";

export function buildClaimReviewUpdateBody(input: {
  toStatus: ClaimReviewToStatus;
  operatorNotes: string;
  includeClaimantPii: boolean;
}): {
  toStatus: ClaimReviewToStatus;
  confirm: typeof CLAIM_REVIEW_CONFIRMATION;
  operatorNotes?: string;
  includeClaimantPii?: true;
} {
  const body: {
    toStatus: ClaimReviewToStatus;
    confirm: typeof CLAIM_REVIEW_CONFIRMATION;
    operatorNotes?: string;
    includeClaimantPii?: true;
  } = {
    toStatus: input.toStatus,
    confirm: CLAIM_REVIEW_CONFIRMATION,
  };
  const notes = input.operatorNotes.trim();
  if (notes) body.operatorNotes = notes;
  if (input.includeClaimantPii) body.includeClaimantPii = true;
  return body;
}

export function buildMediaOnlyWithdrawalBody(input: {
  annotationId: string;
  mediaId: string;
  reasonCode: MediaOnlyReasonCode;
  claimId: string;
}): MediaOnlyWithdrawalInput & { confirm: typeof MODERATION_CONFIRMATION } {
  const body: MediaOnlyWithdrawalInput & { confirm: typeof MODERATION_CONFIRMATION } = {
    annotationId: input.annotationId,
    mediaId: input.mediaId,
    reasonCode: input.reasonCode,
    claimId: null,
    confirm: MODERATION_CONFIRMATION,
  };
  const claimId = input.claimId.trim();
  if (claimId) body.claimId = claimId;
  return body;
}

function annotationModerationRequestBody(
  confirm: typeof ANNOTATION_HIDE_CONFIRMATION
    | typeof ANNOTATION_UNHIDE_CONFIRMATION
    | typeof ANNOTATION_REMOVE_CONFIRMATION,
  input: {
    reasonCode: AnnotationModerationReasonCode;
    claimId: string;
    resolveClaim?: boolean;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    reasonCode: input.reasonCode,
    confirm,
  };
  const claimId = input.claimId.trim();
  if (claimId) body.claimId = claimId;
  if (input.resolveClaim) body.resolveClaim = true;
  return body;
}

export function buildAnnotationHideBody(input: {
  reasonCode: AnnotationModerationReasonCode;
  claimId: string;
}): Record<string, unknown> {
  return annotationModerationRequestBody(ANNOTATION_HIDE_CONFIRMATION, input);
}

export function buildAnnotationUnhideBody(input: {
  reasonCode: AnnotationModerationReasonCode;
  claimId: string;
}): Record<string, unknown> {
  return annotationModerationRequestBody(ANNOTATION_UNHIDE_CONFIRMATION, input);
}

export function buildAnnotationRemoveBody(input: {
  reasonCode: AnnotationModerationReasonCode;
  claimId: string;
  resolveClaim: boolean;
}): Record<string, unknown> {
  return annotationModerationRequestBody(ANNOTATION_REMOVE_CONFIRMATION, input);
}

export function isAnnotationUuidReady(value: string): boolean {
  return isUuid(value.trim());
}

export function isOptionalUuidReady(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || isUuid(trimmed);
}

export function isMediaOnlyWithdrawReady(input: {
  annotationId: string;
  mediaId: string;
  typedConfirm: string;
  claimId: string;
}): boolean {
  return isAnnotationUuidReady(input.annotationId)
    && isAnnotationUuidReady(input.mediaId)
    && isOptionalUuidReady(input.claimId)
    && isTypedConfirmationReady(input.typedConfirm, MODERATION_CONFIRMATION);
}

export function isAnnotationHideReady(input: {
  annotationId: string;
  typedConfirm: string;
  claimId: string;
}): boolean {
  return isAnnotationUuidReady(input.annotationId)
    && isOptionalUuidReady(input.claimId)
    && isTypedConfirmationReady(input.typedConfirm, ANNOTATION_HIDE_CONFIRMATION);
}

export function isAnnotationUnhideReady(input: {
  annotationId: string;
  typedConfirm: string;
  claimId: string;
}): boolean {
  return isAnnotationUuidReady(input.annotationId)
    && isOptionalUuidReady(input.claimId)
    && isTypedConfirmationReady(input.typedConfirm, ANNOTATION_UNHIDE_CONFIRMATION);
}

export function isAnnotationRemoveReady(input: {
  annotationId: string;
  typedConfirm: string;
  claimId: string;
  resolveClaim: boolean;
}): boolean {
  const claimId = input.claimId.trim();
  if (input.resolveClaim && !isUuid(claimId)) return false;
  return isAnnotationUuidReady(input.annotationId)
    && isOptionalUuidReady(input.claimId)
    && isTypedConfirmationReady(input.typedConfirm, ANNOTATION_REMOVE_CONFIRMATION);
}

export function parseOpsClaim(value: unknown): OpsClaim | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.claimId !== "string"
    || !isUuid(value.claimId)
    || typeof value.annotationId !== "string"
    || !isUuid(value.annotationId)
    || !isClaimReviewStatus(value.status)
    || typeof value.relationshipToContent !== "string"
    || typeof value.reason !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.operatorNotes !== null && typeof value.operatorNotes !== "string")
  ) {
    return null;
  }
  const claim: OpsClaim = {
    claimId: value.claimId,
    annotationId: value.annotationId,
    status: value.status,
    relationshipToContent: value.relationshipToContent,
    reason: value.reason,
    operatorNotes: value.operatorNotes,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (typeof value.claimantName === "string" || value.claimantName === null) {
    claim.claimantName = value.claimantName;
  }
  if (typeof value.claimantEmail === "string" || value.claimantEmail === null) {
    claim.claimantEmail = value.claimantEmail;
  }
  if (typeof value.details === "string" || value.details === null) {
    claim.details = value.details;
  }
  return claim;
}

export function parseOpsClaimList(value: unknown): OpsClaim[] | null {
  if (!isRecord(value) || !Array.isArray(value.claims)) return null;
  const claims: OpsClaim[] = [];
  for (const item of value.claims) {
    const claim = parseOpsClaim(item);
    if (!claim) return null;
    claims.push(claim);
  }
  return claims;
}

export function parseOpsClaimDetail(value: unknown): OpsClaim | null {
  if (!isRecord(value)) return null;
  return parseOpsClaim(value.claim);
}

export function parseBoundedModerationError(value: unknown): string {
  if (isRecord(value) && typeof value.error === "string" && value.error.length > 0) {
    return value.error;
  }
  return "UNAVAILABLE";
}

export function operatorActionMessage(code: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Your session expired. Sign in again and retry.";
    case "FORBIDDEN":
      return "The request was denied.";
    case "INVALID_REQUEST":
      return "The request was rejected. Check IDs, status, and the confirmation phrase.";
    case "SERVER_MISCONFIGURED":
      return "The operator allowlist or server configuration is unavailable.";
    case "CLAIM_REVIEW_UNAVAILABLE":
      return "Claim review is unavailable for that request.";
    case "WITHDRAWAL_UNAVAILABLE":
      return "Media-only withdrawal is unavailable for that request.";
    case "ANNOTATION_MODERATION_UNAVAILABLE":
      return "Annotation moderation is unavailable for that request.";
    default:
      return "The operator action could not be completed.";
  }
}

export function claimActionLabel(toStatus: ClaimReviewToStatus): string {
  if (toStatus === "reviewing") return "Reviewing";
  if (toStatus === "resolved") return "Resolve";
  return "Reject";
}
