import { isUuid } from "./public-content.ts";

export const MODERATION_CONFIRMATION = "MEDIA_ONLY_WITHDRAW";
export const CLAIM_REVIEW_CONFIRMATION = "CLAIM_REVIEW_UPDATE";
export const ANNOTATION_HIDE_CONFIRMATION = "ANNOTATION_HIDE";
export const ANNOTATION_UNHIDE_CONFIRMATION = "ANNOTATION_UNHIDE";
export const ANNOTATION_REMOVE_CONFIRMATION = "ANNOTATION_REMOVE";
export const MODERATION_REQUEST_BYTE_LIMIT = 2048;
export const MODERATION_CACHE_CONTROL = "private, no-store";
export const CLAIM_REVIEW_LIST_LIMIT_DEFAULT = 50;
export const CLAIM_REVIEW_LIST_LIMIT_MAX = 100;
export const CLAIM_REVIEW_NOTES_MAX = 4000;

export const CLAIM_REVIEW_STATUSES = [
  "submitted",
  "reviewing",
  "resolved",
  "rejected",
] as const;

export const CLAIM_REVIEW_TO_STATUSES = [
  "reviewing",
  "resolved",
  "rejected",
] as const;

export const MEDIA_ONLY_REASON_CODES = [
  "copyright",
  "excerpt_claim",
  "operator_request",
] as const;

export const ANNOTATION_MODERATION_REASON_CODES = [
  "copyright",
  "excerpt_claim",
  "operator_request",
  "commentary",
] as const;

export type MediaOnlyReasonCode = (typeof MEDIA_ONLY_REASON_CODES)[number];

export type MediaOnlyWithdrawalInput = {
  annotationId: string;
  mediaId: string;
  reasonCode: MediaOnlyReasonCode;
  claimId: string | null;
};

export type MediaOnlyWithdrawalResult = {
  annotationId: string;
  mediaId: string;
  claimId: string | null;
  reasonCode: MediaOnlyReasonCode;
  resultCode: "withdrawn" | "already_withdrawn";
  removedAt: string;
  auditId: string | null;
  annotationStatus: string;
  processingStatus: string;
  transcriptContentCleared: boolean;
};

export type ClaimReviewStatus = (typeof CLAIM_REVIEW_STATUSES)[number];
export type ClaimReviewToStatus = (typeof CLAIM_REVIEW_TO_STATUSES)[number];

export type ClaimReviewListInput = {
  status: ClaimReviewStatus | null;
  includeClaimantPii: boolean;
  limit: number;
  afterCreatedAt: string | null;
  afterId: string | null;
};

export type ClaimReviewGetInput = {
  claimId: string;
  includeClaimantPii: boolean;
};

export type ClaimReviewUpdateInput = {
  toStatus: ClaimReviewToStatus;
  operatorNotes: string | null;
  clearOperatorNotes: boolean;
  includeClaimantPii: boolean;
};

export type ClaimReviewRecord = {
  claimId: string;
  annotationId: string;
  status: ClaimReviewStatus;
  relationshipToContent: string;
  reason: string;
  operatorNotes: string | null;
  createdAt: string;
  updatedAt: string;
  claimantName: string | null;
  claimantEmail: string | null;
  details: string | null;
};

export type ClaimReviewUpdateResult = ClaimReviewRecord & {
  previousStatus: ClaimReviewStatus;
  auditId: string;
  resultCode: ClaimReviewToStatus;
};

export type AnnotationModerationReasonCode =
  (typeof ANNOTATION_MODERATION_REASON_CODES)[number];

export type AnnotationHideInput = {
  annotationId: string;
  reasonCode: AnnotationModerationReasonCode;
  claimId: string | null;
};

export type AnnotationUnhideInput = AnnotationHideInput;

export type AnnotationRemoveInput = AnnotationHideInput & {
  resolveClaim: boolean;
};

