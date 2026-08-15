export const MEDIA_CAPTURE_MAX_DURATION_MS = 90_000;
export const MEDIA_CAPTURE_FIXED_DURATION_MS = 15_000;
export const MEDIA_CAPTURE_CLEANUP_TOLERANCE_MS = 2_000;

export const MEDIA_CAPTURE_START = 'annotated.mediaCaptureSpike.start.v1';
export const MEDIA_CAPTURE_CANCEL = 'annotated.mediaCaptureSpike.cancel.v1';
export const MEDIA_CAPTURE_CLEAR = 'annotated.mediaCaptureSpike.clear.v1';
export const MEDIA_CAPTURE_STATUS = 'annotated.mediaCaptureSpike.status.v1';
export const MEDIA_CAPTURE_EVENT = 'annotated.mediaCaptureSpike.event.v1';
export const MEDIA_CAPTURE_OFFSCREEN_START = 'annotated.mediaCaptureSpike.offscreenStart.v1';
export const MEDIA_CAPTURE_OFFSCREEN_CANCEL = 'annotated.mediaCaptureSpike.offscreenCancel.v1';
export const MEDIA_CAPTURE_OFFSCREEN_CLEAR = 'annotated.mediaCaptureSpike.offscreenClear.v1';
export const MEDIA_CAPTURE_OFFSCREEN_STATUS = 'annotated.mediaCaptureSpike.offscreenStatus.v1';
export const MEDIA_CAPTURE_OFFSCREEN_EVENT = 'annotated.mediaCaptureSpike.offscreenEvent.v1';

export type CaptureSourceKind = 'youtube' | 'audio' | 'video';
export type CaptureRequestSourceKind = CaptureSourceKind | 'generic';

export type CaptureSourceIdentity = {
  kind: CaptureRequestSourceKind;
  pageUrl: string;
  sourceKey: string;
};

export type CaptureIntent =
  | { kind: 'fixed-duration'; durationMs: number }
  | { kind: 'selected-range'; startMs: number; endMs: number };

export type CaptureStartRequest = {
  source: CaptureSourceIdentity;
  tabId: number;
  intent: CaptureIntent;
};

export type CaptureIntentDiagnostic =
  | { kind: 'fixed-duration'; durationMs: number }
  | { kind: 'selected-range'; startMs: number; endMs: number };

export type CaptureProtocolDiagnostics = {
  panelOutbound?: CaptureIntentDiagnostic;
  backgroundAccepted?: CaptureIntentDiagnostic;
  preparePageInput?: CaptureIntentDiagnostic & { maximumDurationMs: number };
};

export type CaptureGeometry = {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  boundingClientRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null;
  videoWidth: number | null;
  videoHeight: number | null;
  objectFit: string | null;
  objectPosition: string | null;
  fullscreen: boolean;
  fullscreenElement: string | null;
  scrollX: number;
  scrollY: number;
};

export type CaptureStreamDiagnostic = {
  methodExists: boolean;
  callSucceeded: boolean;
  audioTrackCount: number;
  videoTrackCount: number;
  tracks: Array<{ kind: string; readyState: string; enabled: boolean; muted: boolean }>;
  currentSourceCrossOrigin: boolean | null;
  crossOriginAttribute: string | null;
  exceptionName: string | null;
  exceptionMessage: string | null;
};

export type CapturePreparedPage = {
  sourceKind: CaptureSourceKind;
  requestedStartMs: number;
  requestedEndMs: number;
  requestedDurationMs: number;
  playerCurrentTimeBeforeRecordingMs: number;
  mediaDurationMs: number | null;
  pageUrl: string;
  geometry: CaptureGeometry;
};

export type CaptureTrackDiagnostic = {
  kind: string;
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: string;
  settings: Record<string, string | number | boolean>;
};

