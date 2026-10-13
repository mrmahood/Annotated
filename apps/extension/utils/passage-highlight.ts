import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAnnotationQueryPlan, isUuid } from './social-helpers.ts';
import {
  applyPassageHighlightsOnPage,
  PASSAGE_HIGHLIGHT_LIMIT,
  type PassageHighlightPageRequest,
  type PassageHighlightPageResult,
  type PassageHighlighterToken,
} from './passage-highlight-page.ts';

export const PASSAGE_OPEN_MESSAGE = 'annotated-passage-open';
export const PASSAGE_OPEN_STORAGE_KEY = 'annotatedPassageOpen';
const PASSAGE_OPEN_TTL_MS = 2 * 60 * 1000;

const VERDICT_SELECT = `
  id,
  title,
  commentary_text,
  published_at,
  verdict,
  source:sources!annotations_source_id_fkey!inner(normalized_url),
  target:annotation_targets!annotation_targets_annotation_id_fkey(*)
`;

const PUBLIC_SELECT = `
  id,
  title,
  commentary_text,
  published_at,
  source:sources!annotations_source_id_fkey!inner(normalized_url),
  target:annotation_targets!annotation_targets_annotation_id_fkey(*)
`;

export type PublishedPassage = {
  annotationId: string;
  quote: string;
  prefix: string | null;
  suffix: string | null;
  verdict: string | null;
  color: PassageHighlighterToken;
  commentary: string | null;
  title: string | null;
};

export type PassageHighlightPanel =
  | { status: 'empty' }
  | { status: 'highlighted'; highlighted: number; unmatched: number }
  | { status: 'list'; passages: PublishedPassage[]; reason: 'csp-blocked' | 'unavailable' }
  | { status: 'error' };

export type PassageOpenRequest = {
  annotationId: string;
  tabId: number | null;
  requestedAt: number;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function singleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function verdictText(value: unknown): string | null {
  if (typeof value === 'string') return optionalText(value, 80);
  if (!isRecord(value)) return null;
  return verdictText(value.label ?? value.value ?? value.name ?? value.verdict);
}

export function highlighterTokenForVerdict(verdict: string | null): PassageHighlighterToken {
  if (!verdict) return 'yellow';
  const key = verdict.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if ([
    'agree', 'support', 'supported', 'true', 'accurate', 'confirmed', 'yes',
  ].includes(key)) return 'green';
  if ([
    'disagree', 'refute', 'refuted', 'false', 'inaccurate', 'no', 'contradict', 'contradicted',
  ].includes(key)) return 'red';
  if ([
    'mixed', 'uncertain', 'partial', 'disputed', 'context', 'unclear',
  ].includes(key)) return 'amber';
  return 'yellow';
}

export function readPassageVerdict(annotation: UnknownRecord, target: UnknownRecord | null): string | null {
  const metadata = isRecord(annotation.metadata) ? annotation.metadata : null;
  return verdictText(annotation.verdict)
    ?? verdictText(annotation.annotation_verdict)
    ?? verdictText(target?.verdict)
    ?? verdictText(target?.annotation_verdict)
    ?? verdictText(metadata?.verdict);
}

export function mapPublishedPassages(rows: unknown): PublishedPassage[] {
  if (!Array.isArray(rows)) return [];
  const passages: PublishedPassage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || passages.length >= PASSAGE_HIGHLIGHT_LIMIT) continue;
    const target = singleRelation(row.target);
    const annotationId = optionalText(row.id, 80);
    const quote = optionalText(target?.selected_text, 2000);
    if (!annotationId || !isUuid(annotationId) || !quote || seen.has(annotationId)) continue;
    if (optionalText(target?.target_type, 40) !== 'text') continue;
    const verdict = readPassageVerdict(row, target);
    seen.add(annotationId);
    passages.push({
      annotationId,
      quote,
      prefix: optionalText(target?.text_prefix, 500),
      suffix: optionalText(target?.text_suffix, 500),
      verdict,
      color: highlighterTokenForVerdict(verdict),
      commentary: optionalText(row.commentary_text, 2000),
      title: optionalText(row.title, 120),
    });
  }
  return passages;
}

export function isMissingVerdictColumnError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (!message.includes('verdict')) return false;
  return code === '42703' || code === 'PGRST204' ||
    message.includes('does not exist') || message.includes('schema cache');
}

