import {
  AI_SUGGESTED_ORIGIN,
  RECEIPT_SOURCE_LIMIT,
  parseApprovedReceiptSource,
  parsePublicReceiptSource,
  sameHttpUrl,
  type ApprovedReceiptSource,
} from '@annotated/shared/receipt-source';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from './social-helpers.ts';

export type { ApprovedReceiptSource };
export { AI_SUGGESTED_ORIGIN };

export type ReceiptSuggestion = {
  claimSummary: string;
  sources: ApprovedReceiptSource[];
};

type PostgrestError = { code?: string; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMissingSourcesColumn(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return text.includes('42703') || text.includes('pgrst204') || (
    text.includes('sources') && (text.includes('column') || text.includes('schema cache'))
  );
}

function suggestionSource(value: unknown): ApprovedReceiptSource | null {
  const source = parseApprovedReceiptSource(value);
  return source?.origin === AI_SUGGESTED_ORIGIN ? source : null;
}

export function parseReceiptSuggestionResponse(value: unknown): ReceiptSuggestion | null {
  if (!isRecord(value) || typeof value.claimSummary !== 'string') return null;
  const claimSummary = value.claimSummary.replace(/\s+/g, ' ').trim();
  if (claimSummary.length < 8 || claimSummary.length > 400 || !Array.isArray(value.sources)) return null;
  const sources: ApprovedReceiptSource[] = [];
  for (const candidate of value.sources) {
    const source = suggestionSource(candidate);
    if (!source || sources.some((item) => sameHttpUrl(item.url, source.url))) continue;
    sources.push(source);
    if (sources.length === RECEIPT_SOURCE_LIMIT) break;
  }
  if (sources.length < 2) return null;
  return { claimSummary, sources };
}

export async function loadReceiptAssistAvailability(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL('/api/receipts/suggest', origin), { method: 'GET' });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isRecord(body) && body.enabled === true;
  } catch {
    return false;
  }
}

export async function requestReceiptSuggestions(
  origin: string,
  accessToken: string,
  input: { passage: string; pageUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ReceiptSuggestion> {
  const response = await fetchImpl(new URL('/api/receipts/suggest', origin), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      passage: input.passage,
      pageUrl: input.pageUrl,
    }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : 'RECEIPTS_FAILED';
    throw new Error(code === 'RECEIPTS_UNAVAILABLE' ? 'RECEIPTS_UNAVAILABLE' : 'RECEIPTS_FAILED');
  }
  const suggestion = parseReceiptSuggestionResponse(body);
  if (!suggestion) throw new Error('RECEIPTS_FAILED');
  return suggestion;
}

async function appendSourcesColumn(
  supabase: SupabaseClient,
  annotationId: string,
  source: ApprovedReceiptSource,
): Promise<'attached' | 'missing' | 'rejected'> {
  const read = await supabase
    .from('annotations')
    .select('sources')
    .eq('id', annotationId)
    .maybeSingle();
  if (read.error) return isMissingSourcesColumn(read.error) ? 'missing' : 'rejected';
  const current = isRecord(read.data) && Array.isArray(read.data.sources) ? read.data.sources : null;
  if (!current && isRecord(read.data) && read.data.sources != null) return 'rejected';
  const existing = current ?? [];
  if (existing.some((item) => {
    const parsed = parsePublicReceiptSource(item);
    return parsed ? sameHttpUrl(parsed.url, source.url) : false;
  })) return 'attached';
  if (existing.length >= RECEIPT_SOURCE_LIMIT) return 'rejected';
  const write = await supabase
    .from('annotations')
    .update({
      sources: [...existing, {
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        origin: AI_SUGGESTED_ORIGIN,
      }],
    })
    .eq('id', annotationId);
  if (write.error) return isMissingSourcesColumn(write.error) ? 'missing' : 'rejected';
  return 'attached';
}

async function insertReceiptRow(
  supabase: SupabaseClient,
  annotationId: string,
  source: ApprovedReceiptSource,
): Promise<'attached' | 'rejected'> {
  const { error } = await supabase.from('annotation_receipt_sources').insert({
    annotation_id: annotationId,
    url: source.url,
    title: source.title,
    publisher: source.publisher,
    origin: AI_SUGGESTED_ORIGIN,
  });
  if (!error) return 'attached';
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  if (error.code === '23505' || /duplicate/i.test(text)) return 'attached';
  return 'rejected';
}

export async function attachApprovedReceiptSource(
  supabase: SupabaseClient,
  annotationId: string,
  source: ApprovedReceiptSource,
): Promise<'attached' | 'unavailable'> {
  const approved = parseApprovedReceiptSource(source);
  if (!approved || !isUuid(annotationId)) return 'unavailable';
  const column = await appendSourcesColumn(supabase, annotationId, approved);
  if (column === 'attached') return 'attached';
  if (column === 'rejected') {
    const fallback = await insertReceiptRow(supabase, annotationId, approved);
    return fallback === 'attached' ? 'attached' : 'unavailable';
  }
  const inserted = await insertReceiptRow(supabase, annotationId, approved);
  return inserted === 'attached' ? 'attached' : 'unavailable';
}

export async function attachApprovedReceiptSources(
  supabase: SupabaseClient,
  annotationId: string,
  sources: readonly ApprovedReceiptSource[],
): Promise<void> {
  const unique: ApprovedReceiptSource[] = [];
  for (const candidate of sources) {
    const source = parseApprovedReceiptSource(candidate);
    if (!source || unique.some((item) => sameHttpUrl(item.url, source.url))) continue;
    unique.push(source);
    if (unique.length === RECEIPT_SOURCE_LIMIT) break;
  }
  for (const source of unique) {
    await attachApprovedReceiptSource(supabase, annotationId, source);
  }
}
