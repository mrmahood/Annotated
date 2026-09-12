import { isUuid } from "../public-content.ts";

export type BookmarkListRow = {
  annotationId: string;
  bookmarkedAt: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCurrentBookmarkIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const row of value) {
    const annotationId = isRecord(row)
      ? getOptionalText(row.annotation_id)
      : getOptionalText(row);
    if (annotationId && isUuid(annotationId)) ids.add(annotationId);
  }
  return ids;
}

export function parseBookmarkListRow(value: unknown): BookmarkListRow | null {
  if (!isRecord(value)) return null;
  const annotationId = getOptionalText(value.annotation_id);
  const bookmarkedAt = getOptionalText(value.bookmarked_at);
  const bookmarkedDate = bookmarkedAt ? new Date(bookmarkedAt) : null;
  if (
    !annotationId ||
    !isUuid(annotationId) ||
    !bookmarkedDate ||
    Number.isNaN(bookmarkedDate.getTime())
  ) {
    return null;
  }
  return {
    annotationId,
    bookmarkedAt: bookmarkedDate.toISOString(),
  };
}
