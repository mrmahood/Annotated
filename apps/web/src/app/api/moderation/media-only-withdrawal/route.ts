import {
  HostedMediaApiError,
  authenticatedUser,
  createAuthenticatedClient,
  createServiceClient,
} from "@/lib/hosted-media-upload";
import {
  MODERATION_REQUEST_BYTE_LIMIT,
  ModerationApiError,
  boundedModerationLog,
  isAllowlistedModerationOperator,
  isModerationAllowlistConfigured,
  mapModerationRpcError,
  moderationErrorResponse,
  moderationJsonResponse,
  parseMediaOnlyWithdrawalRequest,
  parseMediaOnlyWithdrawalResult,
} from "@/lib/moderation";

export async function POST(request: Request) {
  let annotationId = "invalid";
  let mediaId = "invalid";
  try {
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
    const input = parseMediaOnlyWithdrawalRequest(body);
    annotationId = input.annotationId;
    mediaId = input.mediaId;

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    if (!isModerationAllowlistConfigured()) {
      throw new ModerationApiError("SERVER_MISCONFIGURED", 500);
    }
    if (!isAllowlistedModerationOperator(user)) {
      throw new ModerationApiError("FORBIDDEN", 403);
    }

    const service = createServiceClient();
    const { data, error } = await service.rpc("moderate_media_only_withdrawal", {
      p_actor_id: user.id,
      p_annotation_id: input.annotationId,
      p_media_id: input.mediaId,
      p_reason_code: input.reasonCode,
      p_claim_id: input.claimId,
    });
    if (error) throw mapModerationRpcError(error);
    const result = parseMediaOnlyWithdrawalResult(data);
    console.info("[Moderation]", boundedModerationLog(result));
    return moderationJsonResponse({
      resultCode: result.resultCode,
      annotationId: result.annotationId,
      mediaId: result.mediaId,
      claimId: result.claimId,
      reasonCode: result.reasonCode,
      removedAt: result.removedAt,
      auditId: result.auditId,
      annotationStatus: result.annotationStatus,
      processingStatus: result.processingStatus,
      transcriptContentCleared: result.transcriptContentCleared,
    });
  } catch (error) {
    const bounded = error instanceof HostedMediaApiError && error.code === "AUTH_REQUIRED"
      ? new ModerationApiError("AUTH_REQUIRED", 401)
      : error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED"
        ? new ModerationApiError("SERVER_MISCONFIGURED", 500)
        : error;
    const code = bounded instanceof ModerationApiError ? bounded.code : "WITHDRAWAL_UNAVAILABLE";
    console.warn("[Moderation]", {
      annotationId,
      mediaId,
      code,
    });
    return moderationErrorResponse(bounded);
  }
}
