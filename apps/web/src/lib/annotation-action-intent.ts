export const ANNOTATION_ACTION_INTENTS = [
  "share",
  "bookmark",
  "upvote",
  "downvote",
  "comment",
] as const;

export type AnnotationActionIntent = (typeof ANNOTATION_ACTION_INTENTS)[number];

const INTENT_HASH: Record<AnnotationActionIntent, string> = {
  share: "share",
  bookmark: "bookmark",
  upvote: "votes",
  downvote: "votes",
  comment: "comments",
};

export function isAnnotationActionIntent(
  value: string | null | undefined,
): value is AnnotationActionIntent {
  return value === "share"
    || value === "bookmark"
    || value === "upvote"
    || value === "downvote"
    || value === "comment";
}

export function readAnnotationActionIntent(
  value: string | string[] | null | undefined,
): AnnotationActionIntent | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return isAnnotationActionIntent(raw) ? raw : null;
}

export function annotationActionReturnTo(
  returnTo: string,
  intent: AnnotationActionIntent,
): string {
  try {
    const hashIndex = returnTo.indexOf("#");
    const withoutHash = hashIndex >= 0 ? returnTo.slice(0, hashIndex) : returnTo;
    const url = new URL(withoutHash, "http://annotated.local");
    if (url.origin !== "http://annotated.local") return returnTo;
    url.searchParams.set("intent", intent);
    return `${url.pathname}${url.search}#${INTENT_HASH[intent]}`;
  } catch {
    return returnTo;
  }
}
