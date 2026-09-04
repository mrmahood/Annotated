import {
  HostedMediaApiError,
  authenticatedUser,
  createAuthenticatedClient,
  createServiceClient,
} from "@/lib/hosted-media-upload";
import {
  ModerationApiError,
  assertModerationOperatorAllowlist,
  boundedClaimReviewLog,
  claimReviewPublicJson,
  mapModerationRpcError,
  moderationErrorResponse,
  moderationJsonResponse,
  parseClaimReviewListQuery,
  parseClaimReviewListResult,
} from "@/lib/moderation";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = parseClaimReviewListQuery(url.searchParams);

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    const { data, error } = await service.rpc("list_claims_for_review", {
      p_status: input.status,
      p_include_claimant_pii: input.includeClaimantPii,
      p_limit: input.limit,
      p_after_created_at: input.afterCreatedAt,
      p_after_id: input.afterId,
    });
    if (error) throw mapModerationRpcError(error, "CLAIM_REVIEW_UNAVAILABLE");
    const claims = parseClaimReviewListResult(data);
    console.info("[Moderation]", boundedClaimReviewLog({
      claimId: "list",
      annotationId: "list",
      status: input.status ?? "submitted",
      includeClaimantPii: input.includeClaimantPii,
      claimCount: claims.length,
    }));
    return moderationJsonResponse({
      claims: claims.map((claim) => claimReviewPublicJson(claim, input.includeClaimantPii)),
    });
  } catch (error) {
    const bounded = error instanceof HostedMediaApiError && error.code === "AUTH_REQUIRED"
      ? new ModerationApiError("AUTH_REQUIRED", 401)
      : error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED"
        ? new ModerationApiError("SERVER_MISCONFIGURED", 500)
        : error;
    const code = bounded instanceof ModerationApiError ? bounded.code : "CLAIM_REVIEW_UNAVAILABLE";
    console.warn("[Moderation]", { route: "claims.list", code });
    return moderationErrorResponse(bounded, "CLAIM_REVIEW_UNAVAILABLE");
  }
}