export type AnnotationHideResult = {
  annotationId: string;
  mediaId: string | null;
  claimId: string | null;
  reasonCode: AnnotationModerationReasonCode;
  resultCode: "hidden" | "already_hidden";
  auditId: string | null;
  annotationStatus: string;
  previousStatus: string;
  processingStatus: string | null;
};

export type AnnotationUnhideResult = {
  annotationId: string;
  mediaId: string | null;
  claimId: string | null;
  reasonCode: AnnotationModerationReasonCode;
  resultCode: "unhidden" | "already_published";
  auditId: string | null;
  annotationStatus: string;
  previousStatus: string;
  processingStatus: string | null;
  transcriptContentRestored: false;
};

export type AnnotationRemoveResult = {
  annotationId: string;
  mediaId: string | null;
  claimId: string | null;
  reasonCode: AnnotationModerationReasonCode;
  resultCode: "removed" | "already_removed";
  auditId: string | null;
  annotationStatus: string;
  previousStatus: string;
  processingStatus: string | null;
  transcriptContentCleared: boolean;
  claimStatus: string | null;
  claimResolved: boolean;
};

export type ModerationErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "SERVER_MISCONFIGURED"
  | "WITHDRAWAL_UNAVAILABLE"
  | "CLAIM_REVIEW_UNAVAILABLE"
  | "ANNOTATION_MODERATION_UNAVAILABLE";

export class ModerationApiError extends Error {
  readonly code: ModerationErrorCode;
  readonly status: 400 | 401 | 403 | 500 | 503;

  constructor(code: ModerationErrorCode, status: 400 | 401 | 403 | 500 | 503) {
    super(code);
    this.name = "ModerationApiError";
    this.code = code;
    this.status = status;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]) {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function isUuidValue(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

function isReasonCode(value: unknown): value is MediaOnlyReasonCode {
  return typeof value === "string"
    && (MEDIA_ONLY_REASON_CODES as readonly string[]).includes(value);
}

function isAnnotationModerationReasonCode(
  value: unknown,
): value is AnnotationModerationReasonCode {
  return typeof value === "string"
    && (ANNOTATION_MODERATION_REASON_CODES as readonly string[]).includes(value);
}

function isHideResultCode(
  value: unknown,
): value is AnnotationHideResult["resultCode"] {
  return value === "hidden" || value === "already_hidden";
}

function isUnhideResultCode(
  value: unknown,
): value is AnnotationUnhideResult["resultCode"] {
  return value === "unhidden" || value === "already_published";
}

function isRemoveResultCode(
  value: unknown,
): value is AnnotationRemoveResult["resultCode"] {
  return value === "removed" || value === "already_removed";
}

function parseOptionalUuid(value: unknown): string | null {
  if (value === null) return null;
  if (isUuidValue(value)) return value;
  throw new ModerationApiError("INVALID_REQUEST", 400);
}

function parseAnnotationModerationRequest(
  body: unknown,
  confirm: typeof ANNOTATION_HIDE_CONFIRMATION | typeof ANNOTATION_UNHIDE_CONFIRMATION,
  annotationId: string,
): AnnotationHideInput {
  if (!isUuid(annotationId)) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (!isRecord(body)) throw new ModerationApiError("INVALID_REQUEST", 400);
  const requiredKeys = ["reasonCode", "confirm"] as const;
  const optionalClaim = Object.hasOwn(body, "claimId");
  const allowedKeys = optionalClaim ? [...requiredKeys, "claimId"] : requiredKeys;
  if (!hasExactKeys(body, allowedKeys)) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (body.confirm !== confirm) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (!isAnnotationModerationReasonCode(body.reasonCode)) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  return {
    annotationId,
    reasonCode: body.reasonCode,
    claimId: optionalClaim ? parseOptionalUuid(body.claimId) : null,
  };
}

function isResultCode(value: unknown): value is MediaOnlyWithdrawalResult["resultCode"] {
  return value === "withdrawn" || value === "already_withdrawn";
}

function parseAllowlist(value: string | undefined, kind: "id" | "email"): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (kind === "email" ? entry.toLowerCase() : entry.toLowerCase()));
}

