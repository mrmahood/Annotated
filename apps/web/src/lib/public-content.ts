export const PUBLIC_PAGE_SIZE = 12;
export const MAX_PUBLIC_PAGE = 10_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function parsePageQuery(
  value: string | string[] | undefined,
): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return 1;
  }

  const page = Number(value);

  return Number.isSafeInteger(page) && page <= MAX_PUBLIC_PAGE ? page : 1;
}

export function isCanonicalPageQuery(
  value: string | string[] | undefined,
): boolean {
  if (value === undefined) {
    return true;
  }

  const page = parsePageQuery(value);
  return typeof value === "string" && page > 1 && value === String(page);
}

export function getPageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

export function getPageRange(page: number): { from: number; to: number } {
  const safePage = Math.min(Math.max(Math.trunc(page), 1), MAX_PUBLIC_PAGE);
  const from = (safePage - 1) * PUBLIC_PAGE_SIZE;

  // Supabase range bounds are inclusive. This requests PAGE_SIZE + 1 rows.
  return { from, to: from + PUBLIC_PAGE_SIZE };
}

export function getPagination(
  page: number,
  hasNext: boolean,
): { previousPage: number | null; nextPage: number | null } {
  const safePage = Math.min(Math.max(Math.trunc(page), 1), MAX_PUBLIC_PAGE);

  return {
    previousPage: safePage > 1 ? safePage - 1 : null,
    nextPage: hasNext && safePage < MAX_PUBLIC_PAGE ? safePage + 1 : null,
  };
}

export function truncateExcerpt(value: string, maximumLength: number): string {
  const text = value.trim();

  if (maximumLength < 2 || text.length <= maximumLength) {
    return text.slice(0, Math.max(maximumLength, 0));
  }

  const availableLength = maximumLength - 1;
  const candidate = text.slice(0, availableLength);
  const finalWhitespace = Math.max(
    candidate.lastIndexOf(" "),
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf("\t"),
  );
  const minimumWordBoundary = Math.floor(availableLength * 0.6);
  const excerpt =
    finalWhitespace >= minimumWordBoundary
      ? candidate.slice(0, finalWhitespace).trimEnd()
      : candidate.trimEnd();

  return `${excerpt}…`;
}

export function getHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function formatHostname(value: unknown): string | null {
  const url = getHttpUrl(value);

  if (!url) {
    return null;
  }

  return url.hostname.replace(/^www\./i, "") || null;
}

export function getOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getInitial(value: string): string {
  return value.trim().slice(0, 1).toLocaleUpperCase() || "A";
}
