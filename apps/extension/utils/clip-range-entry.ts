import {
  formatTypedMediaTime,
  getMediaEndpointBoundError,
  getNewMediaPublicationRangeError,
  parseMediaTime,
  TYPED_MEDIA_TIME_FORMAT_ERROR,
} from '@annotated/shared/media-time';

export type TypedClipField = {
  text: string;
  dirty: boolean;
  formatError: string | null;
};

export { TYPED_MEDIA_TIME_FORMAT_ERROR };

export function fieldFromMilliseconds(milliseconds: number | null): TypedClipField {
  return {
    text: milliseconds === null ? '' : formatTypedMediaTime(milliseconds),
    dirty: false,
    formatError: null,
  };
}

export function applyTypedClipFieldInput(
  text: string,
  commit: boolean,
): {
  field: TypedClipField;
  milliseconds: number | null;
  updateMilliseconds: boolean;
} {
  const parsed = parseMediaTime(text);
  if (parsed.status === 'empty') {
    return {
      field: { text, dirty: !commit, formatError: null },
      milliseconds: null,
      updateMilliseconds: true,
    };
  }
  if (parsed.status === 'ok') {
    return {
      field: {
        text: commit ? formatTypedMediaTime(parsed.milliseconds) : text,
        dirty: !commit,
        formatError: null,
      },
      milliseconds: parsed.milliseconds,
      updateMilliseconds: true,
    };
  }
  return {
    field: {
      text,
      dirty: true,
      formatError: commit || parsed.status === 'invalid'
        ? TYPED_MEDIA_TIME_FORMAT_ERROR
        : null,
    },
    milliseconds: null,
    updateMilliseconds: false,
  };
}

export function syncTypedClipFieldFromMilliseconds(
  field: TypedClipField,
  milliseconds: number | null,
): TypedClipField {
  if (field.dirty) {
    const parsed = parseMediaTime(field.text);
    if (parsed.status === 'ok' && parsed.milliseconds === milliseconds) return field;
    if (parsed.status === 'empty' && milliseconds === null) return field;
    return fieldFromMilliseconds(milliseconds);
  }
  const expected = milliseconds === null ? '' : formatTypedMediaTime(milliseconds);
  if (field.text === expected && field.formatError === null) return field;
  return fieldFromMilliseconds(milliseconds);
}

export function typedClipFieldMatchesMilliseconds(
  field: TypedClipField,
  milliseconds: number | null,
): boolean {
  const parsed = parseMediaTime(field.text);
  if (parsed.status === 'empty') return milliseconds === null;
  if (parsed.status === 'ok') return parsed.milliseconds === milliseconds;
  return false;
}

export function typedClipFieldsAllowPublish(
  startField: TypedClipField,
  endField: TypedClipField,
  startMs: number | null,
  endMs: number | null,
): boolean {
  return typedClipFieldMatchesMilliseconds(startField, startMs)
    && typedClipFieldMatchesMilliseconds(endField, endMs);
}

export function getTypedClipFieldError(
  field: TypedClipField,
  milliseconds: number | null,
  durationMs: number | null,
  endpoint: 'start' | 'end',
): string | null {
  return field.formatError ?? getMediaEndpointBoundError(milliseconds, durationMs, endpoint);
}

export function getTypedClipRangeError(
  startMs: number | null,
  endMs: number | null,
  durationMs: number | null,
): string | null {
  return getNewMediaPublicationRangeError(startMs, endMs, durationMs);
}
