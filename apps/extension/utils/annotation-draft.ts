import { normalizeArticleUrl } from '@annotated/shared/url-normalization';
import type { ActiveTabContext } from './active-tab-context';
import type { CapturedArticleSelection } from './selection-capture';

export const ANNOTATION_DRAFT_STORAGE_KEY = 'annotated.annotationDraft.v1';

const ANNOTATION_DRAFT_VERSION = 1 as const;
const MAXIMUM_ANNOTATION_TEXT_LENGTH = 2_000;

export type AnnotationDraft = {
  version: typeof ANNOTATION_DRAFT_VERSION;
  source: {
    tabId: number;
    windowId: number;
    connectedUrl: string;
    normalizedUrl: string;
  };
  capture: CapturedArticleSelection;
  commentary: string;
  updatedAt: number;
};

export type AnnotationDraftLifecycleEvent =
  | 'publish-succeeded'
  | 'explicit-clear'
  | 'source-invalidated'
  | 'unmount'
  | 'navigation'
  | 'audio-discard'
  | 'audio-failure';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function normalizeSourceUrl(value: string): string | null {
  try {
    return normalizeArticleUrl(value);
  } catch {
    return null;
  }
}

function deserializeCapture(value: unknown): CapturedArticleSelection | null {
  if (!isRecord(value)) return null;

  if (
    typeof value.selectedText !== 'string' ||
    value.selectedText.length < 1 ||
    value.selectedText.length > MAXIMUM_ANNOTATION_TEXT_LENGTH ||
    typeof value.textPrefix !== 'string' ||
    typeof value.textSuffix !== 'string' ||
    typeof value.pageTitle !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.canonicalUrl !== 'string' ||
    typeof value.hostname !== 'string' ||
    !isNullableString(value.author) ||
    !isNullableString(value.publisher) ||
    typeof value.capturedAt !== 'string' ||
    normalizeSourceUrl(value.sourceUrl) === null ||
    normalizeSourceUrl(value.canonicalUrl) === null
  ) {
    return null;
  }

  return {
    selectedText: value.selectedText,
    textPrefix: value.textPrefix,
    textSuffix: value.textSuffix,
    pageTitle: value.pageTitle,
    sourceUrl: value.sourceUrl,
    canonicalUrl: value.canonicalUrl,
    hostname: value.hostname,
    author: value.author,
    publisher: value.publisher,
    capturedAt: value.capturedAt,
  };
}

export function serializeAnnotationDraft(
  context: ActiveTabContext,
  capture: CapturedArticleSelection,
  commentary: string,
  updatedAt = Date.now(),
): AnnotationDraft {
  const normalizedUrl = normalizeSourceUrl(capture.sourceUrl);
  if (
    normalizedUrl === null ||
    normalizeSourceUrl(context.url) !== normalizedUrl ||
    commentary.length > MAXIMUM_ANNOTATION_TEXT_LENGTH
  ) {
    throw new Error('The annotation draft source or commentary is invalid.');
  }

  return {
    version: ANNOTATION_DRAFT_VERSION,
    source: {
      tabId: context.tabId,
      windowId: context.windowId,
      connectedUrl: context.url,
      normalizedUrl,
    },
    capture: { ...capture },
    commentary,
    updatedAt,
  };
}

export function deserializeAnnotationDraft(value: unknown): AnnotationDraft | null {
  if (!isRecord(value) || value.version !== ANNOTATION_DRAFT_VERSION) return null;
  if (
    !isRecord(value.source) ||
    typeof value.source.tabId !== 'number' ||
    !Number.isInteger(value.source.tabId) ||
    value.source.tabId < 0 ||
    typeof value.source.windowId !== 'number' ||
    !Number.isInteger(value.source.windowId) ||
    value.source.windowId < 0
  ) return null;
  if (typeof value.source.connectedUrl !== 'string' || typeof value.source.normalizedUrl !== 'string') return null;
  if (typeof value.commentary !== 'string' || value.commentary.length > MAXIMUM_ANNOTATION_TEXT_LENGTH) return null;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null;

  const normalizedConnectedUrl = normalizeSourceUrl(value.source.connectedUrl);
  const capture = deserializeCapture(value.capture);
  if (
    normalizedConnectedUrl === null ||
    normalizedConnectedUrl !== value.source.normalizedUrl ||
    capture === null ||
    normalizeSourceUrl(capture.sourceUrl) !== value.source.normalizedUrl
  ) {
    return null;
  }

  return {
    version: ANNOTATION_DRAFT_VERSION,
    source: {
      tabId: value.source.tabId,
      windowId: value.source.windowId,
      connectedUrl: value.source.connectedUrl,
      normalizedUrl: value.source.normalizedUrl,
    },
    capture,
    commentary: value.commentary,
    updatedAt: value.updatedAt,
  };
}

export function annotationDraftBelongsToContext(
  draft: AnnotationDraft,
  context: ActiveTabContext,
): boolean {
  return (
    draft.source.tabId === context.tabId &&
    draft.source.windowId === context.windowId &&
    normalizeSourceUrl(context.url) === draft.source.normalizedUrl
  );
}

export function updateAnnotationDraftCommentary(
  draft: AnnotationDraft,
  commentary: string,
  updatedAt = Date.now(),
): AnnotationDraft | null {
  if (commentary.length > MAXIMUM_ANNOTATION_TEXT_LENGTH) return null;
  return { ...draft, commentary, updatedAt };
}

export function shouldApplyDraftRestoration(
  restorationRevision: number,
  currentRevision: number,
  draft: AnnotationDraft | null,
  context: ActiveTabContext | null,
): draft is AnnotationDraft {
  return (
    restorationRevision === currentRevision &&
    draft !== null &&
    context !== null &&
    annotationDraftBelongsToContext(draft, context)
  );
}

export function shouldClearAnnotationDraft(event: AnnotationDraftLifecycleEvent): boolean {
  return event === 'publish-succeeded' || event === 'explicit-clear';
}
