import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import { normalizeArticleUrl } from '@annotated/shared/url-normalization';

export const MEDIA_CAPTURE_MAX_DURATION_MS = 90_000;
export const MEDIA_CAPTURE_FAILSAFE_MS = 92_000;
export const MEDIA_CAPTURE_START = 'annotated.mediaCapture.start.v1';
export const MEDIA_CAPTURE_CANCEL = 'annotated.mediaCapture.cancel.v1';
export const MEDIA_CAPTURE_RETRY = 'annotated.mediaCapture.retry.v1';
export const MEDIA_CAPTURE_STATUS = 'annotated.mediaCapture.status.v1';
export const MEDIA_CAPTURE_EVENT = 'annotated.mediaCapture.event.v1';
export const MEDIA_CAPTURE_OFFSCREEN_START = 'annotated.mediaCapture.offscreenStart.v1';
export const MEDIA_CAPTURE_OFFSCREEN_PLAYBACK = 'annotated.mediaCapture.offscreenPlayback.v1';
export const MEDIA_CAPTURE_OFFSCREEN_CANCEL = 'annotated.mediaCapture.offscreenCancel.v1';
export const MEDIA_CAPTURE_OFFSCREEN_RETRY = 'annotated.mediaCapture.offscreenRetry.v1';
export const MEDIA_CAPTURE_OFFSCREEN_STATUS = 'annotated.mediaCapture.offscreenStatus.v1';
export const MEDIA_CAPTURE_OFFSCREEN_EVENT = 'annotated.mediaCapture.offscreenEvent.v1';
export const MEDIA_CAPTURE_OFFSCREEN_NEEDS_END = 'annotated.mediaCapture.offscreenNeedsEnd.v1';

export type CaptureSourceIdentity = {
  kind: 'youtube' | 'tiktok' | 'web-video' | 'audio';
  pageUrl: string;
  sourceKey: string;
  playerIdentity: string;
};
export type HostedMediaOperation = {
  annotationId: string; mediaId: string; creatorHandle: string; annotationSlug: string;
  processingStatus: 'capture_pending';
};
export type CaptureStartRequest = {
  captureId: string; tabId: number; source: CaptureSourceIdentity; startMs: number; endMs: number;
  operation: HostedMediaOperation; accessToken: string; apiOrigin: string;
};
export type CaptureRect = {
  x: number; y: number; width: number; height: number;
  top: number; right: number; bottom: number; left: number;
};
export type CaptureGeometry = {
  viewportWidth: number; viewportHeight: number; devicePixelRatio: number;
  boundingClientRect: CaptureRect | null; videoWidth: number | null; videoHeight: number | null;
  objectFit: string | null; objectPosition: string | null; fullscreen: boolean;
  fullscreenElement: string | null; scrollX: number; scrollY: number;
  frameMapping: null | {
    path: string; origin: string; viewportWidth: number; viewportHeight: number;
    borderLeft: number; borderRight: number; borderTop: number; borderBottom: number;
  };
};
export type CapturePreparedPage = {
  sourceKind: 'youtube' | 'tiktok' | 'web-video' | 'audio'; requestedStartMs: number; requestedEndMs: number;
  requestedDurationMs: number; playerCurrentTimeBeforeRecordingMs: number;
  mediaDurationMs: number | null; pageUrl: string; geometry: CaptureGeometry;
};
export type CaptureTrack = {
  kind: string; label: string; enabled: boolean; muted: boolean; readyState: string;
  settings: Record<string, string | number | boolean>;
};
export type CaptureMetadata = {
  version: 2;
  viewport?: {
    start: CaptureViewport;
    end: CaptureViewport;
  };
  video_element?: { start: CaptureRect | null; end: CaptureRect | null };
  intrinsic_video?: { width: number | null; height: number | null };
  computed_style?: { object_fit: string | null; object_position: string | null };
  fullscreen?: { start: boolean; end: boolean };
  capture_track: {
    mime_type: string; audio_track_count: number; video_track_count: number;
    tracks: CaptureTrack[]; loopback_enabled: boolean;
  };
  timing: {
    requested_start_ms: number; requested_end_ms: number; requested_duration_ms: number;
    lead_in_ms: number;
    recorder_elapsed_ms: number; player_start_ms: number | null; player_end_ms: number | null;
    lead_in_clock: 'offscreen_monotonic';
  };
};
export type CaptureViewport = {
  width: number; height: number; device_pixel_ratio: number; scroll_x: number; scroll_y: number;
};
export type CaptureMetadataV2Input = {
  prepared: CapturePreparedPage;
  endGeometry: CaptureGeometry | null;
  selectedMimeType: string;
  tracks: CaptureTrack[];
  audioTrackCount: number;
  videoTrackCount: number;
  loopbackEnabled: boolean;
  leadInMs: number;
  recorderElapsedMs: number;
  playerStartMs: number | null;
  playerEndMs: number | null;
};