export function getModerationOperatorAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): { ids: Set<string>; emails: Set<string> } {
  const ids = parseAllowlist(env.ANNOTATED_MODERATION_OPERATOR_IDS, "id")
    .filter((id) => isUuid(id));
  const emails = parseAllowlist(env.ANNOTATED_MODERATION_OPERATOR_EMAILS, "email")
    .filter((email) => email.includes("@") && email.length <= 320);
  return { ids: new Set(ids), emails: new Set(emails) };
}

export function isAllowlistedModerationOperator(
  user: { id: string; email?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isUuid(user.id)) return false;
  const allowlist = getModerationOperatorAllowlist(env);
  if (allowlist.ids.size === 0 && allowlist.emails.size === 0) return false;
  if (allowlist.ids.has(user.id.toLowerCase())) return true;
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && allowlist.emails.has(email));
}

export function isModerationAllowlistConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allowlist = getModerationOperatorAllowlist(env);
  return allowlist.ids.size > 0 || allowlist.emails.size > 0;
}

export function assertModerationOperatorAllowlist(
  user: { id: string; email?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isModerationAllowlistConfigured(env)) {
    throw new ModerationApiError("SERVER_MISCONFIGURED", 500);
  }
  if (!isAllowlistedModerationOperator(user, env)) {
    throw new ModerationApiError("FORBIDDEN", 403);
  }
}

export function parseMediaOnlyWithdrawalRequest(body: unknown): MediaOnlyWithdrawalInput {
  if (!isRecord(body)) throw new ModerationApiError("INVALID_REQUEST", 400);
  const requiredKeys = ["annotationId", "mediaId", "reasonCode", "confirm"] as const;
  const optionalClaim = Object.hasOwn(body, "claimId");
  const allowedKeys = optionalClaim ? [...requiredKeys, "claimId"] : requiredKeys;
  if (!hasExactKeys(body, allowedKeys)) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (body.confirm !== MODERATION_CONFIRMATION) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (!isUuidValue(body.annotationId) || !isUuidValue(body.mediaId)) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (
    typeof body.reasonCode !== "string"
    || !isReasonCode(body.reasonCode)
  ) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  let claimId: string | null = null;
  if (optionalClaim) {
    if (body.claimId === null) claimId = null;
    else if (isUuidValue(body.claimId)) claimId = body.claimId;
    else throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  return {
    annotationId: body.annotationId,
    mediaId: body.mediaId,
    reasonCode: body.reasonCode,
    claimId,
  };
}

export function parseMediaOnlyWithdrawalResult(
  value: unknown,
): MediaOnlyWithdrawalResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) throw new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
  if (
    !isUuidValue(row.annotation_id)
    || !isUuidValue(row.media_id)
    || !isResultCode(row.result_code)
    || !isReasonCode(row.reason_code)
    || typeof row.removed_at !== "string"
    || typeof row.annotation_status !== "string"
    || typeof row.processing_status !== "string"
    || typeof row.transcript_content_cleared !== "boolean"
  ) {
    throw new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
  }
  let claimId: string | null = null;
  if (row.claim_id !== null) {
    if (!isUuidValue(row.claim_id)) throw new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
    claimId = row.claim_id;
  }
  let auditId: string | null = null;
  if (row.audit_id !== null) {
    if (!isUuidValue(row.audit_id)) throw new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
    auditId = row.audit_id;
  }
  return {
    annotationId: row.annotation_id,
    mediaId: row.media_id,
    claimId,
    reasonCode: row.reason_code,
    resultCode: row.result_code,
    removedAt: row.removed_at,
    auditId,
    annotationStatus: row.annotation_status,
    processingStatus: row.processing_status,
    transcriptContentCleared: row.transcript_content_cleared,
  };
}

