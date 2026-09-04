import {
  HostedMediaApiError,
  authenticatedUser,
  createAuthenticatedClient,
  createServiceClient,
} from "@/lib/hosted-media-upload";
import {
  MODERATION_REQUEST_BYTE_LIMIT,
  ModerationApiError,
  assertModerationOperatorAllowlist,
  boundedClaimReviewLog,
  claimReviewPublicJson,
  mapModerationRpcError,
  moderationErrorResponse,
  moderationJsonResponse,
  parseClaimReviewGetInput,
  parseClaimReviewGetResult,
  parseClaimReviewUpdateRequest,
  parseClaimReviewUpdateResult,
} from "@/lib/moderation";

type ClaimReviewRouteContext = { params: Promise<{ claimId: string }> };

function mapHostedAuthError(error: unknown) {
  if (error instanceof HostedMediaApiError && error.code === "AUTH_REQUIRED") {
    return new ModerationApiError("AUTH_REQUIRED", 401);
  }
  if (error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED") {
    return new ModerationApiError("SERVER_MISCONFIGURED", 500);
  }
  return error;
}

export async function GET(request: Request, context: ClaimReviewRouteContext) {
  let claimId = "invalid";
  try {
    const params = await context.params;
    const url = new URL(request.url);
    const input = parseClaimReviewGetInput(params.claimId, url.searchParams);
    claimId = input.claimId;

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    const { data, error } = await service.rpc("get_claim_for_review", {
      p_claim_id: input.claimId,
      p_include_claimant_pii: input.includeClaimantPii,
    });
    if (error) throw mapModerationRpcError(error, "CLAIM_REVIEW_UNAVAILABLE");
    const claim = parseClaimReviewGetResult(data);
    console.info("[Moderation]", boundedClaimReviewLog({
      claimId: claim.claimId,
      annotationId: claim.annotationId,
      status: claim.status,
      includeClaimantPii: input.includeClaimantPii,
    }));
    return moderationJsonResponse({
      claim: claimReviewPublicJson(claim, input.includeClaimantPii),
    });
  } catch (error) {
    const bounded = mapHostedAuthError(error);
    const code = bounded instanceof ModerationApiError ? bounded.code : "CLAIM_REVIEW_UNAVAILABLE";
    console.warn("[Moderation]", { route: "claims.get", claimId, code });
    return moderationErrorResponse(bounded, "CLAIM_REVIEW_UNAVAILABLE");
  }
}

export async function POST(request: Request, context: ClaimReviewRouteContext) {
  let claimId = "invalid";
  try {
    const params = await context.params;
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
    const path = parseClaimReviewGetInput(params.claimId, url.searchParams);
    claimId = path.claimId;

    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new ModerationApiError("INVALID_REQUEST", 400);
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > MODERATION_REQUEST_BYTE_LIMIT) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }
    const input = parseClaimReviewUpdateRequest(body);

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    const { data, error } = await service.rpc("update_claim_review", {
      p_actor_id: user.id,
      p_claim_id: claimId,
      p_to_status: input.toStatus,
      p_operator_notes: input.operatorNotes,
      p_clear_operator_notes: input.clearOperatorNotes,
      p_include_claimant_pii: input.includeClaimantPii,
    });
    if (error) throw mapModerationRpcError(error, "CLAIM_REVIEW_UNAVAILABLE");
    const result = parseClaimReviewUpdateResult(data);
    console.info("[Moderation]", boundedClaimReviewLog({
      claimId: result.claimId,
      annotationId: result.annotationId,
      status: result.status,
      auditId: result.auditId,
      resultCode: result.resultCode,
      previousStatus: result.previousStatus,
      includeClaimantPii: input.includeClaimantPii,
    }));
    return moderationJsonResponse({
      claim: claimReviewPublicJson(result, input.includeClaimantPii),
      previousStatus: result.previousStatus,
      resultCode: result.resultCode,
      auditId: result.auditId,
    });
  } catch (error) {
    const bounded = mapHostedAuthError(error);
    const code = bounded instanceof ModerationApiError ? bounded.code : "CLAIM_REVIEW_UNAVAILABLE";
    console.warn("[Moderation]", { route: "claims.update", claimId, code });
    return moderationErrorResponse(bounded, "CLAIM_REVIEW_UNAVAILABLE");
  }
}
