export const ANNOTATION_TITLE_MAX_LENGTH = 120;
export const ANNOTATION_TITLE_ERROR = 'Title cannot exceed 120 characters.';

export function getAnnotationTitleError(value: string): string | null {
  if (value.length > ANNOTATION_TITLE_MAX_LENGTH) {
    return ANNOTATION_TITLE_ERROR;
  }
  return null;
}

export function normalizeAnnotationTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseStoredAnnotationTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ANNOTATION_TITLE_MAX_LENGTH) return null;
  return trimmed;
}

export function readDraftAnnotationTitle(value: unknown): string {
  return typeof value === 'string' && value.length <= ANNOTATION_TITLE_MAX_LENGTH
    ? value
    : '';
}
