import { isUuid } from "./public-content.ts";

export const MODERATION_CONFIRMATION = "MEDIA_ONLY_WITHDRAW";
export const MODERATION_REQUEST_BYTE_LIMIT = 2048;
export const MODERATION_CACHE_CONTROL = "private, no-store";

export const MEDIA_ONLY_REASON_CODES = [
  "copyright",
  "excerpt_claim",
  "operator_request",
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

export type ModerationErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "SERVER_MISCONFIGURED"
  | "WITHDRAWAL_UNAVAILABLE";

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

export function mapModerationRpcError(error: unknown): ModerationApiError {
  if (!isRecord(error)) return new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "42501") return new ModerationApiError("FORBIDDEN", 403);
  if (code === "22023") return new ModerationApiError("INVALID_REQUEST", 400);
  if (code === "55000") return new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
  return new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
}

export function moderationJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": MODERATION_CACHE_CONTROL },
  });
}

export function moderationErrorResponse(error: unknown): Response {
  const bounded = error instanceof ModerationApiError
    ? error
    : new ModerationApiError("WITHDRAWAL_UNAVAILABLE", 503);
  return moderationJsonResponse({ error: bounded.code }, bounded.status);
}