export function boundedModerationLog(
  result: MediaOnlyWithdrawalResult,
): Record<string, string | boolean | null> {
  return {
    annotationId: result.annotationId,
    mediaId: result.mediaId,
    claimId: result.claimId,
    reasonCode: result.reasonCode,
    resultCode: result.resultCode,
    auditId: result.auditId,
    annotationStatus: result.annotationStatus,
    processingStatus: result.processingStatus,
    transcriptContentCleared: result.transcriptContentCleared,
  };
}

export function parseAnnotationHideRequest(
  body: unknown,
  annotationId: string,
): AnnotationHideInput {
  return parseAnnotationModerationRequest(body, ANNOTATION_HIDE_CONFIRMATION, annotationId);
}

export function parseAnnotationUnhideRequest(
  body: unknown,
  annotationId: string,
): AnnotationUnhideInput {
  return parseAnnotationModerationRequest(body, ANNOTATION_UNHIDE_CONFIRMATION, annotationId);
}

export function parseAnnotationRemoveRequest(
  body: unknown,
  annotationId: string,
): AnnotationRemoveInput {
  if (!isUuid(annotationId)) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (!isRecord(body)) throw new ModerationApiError("INVALID_REQUEST", 400);
  const requiredKeys = ["reasonCode", "confirm"] as const;
  const optionalClaim = Object.hasOwn(body, "claimId");
  const optionalResolve = Object.hasOwn(body, "resolveClaim");
  const allowedKeys = [
    ...requiredKeys,
    ...(optionalClaim ? ["claimId"] as const : []),
    ...(optionalResolve ? ["resolveClaim"] as const : []),
  ];
  if (!hasExactKeys(body, allowedKeys)) throw new ModerationApiError("INVALID_REQUEST", 400);
  if (body.confirm !== ANNOTATION_REMOVE_CONFIRMATION) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (!isAnnotationModerationReasonCode(body.reasonCode)) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (optionalResolve && body.resolveClaim !== true) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  const resolveClaim = optionalResolve;
  const claimId = optionalClaim ? parseOptionalUuid(body.claimId) : null;
  if (resolveClaim && claimId === null) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  return {
    annotationId,
    reasonCode: body.reasonCode,
    claimId,
    resolveClaim,
  };
}

function parseAnnotationModerationRow(row: UnknownRecord): {
  annotationId: string;
  mediaId: string | null;
  claimId: string | null;
  reasonCode: AnnotationModerationReasonCode;
  auditId: string | null;
  annotationStatus: string;
  previousStatus: string;
  processingStatus: string | null;
} {
  if (
    !isUuidValue(row.annotation_id)
    || !isAnnotationModerationReasonCode(row.reason_code)
    || typeof row.annotation_status !== "string"
    || typeof row.previous_status !== "string"
  ) {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  let mediaId: string | null = null;
  if (row.media_id !== null) {
    if (!isUuidValue(row.media_id)) {
      throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
    }
    mediaId = row.media_id;
  }
  let claimId: string | null = null;
  if (row.claim_id !== null) {
    if (!isUuidValue(row.claim_id)) {
      throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
    }
    claimId = row.claim_id;
  }
  let auditId: string | null = null;
  if (row.audit_id !== null) {
    if (!isUuidValue(row.audit_id)) {
      throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
    }
    auditId = row.audit_id;
  }
  if (row.processing_status !== null && typeof row.processing_status !== "string") {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  return {
    annotationId: row.annotation_id,
    mediaId,
    claimId,
    reasonCode: row.reason_code,
    auditId,
    annotationStatus: row.annotation_status,
    previousStatus: row.previous_status,
    processingStatus: row.processing_status,
  };
}

export function parseAnnotationHideResult(value: unknown): AnnotationHideResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row) || !isHideResultCode(row.result_code)) {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  return { ...parseAnnotationModerationRow(row), resultCode: row.result_code };
}

