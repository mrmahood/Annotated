export const PUBLIC_ANNOTATION_STATUS = "published" as const;

export const PUBLIC_ANNOTATION_CARD_SELECT = `
  id,
  commentary_text,
  published_at,
  annotator:profiles!annotations_user_id_fkey(id, display_name, avatar_url),
  source:sources!annotations_source_id_fkey(canonical_url, title, author, publisher),
  target:annotation_targets!annotation_targets_annotation_id_fkey(selected_text)
`;

type PublicAnnotationFilter = {
  column: "status" | "user_id";
  value: string;
};

export type PublicAnnotationQueryPlan = {
  table: "annotations";
  select: string;
  filters: PublicAnnotationFilter[];
  orders: readonly [
    { column: "published_at"; ascending: false },
    { column: "id"; ascending: false },
  ];
};

export function buildPublicFeedQueryPlan(): PublicAnnotationQueryPlan {
  return buildPublicAnnotationQueryPlan();
}

export function buildPublicProfileAnnotationsQueryPlan(
  profileId: string,
): PublicAnnotationQueryPlan {
  return buildPublicAnnotationQueryPlan(profileId);
}

function buildPublicAnnotationQueryPlan(
  profileId?: string,
): PublicAnnotationQueryPlan {
  return {
    table: "annotations",
    select: PUBLIC_ANNOTATION_CARD_SELECT,
    filters: [
      { column: "status", value: PUBLIC_ANNOTATION_STATUS },
      ...(profileId ? [{ column: "user_id" as const, value: profileId }] : []),
    ],
    orders: [
      { column: "published_at", ascending: false },
      { column: "id", ascending: false },
    ],
  };
}
