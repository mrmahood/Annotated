import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
} from '../../utils/active-tab-context';
import {
  inspectMediaCapturePlayerOnPage,
  inspectMediaElementCaptureStreamOnPage,
  type CapturePlayerDiagnostic,
} from '../../utils/media-capture-page';
import {
  MEDIA_CAPTURE_CANCEL,
  MEDIA_CAPTURE_CLEAR,
  MEDIA_CAPTURE_EVENT,
  MEDIA_CAPTURE_FIXED_DURATION_MS,
  MEDIA_CAPTURE_MAX_DURATION_MS,
  MEDIA_CAPTURE_START,
  MEDIA_CAPTURE_STATUS,
  getCaptureDurationError,
  getCaptureIntentDiagnostic,
  getMediaCaptureEligibility,
  reduceCaptureUiState,
  sourceIdentityMatchesUrl,
  type CaptureIntent,
  type CaptureProtocolDiagnostics,
  type CaptureSourceIdentity,
  type CaptureStartResponse,
  type CaptureStreamDiagnostic,
  type CaptureUiState,
  type MediaCapturePanelDiagnostic,
} from '../../utils/media-capture-spike';
import './media-capture-spike.css';

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;

export type MediaCaptureSpikeSource = CaptureSourceIdentity & { tabId: number };
export type MediaCaptureSpikeStatus = MediaCapturePanelDiagnostic;

function formatMilliseconds(value: number | null) {
  if (value === null) return 'not measurable';
  return `${value.toLocaleString()} ms`;
}

function formatBytes(value: number) {
  return value < 1_048_576
    ? `${(value / 1_024).toFixed(1)} KiB`
    : `${(value / 1_048_576).toFixed(2)} MiB`;
}

function diagnosticError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isCapturePlayerDiagnostic(value: unknown): value is CapturePlayerDiagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.sourceMatches === 'boolean' &&
    (row.source === 'youtube' || row.source === 'podcast' ||
      row.source === 'video' || row.source === 'unsupported') &&
    (row.player === 'ready' || row.player === 'not-ready' || row.player === 'not-found');
}

const SOURCE_LABELS: Record<MediaCapturePanelDiagnostic['source'], string> = {
  youtube: 'YouTube',
  podcast: 'Podcast',
  video: 'Video',
  unsupported: 'Unsupported',
  'not-connected': 'Not connected',
};