type PassageQuery = {
  select: (columns: string) => PassageQuery;
  eq: (column: string, value: string) => PassageQuery;
  in: (column: string, value: string[]) => PassageQuery;
  order: (column: string, options: { ascending: boolean }) => PassageQuery;
  limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function queryPublishedPassages(
  supabase: SupabaseClient,
  pageUrl: string,
): Promise<PublishedPassage[]> {
  let urls: string[] = [];
  try {
    const plan = buildAnnotationQueryPlan({ sourceUrl: pageUrl });
    urls = plan.normalizedUrls ?? (plan.normalizedUrl ? [plan.normalizedUrl] : []);
  } catch {
    return [];
  }
  if (urls.length === 0) return [];

  const run = async (includeVerdict: boolean) => {
    let query = (supabase.from('annotations') as unknown as PassageQuery)
      .select(includeVerdict ? VERDICT_SELECT : PUBLIC_SELECT)
      .eq('status', 'published')
      .eq('annotation_type', 'article_text');
    query = urls.length === 1
      ? query.eq('source.normalized_url', urls[0] ?? '')
      : query.in('source.normalized_url', urls);
    return query
      .order('published_at', { ascending: false })
      .limit(PASSAGE_HIGHLIGHT_LIMIT);
  };

  const first = await run(true);
  if (first.error && isMissingVerdictColumnError(first.error)) {
    const retry = await run(false);
    if (retry.error || !Array.isArray(retry.data)) throw new Error('Published passages are unavailable.');
    return mapPublishedPassages(retry.data);
  }
  if (first.error || !Array.isArray(first.data)) throw new Error('Published passages are unavailable.');
  return mapPublishedPassages(first.data);
}

function readPageResult(value: unknown): PassageHighlightPageResult | null {
  if (!Array.isArray(value) || value.length === 0 || !isRecord(value[0])) return null;
  const result = value[0].result;
  if (!isRecord(result) || typeof result.ok !== 'boolean') return null;
  const reason = result.reason;
  if (
    reason !== undefined && reason !== 'csp-blocked' && reason !== 'source-mismatch' &&
    reason !== 'invalid-request' && reason !== 'cleared'
  ) return null;
  const highlighted = result.highlighted;
  const unmatched = result.unmatched;
  return {
    ok: result.ok,
    ...(typeof reason === 'string' ? { reason } : {}),
    ...(typeof highlighted === 'number' && Number.isSafeInteger(highlighted) ? { highlighted } : {}),
    ...(typeof unmatched === 'number' && Number.isSafeInteger(unmatched) ? { unmatched } : {}),
  };
}

export async function applyPublishedPassageHighlights(options: {
  supabase: SupabaseClient;
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: [0] };
      func: typeof applyPassageHighlightsOnPage;
      args: [PassageHighlightPageRequest];
    }) => Promise<unknown>;
  } | null | undefined;
  tabId: number;
  pageUrl: string;
}): Promise<PassageHighlightPanel> {
  let passages: PublishedPassage[];
  try {
    passages = await queryPublishedPassages(options.supabase, options.pageUrl);
  } catch {
    return { status: 'error' };
  }
  if (!options.scripting?.executeScript || !Number.isInteger(options.tabId) || options.tabId < 0) {
    return passages.length
      ? { status: 'list', passages, reason: 'unavailable' }
      : { status: 'empty' };
  }

  try {
    const injection = await options.scripting.executeScript({
      target: { tabId: options.tabId, frameIds: [0] },
      func: applyPassageHighlightsOnPage,
      args: [{
        pageUrl: options.pageUrl,
        passages: passages.map((passage) => ({
          annotationId: passage.annotationId,
          quote: passage.quote,
          prefix: passage.prefix,
          suffix: passage.suffix,
          color: passage.color,
        })),
      }],
    });
    const page = readPageResult(injection);
    if (!page) {
      return passages.length
        ? { status: 'list', passages, reason: 'unavailable' }
        : { status: 'error' };
    }
    if (page.reason === 'csp-blocked') return { status: 'list', passages, reason: 'csp-blocked' };
    if (!page.ok) return { status: 'error' };
    if (passages.length === 0) return { status: 'empty' };
    return {
      status: 'highlighted',
      highlighted: page.highlighted ?? 0,
      unmatched: page.unmatched ?? 0,
    };
  } catch {
    return passages.length
      ? { status: 'list', passages, reason: 'unavailable' }
      : { status: 'error' };
  }
}

export function isPassageOpenMessage(value: unknown): value is { type: typeof PASSAGE_OPEN_MESSAGE; annotationId: string } {
  return isRecord(value) && value.type === PASSAGE_OPEN_MESSAGE && isUuid(value.annotationId);
}

export function isPassageOpenRequest(value: unknown, now = Date.now()): value is PassageOpenRequest {
  if (!isRecord(value) || !isUuid(value.annotationId)) return false;
  if (typeof value.requestedAt !== 'number' || !Number.isFinite(value.requestedAt)) return false;
  if (now - value.requestedAt >= PASSAGE_OPEN_TTL_MS || value.requestedAt - now > 5_000) return false;
  const tabId = value.tabId;
  if (tabId !== null && (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0)) return false;
  return true;
}

export function installPassageHighlightOpen(chromeApi: {
  runtime: {
    onMessage: {
      addListener: (
        listener: (message: unknown, sender: { tab?: { id?: number } }) => void,
      ) => void;
    };
  };
  storage: {
    session: {
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  sidePanel?: {
    open: (options: { tabId: number }) => Promise<void>;
  };
}): void {
  chromeApi.runtime.onMessage.addListener((message, sender) => {
    if (!isPassageOpenMessage(message)) return;
    const tabId = typeof sender.tab?.id === 'number' ? sender.tab.id : null;
    const request: PassageOpenRequest = {
      annotationId: message.annotationId,
      tabId,
      requestedAt: Date.now(),
    };
    void chromeApi.storage.session.set({ [PASSAGE_OPEN_STORAGE_KEY]: request });
    if (tabId !== null && chromeApi.sidePanel?.open) {
      void chromeApi.sidePanel.open({ tabId }).catch(() => undefined);
    }
  });
}
