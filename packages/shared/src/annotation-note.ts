export const ANNOTATION_NOTE_TYPES = [
  'fact_check',
  'receipts',
  'context',
  'steelman',
  'hot_take',
] as const;

export const ANNOTATION_VERDICTS = [
  'true',
  'misleading',
  'false',
  'needs_context',
] as const;

export const ANNOTATION_SOURCE_URL_LIMIT = 8;
export const ANNOTATION_SOURCE_URL_MAX_LENGTH = 2_000;

export const ANNOTATION_NOTE_TYPE_REQUIRED = 'An annotation type is required.';
export const ANNOTATION_VERDICT_UNRECOGNIZED = 'The verdict is not recognized.';
export const ANNOTATION_FACT_CHECK_VERDICT_REQUIRED = 'A fact check requires a verdict.';
export const ANNOTATION_SOURCE_URL_INVALID = 'Each source link must be an HTTP or HTTPS URL.';
export const ANNOTATION_SOURCE_URL_LIMIT_ERROR = 'At most 8 source links are allowed.';
export const ANNOTATION_SOURCE_LINKS_REQUIRED = 'Fact check and Receipts require at least one source link.';

const SOURCE_URL_PATTERN = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^\s]*)?$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AnnotationNoteType = (typeof ANNOTATION_NOTE_TYPES)[number];
export type AnnotationVerdict = (typeof ANNOTATION_VERDICTS)[number];

export const ANNOTATION_NOTE_TYPE_LABELS: Record<AnnotationNoteType, string> = {
  fact_check: 'Fact check',
  receipts: 'Receipts',
  context: 'Context',
  steelman: 'Steelman',
  hot_take: 'Hot take',
};

export const ANNOTATION_VERDICT_LABELS: Record<AnnotationVerdict, string> = {
  true: 'True',
  misleading: 'Misleading',
  false: 'False',
  needs_context: 'Needs context',
};

export type AnnotationSourceLink = {
  id: string;
  url: string;
  position: number;
};

export type AnnotationNoteInput = {
  noteType: AnnotationNoteType;
  verdict: AnnotationVerdict | null;
  sourceUrls: string[];
};

export type AnnotationConsensusSource = AnnotationSourceLink & {
  helpfulCount: number;
  viewerMarkedHelpful: boolean;
};

export type AnnotationConsensus = {
  agreeCount: number;
  disagreeCount: number;
  viewerAgreement: -1 | 1 | null;
  sources: AnnotationConsensusSource[];
};

export type HelpfulRatingResult = {
  resultCode: 'CREATED' | 'CLEARED' | 'RATE_LIMITED' | 'SELF_RATE_FORBIDDEN' | 'SOURCE_UNAVAILABLE' | 'AUTH_REQUIRED';
  helpfulCount: number;
  viewerMarkedHelpful: boolean;
  retryAfterSeconds: number | null;
};

type NoteDraft = {
  noteType: string;
  verdict: string;
  sourceUrls: readonly string[];
};

export function isAnnotationNoteType(value: unknown): value is AnnotationNoteType {
  return typeof value === 'string' && ANNOTATION_NOTE_TYPES.includes(value as AnnotationNoteType);
}

export function isAnnotationVerdict(value: unknown): value is AnnotationVerdict {
  return typeof value === 'string' && ANNOTATION_VERDICTS.includes(value as AnnotationVerdict);
}

export function noteTypeRequiresVerdict(noteType: AnnotationNoteType): boolean {
  return noteType === 'fact_check';
}

export function noteTypeRequiresSourceLinks(noteType: AnnotationNoteType): boolean {
  return noteType === 'fact_check' || noteType === 'receipts';
}

export function isAnnotationSourceUrl(value: string): boolean {
  return value.length <= ANNOTATION_SOURCE_URL_MAX_LENGTH && SOURCE_URL_PATTERN.test(value);
}

