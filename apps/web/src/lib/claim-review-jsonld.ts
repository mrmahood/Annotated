import {
  ANNOTATION_VERDICT_LABELS,
  type AnnotationVerdict,
} from "@annotated/shared/annotation-note";
import type { PublicAnnotation } from "./data/public-annotation-model.ts";
import { getConfiguredSiteOrigin, getPublicAnnotationPath } from "./public-routes.ts";

/**
 * ClaimReview reviewRating scale.
 *
 * An ordinal of how far the reviewed claim holds. A higher ratingValue is
 * closer to the claim holding. It is not a score of the annotation.
 * worstRating is 1 and bestRating is 4. alternateName is the visible verdict
 * label from ANNOTATION_VERDICT_LABELS. True means the claim is accurate;
 * the pill says True, so the structured-data label stays True.
 *
 * false / False / 1
 * misleading / Misleading / 2
 * needs_context / Needs context / 3
 * true / True / 4
 */
export const CLAIM_REVIEW_WORST_RATING = 1;
export const CLAIM_REVIEW_BEST_RATING = 4;

export const CLAIM_REVIEW_RATINGS: Record<AnnotationVerdict, {
  alternateName: string;
  ratingValue: number;
  meaning: string;
}> = {
  false: {
    alternateName: ANNOTATION_VERDICT_LABELS.false,
    ratingValue: 1,
    meaning: "The claim does not hold.",
  },
  misleading: {
    alternateName: ANNOTATION_VERDICT_LABELS.misleading,
    ratingValue: 2,
    meaning: "The claim misleads.",
  },
  needs_context: {
    alternateName: ANNOTATION_VERDICT_LABELS.needs_context,
    ratingValue: 3,
    meaning: "The claim is missing context that changes what it means.",
  },
  true: {
    alternateName: ANNOTATION_VERDICT_LABELS.true,
    ratingValue: 4,
    meaning: "The claim is accurate.",
  },
};

/**
 * Profiles do not store an account type. A display name that names a desk,
 * newsroom, foundation, institute, association, collective, news outlet,
 * media, press, or project is an Organization. Every other profile is a Person.
 */
const ORGANIZATION_DISPLAY_NAME =
  /\b(?:desk|newsroom|foundation|institute|association|collective|news|media|press|project)\b/i;

export function annotationAuthorType(displayName: string): "Person" | "Organization" {
  return ORGANIZATION_DISPLAY_NAME.test(displayName) ? "Organization" : "Person";
}

export function claimReviewRatingEntries(): Array<{
  verdict: AnnotationVerdict;
  alternateName: string;
  ratingValue: number;
  meaning: string;
}> {
  return (Object.entries(CLAIM_REVIEW_RATINGS) as Array<[
    AnnotationVerdict,
    (typeof CLAIM_REVIEW_RATINGS)[AnnotationVerdict],
  ]>)
    .map(([verdict, rating]) => ({ verdict, ...rating }))
    .sort((left, right) => left.ratingValue - right.ratingValue);
}

type JsonLd = Record<string, unknown>;

function collapseWhitespace(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** claimReviewed is a short label. The page blockquote keeps the full quote. */
export const CLAIM_REVIEWED_MAX_LENGTH = 75;
const CLAIM_REVIEWED_ELLIPSIS = "…";

export function shortenClaimReviewed(value: string): string {
  if (value.length <= CLAIM_REVIEWED_MAX_LENGTH) return value;
  const room = CLAIM_REVIEWED_MAX_LENGTH - CLAIM_REVIEWED_ELLIPSIS.length;
  const boundary = value.lastIndexOf(" ", room);
  const end = boundary > 0 ? boundary : room;
  const cut = value.slice(0, end).trimEnd();
  if (cut.endsWith("...") || cut.endsWith(CLAIM_REVIEWED_ELLIPSIS)) return cut;
  return `${cut}${CLAIM_REVIEWED_ELLIPSIS}`;
}

function quotedPassage(annotation: PublicAnnotation): string | null {
  if (annotation.kind === "article") return collapseWhitespace(annotation.selectedText);
  if ("transcript" in annotation && annotation.transcript) {
    return collapseWhitespace(annotation.transcript.text);
  }
  return null;
}

function authorNode(annotation: PublicAnnotation, origin: string): JsonLd {
  return {
    "@type": annotationAuthorType(annotation.annotator.name),
    name: annotation.annotator.name,
    url: new URL(`/p/${annotation.annotator.id}`, origin).href,
  };
}

function sourceAppearance(annotation: PublicAnnotation): JsonLd {
  const appearance: JsonLd = {
    "@type": "CreativeWork",
    url: annotation.source.canonicalUrl,
  };
  const headline = collapseWhitespace(annotation.source.title);
  if (headline) appearance.headline = headline;
  const publisher = collapseWhitespace(annotation.source.publisher);
  if (publisher) {
    appearance.publisher = {
      "@type": "Organization",
      name: publisher,
    };
  }
  return appearance;
}

function citationValue(annotation: PublicAnnotation): string | string[] | undefined {
  const urls = annotation.sourceLinks.map((link) => link.url);
  if (urls.length === 0) return undefined;
  if (urls.length === 1) return urls[0];
  return urls;
}

function claimReview(
  annotation: PublicAnnotation,
  url: string,
  origin: string,
  verdict: AnnotationVerdict,
  passage: string,
): JsonLd {
  const rating = CLAIM_REVIEW_RATINGS[verdict];
  const citation = citationValue(annotation);
  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    url,
    claimReviewed: shortenClaimReviewed(passage),
    datePublished: annotation.publishedAt,
    author: authorNode(annotation, origin),
    itemReviewed: {
      "@type": "Claim",
      appearance: sourceAppearance(annotation),
    },
    reviewRating: {
      "@type": "Rating",
      alternateName: rating.alternateName,
      ratingValue: rating.ratingValue,
      bestRating: CLAIM_REVIEW_BEST_RATING,
      worstRating: CLAIM_REVIEW_WORST_RATING,
    },
    ...(citation ? { citation } : {}),
  };
}

function commentNode(
  annotation: PublicAnnotation,
  url: string,
  origin: string,
  text: string,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Comment",
    url,
    text,
    datePublished: annotation.publishedAt,
    author: authorNode(annotation, origin),
    about: sourceAppearance(annotation),
  };
}

/**
 * Fact-check annotations with a verdict and a quoted passage emit one ClaimReview.
 * The quoted passage is the article selection, or the excerpt transcript when
 * the annotation is hosted media. claimReviewed keeps about 75 characters of
 * that quote, cut on a word boundary, with an ellipsis when it is longer.
 * A cut that already ends in "..." or "…" does not gain a second ellipsis.
 * The page blockquote still shows the full quote. Other annotations emit a
 * Comment. A page with no configured origin, or with no passage and no
 * commentary, emits nothing.
 * Both `/{handle}/{slug}` and `/factdesk/...` use this through the shared page.
 */
export function getAnnotationStructuredData(annotation: PublicAnnotation): JsonLd | null {
  const origin = getConfiguredSiteOrigin();
  if (!origin) return null;

  const url = new URL(getPublicAnnotationPath(annotation.route, annotation.id), origin).href;
  const passage = quotedPassage(annotation);
  if (annotation.noteType === "fact_check" && annotation.verdict && passage) {
    return claimReview(annotation, url, origin, annotation.verdict, passage);
  }

  const text = collapseWhitespace(annotation.commentaryText) ?? passage;
  if (!text) return null;
  return commentNode(annotation, url, origin, text);
}
