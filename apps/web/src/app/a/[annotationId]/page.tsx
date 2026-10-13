import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { readAnnotationActionIntent } from "@/lib/annotation-action-intent";
import { PublicAnnotationPage } from "../../public-annotation-page";
import { loadPublicAnnotation, resolvePublicAnnotationUuid } from "@/lib/data/public-annotation";
import { isUuid } from "@/lib/public-content";
import {
  getCanonicalAnnotationPath,
  getNotFoundMetadata,
  getPublicAnnotationMetadata,
} from "@/lib/public-routes";

export const dynamic = "force-dynamic";

type AnnotationPageProps = {
  params: Promise<{ annotationId: string }>;
  searchParams: Promise<{ intent?: string | string[] }>;
};

export async function generateMetadata({ params }: AnnotationPageProps): Promise<Metadata> {
  const { annotationId } = await params;
  if (!isUuid(annotationId)) return getNotFoundMetadata();
  const annotation = await loadPublicAnnotation(annotationId);
  return annotation ? getPublicAnnotationMetadata(annotation) : getNotFoundMetadata();
}

export default async function AnnotationCompatibilityPage({ params, searchParams }: AnnotationPageProps) {
  const [{ annotationId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(annotationId)) notFound();

  const resolvedRoute = await resolvePublicAnnotationUuid(annotationId);
  if (resolvedRoute) permanentRedirect(getCanonicalAnnotationPath(resolvedRoute));

  // Guarded rollout fallback: a published historical row without complete route
  // identity remains readable by UUID, but no canonical path is invented.
  const annotation = await loadPublicAnnotation(annotationId);
  if (!annotation) notFound();
  return (
    <PublicAnnotationPage
      annotation={annotation}
      actionIntent={readAnnotationActionIntent(query.intent)}
    />
  );
}