export function normalizeAnnotationSourceUrls(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const url = value.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function getAnnotationNoteError(draft: NoteDraft): string | null {
  if (!isAnnotationNoteType(draft.noteType)) return ANNOTATION_NOTE_TYPE_REQUIRED;
  if (draft.verdict !== '' && !isAnnotationVerdict(draft.verdict)) return ANNOTATION_VERDICT_UNRECOGNIZED;
  if (noteTypeRequiresVerdict(draft.noteType) && !isAnnotationVerdict(draft.verdict)) {
    return ANNOTATION_FACT_CHECK_VERDICT_REQUIRED;
  }
  const urls = normalizeAnnotationSourceUrls(draft.sourceUrls);
  const entered = draft.sourceUrls.map((value) => value.trim()).filter(Boolean);
  if (entered.length > ANNOTATION_SOURCE_URL_LIMIT) return ANNOTATION_SOURCE_URL_LIMIT_ERROR;
  if (entered.some((url) => !isAnnotationSourceUrl(url))) return ANNOTATION_SOURCE_URL_INVALID;
  if (noteTypeRequiresSourceLinks(draft.noteType) && urls.length < 1) {
    return ANNOTATION_SOURCE_LINKS_REQUIRED;
  }
  return null;
}

export function readAnnotationNoteForPublish(
  draft: NoteDraft,
): { ok: true; note: AnnotationNoteInput } | { ok: false; message: string } {
  const message = getAnnotationNoteError(draft);
  if (message || !isAnnotationNoteType(draft.noteType)) {
    return { ok: false, message: message ?? ANNOTATION_NOTE_TYPE_REQUIRED };
  }
  return {
    ok: true,
    note: {
      noteType: draft.noteType,
      verdict: isAnnotationVerdict(draft.verdict) ? draft.verdict : null,
      sourceUrls: normalizeAnnotationSourceUrls(draft.sourceUrls),
    },
  };
}

export function annotationNoteRpcArguments(note: AnnotationNoteInput): {
  p_note_type: AnnotationNoteType;
  p_verdict: AnnotationVerdict | null;
  p_source_urls: string[];
} {
  const parsed = readAnnotationNoteForPublish({
    noteType: note.noteType,
    verdict: note.verdict ?? '',
    sourceUrls: note.sourceUrls,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    p_note_type: parsed.note.noteType,
    p_verdict: parsed.note.verdict,
    p_source_urls: parsed.note.sourceUrls,
  };
}

export function parseStoredAnnotationNote(
  noteType: unknown,
  verdict: unknown,
  citedSources: unknown,
): {
  noteType: AnnotationNoteType | null;
  verdict: AnnotationVerdict | null;
  sourceLinks: AnnotationSourceLink[];
} {
  const parsedType = isAnnotationNoteType(noteType) ? noteType : null;
  const parsedVerdict = parsedType && isAnnotationVerdict(verdict) ? verdict : null;
  return {
    noteType: parsedType,
    verdict: parsedVerdict,
    sourceLinks: parseStoredSourceLinks(citedSources),
  };
}

export function parseStoredSourceLinks(value: unknown): AnnotationSourceLink[] {
  if (!Array.isArray(value)) return [];
  const links: AnnotationSourceLink[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const id = row.id;
    const url = row.url;
    const position = row.position;
    if (
      typeof id !== 'string' || !UUID_PATTERN.test(id) ||
      typeof url !== 'string' || !isAnnotationSourceUrl(url) ||
      typeof position !== 'number' || !Number.isInteger(position) ||
      position < 1 || position > ANNOTATION_SOURCE_URL_LIMIT
    ) continue;
    links.push({ id, url, position });
  }
  return links.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function parseCount(value: unknown): number | null {
  const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function parseAnnotationConsensus(value: unknown): AnnotationConsensus | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const agreeCount = parseCount(record.agree_count);
  const disagreeCount = parseCount(record.disagree_count);
  const viewerAgreement = record.viewer_agreement === null || record.viewer_agreement === undefined
    ? null
    : record.viewer_agreement === 1 || record.viewer_agreement === -1
      ? record.viewer_agreement
      : undefined;
  if (agreeCount === null || disagreeCount === null || viewerAgreement === undefined) return null;
  if (!Array.isArray(record.sources)) return null;
  const sources: AnnotationConsensusSource[] = [];
  for (const link of parseStoredSourceLinks(record.sources)) {
    const match = record.sources.find((candidate) => {
      return !!candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === link.id;
    }) as Record<string, unknown> | undefined;
    const helpfulCount = parseCount(match?.helpful_count);
    if (helpfulCount === null || typeof match?.viewer_helpful !== 'boolean') return null;
    sources.push({ ...link, helpfulCount, viewerMarkedHelpful: match.viewer_helpful });
  }
  return { agreeCount, disagreeCount, viewerAgreement, sources };
}

export function parseHelpfulRatingResult(value: unknown): HelpfulRatingResult | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const resultCode = record.result_code;
  if (
    resultCode !== 'CREATED' && resultCode !== 'CLEARED' && resultCode !== 'RATE_LIMITED' &&
    resultCode !== 'SELF_RATE_FORBIDDEN' && resultCode !== 'SOURCE_UNAVAILABLE' &&
    resultCode !== 'AUTH_REQUIRED'
  ) return null;
  const helpfulCount = parseCount(record.helpful_count);
  if (helpfulCount === null || typeof record.viewer_helpful !== 'boolean') return null;
  const retryAfterSeconds = record.retry_after_seconds === null || record.retry_after_seconds === undefined
    ? null
    : typeof record.retry_after_seconds === 'number' &&
      Number.isSafeInteger(record.retry_after_seconds) &&
      record.retry_after_seconds >= 1 &&
      record.retry_after_seconds <= 600
      ? record.retry_after_seconds
      : undefined;
  if (retryAfterSeconds === undefined) return null;
  if ((resultCode === 'RATE_LIMITED') !== (retryAfterSeconds !== null)) return null;
  return {
    resultCode,
    helpfulCount,
    viewerMarkedHelpful: record.viewer_helpful,
    retryAfterSeconds,
  };
}

export function helpfulSourceCount(sources: readonly { helpfulCount: number }[]): number {
  return sources.reduce((total, source) => total + source.helpfulCount, 0);
}

export function isMissingAnnotationNoteSchema(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  const mentionsClassification = message.includes('note_type') || message.includes('annotation_sources');
  if (!mentionsClassification) return false;
  const code = error.code ?? '';
  return code === '42703'
    || code === '42P01'
    || code.startsWith('PGRST')
    || message.includes('does not exist')
    || message.includes('schema cache');
}
