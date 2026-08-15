import {
  MEDIA_CAPTURE_CLEANUP_TOLERANCE_MS,
  MEDIA_CAPTURE_MAX_DURATION_MS,
  MEDIA_CAPTURE_OFFSCREEN_CANCEL,
  MEDIA_CAPTURE_OFFSCREEN_CLEAR,
  MEDIA_CAPTURE_OFFSCREEN_EVENT,
  MEDIA_CAPTURE_OFFSCREEN_START,
  MEDIA_CAPTURE_OFFSCREEN_STATUS,
  isOffscreenStartMessage,
  selectCaptureMimeType,
  type CaptureFailure,
  type CapturePreparedPage,
  type CaptureResult,
  type CaptureSnapshot,
  type CaptureTrackDiagnostic,
  type OffscreenStartMessage,
} from '../../utils/media-capture-spike';

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;

type ActiveCapture = {
  captureId: string;
  prepared: CapturePreparedPage;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  selectedMimeType: string;
  startedAtEpochMs: number;
  startedAtPerformanceMs: number;
  stopReason: CaptureResult['stopReason'];
  cancelled: CaptureFailure | null;
  durationTimer: number;
  failsafeTimer: number;
  audioContext: AudioContext | null;
  audioSource: MediaStreamAudioSourceNode | null;
  audiblePlaybackConnected: boolean;
};

let active: ActiveCapture | null = null;
let snapshot: CaptureSnapshot = { status: 'idle' };
let previewUrl: string | null = null;

function sendOffscreenEvent(next: CaptureSnapshot) {
  snapshot = next;
  void chrome.runtime.sendMessage({
    target: 'background',
    type: MEDIA_CAPTURE_OFFSCREEN_EVENT,
    snapshot: next,
  }).catch(() => undefined);
}

function primitiveSettings(track: MediaStreamTrack): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(track.getSettings())) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

function trackDiagnostics(stream: MediaStream): CaptureTrackDiagnostic[] {
  return stream.getTracks().map((track) => ({
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: primitiveSettings(track),
  }));
}

function captureError(error: unknown): CaptureFailure {
  const name = error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { captureId: null, status: 'error', code: 'tab-capture-denied', message: `Tab capture was denied: ${message}` };
  }
  if (name === 'NotFoundError' || /no (?:audio|video) track/i.test(message)) {
    return { captureId: null, status: 'error', code: 'protected-or-muted', message: `The tab did not expose usable capture tracks: ${message}` };
  }
  return { captureId: null, status: 'error', code: 'unexpected', message: `Tab recording failed: ${message}` };
}

async function closeAudioLoopback(capture: ActiveCapture) {
  try { capture.audioSource?.disconnect(); } catch { /* Already disconnected. */ }
  capture.audioSource = null;
  const context = capture.audioContext;
  capture.audioContext = null;
  if (context && context.state !== 'closed') {
    try { await context.close(); } catch { /* Best-effort teardown. */ }
  }
}

async function measureBlobDuration(preview: string, hasVideo: boolean): Promise<number | null> {
  const media = document.createElement(hasVideo ? 'video' : 'audio');
  media.preload = 'metadata';
  media.muted = true;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      media.removeAttribute('src');
      media.load();
      media.remove();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 3_000);
    media.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(media.duration) && media.duration >= 0
        ? Math.round(media.duration * 1_000)
        : null);
    }, { once: true });
    media.addEventListener('error', () => finish(null), { once: true });
    media.src = preview;
    media.load();
  });
}

async function releaseCapture(capture: ActiveCapture) {
  window.clearTimeout(capture.durationTimer);
  window.clearTimeout(capture.failsafeTimer);
  capture.stream.getTracks().forEach((track) => track.stop());
  await closeAudioLoopback(capture);
}

