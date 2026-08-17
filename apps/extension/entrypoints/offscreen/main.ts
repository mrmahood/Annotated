import {
  MEDIA_CAPTURE_FAILSAFE_MS,
  MEDIA_CAPTURE_OFFSCREEN_CANCEL,
  MEDIA_CAPTURE_OFFSCREEN_EVENT,
  MEDIA_CAPTURE_OFFSCREEN_NEEDS_END,
  MEDIA_CAPTURE_OFFSCREEN_PLAYBACK,
  MEDIA_CAPTURE_OFFSCREEN_RETRY,
  MEDIA_CAPTURE_OFFSCREEN_START,
  MEDIA_CAPTURE_OFFSCREEN_STATUS,
  isOffscreenStartMessage,
  executeHostedMediaUpload,
  selectCaptureMimeType,
  type CaptureGeometry,
  type CaptureMetadata,
  type CaptureSnapshot,
  type CaptureTrack,
  type OffscreenStartMessage,
} from '../../utils/media-capture';

type ActiveRecording = {
  message: OffscreenStartMessage;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  selectedMimeType: string;
  startedAtEpochMs: number;
  startedAtPerformanceMs: number;
  playbackAcknowledgedAtMs: number | null;
  playerStartMs: number | null;
  durationTimer: number;
  failsafeTimer: number;
  audioContext: AudioContext | null;
  audioSource: MediaStreamAudioSourceNode | null;
  loopbackEnabled: boolean;
  cancelled: { code: string; message: string } | null;
};
type RetainedUpload = {
  captureId: string;
  request: OffscreenStartMessage['request'];
  prepared: OffscreenStartMessage['prepared'];
  blob: Blob;
  selectedMimeType: string;
  tracks: CaptureTrack[];
  audioTrackCount: number;
  videoTrackCount: number;
  recorderStartedAtMs: number;
  playbackAcknowledgedAtMs: number;
  playerStartMs: number | null;
  recorderElapsedMs: number;
  playerEndMs: number | null;
  endGeometry: CaptureGeometry | null;
  loopbackEnabled: boolean;
  attempts: number;
  xhr: XMLHttpRequest | null;
};

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
// Change only this development constant for a loopback-disabled crackle comparison build.
const ENABLE_AUDIO_LOOPBACK = true;
let recording: ActiveRecording | null = null;
let retained: RetainedUpload | null = null;
let snapshot: CaptureSnapshot = { status: 'idle' };

