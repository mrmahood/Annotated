import { isUuid } from "@/lib/public-content";

export const RESHARE_COMMENT_LIMIT = 1_000;

export type TimelineItemKind = "annotation" | "reshare";

export type PublicTimelineRow = {
  itemKind: TimelineItemKind;
  itemId: string;
  occurredAt: string;
  annotationId: string;
  resharerUserId: string | null;
  reshareComment: string | null;
};

export type PublicReshareAttribution = {
  id: string;
  createdAt: string;
  comment: string | null;
  resharer: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeReshareComment(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > RESHARE_COMMENT_LIMIT) {
    throw new Error("Reshare comments cannot exceed 1,000 characters.");
  }
  return trimmed;
}

export function parseTimelineRow(value: unknown): PublicTimelineRow | null {
  if (!isRecord(value)) return null;
  const itemKind = value.item_kind === "annotation" || value.item_kind === "reshare"
    ? value.item_kind
    : null;
  const itemId = getOptionalText(value.item_id);
  const annotationId = getOptionalText(value.annotation_id);
  const occurredAt = getOptionalText(value.occurred_at);
  const occurredDate = occurredAt ? new Date(occurredAt) : null;
  const resharerUserId = getOptionalText(value.resharer_user_id);
  const comment = typeof value.reshare_comment === "string" ? value.reshare_comment : null;

  if (
    !itemKind || !itemId || !isUuid(itemId) || !annotationId || !isUuid(annotationId) ||
    !occurredDate || Number.isNaN(occurredDate.getTime())
  ) {
    return null;
  }

  if (itemKind === "reshare") {
    if (!resharerUserId || !isUuid(resharerUserId)) return null;
    if (comment !== null && (!comment.trim() || comment.length > RESHARE_COMMENT_LIMIT)) {
      return null;
    }
  } else if (resharerUserId || comment) {
    return null;
  }

  return {
    itemKind,
    itemId,
    occurredAt: occurredDate.toISOString(),
    annotationId,
    resharerUserId: itemKind === "reshare" ? resharerUserId : null,
    reshareComment: itemKind === "reshare" ? (comment?.trim() || null) : null,
  };
}

export function parseCurrentReshareIds(value: unknown): Set<string> {
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

export function feedItemKey(item: {
  annotation: { id: string };
  reshare: { id: string } | null;
}): string {
  return item.reshare ? `reshare:${item.reshare.id}` : `annotation:${item.annotation.id}`;
}
