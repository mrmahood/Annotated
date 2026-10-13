export const AI_SUGGESTED_ORIGIN = 'ai-suggested' as const;
export const RECEIPT_SOURCE_LIMIT = 3;

export type ApprovedReceiptSource = {
  url: string;
  title: string;
  publisher: string | null;
  origin: typeof AI_SUGGESTED_ORIGIN;
};

export type PublicReceiptSource = {
  url: string;
  title: string;
  publisher: string | null;
  origin: typeof AI_SUGGESTED_ORIGIN | 'approved';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPublicHttpsUrl(value: string): boolean {
  if (value.length > 2_000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || !host.includes('.')) return false;
  return true;
}

export function parseApprovedReceiptSource(value: unknown): ApprovedReceiptSource | null {
  if (!isRecord(value) || value.origin !== AI_SUGGESTED_ORIGIN) return null;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const publisherValue = value.publisher;
  const publisher = publisherValue == null
    ? null
    : typeof publisherValue === 'string' ? publisherValue.trim() : null;
  if (!isPublicHttpsUrl(url) || title.length < 1 || title.length > 200) return null;
  if (publisher !== null && (publisher.length < 1 || publisher.length > 120)) return null;
  return {
    url,
    title,
    publisher: publisher && publisher.length > 0 ? publisher : null,
    origin: AI_SUGGESTED_ORIGIN,
  };
}

export function parsePublicReceiptSource(value: unknown): PublicReceiptSource | null {
  if (!isRecord(value)) return null;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const publisherValue = value.publisher;
  const publisher = publisherValue == null || publisherValue === ''
    ? null
    : typeof publisherValue === 'string' ? publisherValue.trim() : null;
  if (!isPublicHttpsUrl(url) || title.length < 1 || title.length > 200) return null;
  if (publisher !== null && (publisher.length < 1 || publisher.length > 120)) return null;
  return {
    url,
    title,
    publisher,
    origin: value.origin === AI_SUGGESTED_ORIGIN ? AI_SUGGESTED_ORIGIN : 'approved',
  };
}

export function sameHttpUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

export function mergeReceiptSources(
  groups: readonly unknown[][],
): PublicReceiptSource[] {
  const merged: PublicReceiptSource[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const source = parsePublicReceiptSource(candidate);
      if (!source || merged.some((item) => sameHttpUrl(item.url, source.url))) continue;
      merged.push(source);
      if (merged.length >= RECEIPT_SOURCE_LIMIT) return merged;
    }
  }
  return merged;
}
