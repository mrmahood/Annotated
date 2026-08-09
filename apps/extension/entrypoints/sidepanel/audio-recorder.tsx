import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ANNOTATION_AUDIO_MIME_TYPE,
  AUDIO_MAX_DURATION_MS,
  formatAudioDuration,
  getAudioValidationError,
  reduceRecordingState,
  selectRecordingMimeType,
  type RecordingState,
} from '../../utils/audio-commentary';

const UNSUPPORTED_MESSAGE =
  'This browser cannot record WebM audio. You can still publish your text annotation.';

type RecorderListeners = {
  data: (event: BlobEvent) => void;
  stop: () => void;
  error: () => void;
};

function getMicrophoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was denied. Allow microphone access and choose Record audio to try again.';
  }
  if (name === 'NotFoundError') {
    return 'No microphone was found. Connect a microphone or publish without audio.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The microphone is unavailable or already in use. Close other recording apps and try again.';
  }
  return 'Audio recording could not start. You can retry or publish without audio.';
}

export type AudioRecorderController = {
  state: RecordingState;
  playbackError: string | null;
  start: () => Promise<void>;
  stop: () => void;
  discard: () => void;
  rerecord: () => Promise<void>;
  reportPlaybackError: () => void;
};

export function useAudioRecorder(): AudioRecorderController {
  const [state, dispatch] = useReducer(reduceRecordingState, { status: 'idle' });
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestRevisionRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const listenersRef = useRef<RecorderListeners | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const maximumTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPlaybackError(null);
  }, []);

  const releaseRecorder = useCallback((stopActiveRecorder: boolean) => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (maximumTimerRef.current !== null) {
      window.clearTimeout(maximumTimerRef.current);
      maximumTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    const listeners = listenersRef.current;
    if (recorder && listeners) {
      recorder.removeEventListener('dataavailable', listeners.data);
      recorder.removeEventListener('stop', listeners.stop);
      recorder.removeEventListener('error', listeners.error);
    }
    listenersRef.current = null;
    recorderRef.current = null;

    if (stopActiveRecorder && recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* Tracks are stopped below. */ }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  const failRecording = useCallback((message: string) => {
    releaseRecorder(true);
    if (mountedRef.current) dispatch({ type: 'fail', message });
  }, [releaseRecorder]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      recorder.requestData();
      recorder.stop();
    } catch {
      failRecording('The recorder stopped unexpectedly. Discard it and try again.');
    }
  }, [failRecording]);

  const discard = useCallback(() => {
    requestRevisionRef.current += 1;
    releaseRecorder(true);
    revokePreview();
    if (mountedRef.current) dispatch({ type: 'discard' });
  }, [releaseRecorder, revokePreview]);

  const start = useCallback(async () => {
    const revision = ++requestRevisionRef.current;
    releaseRecorder(true);
    revokePreview();

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined' ||
      typeof MediaRecorder.isTypeSupported !== 'function'
    ) {
      dispatch({ type: 'fail', message: UNSUPPORTED_MESSAGE });
      return;
    }

    const recordingMimeType = selectRecordingMimeType(
      MediaRecorder.isTypeSupported.bind(MediaRecorder),
    );
    if (!recordingMimeType) {
      dispatch({ type: 'fail', message: UNSUPPORTED_MESSAGE });
      return;
    }

    dispatch({ type: 'request' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || revision !== requestRevisionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType: recordingMimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      const listeners: RecorderListeners = {
        data: (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        },
        stop: () => {
          const durationMs = Math.min(
            AUDIO_MAX_DURATION_MS,
            Math.max(0, Math.round(performance.now() - startedAtRef.current)),
          );
          const blob = new Blob(chunksRef.current, {
            type: ANNOTATION_AUDIO_MIME_TYPE,
          });
          releaseRecorder(false);
          const validationError = getAudioValidationError(blob, durationMs);
          if (!mountedRef.current) return;
          if (validationError) {
            dispatch({ type: 'fail', message: validationError });
            return;
          }
          const previewUrl = URL.createObjectURL(blob);
          previewUrlRef.current = previewUrl;
          dispatch({ type: 'finish', blob, previewUrl, durationMs });
        },
        error: () => {
          failRecording('The recorder encountered an error. Try recording again or publish without audio.');
        },
      };
      listenersRef.current = listeners;
      recorder.addEventListener('dataavailable', listeners.data);
      recorder.addEventListener('stop', listeners.stop);
      recorder.addEventListener('error', listeners.error);

      startedAtRef.current = performance.now();
      recorder.start(1_000);
      dispatch({ type: 'start' });
      intervalRef.current = window.setInterval(() => {
        if (!mountedRef.current) return;
        dispatch({
          type: 'tick',
          elapsedMs: performance.now() - startedAtRef.current,
        });
      }, 250);
      maximumTimerRef.current = window.setTimeout(() => stop(), AUDIO_MAX_DURATION_MS);
    } catch (error) {
      if (revision !== requestRevisionRef.current) return;
      failRecording(getMicrophoneErrorMessage(error));
    }
  }, [failRecording, releaseRecorder, revokePreview, stop]);

  const rerecord = useCallback(async () => {
    discard();
    await start();
  }, [discard, start]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRevisionRef.current += 1;
      releaseRecorder(true);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [releaseRecorder]);

  return {
    state,
    playbackError,
    start,
    stop,
    discard,
    rerecord,
    reportPlaybackError: () => setPlaybackError(
      'The audio preview could not be played. You can re-record, discard it, or retry playback.',
    ),
  };
}

