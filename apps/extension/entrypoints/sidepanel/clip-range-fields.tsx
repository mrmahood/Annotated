import { useEffect, useRef, useState } from 'react';
import {
  applyTypedClipFieldInput,
  fieldFromMilliseconds,
  syncTypedClipFieldFromMilliseconds,
  typedClipFieldsAllowPublish,
  type TypedClipField,
} from '../../utils/clip-range-entry';
import {
  CLIP_PRESETS,
  formatClipBudgetLabel,
  formatClipSpanReadout,
  getClipBudget,
  mediaDurationSliderMaxMs,
  moveClipHandle,
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
  startField,
  endField,
  lengthDisplay,
  startError,
  endError,
  rangeError,
  disabled,
  playerSelected,
  playerReading,
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
  startField: TypedClipField;
  endField: TypedClipField;
  lengthDisplay: string;
  startError: string | null;
  endError: string | null;
  rangeError: string | null;
  disabled: boolean;
  playerSelected: boolean;
  playerReading: boolean;
  previewEnabled: boolean;
  previewLabel: string;
  onCommitRange: (startMs: number, endMs: number) => void;
  onStartChange: (text: string) => void;
  onEndChange: (text: string) => void;
  onStartBlur: () => void;
  onEndBlur: () => void;
  onPreset: (durationMs: number) => void;
  onPreview: () => void;
  onRefresh: () => void;
}) {
  const maxMs = mediaDurationSliderMaxMs(durationMs);
  const maxSeconds = maxMs === null ? 0 : maxMs / 1_000;
  const startSeconds = startMs === null ? 0 : Math.round(startMs / 1_000);
  const endSeconds = endMs === null ? 0 : Math.round(endMs / 1_000);
  const hasRange = startMs !== null && endMs !== null && endMs > startMs;
  const budget = getClipBudget(startMs, endMs);
  const startPercent = maxSeconds > 0 ? (startSeconds / maxSeconds) * 100 : 0;
  const widthPercent = maxSeconds > 0 ? (Math.max(0, endSeconds - startSeconds) / maxSeconds) * 100 : 0;
  const sliderDisabled = disabled || maxSeconds < 1;
  const actionsDisabled = disabled || !playerSelected || playerReading;

  const moveHandle = (handle: 'start' | 'end', nextSeconds: number) => {
    const next = moveClipHandle({
      startMs,
      endMs,
      durationMs,
      handle,
      nextMs: nextSeconds * 1_000,
    });
    onCommitRange(next.startMs, next.endMs);
  };

  return (
    <div className="clip-range-editor">
      <div className="clip-range-readout">
        <strong>{formatClipSpanReadout(startMs, endMs)}</strong>
        <span>{formatClipBudgetLabel(budget)}</span>
      </div>
      <div className="clip-range-slider" data-empty={hasRange ? undefined : 'true'}>
        <div className="clip-range-rail" aria-hidden="true">
          {hasRange && maxSeconds > 0 && (
            <span
              className="clip-range-fill"
              style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
            />
          )}
        </div>
        <input
          className="clip-range-thumb clip-range-thumb-start"
          type="range"
          min={0}
          max={maxSeconds}
          step={1}
          value={Math.min(startSeconds, maxSeconds)}
          disabled={sliderDisabled}
          aria-label="Clip start"
          onChange={(event) => moveHandle('start', Number(event.target.value))}
        />
        <input
          className="clip-range-thumb clip-range-thumb-end"
          type="range"
          min={0}
          max={maxSeconds}
          step={1}
          value={Math.min(endSeconds, maxSeconds)}
          disabled={sliderDisabled}
          aria-label="Clip end"
          onChange={(event) => moveHandle('end', Number(event.target.value))}
        />
      </div>
      <div className="clip-preset-row">
        {CLIP_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="button button-secondary"
            type="button"
            disabled={actionsDisabled}
            onClick={() => onPreset(preset.durationMs)}
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