async function finalizeCapture(capture: ActiveCapture) {
  if (active !== capture) return;
  const endedAtEpochMs = Date.now();
  const elapsedMs = Math.max(0, Math.round(performance.now() - capture.startedAtPerformanceMs));
  const beforeStopTracks = trackDiagnostics(capture.stream);
  const audioTrackCount = capture.stream.getAudioTracks().length;
  const videoTrackCount = capture.stream.getVideoTracks().length;
  const blob = new Blob(capture.chunks, { type: capture.recorder.mimeType || capture.selectedMimeType });
  await releaseCapture(capture);
  const allTracksStopped = capture.stream.getTracks().every((track) => track.readyState === 'ended');
  active = null;

  if (capture.cancelled) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    sendOffscreenEvent({ ...capture.cancelled, captureId: capture.captureId });
    return;
  }

  if (blob.size === 0) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    sendOffscreenEvent({
      captureId: capture.captureId,
      status: 'error',
      code: 'protected-or-muted',
      message: 'MediaRecorder produced an empty Blob for the connected tab.',
    });
    return;
  }

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const blobDurationMs = await measureBlobDuration(previewUrl, videoTrackCount > 0);
  const measuredDurationMs = blobDurationMs ?? elapsedMs;
  const result: CaptureResult = {
    ...capture.prepared,
    captureId: capture.captureId,
    status: 'recorded',
    previewUrl,
    selectedMimeType: capture.selectedMimeType,
    blobMimeType: blob.type,
    byteSize: blob.size,
    audioTrackCount,
    videoTrackCount,
    tracks: beforeStopTracks,
    actualRecordingStartTimestamp: capture.startedAtEpochMs,
    actualRecordingEndTimestamp: endedAtEpochMs,
    recordingElapsedMs: elapsedMs,
    blobDurationMs,
    durationDifferenceMs: measuredDurationMs - capture.prepared.requestedDurationMs,
    playerCurrentTimeAfterRecordingMs: null,
    audiblePlaybackConnected: capture.audiblePlaybackConnected,
    stopReason: capture.stopReason,
    allTracksStopped,
  };
  sendOffscreenEvent(result);
}

function stopActive(reason: CaptureResult['stopReason']) {
  const capture = active;
  if (!capture || capture.recorder.state === 'inactive') return;
  capture.stopReason = reason;
  snapshot = { status: 'stopping', captureId: capture.captureId };
  try {
    capture.recorder.requestData();
    capture.recorder.stop();
  } catch (error) {
    capture.cancelled = captureError(error);
    void finalizeCapture(capture);
  }
}

async function cancelActive(code: CaptureFailure['code'], message: string) {
  const capture = active;
  if (!capture) {
    snapshot = { status: 'idle' };
    return;
  }
  capture.cancelled = { captureId: capture.captureId, status: 'cancelled', code, message };
  if (capture.recorder.state === 'inactive') await finalizeCapture(capture);
  else stopActive('user-stop');
}

