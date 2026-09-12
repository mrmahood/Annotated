import type { Metadata } from "next";
import { formatMediaTime } from "@annotated/shared/media-time";
import type { PublicAnnotation } from "@/lib/data/public-annotation-model";

const CREATOR_HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;
const ANNOTATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_ROOT_HANDLES = new Set(["api", "auth", "_next", "ops", "me", "trending"]);

export type PublicAnnotationRoute = {
  creatorHandle: string;
  annotationSlug: string;
};

export function isPublicCreatorHandle(value: unknown): value is string {
  return typeof value === "string" && CREATOR_HANDLE_PATTERN.test(value) &&
    !RESERVED_ROOT_HANDLES.has(value);
}

export function isPublicAnnotationSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 100 &&
    ANNOTATION_SLUG_PATTERN.test(value)
  );
}

export function getCanonicalAnnotationPath(route: PublicAnnotationRoute): string {
  if (
    !isPublicCreatorHandle(route.creatorHandle) ||
    !isPublicAnnotationSlug(route.annotationSlug)
  ) {
    throw new Error("Invalid public annotation route identity.");
  }
  return `/${route.creatorHandle}/${route.annotationSlug}`;
}

export function getPublicAnnotationPath(
  route: PublicAnnotationRoute | null,
  annotationId: string,
): string {
  return route ? getCanonicalAnnotationPath(route) : `/a/${annotationId}`;
}

export function getConfiguredPublicPageUrl(path: string): string | undefined {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const routeMatch = /^\/([^/]+)\/([^/]+)$/.exec(path);
  if (
    !configuredSiteUrl ||
    !routeMatch ||
    !isPublicCreatorHandle(routeMatch[1]) ||
    !isPublicAnnotationSlug(routeMatch[2])
  ) return undefined;

  try {
    const siteUrl = new URL(configuredSiteUrl);
    const isLocalHttp =
      siteUrl.protocol === "http:" &&
      (siteUrl.hostname === "localhost" || siteUrl.hostname === "127.0.0.1");

    if (
      (siteUrl.protocol !== "https:" && !isLocalHttp) ||
      siteUrl.pathname !== "/" ||
      siteUrl.search ||
      siteUrl.hash ||
      siteUrl.username ||
      siteUrl.password
    ) {
      return undefined;
    }

    return new URL(path, siteUrl.origin).href;
  } catch {
    return undefined;
  }
}

export function getNotFoundMetadata(): Metadata {
  return {
    title: "Annotation not found | Annotated",
    robots: { index: false, follow: false },
  };
}

export function getPublicAnnotationMetadata(annotation: PublicAnnotation): Metadata {
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const title = `Annotation on ${sourceTitle}`;
  const isVideoKind = annotation.kind === "video_legacy" ||
    annotation.kind === "video_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "video");
  const description = isVideoKind && annotation.source.type === "youtube"
    ? `${annotation.annotator.name} annotated a YouTube clip from ${formatMediaTime(annotation.startMs)} to ${formatMediaTime(annotation.endMs)}.`
    : isVideoKind && annotation.source.type === "tiktok"
      ? `${annotation.annotator.name} annotated a TikTok clip from ${formatMediaTime(annotation.startMs)} to ${formatMediaTime(annotation.endMs)}.`
    : isVideoKind && annotation.source.type === "article"
      ? `${annotation.annotator.name} annotated a video clip from ${annotation.source.hostname}.`
    : annotation.kind === "audio_legacy" ||
        annotation.kind === "audio_hosted" ||
        annotation.kind === "media_removed"
      ? `${annotation.annotator.name} annotated an audio clip from ${formatMediaTime(annotation.startMs)} to ${formatMediaTime(annotation.endMs)}.`
      : `${annotation.annotator.name} annotated an article from ${annotation.source.hostname}.`;
  const canonicalPath = annotation.route
    ? getCanonicalAnnotationPath(annotation.route)
    : null;
  const publicPageUrl = canonicalPath
    ? getConfiguredPublicPageUrl(canonicalPath)
    : undefined;

  return {
    title,
    description,
    ...(publicPageUrl ? { alternates: { canonical: publicPageUrl } } : {}),
    openGraph: {
      type: "article",
      title,
      description,
      publishedTime: annotation.publishedAt,
      ...(publicPageUrl ? { url: publicPageUrl } : {}),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
