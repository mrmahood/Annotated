import { isUuid } from "../public-content.ts";

export const TRENDING_MAX_CARDS = 8;
export const TRENDING_MIN_VISIBLE = 2;
export const TRENDING_WINDOW_DAYS = 7;
export const TRENDING_RECENCY_HALF_LIFE_HOURS = 48;
export const TRENDING_BOOST_MIN = 0.01;
export const TRENDING_BOOST_MAX = 100;
export const TRENDING_BOOST_CONFIRMATION = "TRENDING_BOOST";
export const TRENDING_BOOSTS_PATH = "/api/moderation/trending/boosts";

export type TrendingListRow = {
  annotationId: string;
  score: number;
};

export type TrendingBoostRow = {
  annotationId: string;
  boost: number;
  updatedAt: string;
};

export type TrendingBoostAction = "set" | "clear";

export type TrendingBoostRequest = {
  annotationId: string;
  action: TrendingBoostAction;
  boost?: number;
  confirm: typeof TRENDING_BOOST_CONFIRMATION;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function shouldShowTrendingSurface(count: number): boolean {
  return Number.isSafeInteger(count) && count >= TRENDING_MIN_VISIBLE;
}

export function clampTrendingLimit(limit: number): number {
  if (!Number.isSafeInteger(limit)) return TRENDING_MAX_CARDS;
  return Math.min(Math.max(limit, 1), TRENDING_MAX_CARDS);
}

export function parseTrendingListRow(value: unknown): TrendingListRow | null {
  if (!isRecord(value)) return null;
  const annotationId = getOptionalText(value.annotation_id) ?? getOptionalText(value.annotationId);
  const score = typeof value.score === "number"
    ? value.score
    : typeof value.score === "string"
      ? Number(value.score)
      : Number.NaN;
  if (!annotationId || !isUuid(annotationId) || !Number.isFinite(score)) return null;
  return { annotationId, score };
}

export function parseTrendingBoostRow(value: unknown): TrendingBoostRow | null {
  if (!isRecord(value)) return null;
  const annotationId = getOptionalText(value.annotation_id) ?? getOptionalText(value.annotationId);
  const boost = typeof value.boost === "number"
    ? value.boost
    : typeof value.boost === "string"
      ? Number(value.boost)
      : Number.NaN;
  const updatedAt = getOptionalText(value.updated_at) ?? getOptionalText(value.updatedAt);
  const updatedDate = updatedAt ? new Date(updatedAt) : null;
  if (
    !annotationId ||
    !isUuid(annotationId) ||
    !Number.isFinite(boost) ||
    boost <= 0 ||
    boost > TRENDING_BOOST_MAX ||
    !updatedDate ||
    Number.isNaN(updatedDate.getTime())
  ) {
    return null;
  }
  return {
    annotationId,
    boost,
    updatedAt: updatedDate.toISOString(),
  };
}

export function parseTrendingBoostList(value: unknown): TrendingBoostRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.boosts)) return null;
  const boosts: TrendingBoostRow[] = [];
  for (const item of value.boosts) {
    const row = parseTrendingBoostRow(item);
    if (!row) return null;
    boosts.push(row);
  }
  return boosts;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

export function parseTrendingBoostRequest(body: unknown): TrendingBoostRequest | null {
  if (!isRecord(body)) return null;
  const action = body.action === "set" || body.action === "clear" ? body.action : null;
  if (!action) return null;
  const expectedKeys = action === "set"
    ? ["annotationId", "action", "boost", "confirm"]
    : ["annotationId", "action", "confirm"];
  if (!hasExactKeys(body, expectedKeys)) return null;
  if (body.confirm !== TRENDING_BOOST_CONFIRMATION) return null;
  if (typeof body.annotationId !== "string" || !isUuid(body.annotationId)) return null;
  if (action === "clear") {
    return {
      annotationId: body.annotationId,
      action,
      confirm: TRENDING_BOOST_CONFIRMATION,
    };
  }
  const boost = typeof body.boost === "number" ? body.boost : Number.NaN;
  if (!Number.isFinite(boost) || boost < TRENDING_BOOST_MIN || boost > TRENDING_BOOST_MAX) {
    return null;
  }
  return {
    annotationId: body.annotationId,
    action,
    boost,
    confirm: TRENDING_BOOST_CONFIRMATION,
  };
}

export function isTrendingBoostReady(input: {
  annotationId: string;
  typedConfirm: string;
  action: TrendingBoostAction;
  boost: string;
}): boolean {
  if (!isUuid(input.annotationId.trim())) return false;
  if (input.typedConfirm !== TRENDING_BOOST_CONFIRMATION) return false;
  if (input.action === "clear") return true;
  const boost = Number(input.boost);
  return Number.isFinite(boost) && boost >= TRENDING_BOOST_MIN && boost <= TRENDING_BOOST_MAX;
}

export function buildTrendingBoostBody(input: {
  annotationId: string;
  action: TrendingBoostAction;
  boost?: string;
}): TrendingBoostRequest {
  const body: TrendingBoostRequest = {
    annotationId: input.annotationId.trim(),
    action: input.action,
    confirm: TRENDING_BOOST_CONFIRMATION,
  };
  if (input.action === "set" && input.boost != null) {
    body.boost = Number(input.boost);
  }
  return body;
}