async function startCapture(message: OffscreenStartMessage): Promise<CaptureSnapshot> {
  if (active) {
    return {
      captureId: message.captureId,
      status: 'error',
      code: 'busy',
      message: 'Another media capture is already active.',
    };
  }
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return {
      captureId: message.captureId,
      status: 'error',
      code: 'media-recorder-unsupported',
      message: 'MediaRecorder is unavailable in the offscreen document.',
    };
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  let stream: MediaStream | null = null;
  try {
    const tabConstraint = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId,
      },
    } as unknown as MediaTrackConstraints;
    const expectVideo = message.prepared.sourceKind !== 'audio';
    stream = await navigator.mediaDevices.getUserMedia({
      audio: tabConstraint,
      video: expectVideo ? tabConstraint : false,
    });
    const audioTrackCount = stream.getAudioTracks().length;
    const videoTrackCount = stream.getVideoTracks().length;
    if (audioTrackCount === 0) {
      stream.getTracks().forEach((track) => track.stop());
      return {
        captureId: message.captureId,
        status: 'error',
        code: 'no-audio-track',
        message: 'The connected tab did not provide an audio track.',
      };
    }
    if (expectVideo && videoTrackCount === 0) {
      stream.getTracks().forEach((track) => track.stop());
      return {
        captureId: message.captureId,
        status: 'error',
        code: 'no-video-track',
        message: 'The connected video tab did not provide a video track.',
      };
    }
    const selectedMimeType = selectCaptureMimeType(expectVideo, MediaRecorder.isTypeSupported.bind(MediaRecorder));
    if (!selectedMimeType) {
      stream.getTracks().forEach((track) => track.stop());
      return {
        captureId: message.captureId,
        status: 'error',
        code: 'media-recorder-unsupported',
        message: `No supported ${expectVideo ? 'video' : 'audio'} WebM MediaRecorder MIME type was found.`,
      };
    }

    let audioContext: AudioContext | null = null;
    let audioSource: MediaStreamAudioSourceNode | null = null;
    let audiblePlaybackConnected = false;
    try {
      audioContext = new AudioContext();
      audioSource = audioContext.createMediaStreamSource(stream);
      audioSource.connect(audioContext.destination);
      if (audioContext.state === 'suspended') await audioContext.resume();
      audiblePlaybackConnected = audioContext.state === 'running';
    } catch {
      try { audioSource?.disconnect(); } catch { /* No connection. */ }
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => undefined);
      audioContext = null;
      audioSource = null;
    }

    const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
    const chunks: Blob[] = [];
    const capture: ActiveCapture = {
      captureId: message.captureId,
      prepared: message.prepared,
      recorder,
      stream,
      chunks,
      selectedMimeType,
      startedAtEpochMs: Date.now(),
      startedAtPerformanceMs: performance.now(),
      stopReason: 'duration-reached' as const,
      cancelled: null,
      durationTimer: 0,
      failsafeTimer: 0,
      audioContext,
      audioSource,
      audiblePlaybackConnected,
    };
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => { void finalizeCapture(capture); }, { once: true });
    recorder.addEventListener('error', () => {
      capture.cancelled = {
        captureId: capture.captureId,
        status: 'error',
        code: 'unexpected',
        message: 'MediaRecorder reported an error while capturing the tab.',
      };
      stopActive('user-stop');
    }, { once: true });
    try {
      recorder.start(1_000);
    } catch (error) {
      await releaseCapture(capture);
      throw error;
    }
    active = capture;
    capture.durationTimer = window.setTimeout(
      () => stopActive('duration-reached'),
      message.prepared.requestedDurationMs,
    );
    capture.failsafeTimer = window.setTimeout(
      () => stopActive('failsafe'),
      MEDIA_CAPTURE_MAX_DURATION_MS + MEDIA_CAPTURE_CLEANUP_TOLERANCE_MS,
    );
    snapshot = {
      status: 'recording',
      captureId: message.captureId,
      requestedDurationMs: message.prepared.requestedDurationMs,
      actualRecordingStartTimestamp: capture.startedAtEpochMs,
    };
    return snapshot;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    const failure = captureError(error);
    return { ...failure, captureId: message.captureId };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isOffscreenStartMessage(message)) {
    void startCapture(message).then(sendResponse);
    return true;
  }
  if (typeof message !== 'object' || message === null || !('target' in message) || message.target !== 'offscreen') {
    return undefined;
  }
  if ('type' in message && message.type === MEDIA_CAPTURE_OFFSCREEN_CANCEL) {
    const row = message as { captureId?: unknown; code?: unknown; message?: unknown };
    if (
      typeof row.captureId !== 'string' || active?.captureId !== row.captureId ||
      typeof row.code !== 'string' || typeof row.message !== 'string'
    ) {
      sendResponse({ ok: false, error: 'Malformed or stale cancel message.' });
      return undefined;
    }
    void cancelActive(row.code as CaptureFailure['code'], row.message).then(() => sendResponse({ ok: true }));
    return true;
  }
  if ('type' in message && message.type === MEDIA_CAPTURE_OFFSCREEN_CLEAR) {
    if (active) {
      sendResponse({ ok: false, error: 'Cannot clear an active capture.' });
      return undefined;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    snapshot = { status: 'idle' };
    sendResponse({ ok: true });
    return undefined;
  }
  if ('type' in message && message.type === MEDIA_CAPTURE_OFFSCREEN_STATUS) {
    sendResponse({ ok: true, snapshot });
    return undefined;
  }
  return undefined;
});
