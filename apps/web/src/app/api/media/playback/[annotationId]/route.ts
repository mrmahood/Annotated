import {
  MEDIA_PLAYBACK_CACHE_CONTROL,
  MEDIA_SIGNING_TTL_SECONDS,
  MediaPlaybackError,
  PROCESSED_MEDIA_BUCKET,
  getTrustedSignedMediaUrl,
  isPlaybackUuid,
  mediaPlaybackErrorResponse,
  parseMediaDelivery,
} from "@/lib/media-playback";
import {
  HostedMediaApiError,
  assertServiceOperation,
  createServiceClient,
} from "@/lib/hosted-media-upload";

type PlaybackRouteContext = {
  params: Promise<{ annotationId: string }>;
};

async function authorizePlayback(context: PlaybackRouteContext, head: boolean) {
  const startedAt = performance.now();
  let annotationId = "invalid";
  try {
    annotationId = (await context.params).annotationId;
    if (!isPlaybackUuid(annotationId)) {
      throw new MediaPlaybackError("MEDIA_UNAVAILABLE", 404);
    }

    const service = createServiceClient();
    const { data, error } = await service
      .rpc("get_annotation_media_delivery", { p_annotation_id: annotationId })
      .maybeSingle();
    assertServiceOperation(error, "The media delivery state could not be loaded.");
    const delivery = parseMediaDelivery(data, annotationId);
    if (!delivery) throw new MediaPlaybackError("MEDIA_UNAVAILABLE", 404);

    const { data: signed, error: signingError } = await service.storage
      .from(PROCESSED_MEDIA_BUCKET)
      .createSignedUrl(delivery.processedStoragePath, MEDIA_SIGNING_TTL_SECONDS);
    assertServiceOperation(signingError, "The media delivery authorization failed.");
    const signedUrl = getTrustedSignedMediaUrl(
      signed?.signedUrl,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    );
    if (!signedUrl) throw new MediaPlaybackError("MEDIA_UNAVAILABLE", 503);

    console.info("[Media playback]", {
      annotationId,
      code: "SIGNED",
      latencyMs: Math.round(performance.now() - startedAt),
    });
    return new Response(null, {
      status: 307,
      headers: {
        location: signedUrl,
        "cache-control": MEDIA_PLAYBACK_CACHE_CONTROL,
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    const bounded = error instanceof HostedMediaApiError && error.code === "SERVER_MISCONFIGURED"
      ? new MediaPlaybackError("SERVER_MISCONFIGURED", 500)
      : error;
    const code = bounded instanceof MediaPlaybackError
      ? bounded.code
      : "MEDIA_UNAVAILABLE";
    console.warn("[Media playback]", {
      annotationId: isPlaybackUuid(annotationId) ? annotationId : "invalid",
      code,
      latencyMs: Math.round(performance.now() - startedAt),
    });
    return mediaPlaybackErrorResponse(bounded, head);
  }
}

export function GET(_request: Request, context: PlaybackRouteContext) {
  return authorizePlayback(context, false);
}

export function HEAD(_request: Request, context: PlaybackRouteContext) {
  return authorizePlayback(context, true);
}