export type CaptureResult = CapturePreparedPage & {
  captureId: string;
  status: 'recorded';
  previewUrl: string;
  selectedMimeType: string;
  blobMimeType: string;
  byteSize: number;
  audioTrackCount: number;
  videoTrackCount: number;
  tracks: CaptureTrackDiagnostic[];
  actualRecordingStartTimestamp: number;
  actualRecordingEndTimestamp: number;
  recordingElapsedMs: number;
  blobDurationMs: number | null;
  durationDifferenceMs: number;
  playerCurrentTimeAfterRecordingMs: number | null;
  audiblePlaybackConnected: boolean;
  stopReason: 'duration-reached' | 'user-stop' | 'failsafe';
  allTracksStopped: boolean;
};

export type CaptureFailureCode =
  | 'busy'
  | 'connected-source-changed'
  | 'connected-tab-closed'
  | 'invalid-request'
  | 'media-recorder-unsupported'
  | 'no-audio-track'
  | 'no-video-track'
  | 'offscreen-unavailable'
  | 'player-unavailable'
  | 'protected-or-muted'
  | 'restricted-page'
  | 'stream-id-unavailable'
  | 'tab-capture-denied'
  | 'unexpected';

export type CaptureFailure = {
  captureId: string | null;
  status: 'error' | 'cancelled';
  code: CaptureFailureCode;
  message: string;
};

export type CaptureProgress = {
  captureId: string;
  status: 'preparing' | 'recording' | 'stopping';
  requestedDurationMs?: number;
  actualRecordingStartTimestamp?: number;
};

export type CaptureSnapshot =
  | { status: 'idle' }
  | CaptureProgress
  | CaptureResult
  | CaptureFailure;

export type CaptureUiState = CaptureSnapshot;

export type CaptureUiAction =
  | { type: 'prepare'; captureId: string }
  | { type: 'event'; snapshot: CaptureSnapshot }
  | { type: 'clear' };

export type CaptureStartResponse = {
  ok: boolean;
  snapshot: CaptureUiState;
  protocolDiagnostics: CaptureProtocolDiagnostics;
};

export type MediaCapturePanelSource =
  | 'youtube'
  | 'podcast'
  | 'video'
  | 'unsupported'
  | 'not-connected';

export type MediaCapturePanelDiagnostic = {
  source: MediaCapturePanelSource;
  connectedTab: 'connected' | 'missing';
  sourceIdentity: 'match' | 'mismatch' | 'unknown';
  player: 'ready' | 'not-ready' | 'not-found' | 'checking';
};

export type MediaCaptureEligibility = {
  eligible: boolean;
  blockedReason: string | null;
};

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

const AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function getCaptureDurationError(startMs: number, endMs: number): string | null {
  if (!isNonNegativeSafeInteger(startMs) || !isNonNegativeSafeInteger(endMs)) {
    return 'Capture times must be non-negative whole milliseconds.';
  }
  if (endMs <= startMs) return 'Capture end must be after capture start.';
  if (endMs - startMs < 1_000) return 'Capture duration must be at least one second.';
  if (endMs - startMs > MEDIA_CAPTURE_MAX_DURATION_MS) {
    return 'The media capture spike has a hard 90-second maximum.';
  }
  return null;
}

export function getCaptureIntentDiagnostic(intent: CaptureIntent): CaptureIntentDiagnostic {
  return intent.kind === 'fixed-duration'
    ? { kind: 'fixed-duration', durationMs: intent.durationMs }
    : { kind: 'selected-range', startMs: intent.startMs, endMs: intent.endMs };
}

