import { useEffect, useRef, useState } from 'react';
import {
  applyTypedClipFieldInput,
  fieldFromMilliseconds,
  getTypedClipFieldError,
  syncTypedClipFieldFromMilliseconds,
  typedClipFieldsAllowPublish,
  type TypedClipField,
} from '../../utils/clip-range-entry';

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
    setStartField(result.field);
    if (result.updateMilliseconds) onCommitRef.current(result.milliseconds, endMsRef.current);
  };

  const commitEnd = () => {
    const result = applyTypedClipFieldInput(endFieldRef.current.text, true);
    setEndField(result.field);
    if (result.updateMilliseconds) onCommitRef.current(startMsRef.current, result.milliseconds);
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