function viewportSample(geometry: CaptureGeometry): CaptureViewport {
  return {
    width: geometry.viewportWidth,
    height: geometry.viewportHeight,
    device_pixel_ratio: geometry.devicePixelRatio,
    scroll_x: geometry.scrollX,
    scroll_y: geometry.scrollY,
  };
}

export function buildCaptureMetadataV2(input: CaptureMetadataV2Input): CaptureMetadata {
  const start = input.prepared.geometry;
  const video = input.prepared.sourceKind !== 'audio';
  if (video && (
    !input.endGeometry || !start.boundingClientRect || !input.endGeometry.boundingClientRect ||
    start.videoWidth === null || start.videoHeight === null ||
    start.objectFit === null || start.objectPosition === null
  )) {
    throw new Error('recapture-required');
  }
  if (input.prepared.sourceKind === 'web-video') {
    const first = start.frameMapping;
    const last = input.endGeometry?.frameMapping;
    const close = (left: number, right: number) => Math.abs(left - right) <= 1;
    if (!first || !last || first.path !== last.path || first.origin !== last.origin ||
        !close(first.viewportWidth, last.viewportWidth) || !close(first.viewportHeight, last.viewportHeight) ||
        !close(first.borderLeft, last.borderLeft) || !close(first.borderRight, last.borderRight) ||
        !close(first.borderTop, last.borderTop) || !close(first.borderBottom, last.borderBottom)) {
      throw new Error('recapture-required');
    }
  }
  const end = input.endGeometry;
  return {
    version: 2,
    ...(video ? {
      viewport: { start: viewportSample(start), end: viewportSample(end!) },
      video_element: { start: start.boundingClientRect, end: end!.boundingClientRect },
      intrinsic_video: { width: start.videoWidth, height: start.videoHeight },
      computed_style: { object_fit: start.objectFit, object_position: start.objectPosition },
      fullscreen: { start: start.fullscreen, end: end!.fullscreen },
    } : {}),
    capture_track: {
      mime_type: input.selectedMimeType,
      audio_track_count: input.audioTrackCount,
      video_track_count: input.videoTrackCount,
      tracks: input.tracks,
      loopback_enabled: input.loopbackEnabled,
    },
    timing: {
      requested_start_ms: input.prepared.requestedStartMs,
      requested_end_ms: input.prepared.requestedEndMs,
      requested_duration_ms: input.prepared.requestedDurationMs,
      lead_in_ms: input.leadInMs,
      recorder_elapsed_ms: input.recorderElapsedMs,
      player_start_ms: input.playerStartMs,
      player_end_ms: input.playerEndMs,
      lead_in_clock: 'offscreen_monotonic',
    },
  };
}
export type CaptureFailureCode =
  | 'busy' | 'connected-source-changed' | 'connected-tab-closed' | 'invalid-request'
  | 'media-recorder-unsupported' | 'no-audio-track' | 'no-video-track'
  | 'offscreen-unavailable' | 'player-unavailable' | 'protected-or-muted'
  | 'stream-id-unavailable' | 'tab-capture-denied' | 'upload-failed'
  | 'authorization-failed' | 'completion-failed' | 'recapture-required'
  | 'raw-capture-unavailable' | 'unexpected';
export type PreparationDiagnosticCode =
  | 'PLAYER_NOT_FOUND' | 'PLAYER_NOT_READY' | 'SOURCE_CHANGED' | 'RANGE_INVALID'
  | 'SCRIPT_INJECTION_FAILED' | 'PREPARATION_RESULT_MISSING'
  | 'PREPARATION_RESULT_INVALID' | 'STALE_CAPTURE' | 'NAVIGATION_CHANGED';
export type CaptureSnapshot =
  | { status: 'idle' }
  | { status: 'preparing' | 'capturing' | 'stopping'; captureId: string; requestedDurationMs?: number }
  | { status: 'uploading'; captureId: string; progress: number }
  | { status: 'waiting-to-upload'; captureId: string; message: string }
  | { status: 'verifying-upload'; captureId: string; annotationId: string; mediaId: string }
  | { status: 'processing'; captureId: string; annotationId: string; mediaId: string }
  | { status: 'error' | 'cancelled'; captureId: string | null; code: CaptureFailureCode; message: string; diagnosticCode?: PreparationDiagnosticCode };