export function MediaCaptureSpike({
  source,
  status,
  selectedStartMs,
  selectedEndMs,
}: {
  source: MediaCaptureSpikeSource | null;
  status: MediaCaptureSpikeStatus;
  selectedStartMs: number | null;
  selectedEndMs: number | null;
}) {
  const [state, dispatch] = useReducer(reduceCaptureUiState, { status: 'idle' } as CaptureUiState);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [streamDiagnostic, setStreamDiagnostic] = useState<CaptureStreamDiagnostic | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState<MediaCaptureSpikeStatus>(status);
  const [protocolDiagnostics, setProtocolDiagnostics] = useState<CaptureProtocolDiagnostics | null>(null);
  const rangeError = selectedStartMs !== null && selectedEndMs !== null
    ? getCaptureDurationError(selectedStartMs, selectedEndMs)
    : 'Set both range endpoints to capture the selected range.';
  const busy = state.status === 'preparing' || state.status === 'recording' || state.status === 'stopping';
  const eligibility = !source
    ? { eligible: false, blockedReason: 'No supported connected media source.' }
    : diagnosticBusy && !busy
      ? { eligible: false, blockedReason: 'Checking the connected media player.' }
      : getMediaCaptureEligibility(liveStatus, busy);

  const inspectLiveStatus = useCallback(async (): Promise<MediaCaptureSpikeStatus> => {
    if (!source) return status;
    if (status.sourceIdentity === 'mismatch') return status;
    const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
    const context = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (!isActiveTabContext(context) || context.tabId !== source.tabId) {
      return { ...status, connectedTab: 'missing', sourceIdentity: 'unknown', player: 'not-found' };
    }
    if (context.url !== source.pageUrl) {
      return { ...status, connectedTab: 'connected', sourceIdentity: 'mismatch', player: 'not-found' };
    }
    let tab: Browser.tabs.Tab;
    try {
      tab = await chrome.tabs.get(source.tabId);
    } catch {
      return { ...status, connectedTab: 'missing', sourceIdentity: 'unknown', player: 'not-found' };
    }
    if (typeof tab.url !== 'string' || !sourceIdentityMatchesUrl(source, tab.url)) {
      return { ...status, connectedTab: 'connected', sourceIdentity: 'mismatch', player: 'not-found' };
    }
    const execution = await chrome.scripting.executeScript({
      target: { tabId: source.tabId, frameIds: [0] },
      func: inspectMediaCapturePlayerOnPage,
      args: [{ kind: source.kind, pageUrl: source.pageUrl, sourceKey: source.sourceKey }],
    });
    const result = execution[0]?.result;
    if (!isCapturePlayerDiagnostic(result)) {
      return { ...status, connectedTab: 'connected', sourceIdentity: 'match', player: 'not-found' };
    }
    return {
      source: result.source,
      connectedTab: 'connected',
      sourceIdentity: result.sourceMatches ? 'match' : 'mismatch',
      player: result.player,
    };
  }, [source, status]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (
        typeof message === 'object' && message !== null &&
        (message as { target?: unknown }).target === 'panel' &&
        (message as { type?: unknown }).type === MEDIA_CAPTURE_EVENT &&
        typeof (message as { snapshot?: unknown }).snapshot === 'object'
      ) {
        dispatch({ type: 'event', snapshot: (message as { snapshot: CaptureUiState }).snapshot });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    void chrome.runtime.sendMessage({ target: 'background', type: MEDIA_CAPTURE_STATUS })
      .then((response: unknown) => {
        const row = response as { ok?: boolean; snapshot?: CaptureUiState } | undefined;
        if (row?.ok && row.snapshot) dispatch({ type: 'event', snapshot: row.snapshot });
      })
      .catch(() => undefined);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    setStreamDiagnostic(null);
  }, [source?.pageUrl, source?.sourceKey, source?.tabId]);

  useEffect(() => {
    setLiveStatus(status);
  }, [status]);

  useEffect(() => {
    if (!source) return;
    let current = true;
    setDiagnosticBusy(true);
    void inspectLiveStatus()
      .then((next) => { if (current) setLiveStatus(next); })
      .catch(() => {
        if (current) setLiveStatus({ ...status, sourceIdentity: 'unknown', player: 'not-found' });
      })
      .finally(() => { if (current) setDiagnosticBusy(false); });
    return () => { current = false; };
  }, [inspectLiveStatus, source, status]);

  const start = useCallback(async (intentKind: CaptureIntent['kind']) => {
    if (!source || busy) return;
    setCommandError(null);
    const selected = intentKind === 'selected-range';
    if (selected && rangeError !== null) {
      setCommandError(`Selected-range capture unavailable: ${rangeError}`);
      return;
    }
    try {
      setDiagnosticBusy(true);
      const currentStatus = await inspectLiveStatus();
      setLiveStatus(currentStatus);
      const currentEligibility = getMediaCaptureEligibility(currentStatus, busy);
      if (!currentEligibility.eligible) {
        setCommandError(currentEligibility.blockedReason);
        return;
      }
      const intent: CaptureIntent = selected
        ? {
            kind: 'selected-range',
            startMs: selectedStartMs as number,
            endMs: selectedEndMs as number,
          }
        : {
            kind: 'fixed-duration',
            durationMs: MEDIA_CAPTURE_FIXED_DURATION_MS,
          };
      const panelOutbound = getCaptureIntentDiagnostic(intent);
      setProtocolDiagnostics({ panelOutbound });
      console.info('[Annotated media capture spike] side-panel outbound request', panelOutbound);
      dispatch({ type: 'prepare', captureId: 'pending' });
      const response = await chrome.runtime.sendMessage({
        target: 'background',
        type: MEDIA_CAPTURE_START,
        request: {
          tabId: source.tabId,
          source: {
            kind: source.kind,
            pageUrl: source.pageUrl,
            sourceKey: source.sourceKey,
          },
          intent,
        },
      }) as CaptureStartResponse | undefined;
      if (!response?.snapshot) throw new Error('The service worker returned no capture state.');
      setProtocolDiagnostics({ panelOutbound, ...response.protocolDiagnostics });
      dispatch({ type: 'event', snapshot: response.snapshot });
    } catch (error) {
      setCommandError(`Capture command failed: ${diagnosticError(error)}`);
      dispatch({ type: 'clear' });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [busy, inspectLiveStatus, rangeError, selectedEndMs, selectedStartMs, source]);

  const cancel = useCallback(async () => {
    if (!('captureId' in state) || state.captureId === 'pending') return;
    setCommandError(null);
    try {
      await chrome.runtime.sendMessage({
        target: 'background',
        type: MEDIA_CAPTURE_CANCEL,
        captureId: state.captureId,
      });
    } catch (error) {
      setCommandError(`Cancel command failed: ${diagnosticError(error)}`);
    }
  }, [state]);

  const clear = useCallback(async () => {
    setCommandError(null);
    try {
      const response = await chrome.runtime.sendMessage({ target: 'background', type: MEDIA_CAPTURE_CLEAR });
      if (!(response as { ok?: boolean } | undefined)?.ok) throw new Error('The capture result could not be cleared.');
      dispatch({ type: 'clear' });
    } catch (error) {
      setCommandError(`Cleanup failed: ${diagnosticError(error)}`);
    }
  }, []);

  const runCaptureStreamDiagnostic = useCallback(async () => {
    if (!source || busy || diagnosticBusy) return;
    setDiagnosticBusy(true);
    setCommandError(null);
    setStreamDiagnostic(null);
    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];
      if (!isActiveTabContext(context) || context.tabId !== source.tabId || context.url !== source.pageUrl) {
        throw new Error('The diagnostic request no longer matches the connected tab.');
      }
      const tab = await chrome.tabs.get(source.tabId);
      if (typeof tab.url !== 'string' || !sourceIdentityMatchesUrl(source, tab.url)) {
        throw new Error('The connected source changed before the diagnostic ran.');
      }
      const execution = await chrome.scripting.executeScript({
        target: { tabId: source.tabId, frameIds: [0] },
        func: inspectMediaElementCaptureStreamOnPage,
        args: [{ kind: source.kind, pageUrl: source.pageUrl, sourceKey: source.sourceKey }],
      });
      const result = execution[0]?.result;
      if (!result) throw new Error('The selected media element returned no diagnostic result.');
      setStreamDiagnostic(result);
    } catch (error) {
      setCommandError(`captureStream diagnostic failed: ${diagnosticError(error)}`);
    } finally {
      setDiagnosticBusy(false);
    }
  }, [busy, diagnosticBusy, source]);

  return (
    <section
      className="media-capture-spike"
      aria-labelledby="media-capture-spike-heading"
      data-media-capture-spike="active"
    >
      <div className="section-heading">
        <h2 id="media-capture-spike-heading">MEDIA CAPTURE SPIKE</h2>
        <span>SPIKE BUILD ACTIVE</span>
      </div>
      <p className="create-help">
        Records only the explicitly connected tab. Nothing is uploaded, published, or stored.
      </p>
      {protocolDiagnostics && (
        <details className="capture-protocol-diagnostic" open>
          <summary>Capture protocol intent trace</summary>
          <pre>{JSON.stringify(protocolDiagnostics, null, 2)}</pre>
        </details>
      )}
      <dl className="spike-diagnostics">
        <div><dt>Source</dt><dd>{SOURCE_LABELS[liveStatus.source]}</dd></div>
        <div><dt>Connected tab</dt><dd>{liveStatus.connectedTab === 'connected' ? 'Connected' : 'Missing'}</dd></div>
        <div><dt>Source identity</dt><dd>{liveStatus.sourceIdentity === 'match' ? 'Match' : liveStatus.sourceIdentity === 'mismatch' ? 'Mismatch' : 'Unknown'}</dd></div>
        <div><dt>Player</dt><dd>{liveStatus.player === 'ready' ? 'Ready' : liveStatus.player === 'not-found' ? 'Not found' : liveStatus.player === 'checking' || diagnosticBusy ? 'Not ready (checking)' : 'Not ready'}</dd></div>
        <div><dt>Capture</dt><dd>{eligibility.eligible ? 'Ready' : 'Blocked'}</dd></div>
      </dl>
      {!eligibility.eligible && <div className="compact-state"><strong>Capture blocked:</strong><span>{eligibility.blockedReason}</span></div>}
      <div className="spike-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={() => void start('fixed-duration')}
          disabled={!eligibility.eligible || diagnosticBusy}
          title={eligibility.blockedReason ?? undefined}
        >
          {busy ? 'Capture in progress...' : 'Capture 15-second test'}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void start('selected-range')}
          disabled={!eligibility.eligible || diagnosticBusy || rangeError !== null}
          title={eligibility.blockedReason ?? rangeError ?? undefined}
        >
          Capture selected range
        </button>
        {busy && <button className="button button-secondary danger-button" type="button" onClick={() => void cancel()}>Cancel and clean up</button>}
      </div>
      {rangeError && selectedStartMs !== null && selectedEndMs !== null && (
        <p className="inline-error" role="status">Selected-range capture unavailable: {rangeError}</p>
      )}
      {state.status === 'preparing' && <div className="compact-state" role="status"><strong>Preparing connected player</strong><span>Validating source identity, seeking, and requesting the tab stream.</span></div>}
      {state.status === 'recording' && <div className="compact-state" role="status"><strong>Recording tab</strong><span>Offscreen MediaRecorder is active for {formatMilliseconds(state.requestedDurationMs ?? null)}.</span></div>}
      {state.status === 'stopping' && <div className="compact-state" role="status"><strong>Finalizing local Blob</strong><span>Stopping tracks and measuring the WebM result.</span></div>}
      {(state.status === 'error' || state.status === 'cancelled') && (
        <div className="compact-state compact-state-error" role="alert"><strong>{state.status === 'cancelled' ? 'Capture cancelled' : 'Capture unsupported / failed'} ({state.code})</strong><span>{state.message}</span></div>
      )}
      {state.status === 'recorded' && (
        <div className="spike-result">
          <strong>Local capture ready</strong>
          {state.sourceKind === 'audio'
            ? <audio controls preload="metadata" src={state.previewUrl} aria-label="Captured tab audio preview" />
            : <video controls preload="metadata" src={state.previewUrl} aria-label="Captured tab video preview" />}
          <p className="spike-evidence-note">
            Inspect this preview for surrounding page content, player controls, captions, overlays/ads,
            browser chrome, and the open Annotated side panel. Those visual acceptance results are empirical.
          </p>
          <dl className="spike-diagnostics">
            <div><dt>Requested range</dt><dd>{formatMilliseconds(state.requestedStartMs)} - {formatMilliseconds(state.requestedEndMs)}</dd></div>
            <div><dt>Requested duration</dt><dd>{formatMilliseconds(state.requestedDurationMs)}</dd></div>
            <div><dt>Recorder started</dt><dd>{new Date(state.actualRecordingStartTimestamp).toISOString()}</dd></div>
            <div><dt>Recorder elapsed</dt><dd>{formatMilliseconds(state.recordingElapsedMs)}</dd></div>
            <div><dt>Blob duration</dt><dd>{formatMilliseconds(state.blobDurationMs)}</dd></div>
            <div><dt>Duration difference</dt><dd>{formatMilliseconds(state.durationDifferenceMs)}</dd></div>
            <div><dt>Player before</dt><dd>{formatMilliseconds(state.playerCurrentTimeBeforeRecordingMs)}</dd></div>
            <div><dt>Player after</dt><dd>{formatMilliseconds(state.playerCurrentTimeAfterRecordingMs)}</dd></div>
            <div><dt>Selected MIME</dt><dd>{state.selectedMimeType}</dd></div>
            <div><dt>Blob MIME</dt><dd>{state.blobMimeType || '(empty)'}</dd></div>
            <div><dt>Blob size</dt><dd>{formatBytes(state.byteSize)} ({state.byteSize.toLocaleString()} bytes)</dd></div>
            <div><dt>Tracks</dt><dd>{state.videoTrackCount} video / {state.audioTrackCount} audio</dd></div>
            <div><dt>Audible loopback</dt><dd>{state.audiblePlaybackConnected ? 'AudioContext running' : 'not running'}</dd></div>
            <div><dt>Cleanup</dt><dd>{state.allTracksStopped ? 'all capture tracks ended' : 'track cleanup incomplete'}</dd></div>
            <div><dt>Stop reason</dt><dd>{state.stopReason}</dd></div>
          </dl>
          <details><summary>Video geometry</summary><pre>{JSON.stringify(state.geometry, null, 2)}</pre></details>
          <details><summary>Capture track settings</summary><pre>{JSON.stringify(state.tracks, null, 2)}</pre></details>
          <button className="button button-secondary danger-button" type="button" onClick={() => void clear()}>Discard local test clip</button>
        </div>
      )}
      {commandError && <p className="inline-error" role="alert">{commandError}</p>}
      {source && (
        <div className="capture-stream-diagnostic">
          <button className="button button-secondary button-small" type="button" onClick={() => void runCaptureStreamDiagnostic()} disabled={busy || diagnosticBusy}>
            {diagnosticBusy ? 'Checking captureStream()...' : 'Run captureStream() diagnostic'}
          </button>
          {streamDiagnostic && <details open><summary>Element-level diagnostic</summary><pre>{JSON.stringify(streamDiagnostic, null, 2)}</pre></details>}
        </div>
      )}
      <p className="spike-limit">Hard maximum: {MEDIA_CAPTURE_MAX_DURATION_MS / 1_000} seconds. Offscreen cleanup continues if this panel closes.</p>
    </section>
  );
}