export function parseAnnotationUnhideResult(value: unknown): AnnotationUnhideResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || !isUnhideResultCode(row.result_code)
    || row.transcript_content_restored !== false
  ) {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  return {
    ...parseAnnotationModerationRow(row),
    resultCode: row.result_code,
    transcriptContentRestored: false,
  };
}

export function parseAnnotationRemoveResult(value: unknown): AnnotationRemoveResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || !isRemoveResultCode(row.result_code)
    || typeof row.transcript_content_cleared !== "boolean"
    || typeof row.claim_resolved !== "boolean"
  ) {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  if (row.claim_status !== null && typeof row.claim_status !== "string") {
    throw new ModerationApiError("ANNOTATION_MODERATION_UNAVAILABLE", 503);
  }
  const claimStatus: string | null = typeof row.claim_status === "string"
    ? row.claim_status
    : null;
  return {
    ...parseAnnotationModerationRow(row),
    resultCode: row.result_code,
    transcriptContentCleared: row.transcript_content_cleared,
    claimStatus,
    claimResolved: row.claim_resolved,
  };
}

export function boundedAnnotationModerationLog(
  result: AnnotationHideResult | AnnotationUnhideResult | AnnotationRemoveResult,
): Record<string, string | boolean | null> {
  return {
    annotationId: result.annotationId,
    mediaId: result.mediaId,
    claimId: result.claimId,
    reasonCode: result.reasonCode,
    resultCode: result.resultCode,
    auditId: result.auditId,
    annotationStatus: result.annotationStatus,
    previousStatus: result.previousStatus,
    processingStatus: result.processingStatus,
    ...("transcriptContentRestored" in result
      ? { transcriptContentRestored: result.transcriptContentRestored }
      : {}),
    ...("transcriptContentCleared" in result
      ? {
        transcriptContentCleared: result.transcriptContentCleared,
        claimStatus: result.claimStatus,
        claimResolved: result.claimResolved,
      }
      : {}),
  };
}

export function mapModerationRpcError(
  error: unknown,
  unavailable:
    | "WITHDRAWAL_UNAVAILABLE"
    | "CLAIM_REVIEW_UNAVAILABLE"
    | "ANNOTATION_MODERATION_UNAVAILABLE" = "WITHDRAWAL_UNAVAILABLE",
): ModerationApiError {
  if (!isRecord(error)) return new ModerationApiError(unavailable, 503);
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "42501") return new ModerationApiError("FORBIDDEN", 403);
  if (code === "22023") return new ModerationApiError("INVALID_REQUEST", 400);
  if (code === "55000") return new ModerationApiError(unavailable, 503);
  return new ModerationApiError(unavailable, 503);
}

export function moderationJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": MODERATION_CACHE_CONTROL },
  });
}

export function moderationErrorResponse(
  error: unknown,
  fallback:
    | "WITHDRAWAL_UNAVAILABLE"
    | "CLAIM_REVIEW_UNAVAILABLE"
    | "ANNOTATION_MODERATION_UNAVAILABLE" = "WITHDRAWAL_UNAVAILABLE",
): Response {
  const bounded = error instanceof ModerationApiError
    ? error
    : new ModerationApiError(fallback, 503);
  return moderationJsonResponse({ error: bounded.code }, bounded.status);
}

function isClaimReviewStatus(value: unknown): value is ClaimReviewStatus {
  return typeof value === "string"
    && (CLAIM_REVIEW_STATUSES as readonly string[]).includes(value);
}

function isClaimReviewToStatus(value: unknown): value is ClaimReviewToStatus {
  return typeof value === "string"
    && (CLAIM_REVIEW_TO_STATUSES as readonly string[]).includes(value);
}

function hasOnlyAllowedKeys(value: UnknownRecord, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function parseIncludeClaimantPiiFlag(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === true) return true;
  throw new ModerationApiError("INVALID_REQUEST", 400);
}

function parseOperatorNotes(value: unknown): string {
  if (typeof value !== "string") throw new ModerationApiError("INVALID_REQUEST", 400);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CLAIM_REVIEW_NOTES_MAX) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  return trimmed;
}

