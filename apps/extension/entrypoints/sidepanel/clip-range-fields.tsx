import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  applyTypedClipFieldInput,
  fieldFromMilliseconds,
  syncTypedClipFieldFromMilliseconds,
  typedClipFieldsAllowPublish,
  type TypedClipField,
} from '../../utils/clip-range-entry';
import {
  CLIP_PRESETS,
  CLIP_SLIDER_PAN_MS,
  clampClipSliderWindowStart,
  clipSliderDisplayOffsetSeconds,
  clipSliderMediaMsFromOffset,
  clipSliderWindowContainsRange,
  clipSliderWindowDurationMs,
  clipSliderWindowIsZoomed,
  clipSliderWindowOverlapsRange,
  formatClipBudgetLabel,
  formatClipSliderWindowCue,
  formatClipSpanReadout,
  getClipBudget,
  mediaDurationSliderMaxMs,
  moveClipHandle,
  panClipSliderWindow,
  recenterClipSliderWindow,
  snapMsToWholeSeconds,
} from '../../utils/clip-range';

export function useTypedClipRange(
  startMs: number | null,
  endMs: number | null,
  onCommitRange: (startMs: number | null, endMs: number | null) => void,
): {
  startField: TypedClipField;
  endField: TypedClipField;
  changeStart: (text: string) => void;
  changeEnd: (text: string) => void;
  commitStart: () => void;
  commitEnd: () => void;
  allowsPublish: boolean;
} {
  const [startField, setStartField] = useState(() => fieldFromMilliseconds(startMs));
  const [endField, setEndField] = useState(() => fieldFromMilliseconds(endMs));
  const startFieldRef = useRef(startField);
  const endFieldRef = useRef(endField);
  const startMsRef = useRef(startMs);
  const endMsRef = useRef(endMs);
  const onCommitRef = useRef(onCommitRange);
  startFieldRef.current = startField;
  endFieldRef.current = endField;
  startMsRef.current = startMs;
  endMsRef.current = endMs;
  onCommitRef.current = onCommitRange;

  useEffect(() => {
    setStartField((field) => syncTypedClipFieldFromMilliseconds(field, startMs));
  }, [startMs]);

  useEffect(() => {
    setEndField((field) => syncTypedClipFieldFromMilliseconds(field, endMs));
  }, [endMs]);

  const changeStart = (text: string) => {
    const result = applyTypedClipFieldInput(text, false);
    setStartField(result.field);
    if (result.updateMilliseconds) onCommitRef.current(result.milliseconds, endMsRef.current);
  };

  const changeEnd = (text: string) => {
    const result = applyTypedClipFieldInput(text, false);
    setEndField(result.field);
    if (result.updateMilliseconds) onCommitRef.current(startMsRef.current, result.milliseconds);
  };

  const commitStart = () => {
    const result = applyTypedClipFieldInput(startFieldRef.current.text, true);
    const milliseconds = result.milliseconds === null ? null : snapMsToWholeSeconds(result.milliseconds);
    setStartField(
      result.updateMilliseconds && milliseconds !== result.milliseconds
        ? fieldFromMilliseconds(milliseconds)
        : result.field,
    );
    if (result.updateMilliseconds) onCommitRef.current(milliseconds, endMsRef.current);
  };

  const commitEnd = () => {
    const result = applyTypedClipFieldInput(endFieldRef.current.text, true);
    const milliseconds = result.milliseconds === null ? null : snapMsToWholeSeconds(result.milliseconds);
    setEndField(
      result.updateMilliseconds && milliseconds !== result.milliseconds
        ? fieldFromMilliseconds(milliseconds)
        : result.field,
    );
    if (result.updateMilliseconds) onCommitRef.current(startMsRef.current, milliseconds);
  };

  return {
    startField,
    endField,
    changeStart,
    changeEnd,
    commitStart,
    commitEnd,
    allowsPublish: typedClipFieldsAllowPublish(startField, endField, startMs, endMs),
  };
}

