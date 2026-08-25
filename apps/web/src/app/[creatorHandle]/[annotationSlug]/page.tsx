import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicAnnotationPage } from "../../public-annotation-page";
import { loadPublicAnnotation, resolvePublicAnnotationRoute } from "@/lib/data/public-annotation";
import {
  getCanonicalAnnotationPath,
  getNotFoundMetadata,
  getPublicAnnotationMetadata,
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
} from "@/lib/public-routes";

export const dynamic = "force-dynamic";

type CanonicalAnnotationPageProps = {
  params: Promise<{ creatorHandle: string; annotationSlug: string }>;
};

async function resolveCanonicalAnnotation(creatorHandle: string, annotationSlug: string) {
  if (!isPublicCreatorHandle(creatorHandle) || !isPublicAnnotationSlug(annotationSlug)) return null;
  const resolvedRoute = await resolvePublicAnnotationRoute(creatorHandle, annotationSlug);
  if (!resolvedRoute) return null;
  const annotation = await loadPublicAnnotation(resolvedRoute.annotationId);
  if (
    !annotation?.route ||
    annotation.route.creatorHandle !== resolvedRoute.creatorHandle ||
    annotation.route.annotationSlug !== resolvedRoute.annotationSlug
  ) return null;
  return { annotation, resolvedRoute };
}

export async function generateMetadata({ params }: CanonicalAnnotationPageProps): Promise<Metadata> {
  const { creatorHandle, annotationSlug } = await params;
  const result = await resolveCanonicalAnnotation(creatorHandle, annotationSlug);
  return result ? getPublicAnnotationMetadata(result.annotation) : getNotFoundMetadata();
}

export default async function CanonicalAnnotationPage({ params }: CanonicalAnnotationPageProps) {
  const { creatorHandle, annotationSlug } = await params;
  const result = await resolveCanonicalAnnotation(creatorHandle, annotationSlug);
  if (!result) notFound();
  if (
    result.resolvedRoute.matchedHandleIsAlias ||
    creatorHandle !== result.resolvedRoute.creatorHandle ||
    annotationSlug !== result.resolvedRoute.annotationSlug
  ) permanentRedirect(getCanonicalAnnotationPath(result.resolvedRoute));
  return <PublicAnnotationPage annotation={result.annotation} />;
}