export function AudioRecorder({
  controller,
  disabled = false,
}: {
  controller: AudioRecorderController;
  disabled?: boolean;
}) {
  const { state } = controller;
  return (
    <section className="audio-recorder" aria-labelledby="audio-commentary-heading">
      <div className="audio-recorder-heading">
        <div>
          <span className="section-label" id="audio-commentary-heading">Audio commentary</span>
          <span className="optional-label">Optional</span>
        </div>
        <span className="audio-limit">WebM · 5:00 max · 6 MiB</span>
      </div>

      {state.status === 'idle' && (
        <button className="button button-secondary button-small" type="button" onClick={() => void controller.start()} disabled={disabled}>
          Record audio
        </button>
      )}
      {state.status === 'requesting_permission' && (
        <div className="audio-status" role="status">
          <span>Requesting microphone access…</span>
        </div>
      )}
      {state.status === 'recording' && (
        <div className="audio-recording-row" role="status">
          <span className="recording-indicator" aria-label="Recording in progress" />
          <strong>Recording</strong>
          <time>{formatAudioDuration(state.elapsedMs)}</time>
          <button className="button button-secondary button-small" type="button" onClick={controller.stop}>
            Stop recording
          </button>
        </div>
      )}
      {state.status === 'recorded' && (
        <div className="audio-preview">
          <div className="audio-preview-meta">
            <strong>Ready to publish</strong>
            <span>{formatAudioDuration(state.durationMs)} · {(state.blob.size / 1024).toFixed(0)} KiB</span>
          </div>
          <audio
            controls
            preload="metadata"
            src={state.previewUrl}
            aria-label="Audio commentary preview"
            onError={controller.reportPlaybackError}
          />
          {controller.playbackError && <p className="inline-error" role="alert">{controller.playbackError}</p>}
          <div className="audio-preview-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => void controller.rerecord()} disabled={disabled}>Re-record</button>
            <button className="button button-secondary button-small danger-button" type="button" onClick={controller.discard} disabled={disabled}>Discard audio</button>
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div className="audio-error">
          <p className="inline-error" role="alert">{state.message}</p>
          <button className="button button-secondary button-small" type="button" onClick={() => void controller.start()} disabled={disabled}>Record audio</button>
        </div>
      )}
    </section>
  );
}