export function ClipRangeFields({
  idPrefix,
  startField,
  endField,
  lengthDisplay,
  startError,
  endError,
  disabled,
  onStartChange,
  onEndChange,
  onStartBlur,
  onEndBlur,
}: {
  idPrefix: string;
  startField: TypedClipField;
  endField: TypedClipField;
  lengthDisplay: string;
  startError: string | null;
  endError: string | null;
  disabled: boolean;
  onStartChange: (text: string) => void;
  onEndChange: (text: string) => void;
  onStartBlur: () => void;
  onEndBlur: () => void;
}) {
  const startId = `${idPrefix}-clip-start`;
  const endId = `${idPrefix}-clip-end`;
  const startErrorId = `${startId}-error`;
  const endErrorId = `${endId}-error`;
  return (
    <dl className="clip-time-grid clip-time-grid-editable">
      <div>
        <dt><label htmlFor={startId}>START</label></dt>
        <dd>
          <input
            id={startId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="1:00"
            aria-invalid={startError !== null}
            aria-describedby={startError ? startErrorId : undefined}
            value={startField.text}
            disabled={disabled}
            onChange={(event) => onStartChange(event.target.value)}
            onBlur={onStartBlur}
          />
        </dd>
        {startError && <p className="inline-error clip-field-error" id={startErrorId} role="alert">{startError}</p>}
      </div>
      <div>
        <dt><label htmlFor={endId}>END</label></dt>
        <dd>
          <input
            id={endId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="2:30"
            aria-invalid={endError !== null}
            aria-describedby={endError ? endErrorId : undefined}
            value={endField.text}
            disabled={disabled}
            onChange={(event) => onEndChange(event.target.value)}
            onBlur={onEndBlur}
          />
        </dd>
        {endError && <p className="inline-error clip-field-error" id={endErrorId} role="alert">{endError}</p>}
      </div>
      <div>
        <dt>LENGTH</dt>
        <dd>{lengthDisplay}</dd>
      </div>
    </dl>
  );
}

export function ClipRangeEditor({
  idPrefix,
  startMs,
  endMs,
  durationMs,
  playheadMs = null,
  startField,
  endField,
  lengthDisplay,
  startError,
  endError,
  rangeError,
  disabled,
  playerSelected,
  playerReading,
  playheadActionsDisabled = false,
  previewEnabled,
  previewLabel,
  onCommitRange,
  onStartChange,
  onEndChange,
  onStartBlur,
  onEndBlur,
  onPreset,
  onPreview,
  onRefresh,
}: {
  idPrefix: string;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  playheadMs?: number | null;
  startField: TypedClipField;
  endField: TypedClipField;
  lengthDisplay: string;
  startError: string | null;
  endError: string | null;
  rangeError: string | null;
  disabled: boolean;
  playerSelected: boolean;
  playerReading: boolean;
  playheadActionsDisabled?: boolean;
  previewEnabled: boolean;
  previewLabel: string;
  onCommitRange: (startMs: number, endMs: number) => void;
  onStartChange: (text: string) => void;
  onEndChange: (text: string) => void;
  onStartBlur: () => void;
  onEndBlur: () => void;
  onPreset: (durationMs: number, window?: { startMs: number; durationMs: number }) => void;
  onPreview: () => void;
  onRefresh: () => void;
}) {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  const windowDurationMs = clipSliderWindowDurationMs(durationMs, startMs, endMs) ?? 0;
  const zoomed = clipSliderWindowIsZoomed(durationMs);
  const [windowStartMs, setWindowStartMs] = useState(0);
  const [panning, setPanning] = useState(false);
  const userAdjustedWindow = useRef(false);
  const initializedDurationMs = useRef<number | null>(null);
  const rangeKeyRef = useRef(`${startMs}:${endMs}`);
  const sliderRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ pointerId: number; x: number; startMs: number } | null>(null);

  useEffect(() => {
    const rangeKey = `${startMs}:${endMs}`;
    const rangeChanged = rangeKeyRef.current !== rangeKey;
    rangeKeyRef.current = rangeKey;
    const hasCommittedRange = startMs !== null && endMs !== null && endMs > startMs;

    if (maxMs === null || windowDurationMs <= 0) {
      initializedDurationMs.current = null;
      userAdjustedWindow.current = false;
      setWindowStartMs(0);
      return;
    }
    if (initializedDurationMs.current !== maxMs) {
      initializedDurationMs.current = maxMs;
      userAdjustedWindow.current = false;
      const next = recenterClipSliderWindow({ startMs, endMs, playheadMs, durationMs });
      setWindowStartMs(next?.startMs ?? 0);
      return;
    }
    setWindowStartMs((current) => {
      const clamped = clampClipSliderWindowStart(current, windowDurationMs, durationMs);
      if (
        rangeChanged
        && hasCommittedRange
        && !clipSliderWindowContainsRange(clamped, windowDurationMs, startMs, endMs)
      ) {
        userAdjustedWindow.current = false;
        return recenterClipSliderWindow({ startMs, endMs, playheadMs, durationMs })?.startMs ?? clamped;
      }
      if (!userAdjustedWindow.current && !hasCommittedRange) {
        return recenterClipSliderWindow({ startMs, endMs, playheadMs, durationMs })?.startMs ?? clamped;
      }
      return clamped;
    });
  }, [durationMs, endMs, maxMs, playheadMs, startMs, windowDurationMs]);

  const windowEndMs = windowStartMs + windowDurationMs;
  const sliderSpanSeconds = windowDurationMs > 0 ? windowDurationMs / 1_000 : 0;
  const displayOffsets = clipSliderDisplayOffsetSeconds({
    startMs,
    endMs,
    windowStartMs,
    windowDurationMs,
    playheadMs,
  });
  const startOffsetSeconds = displayOffsets.startSeconds;
  const endOffsetSeconds = displayOffsets.endSeconds;
  const hasRange = startMs !== null && endMs !== null && endMs > startMs;
  const rangeOnTrack = clipSliderWindowOverlapsRange(windowStartMs, windowDurationMs, startMs, endMs);
  const budget = getClipBudget(startMs, endMs);
  const startPercent = sliderSpanSeconds > 0 ? (startOffsetSeconds / sliderSpanSeconds) * 100 : 0;
  const endPercent = sliderSpanSeconds > 0 ? (endOffsetSeconds / sliderSpanSeconds) * 100 : 0;
  const fillLeft = Math.max(0, Math.min(100, startPercent));
  const fillRight = Math.max(0, Math.min(100, endPercent));
  const sliderDisabled = disabled || sliderSpanSeconds < 1;
  const actionsDisabled = disabled || !playerSelected || playerReading || playheadActionsDisabled;
  const canPanEarlier = zoomed && windowStartMs > 0;
  const canPanLater = zoomed && maxMs !== null && windowEndMs < maxMs;
  const windowCue = zoomed
    ? formatClipSliderWindowCue(windowStartMs, windowDurationMs, durationMs)
    : '';

  const moveHandle = (handle: 'start' | 'end', offsetSeconds: number) => {
    const next = moveClipHandle({
      startMs,
      endMs,
      durationMs,
      handle,
      nextMs: clipSliderMediaMsFromOffset(offsetSeconds, windowStartMs),
      windowStartMs,
      windowDurationMs,
    });
    onCommitRange(next.startMs, next.endMs);
  };

  const applyWindow = (next: { startMs: number } | null, userAdjusted: boolean) => {
    if (!next) return;
    userAdjustedWindow.current = userAdjusted;
    setWindowStartMs(next.startMs);
  };

  const panWindow = (deltaMs: number) => {
    applyWindow(panClipSliderWindow({
      windowStartMs,
      deltaMs,
      startMs,
      endMs,
      durationMs,
    }), true);
  };

  const recenterWindow = () => {
    applyWindow(recenterClipSliderWindow({ startMs, endMs, playheadMs, durationMs }), false);
  };

  const onSliderPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!zoomed || sliderDisabled) return;
    if ((event.target as HTMLElement).closest('input[type="range"]')) return;
    event.preventDefault();
    panDrag.current = { pointerId: event.pointerId, x: event.clientX, startMs: windowStartMs };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };

  const onSliderPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = sliderRef.current?.clientWidth ?? 0;
    if (width <= 0 || windowDurationMs <= 0) return;
    const deltaMs = -((event.clientX - drag.x) / width) * windowDurationMs;
    applyWindow(panClipSliderWindow({
      windowStartMs: drag.startMs,
      deltaMs,
      startMs,
      endMs,
      durationMs,
    }), true);
  };

  const endSliderPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panDrag.current?.pointerId !== event.pointerId) return;
    panDrag.current = null;
    setPanning(false);
  };

  return (
    <div className="clip-range-editor">
      <div className="clip-range-readout">
        <strong>{formatClipSpanReadout(startMs, endMs)}</strong>
        <span>{formatClipBudgetLabel(budget)}</span>
      </div>
      <div
        ref={sliderRef}
        className="clip-range-slider"
        data-empty={hasRange ? undefined : 'true'}
        data-zoomed={zoomed ? 'true' : undefined}
        data-panning={panning ? 'true' : undefined}
        onPointerDown={onSliderPointerDown}
        onPointerMove={onSliderPointerMove}
        onPointerUp={endSliderPan}
        onPointerCancel={endSliderPan}
      >
        <div className="clip-range-rail" aria-hidden="true">
          {rangeOnTrack && sliderSpanSeconds > 0 && fillRight > fillLeft && (
            <span
              className="clip-range-fill"
              style={{ left: `${fillLeft}%`, width: `${fillRight - fillLeft}%` }}
            />
          )}
        </div>
        <input
          className="clip-range-thumb clip-range-thumb-start"
          type="range"
          min={0}
          max={sliderSpanSeconds}
          step={1}
          value={startOffsetSeconds}
          disabled={sliderDisabled}
          aria-label="Clip start"
          onChange={(event) => moveHandle('start', Number(event.target.value))}
        />
        <input
          className="clip-range-thumb clip-range-thumb-end"
          type="range"
          min={0}
          max={sliderSpanSeconds}
          step={1}
          value={endOffsetSeconds}
          disabled={sliderDisabled}
          aria-label="Clip end"
          onChange={(event) => moveHandle('end', Number(event.target.value))}
        />
      </div>
      {zoomed && (
        <div className="clip-range-window">
          <p className="clip-range-window-cue">{windowCue}</p>
          <div className="clip-range-window-actions">
            <button
              className="text-button"
              type="button"
              disabled={sliderDisabled || !canPanEarlier}
              aria-label="Pan earlier"
              onClick={() => panWindow(-CLIP_SLIDER_PAN_MS)}
            >
              ‹
            </button>
            <button
              className="text-button"
              type="button"
              disabled={sliderDisabled}
              aria-label={hasRange ? 'Recenter on selection' : 'Recenter on playhead'}
              onClick={recenterWindow}
            >
              Recenter
            </button>
            <button
              className="text-button"
              type="button"
              disabled={sliderDisabled || !canPanLater}
              aria-label="Pan later"
              onClick={() => panWindow(CLIP_SLIDER_PAN_MS)}
            >
              ›
            </button>
          </div>
        </div>
      )}
      <div className="clip-preset-row">
        {CLIP_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="button button-secondary"
            type="button"
            disabled={actionsDisabled}
            onClick={() => onPreset(
              preset.durationMs,
              windowDurationMs > 0
                ? { startMs: windowStartMs, durationMs: windowDurationMs }
                : undefined,
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          className="text-button"
          type="button"
          disabled={actionsDisabled}
          onClick={onRefresh}
        >
          {playerReading ? 'Reading…' : 'Refresh time'}
        </button>
      </div>
      <ClipRangeFields
        idPrefix={idPrefix}
        startField={startField}
        endField={endField}
        lengthDisplay={lengthDisplay}
        startError={startError}
        endError={endError}
        disabled={disabled}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
        onStartBlur={onStartBlur}
        onEndBlur={onEndBlur}
      />
      <button
        className="button button-secondary preview-clip"
        type="button"
        onClick={onPreview}
        disabled={!previewEnabled || actionsDisabled}
      >
        {previewLabel}
      </button>
      {rangeError && <p className="inline-error" role="alert">{rangeError}</p>}
    </div>
  );
}
