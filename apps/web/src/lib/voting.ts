export const VOTE_CACHE_CONTROL = "private, no-store";
export const VOTE_REQUEST_BYTE_LIMIT = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VoteValue = -1 | 1 | null;

export type VoteSnapshot = {
  currentVote: VoteValue;
  upvoteCount: number;
  downvoteCount: number;
};

export type VoteMutationResult = VoteSnapshot & {
  resultCode: "CREATED" | "CHANGED" | "CLEARED" | "UNCHANGED" | "RATE_LIMITED";
  retryAfterSeconds: number | null;
};

export type VoteApiErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "CROSS_ORIGIN_REQUEST"
  | "SELF_VOTE_FORBIDDEN"
  | "ANNOTATION_UNAVAILABLE"
  | "RATE_LIMITED"
  | "VOTE_UNAVAILABLE"
  | "SERVER_MISCONFIGURED"
  | "VOTE_FAILED";

export class VoteApiError extends Error {
  readonly code: VoteApiErrorCode;
  readonly status: number;

  constructor(code: VoteApiErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "VoteApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseVoteValue(value: unknown): VoteValue | undefined {
  return value === -1 || value === 1 || value === null ? value : undefined;
}

function parseCount(value: unknown): number | null {
  const count = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

function parseRetry(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 600
    ? value
    : undefined;
}

export function parseVoteRequest(value: unknown): { value: VoteValue } {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("value" in value)) {
    throw new VoteApiError("INVALID_REQUEST", 400);
  }
  const vote = parseVoteValue(value.value);
  if (vote === undefined) throw new VoteApiError("INVALID_REQUEST", 400);
  return { value: vote };
}

export function parsePublicVoteTotals(
  value: unknown,
  annotationId: string,
): Pick<VoteSnapshot, "upvoteCount" | "downvoteCount"> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row) || row.annotation_id !== annotationId || !isUuid(row.annotation_id)) return null;
  const upvoteCount = parseCount(row.upvote_count);
  const downvoteCount = parseCount(row.downvote_count);
  return upvoteCount === null || downvoteCount === null
    ? null
    : { upvoteCount, downvoteCount };
}

export function parseCurrentVote(value: unknown, annotationId: string): VoteValue | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row) || row.annotation_id !== annotationId || !isUuid(row.annotation_id)) return undefined;
  return parseVoteValue(row.current_vote);
}

export function parseVoteMutationResult(value: unknown): VoteMutationResult | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  const resultCode = row.result_code;
  if (
    resultCode !== "CREATED" &&
    resultCode !== "CHANGED" &&
    resultCode !== "CLEARED" &&
    resultCode !== "UNCHANGED" &&
    resultCode !== "RATE_LIMITED"
  ) return null;
  const currentVote = parseVoteValue(row.current_vote);
  const upvoteCount = parseCount(row.upvote_count);
  const downvoteCount = parseCount(row.downvote_count);
  const retryAfterSeconds = parseRetry(row.retry_after_seconds);
  if (
    currentVote === undefined ||
    upvoteCount === null ||
    downvoteCount === null ||
    retryAfterSeconds === undefined ||
    (resultCode === "RATE_LIMITED") !== (retryAfterSeconds !== null)
  ) return null;
  return { resultCode, currentVote, upvoteCount, downvoteCount, retryAfterSeconds };
}

function configuredSiteOrigin(configuredSiteUrl: string | undefined): string {
  if (!configuredSiteUrl) throw new VoteApiError("SERVER_MISCONFIGURED", 500);
  try {
    const url = new URL(configuredSiteUrl);
    const localHttp = url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) throw new Error("invalid");
    return url.origin;
  } catch (error) {
    if (error instanceof VoteApiError) throw error;
    throw new VoteApiError("SERVER_MISCONFIGURED", 500);
  }
}

export function assertSameOriginVoteMutation(
  request: Request,
  configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
): void {
  const expectedOrigin = configuredSiteOrigin(configuredSiteUrl);
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new VoteApiError("CROSS_ORIGIN_REQUEST", 403);
  }
  const suppliedOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    requestOrigin !== expectedOrigin ||
    suppliedOrigin !== expectedOrigin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) throw new VoteApiError("CROSS_ORIGIN_REQUEST", 403);
}

export function getOptimisticVoteSnapshot(
  snapshot: VoteSnapshot,
  requestedVote: VoteValue,
): VoteSnapshot {
  let upvoteCount = snapshot.upvoteCount;
  let downvoteCount = snapshot.downvoteCount;
  if (snapshot.currentVote === 1) upvoteCount = Math.max(0, upvoteCount - 1);
  if (snapshot.currentVote === -1) downvoteCount = Math.max(0, downvoteCount - 1);
  if (requestedVote === 1) upvoteCount += 1;
  if (requestedVote === -1) downvoteCount += 1;
  return { currentVote: requestedVote, upvoteCount, downvoteCount };
}

export function parseVoteSnapshotResponse(value: unknown): VoteSnapshot | null {
  if (!isRecord(value)) return null;
  const currentVote = parseVoteValue(value.currentVote);
  const upvoteCount = parseCount(value.upvoteCount);
  const downvoteCount = parseCount(value.downvoteCount);
  return currentVote === undefined || upvoteCount === null || downvoteCount === null
    ? null
    : { currentVote, upvoteCount, downvoteCount };
}

export function voteJsonResponse(
  body: unknown,
  status = 200,
  additionalHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": VOTE_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
      vary: "Cookie",
      ...Object.fromEntries(new Headers(additionalHeaders)),
    },
  });
}

export function voteErrorResponse(error: unknown): Response {
  const bounded = error instanceof VoteApiError
    ? error
    : new VoteApiError("VOTE_FAILED", 500);
  return voteJsonResponse({ error: bounded.code }, bounded.status);
}