const CLAIM_REVIEW_LIST_QUERY_KEYS = [
  "status",
  "limit",
  "afterCreatedAt",
  "afterId",
  "includeClaimantPii",
] as const;

export function parseClaimReviewListQuery(searchParams: URLSearchParams): ClaimReviewListInput {
  const keys = [...searchParams.keys()];
  if (keys.some((key) => !(CLAIM_REVIEW_LIST_QUERY_KEYS as readonly string[]).includes(key))) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  for (const key of new Set(keys)) {
    if (searchParams.getAll(key).length !== 1) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
  }

  let status: ClaimReviewStatus | null = null;
  if (searchParams.has("status")) {
    const raw = searchParams.get("status");
    if (!isClaimReviewStatus(raw)) throw new ModerationApiError("INVALID_REQUEST", 400);
    status = raw;
  }

  let limit = CLAIM_REVIEW_LIST_LIMIT_DEFAULT;
  if (searchParams.has("limit")) {
    const raw = searchParams.get("limit") ?? "";
    if (!/^[1-9]\d*$/.test(raw)) throw new ModerationApiError("INVALID_REQUEST", 400);
    limit = Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLAIM_REVIEW_LIST_LIMIT_MAX) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
  }

  const hasAfterCreatedAt = searchParams.has("afterCreatedAt");
  const hasAfterId = searchParams.has("afterId");
  if (hasAfterCreatedAt !== hasAfterId) throw new ModerationApiError("INVALID_REQUEST", 400);
  let afterCreatedAt: string | null = null;
  let afterId: string | null = null;
  if (hasAfterCreatedAt && hasAfterId) {
    afterCreatedAt = searchParams.get("afterCreatedAt");
    afterId = searchParams.get("afterId");
    if (
      !afterCreatedAt
      || Number.isNaN(Date.parse(afterCreatedAt))
      || !isUuidValue(afterId)
    ) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
  }

  let includeClaimantPii = false;
  if (searchParams.has("includeClaimantPii")) {
    if (searchParams.get("includeClaimantPii") !== "true") {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
    includeClaimantPii = true;
  }

  return { status, includeClaimantPii, limit, afterCreatedAt, afterId };
}

