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
  mapModerationRpcError,
  moderationErrorResponse,
  moderationJsonResponse,
} from "@/lib/moderation";
import {
  parseTrendingBoostList,
  parseTrendingBoostRequest,
  parseTrendingBoostRow,
} from "@/lib/data/trending";

function mapHostedAuthError(error: unknown) {
  if (error instanceof HostedMediaApiError && error.code === "AUTH_REQUIRED") {
    return new ModerationApiError("AUTH_REQUIRED", 401);
  }
  if (error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED") {
    return new ModerationApiError("SERVER_MISCONFIGURED", 500);
  }
  return error;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ModerationApiError("INVALID_REQUEST", 400);
    }

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    const { data, error } = await service.rpc("list_annotation_trending_boosts");
    if (error) throw mapModerationRpcError(error, "TRENDING_BOOST_UNAVAILABLE");
    const boosts = parseTrendingBoostList({ boosts: data });
    if (!boosts) throw new ModerationApiError("TRENDING_BOOST_UNAVAILABLE", 503);
    console.info("[Moderation]", { route: "trending.boosts.list", boostCount: boosts.length });
    return moderationJsonResponse({ boosts });
  } catch (error) {
    const bounded = mapHostedAuthError(error);
    const code = bounded instanceof ModerationApiError
      ? bounded.code
      : "TRENDING_BOOST_UNAVAILABLE";
    console.warn("[Moderation]", { route: "trending.boosts.list", code });
    return moderationErrorResponse(bounded, "TRENDING_BOOST_UNAVAILABLE");
  }
}

export async function POST(request: Request) {
  try {
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
    const input = parseTrendingBoostRequest(body);
    if (!input) throw new ModerationApiError("INVALID_REQUEST", 400);

    const ownerClient = createAuthenticatedClient(request);
    const user = await authenticatedUser(ownerClient, request);
    assertModerationOperatorAllowlist(user);

    const service = createServiceClient();
    if (input.action === "clear") {
      const { data, error } = await service.rpc("clear_annotation_trending_boost", {
        p_actor_id: user.id,
        p_annotation_id: input.annotationId,
      });
      if (error) throw mapModerationRpcError(error, "TRENDING_BOOST_UNAVAILABLE");
      const row = Array.isArray(data) ? data[0] : data;
      const cleared = Boolean(
        row && typeof row === "object" && "cleared" in row && row.cleared === true,
      );
      console.info("[Moderation]", {
        route: "trending.boosts.clear",
        annotationId: input.annotationId,
        cleared,
      });
      return moderationJsonResponse({
        annotationId: input.annotationId,
        cleared,
      });
    }

    const { data, error } = await service.rpc("set_annotation_trending_boost", {
      p_actor_id: user.id,
      p_annotation_id: input.annotationId,
      p_boost: input.boost,
    });
    if (error) throw mapModerationRpcError(error, "TRENDING_BOOST_UNAVAILABLE");
    const row = parseTrendingBoostRow(Array.isArray(data) ? data[0] : data);
    if (!row) throw new ModerationApiError("TRENDING_BOOST_UNAVAILABLE", 503);
    console.info("[Moderation]", {
      route: "trending.boosts.set",
      annotationId: row.annotationId,
    });
    return moderationJsonResponse(row);
  } catch (error) {
    const bounded = mapHostedAuthError(error);
    const code = bounded instanceof ModerationApiError
      ? bounded.code
      : "TRENDING_BOOST_UNAVAILABLE";
    console.warn("[Moderation]", { route: "trending.boosts.mutate", code });
    return moderationErrorResponse(bounded, "TRENDING_BOOST_UNAVAILABLE");
  }
}
