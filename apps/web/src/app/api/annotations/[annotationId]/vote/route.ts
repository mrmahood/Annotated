import { isUuid } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/server";
import { getAnnotationVoteSnapshot, mutateAnnotationVote } from "@/lib/data/voting";
import {
  VOTE_REQUEST_BYTE_LIMIT,
  VoteApiError,
  assertSameOriginVoteMutation,
  parseVoteRequest,
  voteErrorResponse,
  voteJsonResponse,
} from "@/lib/voting";

type VoteRouteContext = { params: Promise<{ annotationId: string }> };

async function verifiedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user || !isUuid(data.user.id) ? null : data.user.id;
}

async function annotationIdFrom(context: VoteRouteContext): Promise<string> {
  const { annotationId } = await context.params;
  if (!isUuid(annotationId)) throw new VoteApiError("ANNOTATION_UNAVAILABLE", 404);
  return annotationId;
}

export async function GET(_request: Request, context: VoteRouteContext) {
  try {
    const annotationId = await annotationIdFrom(context);
    const userId = await verifiedUserId();
    const snapshot = await getAnnotationVoteSnapshot(annotationId, userId);
    if (!snapshot) throw new VoteApiError("ANNOTATION_UNAVAILABLE", 404);
    return voteJsonResponse(snapshot);
  } catch (error) {
    return voteErrorResponse(error);
  }
}

export async function POST(request: Request, context: VoteRouteContext) {
  try {
    assertSameOriginVoteMutation(request);
    const annotationId = await annotationIdFrom(context);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new VoteApiError("INVALID_REQUEST", 400);
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > VOTE_REQUEST_BYTE_LIMIT) {
      throw new VoteApiError("INVALID_REQUEST", 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new VoteApiError("INVALID_REQUEST", 400);
    }
    const { value } = parseVoteRequest(body);
    const userId = await verifiedUserId();
    if (!userId) throw new VoteApiError("AUTH_REQUIRED", 401);

    const result = await mutateAnnotationVote(userId, annotationId, value);
    if (typeof result === "string") {
      if (result === "SELF_VOTE_FORBIDDEN") throw new VoteApiError(result, 403);
      if (result === "ANNOTATION_UNAVAILABLE") throw new VoteApiError(result, 404);
      if (result === "VOTE_UNAVAILABLE") throw new VoteApiError(result, 401);
      if (result === "INVALID_VOTE") throw new VoteApiError("INVALID_REQUEST", 400);
      throw new VoteApiError("VOTE_FAILED", 500);
    }
    const snapshot = {
      currentVote: result.currentVote,
      upvoteCount: result.upvoteCount,
      downvoteCount: result.downvoteCount,
    };
    if (result.resultCode === "RATE_LIMITED") {
      return voteJsonResponse(
        { error: "RATE_LIMITED", ...snapshot, retryAfterSeconds: result.retryAfterSeconds },
        429,
        { "retry-after": String(result.retryAfterSeconds) },
      );
    }
    return voteJsonResponse({ resultCode: result.resultCode, ...snapshot });
  } catch (error) {
    return voteErrorResponse(error);
  }
}