export type CaptureStartResponse = { ok: boolean; snapshot: CaptureSnapshot };
export type OffscreenStartMessage = {
  target: 'offscreen'; type: typeof MEDIA_CAPTURE_OFFSCREEN_START; captureId: string;
  streamId: string; request: CaptureStartRequest; prepared: CapturePreparedPage;
};

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
] as const;
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isInteger(value: unknown): value is number { return Number.isSafeInteger(value); }
export function isCurrentCaptureId(activeCaptureId: string | null, expectedCaptureId: string) {
  return activeCaptureId === expectedCaptureId;
}
export function isCaptureId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isMediaUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function getCaptureRangeError(startMs: unknown, endMs: unknown): string | null {
  if (!isInteger(startMs) || !isInteger(endMs) || startMs < 0) {
    return 'Capture times must be non-negative whole milliseconds.';
  }
  const duration = endMs - startMs;
  if (duration < 1_000) return 'Capture duration must be at least one second.';
  if (duration > MEDIA_CAPTURE_MAX_DURATION_MS) return 'Capture duration cannot exceed 90 seconds.';
  return null;
}
export function selectCaptureMimeType(expectVideo: boolean, isSupported: (mime: string) => boolean) {
  return (expectVideo ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES).find(isSupported) ?? null;
}
export async function executeHostedMediaUpload(stages: {
  authorize: () => Promise<string>;
  upload: (signedUrl: string) => Promise<void>;
  complete: () => Promise<void>;
}) {
  const signedUrl = await stages.authorize();
  await stages.upload(signedUrl);
  await stages.complete();
  return 'verifying-upload' as const;
}
export function sourceIdentityMatchesUrl(source: CaptureSourceIdentity, value: string): boolean {
  try {
    const actual = new URL(value);
    if (!['http:', 'https:'].includes(actual.protocol)) return false;
    if (source.kind === 'youtube') {
      const host = actual.hostname.toLowerCase().replace(/^www\./, '');
      return (host === 'youtube.com' || host === 'm.youtube.com') &&
        actual.pathname === '/watch' && actual.searchParams.get('v') === source.sourceKey;
    }
    if (source.kind === 'tiktok') {
      try {
        return getTikTokVideoIdentity(actual.href).videoId === source.sourceKey &&
          getTikTokVideoIdentity(source.pageUrl).videoId === source.sourceKey;
      } catch {
        return false;
      }
    }
    if (source.kind === 'web-video') {
      return normalizeArticleUrl(actual.href) === source.sourceKey &&
        normalizeArticleUrl(source.pageUrl) === source.sourceKey;
    }
    return normalizeAudioSourceUrl(actual.href) === source.sourceKey &&
      normalizeAudioSourceUrl(source.pageUrl) === source.sourceKey;
  } catch { return false; }
}
export function captureRequestMatchesConnectedTab(
  request: CaptureStartRequest,
  connected: { tabId: number; url: string } | null,
  live: { id?: number; url?: string } | null,
): boolean {
  return Boolean(connected && live && connected.tabId === request.tabId && live.id === request.tabId &&
    connected.url === request.source.pageUrl && sourceIdentityMatchesUrl(request.source, connected.url) &&
    typeof live.url === 'string' && sourceIdentityMatchesUrl(request.source, live.url));
}
export function isHostedMediaOperation(value: unknown): value is HostedMediaOperation {
  return isRecord(value) && isMediaUuid(value.annotationId) && isMediaUuid(value.mediaId) &&
    typeof value.creatorHandle === 'string' && value.creatorHandle.length > 0 &&
    typeof value.annotationSlug === 'string' && value.annotationSlug.length > 0 &&
    value.processingStatus === 'capture_pending';
}
export function isCaptureStartRequest(value: unknown): value is CaptureStartRequest {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  return isCaptureId(value.captureId) && isInteger(value.tabId) && value.tabId >= 0 &&
    (value.source.kind === 'youtube' || value.source.kind === 'tiktok' || value.source.kind === 'web-video' || value.source.kind === 'audio') &&
    typeof value.source.pageUrl === 'string' && value.source.pageUrl.length > 0 &&
    typeof value.source.sourceKey === 'string' && value.source.sourceKey.length > 0 &&
    typeof value.source.playerIdentity === 'string' && (
      value.source.kind === 'youtube' || value.source.kind === 'tiktok'
        ? /^video:[1-5]:[0-9a-f]{8}$/.test(value.source.playerIdentity)
        : value.source.kind === 'web-video'
          ? /^web-video:(?:top|[1-9][0-9]*(?:\.[1-9][0-9]*)*):[1-5]:[0-9a-f]{8}$/.test(value.source.playerIdentity)
        : /^(?:audio|audio-only-video):[1-5]:[0-9a-f]{8}$/.test(value.source.playerIdentity)
    ) &&
    getCaptureRangeError(value.startMs, value.endMs) === null &&
    isHostedMediaOperation(value.operation) && typeof value.accessToken === 'string' &&
    value.accessToken.length > 20 && typeof value.apiOrigin === 'string' &&
    /^https?:\/\//.test(value.apiOrigin);
}
export function isMediaCaptureStartMessage(value: unknown): value is {
  target: 'background'; type: typeof MEDIA_CAPTURE_START; request: CaptureStartRequest;
} {
  return isRecord(value) && value.target === 'background' &&
    value.type === MEDIA_CAPTURE_START && isCaptureStartRequest(value.request);
}
export function isMediaCaptureCancelMessage(value: unknown): value is {
  target: 'background'; type: typeof MEDIA_CAPTURE_CANCEL;
  captureId: string | null; operation: HostedMediaOperation;
} {
  return isRecord(value) && value.target === 'background' && value.type === MEDIA_CAPTURE_CANCEL &&
    (value.captureId === null || isCaptureId(value.captureId)) &&
    isHostedMediaOperation(value.operation);
}
export function isCapturePreparedPage(value: unknown): value is CapturePreparedPage {
  if (!isRecord(value) || !isRecord(value.geometry)) return false;
  const finite = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry);
  const nullableFinite = (entry: unknown) => entry === null || finite(entry);
  const nullableString = (entry: unknown) => entry === null || typeof entry === 'string';
  const geometry = value.geometry;
  const rect = geometry.boundingClientRect;
  const validRect = rect === null || (isRecord(rect) &&
    ['x','y','width','height','top','right','bottom','left'].every((key) => finite(rect[key])));
  const frameMapping = geometry.frameMapping;
  const noFrameMapping = frameMapping === null || frameMapping === undefined;
  const validFrameMapping = noFrameMapping || (isRecord(frameMapping) &&
    typeof frameMapping.path === 'string' && /^(?:top|[1-9][0-9]*(?:\.[1-9][0-9]*)*)$/.test(frameMapping.path) &&
    typeof frameMapping.origin === 'string' && /^https?:\/\//.test(frameMapping.origin) &&
    ['viewportWidth','viewportHeight','borderLeft','borderRight','borderTop','borderBottom']
      .every((key) => finite(frameMapping[key])));
  return (value.sourceKind === 'youtube' || value.sourceKind === 'web-video' || value.sourceKind === 'audio') &&
    isInteger(value.requestedStartMs) && isInteger(value.requestedEndMs) &&
    value.requestedDurationMs === value.requestedEndMs - value.requestedStartMs &&
    getCaptureRangeError(value.requestedStartMs, value.requestedEndMs) === null &&
    finite(value.playerCurrentTimeBeforeRecordingMs) && nullableFinite(value.mediaDurationMs) &&
    typeof value.pageUrl === 'string' && finite(geometry.viewportWidth) &&
    finite(geometry.viewportHeight) && finite(geometry.devicePixelRatio) && validRect &&
    nullableFinite(geometry.videoWidth) && nullableFinite(geometry.videoHeight) &&
    nullableString(geometry.objectFit) && nullableString(geometry.objectPosition) &&
    typeof geometry.fullscreen === 'boolean' && nullableString(geometry.fullscreenElement) &&
    finite(geometry.scrollX) && finite(geometry.scrollY) && validFrameMapping &&
    (value.sourceKind === 'web-video' ? !noFrameMapping : noFrameMapping);
}
export function isOffscreenStartMessage(value: unknown): value is OffscreenStartMessage {
  return isRecord(value) && value.target === 'offscreen' &&
    value.type === MEDIA_CAPTURE_OFFSCREEN_START &&
    isCaptureId(value.captureId) &&
    typeof value.streamId === 'string' && value.streamId.length > 0 &&
    isCaptureStartRequest(value.request) && isCapturePreparedPage(value.prepared) &&
    value.captureId === value.request.captureId &&
    value.request.startMs === value.prepared.requestedStartMs &&
    value.request.endMs === value.prepared.requestedEndMs;
}