export function getMediaCaptureEligibility(
  diagnostic: MediaCapturePanelDiagnostic,
  captureActive = false,
): MediaCaptureEligibility {
  if (captureActive) {
    return { eligible: false, blockedReason: 'A media capture is already active.' };
  }
  if (diagnostic.connectedTab === 'missing' || diagnostic.source === 'not-connected') {
    return { eligible: false, blockedReason: 'No supported connected media source.' };
  }
  if (diagnostic.sourceIdentity === 'mismatch') {
    return { eligible: false, blockedReason: 'Connected source no longer matches this tab.' };
  }
  if (diagnostic.sourceIdentity === 'unknown') {
    return { eligible: false, blockedReason: 'The connected source identity could not be verified.' };
  }
  if (diagnostic.source === 'unsupported') {
    return { eligible: false, blockedReason: 'No supported media player detected.' };
  }
  if (diagnostic.player === 'checking') {
    return { eligible: false, blockedReason: 'Checking the connected media player.' };
  }
  if (diagnostic.player === 'not-found') {
    return { eligible: false, blockedReason: 'No supported media player detected.' };
  }
  if (diagnostic.player === 'not-ready') {
    return { eligible: false, blockedReason: 'Player timing is not ready.' };
  }
  return { eligible: true, blockedReason: null };
}

export function selectCaptureMimeType(
  expectVideo: boolean,
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  const candidates = expectVideo ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
  return candidates.find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

export function getCaptureTrackExpectation(sourceKind: CaptureSourceKind): {
  audioRequired: true;
  videoRequired: boolean;
} {
  return { audioRequired: true, videoRequired: sourceKind !== 'audio' };
}

export function captureRequestMatchesConnectedTab(
  request: CaptureStartRequest,
  connected: { tabId: number; url: string } | null,
  liveTab: { id?: number; url?: string } | null,
): boolean {
  return Boolean(
    connected && liveTab && connected.tabId === request.tabId && liveTab.id === request.tabId &&
    connected.url === request.source.pageUrl &&
    sourceIdentityMatchesUrl(request.source, connected.url) &&
    typeof liveTab.url === 'string' && sourceIdentityMatchesUrl(request.source, liveTab.url),
  );
}

export function hasCompleteCaptureCleanup(state: CaptureUiState): boolean {
  if (state.status === 'preparing' || state.status === 'recording' || state.status === 'stopping') return false;
  if (state.status === 'recorded') return state.allTracksStopped;
  return true;
}

export function reduceCaptureUiState(
  state: CaptureUiState,
  action: CaptureUiAction,
): CaptureUiState {
  if (action.type === 'clear') return { status: 'idle' };
  if (action.type === 'prepare') {
    if (state.status === 'preparing' || state.status === 'recording' || state.status === 'stopping') {
      return state;
    }
    return { status: 'preparing', captureId: action.captureId };
  }
  const next = action.snapshot;
  if (next.status === 'idle') return next;
  if (
    'captureId' in state && state.captureId && state.captureId !== 'pending' &&
    next.captureId !== state.captureId
  ) return state;
  if (state.status === 'recorded' || state.status === 'error' || state.status === 'cancelled') {
    return state;
  }
  return next;
}

export function isCaptureStartRequest(value: unknown): value is CaptureStartRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.intent)) return false;
  const source = value.source;
  const validKind = source.kind === 'youtube' || source.kind === 'audio' ||
    source.kind === 'video' || source.kind === 'generic';
  if (
    !validKind || typeof source.pageUrl !== 'string' || !source.pageUrl ||
    typeof source.sourceKey !== 'string' || !source.sourceKey ||
    !isNonNegativeSafeInteger(value.tabId)
  ) return false;
  if (value.intent.kind === 'fixed-duration') {
    return isNonNegativeSafeInteger(value.intent.durationMs) &&
      value.intent.durationMs >= 1_000 && value.intent.durationMs <= MEDIA_CAPTURE_MAX_DURATION_MS;
  }
  return value.intent.kind === 'selected-range' &&
    getCaptureDurationError(value.intent.startMs as number, value.intent.endMs as number) === null;
}

export function isMediaCaptureStartMessage(value: unknown): value is {
  target: 'background';
  type: typeof MEDIA_CAPTURE_START;
  request: CaptureStartRequest;
} {
  return isRecord(value) && value.target === 'background' &&
    value.type === MEDIA_CAPTURE_START && isCaptureStartRequest(value.request);
}