function sendSnapshot(next: CaptureSnapshot) {
  snapshot = next;
  void chrome.runtime.sendMessage({
    target: 'background',
    type: MEDIA_CAPTURE_OFFSCREEN_EVENT,
    snapshot: next,
  }).catch(() => undefined);
}
function trackFacts(stream: MediaStream): CaptureTrack[] {
  return stream.getTracks().map((track) => {
    const settings = Object.fromEntries(
      Object.entries(track.getSettings()).filter(([, value]) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    ) as Record<string, string | number | boolean>;
    return {
      kind: track.kind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      settings,
    };
  });
}
async function release(active: ActiveRecording) {
  window.clearTimeout(active.durationTimer);
  window.clearTimeout(active.failsafeTimer);
  active.stream.getTracks().forEach((track) => track.stop());
  try { active.audioSource?.disconnect(); } catch { /* Already disconnected. */ }
  if (active.audioContext && active.audioContext.state !== 'closed') {
    await active.audioContext.close().catch(() => undefined);
  }
}
function stopRecording(reason: 'duration' | 'failsafe' | 'cancel') {
  const active = recording;
  if (!active || active.recorder.state === 'inactive') return;
  if (reason === 'cancel' && !active.cancelled) {
    active.cancelled = { code: 'unexpected', message: 'Capture cancelled by the user.' };
  }
  snapshot = { status: 'stopping', captureId: active.message.captureId };
  try {
    active.recorder.requestData();
    active.recorder.stop();
  } catch {
    void finalize(active);
  }
}
async function finalize(active: ActiveRecording) {
  if (recording !== active) return;
  const elapsedMs = Math.max(0, Math.round(performance.now() - active.startedAtPerformanceMs));
  const tracks = trackFacts(active.stream);
  const audioTrackCount = active.stream.getAudioTracks().length;
  const videoTrackCount = active.stream.getVideoTracks().length;
  const blob = new Blob(active.chunks, { type: active.recorder.mimeType || active.selectedMimeType });
  await release(active);
  recording = null;

  if (active.cancelled) {
    retained?.xhr?.abort();
    retained = null;
    sendSnapshot({
      status: 'cancelled',
      captureId: active.message.captureId,
      code: active.cancelled.code as 'unexpected',
      message: active.cancelled.message,
    });
    return;
  }
  if (blob.size === 0) {
    sendSnapshot({
      status: 'error',
      captureId: active.message.captureId,
      code: 'protected-or-muted',
      message: 'The connected tab produced an empty recording.',
    });
    return;
  }
  retained = {
    captureId: active.message.captureId,
    request: active.message.request,
    prepared: active.message.prepared,
    blob,
    selectedMimeType: active.selectedMimeType,
    tracks,
    audioTrackCount,
    videoTrackCount,
    recorderStartedAtMs: active.startedAtEpochMs,
    playbackAcknowledgedAtMs: active.playbackAcknowledgedAtMs ?? Date.now(),
    playerStartMs: active.playerStartMs,
    recorderElapsedMs: elapsedMs,
    playerEndMs: null,
    endGeometry: null,
    loopbackEnabled: active.loopbackEnabled,
    attempts: 0,
    xhr: null,
  };
  void chrome.runtime.sendMessage({
    target: 'background',
    type: MEDIA_CAPTURE_OFFSCREEN_NEEDS_END,
    captureId: active.message.captureId,
  }).catch(() => {
    if (retained?.captureId === active.message.captureId) void uploadRetained(retained);
  });
}
function captureMetadata(upload: RetainedUpload): CaptureMetadata {
  const start = upload.prepared.geometry;
  const end = upload.endGeometry;
  const video = upload.prepared.sourceKind === 'youtube';
  return {
    version: 1,
    ...(video ? {
      viewport: {
        width: start.viewportWidth,
        height: start.viewportHeight,
        device_pixel_ratio: start.devicePixelRatio,
        scroll_x: start.scrollX,
        scroll_y: start.scrollY,
      },
      video_element: {
        start: start.boundingClientRect,
        end: end?.boundingClientRect ?? null,
      },
      intrinsic_video: { width: start.videoWidth, height: start.videoHeight },
      computed_style: { object_fit: start.objectFit, object_position: start.objectPosition },
      fullscreen: { start: start.fullscreen, end: end?.fullscreen ?? start.fullscreen },
    } : {}),
    capture_track: {
      mime_type: upload.selectedMimeType,
      audio_track_count: upload.audioTrackCount,
      video_track_count: upload.videoTrackCount,
      tracks: upload.tracks,
      loopback_enabled: upload.loopbackEnabled,
    },
    timing: {
      requested_start_ms: upload.prepared.requestedStartMs,
      requested_end_ms: upload.prepared.requestedEndMs,
      requested_duration_ms: upload.prepared.requestedDurationMs,
      recorder_started_at_ms: upload.recorderStartedAtMs,
      playback_acknowledged_at_ms: upload.playbackAcknowledgedAtMs,
      lead_in_ms: Math.max(0, upload.playbackAcknowledgedAtMs - upload.recorderStartedAtMs),
      recorder_elapsed_ms: upload.recorderElapsedMs,
      player_start_ms: upload.playerStartMs,
      player_end_ms: upload.playerEndMs,
    },
  };
}
async function authorize(upload: RetainedUpload): Promise<string> {
  const response = await fetch(`${upload.request.apiOrigin}/api/media/upload/authorize`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${upload.request.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      annotationId: upload.request.operation.annotationId,
      mediaId: upload.request.operation.mediaId,
      mimeType: upload.prepared.sourceKind === 'audio' ? 'audio/webm' : 'video/webm',
      byteSize: upload.blob.size,
      startMs: upload.prepared.requestedStartMs,
      endMs: upload.prepared.requestedEndMs,
      captureMetadata: captureMetadata(upload),
    }),
  });
  const body = await response.json().catch(() => null) as { signedUrl?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.signedUrl !== 'string') {
    throw new Error(typeof body?.error === 'string' ? body.error : 'Upload authorization failed.');
  }
  return body.signedUrl;
}
function uploadWithProgress(upload: RetainedUpload, signedUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    upload.xhr = xhr;
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && retained === upload) {
        sendSnapshot({
          status: 'uploading',
          captureId: upload.captureId,
          progress: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        });
      }
    });
    xhr.addEventListener('load', () => {
      upload.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage upload failed with status ${xhr.status}.`));
    });
    xhr.addEventListener('error', () => { upload.xhr = null; reject(new Error('Network upload failed.')); });
    xhr.addEventListener('abort', () => { upload.xhr = null; reject(new Error('Upload was cancelled.')); });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', upload.blob);
    xhr.send(form);
  });
}
async function complete(upload: RetainedUpload) {
  const response = await fetch(`${upload.request.apiOrigin}/api/media/upload/complete`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${upload.request.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      annotationId: upload.request.operation.annotationId,
      mediaId: upload.request.operation.mediaId,
      startMs: upload.prepared.requestedStartMs,
      endMs: upload.prepared.requestedEndMs,
    }),
  });
  const body = await response.json().catch(() => null) as { processingStatus?: unknown; processingStage?: unknown; error?: unknown } | null;
  if (!response.ok || body?.processingStatus !== 'processing' || body.processingStage !== 'queued') {
    throw new Error(typeof body?.error === 'string' ? body.error : 'Upload completion verification failed.');
  }
}
async function uploadRetained(upload: RetainedUpload) {
  if (retained !== upload || upload.xhr) return;
  if (upload.attempts >= 3) {
    sendSnapshot({
      status: 'error',
      captureId: upload.captureId,
      code: 'upload-failed',
      message: 'Upload retry limit reached. Recapture or cancel this draft.',
    });
    return;
  }
  upload.attempts += 1;
  sendSnapshot({ status: 'uploading', captureId: upload.captureId, progress: 0 });
  try {
    if (upload.attempts > 1) {
      try {
        await complete(upload);
        const { annotationId, mediaId } = upload.request.operation;
        retained = null;
        sendSnapshot({ status: 'verifying-upload', captureId: upload.captureId, annotationId, mediaId });
        return;
      } catch {
        // The first response may have been lost after Storage accepted the bytes.
        // If completion still cannot verify an object, obtain a fresh exact-path authorization.
      }
    }
    await executeHostedMediaUpload({
      authorize: () => authorize(upload),
      upload: (signedUrl) => uploadWithProgress(upload, signedUrl),
      complete: () => complete(upload),
    });
    const { annotationId, mediaId } = upload.request.operation;
    retained = null;
    sendSnapshot({ status: 'verifying-upload', captureId: upload.captureId, annotationId, mediaId });
  } catch (error) {
    if (retained !== upload) return;
    sendSnapshot({
      status: 'waiting-to-upload',
      captureId: upload.captureId,
      message: `${error instanceof Error ? error.message : 'Upload failed.'} Keep Chrome open and retry.`,
    });
  }
}
async function start(message: OffscreenStartMessage): Promise<CaptureSnapshot> {
  if (recording || retained) {
    return { status: 'error', captureId: message.captureId, code: 'busy', message: 'Another capture or upload is active.' };
  }
  if (typeof MediaRecorder === 'undefined') {
    return { status: 'error', captureId: message.captureId, code: 'media-recorder-unsupported', message: 'MediaRecorder is unavailable.' };
  }
  let stream: MediaStream | null = null;
  try {
    const tabConstraint = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } as unknown as MediaTrackConstraints;
    const expectVideo = message.prepared.sourceKind !== 'audio';
    stream = await navigator.mediaDevices.getUserMedia({
      audio: tabConstraint,
      video: expectVideo ? tabConstraint : false,
    });
    if (stream.getAudioTracks().length === 0) throw new Error('no-audio-track');
    if (expectVideo && stream.getVideoTracks().length === 0) throw new Error('no-video-track');
    const selectedMimeType = selectCaptureMimeType(expectVideo, MediaRecorder.isTypeSupported.bind(MediaRecorder));
    if (!selectedMimeType) throw new Error('media-recorder-unsupported');

    let audioContext: AudioContext | null = null;
    let audioSource: MediaStreamAudioSourceNode | null = null;
    let loopbackEnabled = false;
    try {
      if (!ENABLE_AUDIO_LOOPBACK) throw new Error('Loopback disabled for diagnostic build.');
      audioContext = new AudioContext();
      audioSource = audioContext.createMediaStreamSource(stream);
      audioSource.connect(audioContext.destination);
      if (audioContext.state === 'suspended') await audioContext.resume();
      loopbackEnabled = audioContext.state === 'running';
    } catch {
      try { audioSource?.disconnect(); } catch { /* No active graph. */ }
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      audioSource = null;
    }

    const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
    const active: ActiveRecording = {
      message, recorder, stream, chunks: [], selectedMimeType,
      startedAtEpochMs: Date.now(), startedAtPerformanceMs: performance.now(),
      playbackAcknowledgedAtMs: null, playerStartMs: null,
      durationTimer: 0, failsafeTimer: 0, audioContext, audioSource, loopbackEnabled,
      cancelled: null,
    };
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) active.chunks.push(event.data); });
    recorder.addEventListener('stop', () => { void finalize(active); }, { once: true });
    recorder.addEventListener('error', () => {
      active.cancelled = { code: 'unexpected', message: 'MediaRecorder failed during capture.' };
      stopRecording('cancel');
    }, { once: true });
    recorder.start(1_000);
    recording = active;
    active.failsafeTimer = window.setTimeout(() => stopRecording('failsafe'), MEDIA_CAPTURE_FAILSAFE_MS);
    snapshot = { status: 'capturing', captureId: message.captureId, requestedDurationMs: message.prepared.requestedDurationMs };
    return snapshot;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    const code = error instanceof Error ? error.message : '';
    return {
      status: 'error',
      captureId: message.captureId,
      code: code === 'no-audio-track' ? 'no-audio-track'
        : code === 'no-video-track' ? 'no-video-track'
          : code === 'media-recorder-unsupported' ? 'media-recorder-unsupported' : 'unexpected',
      message: 'The connected tab capture stream could not be recorded.',
    };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isOffscreenStartMessage(message)) {
    void start(message).then(sendResponse);
    return true;
  }
  if (typeof message !== 'object' || message === null || !('target' in message) || message.target !== 'offscreen') return undefined;
  const row = message as Record<string, unknown>;
  const active = recording;
  if (row.type === MEDIA_CAPTURE_OFFSCREEN_PLAYBACK && active &&
      active.message.captureId === row.captureId && typeof row.acknowledgedAtMs === 'number') {
    active.playbackAcknowledgedAtMs = row.acknowledgedAtMs;
    active.playerStartMs = typeof row.playerStartMs === 'number' ? row.playerStartMs : null;
    active.durationTimer = window.setTimeout(
      () => stopRecording('duration'),
      active.message.prepared.requestedDurationMs,
    );
    sendResponse({ ok: true });
    return undefined;
  }
  const upload = retained;
  if (row.type === 'annotated.mediaCapture.offscreenPlayerEnd.v1' && upload &&
      upload.captureId === row.captureId) {
    upload.playerEndMs = typeof row.playerEndMs === 'number' ? row.playerEndMs : null;
    upload.endGeometry = typeof row.geometry === 'object' ? row.geometry as CaptureGeometry : null;
    void uploadRetained(upload).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (row.type === MEDIA_CAPTURE_OFFSCREEN_CANCEL) {
    if (recording && recording.message.captureId === row.captureId) {
      recording.cancelled = {
        code: typeof row.code === 'string' ? row.code : 'unexpected',
        message: typeof row.message === 'string' ? row.message : 'Capture cancelled.',
      };
      stopRecording('cancel');
    } else if (retained && retained.captureId === row.captureId) {
      retained.xhr?.abort();
      retained = null;
      sendSnapshot({ status: 'cancelled', captureId: String(row.captureId), code: 'unexpected', message: 'Capture cancelled.' });
    }
    sendResponse({ ok: true });
    return undefined;
  }
  if (row.type === MEDIA_CAPTURE_OFFSCREEN_RETRY) {
    if (!retained || retained.captureId !== row.captureId ||
        typeof row.accessToken !== 'string' || row.accessToken.length < 20) {
      sendResponse({ ok: false, error: 'No retained upload is available.' });
      return undefined;
    }
    retained.request.accessToken = row.accessToken;
    void uploadRetained(retained).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (row.type === MEDIA_CAPTURE_OFFSCREEN_STATUS) {
    sendResponse({ ok: true, snapshot });
    return undefined;
  }
  return undefined;
});
