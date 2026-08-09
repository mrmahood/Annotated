import type { SupabaseClient } from "@supabase/supabase-js";
import { getHttpUrl, getOptionalText, isUuid } from "@/lib/public-content";

export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_BODY_LIMIT = 1_000;
export const PUBLIC_COMMENT_STATUS = "public" as const;
export const PUBLIC_ANNOTATION_STATUS = "published" as const;

export type PublicComment = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  author: { displayName: string; avatarUrl: string | null };
};

export type PublicCommentPage = {
  comments: PublicComment[];
  total: number;
  hasMore: boolean;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  }
  return isRecord(value) ? value : null;
}

function mapComment(value: unknown): PublicComment | null {
  if (!isRecord(value)) return null;
  const author = getSingleRelation(value.author);
  const id = getOptionalText(value.id);
  const userId = getOptionalText(value.user_id);
  const body = typeof value.body === "string" ? value.body : null;
  const createdAt = getOptionalText(value.created_at);
  const createdDate = createdAt ? new Date(createdAt) : null;

  if (
    !author || !id || !isUuid(id) || !userId || !isUuid(userId) ||
    !body || !body.trim() || !createdDate || Number.isNaN(createdDate.getTime())
  ) return null;

  return {
    id,
    userId,
    body,
    createdAt: createdDate.toISOString(),
    author: {
      displayName: getOptionalText(author.display_name) ?? "Annotated reader",
      avatarUrl: getHttpUrl(author.avatar_url)?.href ?? null,
    },
  };
}

export async function queryPublicComments(
  supabase: SupabaseClient,
  annotationId: string,
  offset = 0,
): Promise<PublicCommentPage> {
  if (!isUuid(annotationId) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Invalid comment query.");
  }

  const { data, count, error } = await supabase
    .from("annotation_comments")
    .select(
      `id, user_id, body, created_at,
       author:profiles!annotation_comments_user_id_fkey(display_name, avatar_url),
       annotation:annotations!inner(id)`,
      { count: "exact" },
    )
    .eq("annotation_id", annotationId)
    .eq("status", PUBLIC_COMMENT_STATUS)
    .eq("annotation.status", PUBLIC_ANNOTATION_STATUS)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + COMMENT_PAGE_SIZE - 1);

  if (error || !data || count === null) {
    throw new Error("Comments are unavailable.");
  }

  const comments = data
    .map(mapComment)
    .filter((comment): comment is PublicComment => Boolean(comment));

  if (comments.length !== data.length) {
    throw new Error("A comment response was malformed.");
  }

  return {
    comments,
    total: count,
    hasMore: offset + comments.length < count,
  };
}

export async function queryPublicCommentCounts(
  supabase: SupabaseClient,
  annotationIds: string[],
): Promise<Map<string, number>> {
  if (annotationIds.length === 0) return new Map();
  if (annotationIds.length > 100 || annotationIds.some((id) => !isUuid(id))) {
    throw new Error("Invalid comment count query.");
  }

  const { data, error } = await supabase.rpc(
    "get_public_annotation_comment_counts",
    { p_annotation_ids: annotationIds },
  );
  if (error || !Array.isArray(data)) throw new Error("Comment counts are unavailable.");

  const counts = new Map(annotationIds.map((id) => [id, 0]));
  for (const value of data) {
    if (!isRecord(value)) throw new Error("A comment count response was malformed.");
    const annotationId = getOptionalText(value.annotation_id);
    const count = Number(value.comment_count);
    if (!annotationId || !counts.has(annotationId) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("A comment count response was malformed.");
    }
    counts.set(annotationId, count);
  }
  return counts;
}