export type OffscreenStartMessage = {
  target: 'offscreen';
  type: typeof MEDIA_CAPTURE_OFFSCREEN_START;
  captureId: string;
  streamId: string;
  prepared: CapturePreparedPage;
};

export function isOffscreenStartMessage(value: unknown): value is OffscreenStartMessage {
  if (!isRecord(value) || !isRecord(value.prepared)) return false;
  const prepared = value.prepared;
  const geometry = prepared.geometry;
  const finiteNumber = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry);
  const nullableFiniteNumber = (entry: unknown) => entry === null || finiteNumber(entry);
  const nullableString = (entry: unknown) => entry === null || typeof entry === 'string';
  const rect = isRecord(geometry) ? geometry.boundingClientRect : undefined;
  const validRect = rect === null || (
    isRecord(rect) && finiteNumber(rect.x) && finiteNumber(rect.y) &&
    finiteNumber(rect.width) && finiteNumber(rect.height) && finiteNumber(rect.top) &&
    finiteNumber(rect.right) && finiteNumber(rect.bottom) && finiteNumber(rect.left)
  );
  const validGeometry = isRecord(geometry) && finiteNumber(geometry.viewportWidth) &&
    finiteNumber(geometry.viewportHeight) && finiteNumber(geometry.devicePixelRatio) &&
    validRect && nullableFiniteNumber(geometry.videoWidth) &&
    nullableFiniteNumber(geometry.videoHeight) && nullableString(geometry.objectFit) &&
    nullableString(geometry.objectPosition) && typeof geometry.fullscreen === 'boolean' &&
    nullableString(geometry.fullscreenElement) && finiteNumber(geometry.scrollX) &&
    finiteNumber(geometry.scrollY);
  return value.target === 'offscreen' && value.type === MEDIA_CAPTURE_OFFSCREEN_START &&
    typeof value.captureId === 'string' && value.captureId.length >= 8 &&
    typeof value.streamId === 'string' && value.streamId.length > 0 &&
    (prepared.sourceKind === 'youtube' || prepared.sourceKind === 'audio' || prepared.sourceKind === 'video') &&
    isNonNegativeSafeInteger(prepared.requestedStartMs) &&
    isNonNegativeSafeInteger(prepared.requestedEndMs) &&
    isNonNegativeSafeInteger(prepared.requestedDurationMs) &&
    prepared.requestedDurationMs >= 1_000 &&
    prepared.requestedDurationMs === prepared.requestedEndMs - prepared.requestedStartMs &&
    getCaptureDurationError(prepared.requestedStartMs, prepared.requestedEndMs) === null &&
    finiteNumber(prepared.playerCurrentTimeBeforeRecordingMs) &&
    nullableFiniteNumber(prepared.mediaDurationMs) &&
    typeof prepared.pageUrl === 'string' && prepared.pageUrl.length > 0 && validGeometry;
}

export function sourceIdentityMatchesUrl(
  source: CaptureSourceIdentity,
  actualUrl: string,
): boolean {
  try {
    const expected = new URL(source.pageUrl);
    const actual = new URL(actualUrl);
    if (!['http:', 'https:'].includes(expected.protocol) || !['http:', 'https:'].includes(actual.protocol)) {
      return false;
    }
    if (source.kind === 'youtube') {
      const host = actual.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;
      return actual.pathname === '/watch' && actual.searchParams.get('v') === source.sourceKey;
    }
    if (source.kind === 'audio') {
      return normalizeAudioSourceUrl(actual.href) === source.sourceKey ||
        normalizeAudioSourceUrl(actual.href) === normalizeAudioSourceUrl(source.pageUrl);
    }
    return normalizeComparableUrl(actual) === normalizeComparableUrl(expected);
  } catch {
    return false;
  }
}

export function normalizeComparableUrl(value: string | URL): string {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}
import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';
