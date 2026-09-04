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
  boundedAnnotationModerationLog,
  mapModerationRpcError,
  moderationErrorResponse,
  moderationJsonResponse,
  parseAnnotationRemoveRequest,
  parseAnnotationRemoveResult,
} from "@/lib/moderation";

type RemoveRouteContext = { params: Promise<{ annotationId: string }> };

function mapHostedAuthError(error: unknown) {
  if (error instanceof HostedMediaApiError && error.code === "AUTH_REQUIRED") {
    return new ModerationApiError("AUTH_REQUIRED", 401);
  }
  if (error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED") {
    return new ModerationApiError("SERVER_MISCONFIGURED", 500);
  }
  return error;
}

export async function POST(request: Request, context: RemoveRouteContext) {
  let annotationId = "invalid";
  try {
    const params = await context.params;
    annotationId = params.annotationId;
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }

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
    const input = parseAnnotationRemoveRequest(body, annotationId);

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    const { data, error } = await service.rpc("moderate_annotation_remove", {
      p_actor_id: user.id,
      p_annotation_id: input.annotationId,
      p_reason_code: input.reasonCode,
      p_claim_id: input.claimId,
      p_resolve_claim: input.resolveClaim,
    });
    if (error) throw mapModerationRpcError(error, "ANNOTATION_MODERATION_UNAVAILABLE");
    const result = parseAnnotationRemoveResult(data);
    console.info("[Moderation]", boundedAnnotationModerationLog(result));
    return moderationJsonResponse({
      resultCode: result.resultCode,
      annotationId: result.annotationId,
      mediaId: result.mediaId,
      claimId: result.claimId,
      reasonCode: result.reasonCode,
      auditId: result.auditId,
      annotationStatus: result.annotationStatus,
      previousStatus: result.previousStatus,
      processingStatus: result.processingStatus,
      transcriptContentCleared: result.transcriptContentCleared,
      claimStatus: result.claimStatus,
      claimResolved: result.claimResolved,
    });
  } catch (error) {
    const bounded = mapHostedAuthError(error);
    const code = bounded instanceof ModerationApiError
      ? bounded.code
      : "ANNOTATION_MODERATION_UNAVAILABLE";
    console.warn("[Moderation]", { route: "annotations.remove", annotationId, code });
    return moderationErrorResponse(bounded, "ANNOTATION_MODERATION_UNAVAILABLE");
  }
}