export function parseClaimReviewGetInput(
  claimId: string,
  searchParams: URLSearchParams,
): ClaimReviewGetInput {
  if (!isUuid(claimId)) throw new ModerationApiError("INVALID_REQUEST", 400);
  const keys = [...searchParams.keys()];
  if (keys.some((key) => key !== "includeClaimantPii")) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  for (const key of new Set(keys)) {
    if (searchParams.getAll(key).length !== 1) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
  }
  let includeClaimantPii = false;
  if (searchParams.has("includeClaimantPii")) {
    if (searchParams.get("includeClaimantPii") !== "true") {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
    includeClaimantPii = true;
  }
  return { claimId, includeClaimantPii };
}

export function parseClaimReviewUpdateRequest(body: unknown): ClaimReviewUpdateInput {
  if (!isRecord(body)) throw new ModerationApiError("INVALID_REQUEST", 400);
  const requiredKeys = ["toStatus", "confirm"] as const;
  const optionalKeys = ["operatorNotes", "clearOperatorNotes", "includeClaimantPii"] as const;
  if (!requiredKeys.every((key) => Object.hasOwn(body, key))) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (!hasOnlyAllowedKeys(body, [...requiredKeys, ...optionalKeys])) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (body.confirm !== CLAIM_REVIEW_CONFIRMATION) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  if (!isClaimReviewToStatus(body.toStatus)) {
    throw new ModerationApiError("INVALID_REQUEST", 400);
  }
  const hasNotes = Object.hasOwn(body, "operatorNotes");
  const hasClear = Object.hasOwn(body, "clearOperatorNotes");
  if (hasNotes && hasClear) throw new ModerationApiError("INVALID_REQUEST", 400);
  let operatorNotes: string | null = null;
  let clearOperatorNotes = false;
  if (hasNotes) operatorNotes = parseOperatorNotes(body.operatorNotes);
  if (hasClear) {
    if (body.clearOperatorNotes !== true) throw new ModerationApiError("INVALID_REQUEST", 400);
    clearOperatorNotes = true;
  }
  const includeClaimantPii = parseIncludeClaimantPiiFlag(
    Object.hasOwn(body, "includeClaimantPii") ? body.includeClaimantPii : undefined,
  );
  return { toStatus: body.toStatus, operatorNotes, clearOperatorNotes, includeClaimantPii };
}

function parseClaimReviewRecord(row: UnknownRecord): ClaimReviewRecord {
  if (
    !isUuidValue(row.claim_id)
    || !isUuidValue(row.annotation_id)
    || !isClaimReviewStatus(row.status)
    || typeof row.relationship_to_content !== "string"
    || typeof row.reason !== "string"
    || typeof row.created_at !== "string"
    || typeof row.updated_at !== "string"
    || (row.operator_notes !== null && typeof row.operator_notes !== "string")
    || (row.claimant_name !== null && typeof row.claimant_name !== "string")
    || (row.claimant_email !== null && typeof row.claimant_email !== "string")
    || (row.details !== null && typeof row.details !== "string")
  ) {
    throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
  }
  return {
    claimId: row.claim_id,
    annotationId: row.annotation_id,
    status: row.status,
    relationshipToContent: row.relationship_to_content,
    reason: row.reason,
    operatorNotes: row.operator_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimantName: row.claimant_name,
    claimantEmail: row.claimant_email,
    details: row.details,
  };
}

export function parseClaimReviewListResult(value: unknown): ClaimReviewRecord[] {
  if (!Array.isArray(value)) throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
  return value.map((item) => {
    if (!isRecord(item)) throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
    return parseClaimReviewRecord(item);
  });
}

export function parseClaimReviewGetResult(value: unknown): ClaimReviewRecord {
  const rows = parseClaimReviewListResult(value);
  const row = rows[0];
  if (rows.length !== 1 || !row) throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
  return row;
}

export function parseClaimReviewUpdateResult(value: unknown): ClaimReviewUpdateResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
  const claim = parseClaimReviewRecord(row);
  if (
    !isClaimReviewStatus(row.previous_status)
    || !isClaimReviewToStatus(row.result_code)
    || !isUuidValue(row.audit_id)
  ) {
    throw new ModerationApiError("CLAIM_REVIEW_UNAVAILABLE", 503);
  }
  return {
    ...claim,
    previousStatus: row.previous_status,
    auditId: row.audit_id,
    resultCode: row.result_code,
  };
}

export function claimReviewPublicJson(
  record: ClaimReviewRecord,
  includeClaimantPii: boolean,
): Record<string, string | null> {
  const body: Record<string, string | null> = {
    claimId: record.claimId,
    annotationId: record.annotationId,
    status: record.status,
    relationshipToContent: record.relationshipToContent,
    reason: record.reason,
    operatorNotes: record.operatorNotes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (includeClaimantPii) {
    body.claimantName = record.claimantName;
    body.claimantEmail = record.claimantEmail;
    body.details = record.details;
  }
  return body;
}

export function boundedClaimReviewLog(
  record: Pick<ClaimReviewRecord, "claimId" | "annotationId" | "status"> & {
    auditId?: string;
    resultCode?: string;
    previousStatus?: string;
    includeClaimantPii?: boolean;
    claimCount?: number;
  },
): Record<string, string | number | boolean | undefined> {
  return {
    claimId: record.claimId,
    annotationId: record.annotationId,
    status: record.status,
    auditId: record.auditId,
    resultCode: record.resultCode,
    previousStatus: record.previousStatus,
    includeClaimantPii: record.includeClaimantPii,
    claimCount: record.claimCount,
  };
}
