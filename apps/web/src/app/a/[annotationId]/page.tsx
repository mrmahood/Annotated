import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatMediaTime, getClipRangeError } from "@annotated/shared/media-time";
import { getYouTubeTimestampUrl, getYouTubeVideoIdentity } from "@annotated/shared/youtube";
import { createClient } from "@/lib/supabase/server";
import {
  ANNOTATION_AUDIO_BUCKET,
  parsePublicAnnotationAudio,
} from "@/lib/audio-commentary";
import {
  formatHostname,
  getHttpUrl,
  getInitial,
  getOptionalText,
  isUuid,
} from "@/lib/public-content";
import { SiteHeader } from "../../site-header";
import { FollowButton } from "../../follow-button";
import { ClaimForm } from "./claim-form";
import { CommentsSection } from "./comments-section";
import { PublishedAudioPlayer } from "./published-audio-player";
import {
  getCurrentUserFollowState,
  getCurrentUserId,
  getProfileSocialCounts,
  getPublicAnnotationComments,
} from "@/lib/data/social";

export const dynamic = "force-dynamic";

type PublicAnnotationBase = {
  id: string;
  commentaryText: string;
  publishedAt: string;
  source: {
    canonicalUrl: string;
    title: string | null;
    author: string | null;
    publisher: string | null;
    hostname: string;
  };
  annotator: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  audio: {
    publicUrl: string;
    durationMs: number;
  } | null;
};

type PublicAnnotation = PublicAnnotationBase & (
  | { kind: "article"; selectedText: string; startMs: null; endMs: null; source: PublicAnnotationBase["source"] & { type: "article"; videoId: null } }
  | { kind: "youtube"; selectedText: null; startMs: number; endMs: number; source: PublicAnnotationBase["source"] & { type: "youtube"; videoId: string } }
);

const loadPublicAnnotation = cache(
  async (annotationId: string): Promise<PublicAnnotation | null> => {
    if (!isUuid(annotationId)) {
      return null;
    }

    try {
      const supabase = await createClient();
      const { data: annotation, error: annotationError } = await supabase
        .from("annotations")
        .select("id, source_id, user_id, annotation_type, commentary_text, published_at, audio:annotation_audio(storage_path, duration_ms, mime_type, byte_size)")
        .eq("id", annotationId)
        .eq("status", "published")
        .maybeSingle();

      if (
        annotationError ||
        !annotation ||
        !getOptionalText(annotation.commentary_text) ||
        !annotation.published_at
      ) {
        return null;
      }

      const [targetResult, sourceResult, profileResult] = await Promise.all([
        supabase
          .from("annotation_targets")
          .select("target_type, selected_text, start_ms, end_ms")
          .eq("annotation_id", annotation.id)
          .maybeSingle(),
        supabase
          .from("sources")
          .select("canonical_url, normalized_url, source_type, title, author, publisher")
          .eq("id", annotation.source_id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .eq("id", annotation.user_id)
          .maybeSingle(),
      ]);

      const target = targetResult.data;
      const source = sourceResult.data;
      const profile = profileResult.data;
      const canonicalUrl = getHttpUrl(source?.canonical_url);
      const hostname = formatHostname(source?.canonical_url);
      const selectedText = getOptionalText(target?.selected_text);

      if (
        targetResult.error ||
        sourceResult.error ||
        profileResult.error ||
        !target ||
        !source ||
        !profile ||
        !isUuid(profile.id) ||
        !canonicalUrl ||
        !hostname
      ) {
        return null;
      }

      const publishedDate = new Date(annotation.published_at);

      if (Number.isNaN(publishedDate.getTime())) {
        return null;
      }

      const audioMetadata = parsePublicAnnotationAudio(annotation.audio);
      let audio: PublicAnnotation["audio"] = null;
      if (audioMetadata) {
        const candidate = supabase.storage
          .from(ANNOTATION_AUDIO_BUCKET)
          .getPublicUrl(audioMetadata.storagePath).data.publicUrl;
        try {
          const publicUrl = new URL(candidate);
          if (
            publicUrl.protocol === "https:" ||
            (publicUrl.protocol === "http:" && publicUrl.hostname === "localhost")
          ) {
            audio = { publicUrl: publicUrl.href, durationMs: audioMetadata.durationMs };
          }
        } catch {
          // Malformed configured project URLs leave the text annotation readable.
        }
      }

      const common = {
        id: annotation.id,
        commentaryText: annotation.commentary_text.trim(),
        publishedAt: publishedDate.toISOString(),
        source: {
          canonicalUrl: canonicalUrl.href,
          title: getOptionalText(source.title),
          author: getOptionalText(source.author),
          publisher: getOptionalText(source.publisher),
          hostname,
        },
        annotator: {
          id: profile.id,
          name: getOptionalText(profile.display_name) ?? "Annotated reader",
          avatarUrl: getHttpUrl(profile.avatar_url)?.href ?? null,
        },
        audio,
      };

      if (
        annotation.annotation_type === "article_text" && source.source_type === "article" &&
        target.target_type === "text" && selectedText
      ) {
        return {
          ...common,
          kind: "article",
          selectedText,
          startMs: null,
          endMs: null,
          source: { ...common.source, type: "article", videoId: null },
        };
      }

      if (
        annotation.annotation_type === "video_clip" && source.source_type === "youtube" &&
        target.target_type === "time_range" && Number.isSafeInteger(target.start_ms) &&
        Number.isSafeInteger(target.end_ms) &&
        getClipRangeError(target.start_ms, target.end_ms) === null
      ) {
        try {
          const identity = getYouTubeVideoIdentity(canonicalUrl.href);
          if (identity.normalizedUrl !== source.normalized_url) return null;
          return {
            ...common,
            kind: "youtube",
            selectedText: null,
            startMs: target.start_ms,
            endMs: target.end_ms,
            source: { ...common.source, type: "youtube", videoId: identity.videoId },
          };
        } catch {
          return null;
        }
      }

      return null;
    } catch {
      return null;
    }
  },
);

function getPublicPageUrl(annotationId: string): string | undefined {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!configuredSiteUrl) {
    return undefined;
  }

  try {
    const siteUrl = new URL(configuredSiteUrl);

    if (
      (siteUrl.protocol !== "http:" && siteUrl.protocol !== "https:") ||
      siteUrl.pathname !== "/" ||
      siteUrl.search ||
      siteUrl.hash ||
      siteUrl.username ||
      siteUrl.password
    ) {
      return undefined;
    }

    return new URL(`/a/${annotationId}`, siteUrl.origin).href;
  } catch {
    return undefined;
  }
}

type AnnotationPageProps = {
  params: Promise<{ annotationId: string }>;
};

export async function generateMetadata({
  params,
}: AnnotationPageProps): Promise<Metadata> {
  const { annotationId } = await params;
  const annotation = await loadPublicAnnotation(annotationId);

  if (!annotation) {
    return {
      title: "Annotation not found | Annotated",
      robots: { index: false, follow: false },
    };
  }

  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const title = `Annotation on ${sourceTitle}`;
  const description = annotation.kind === "youtube"
    ? `${annotation.annotator.name} annotated a YouTube clip from ${formatMediaTime(annotation.startMs)} to ${formatMediaTime(annotation.endMs)}.`
    : `${annotation.annotator.name} annotated an article from ${annotation.source.hostname}.`;
  const publicPageUrl = getPublicPageUrl(annotation.id);

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
  };
}

export default async function AnnotationPage({ params }: AnnotationPageProps) {
  const { annotationId } = await params;
  const annotation = await loadPublicAnnotation(annotationId);

  if (!annotation) {
    notFound();
  }

  const currentUserId = await getCurrentUserId();
  const [socialCounts, isFollowing, comments] = await Promise.all([
    getProfileSocialCounts(annotation.annotator.id),
    getCurrentUserFollowState(annotation.annotator.id, currentUserId),
    getPublicAnnotationComments(annotation.id),
  ]);

  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const sourceUrl = annotation.kind === "youtube"
    ? getYouTubeTimestampUrl(annotation.source.canonicalUrl, annotation.startMs)
    : annotation.source.canonicalUrl;
  const publicationDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(annotation.publishedAt));

  return (
    <>
      <SiteHeader returnTo={`/a/${annotation.id}`} />
      <main className="annotation-shell">
      <article className="annotation-page">
        <header className="annotation-header">
          <div className="annotator-line">
            <Link className="annotator-avatar-link" href={`/p/${annotation.annotator.id}`} aria-label={`View ${annotation.annotator.name}’s profile`}>
              {annotation.annotator.avatarUrl ? (
                // External avatars are rendered as plain images because their hosts vary.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="public-avatar" src={annotation.annotator.avatarUrl} alt="" width="48" height="48" referrerPolicy="no-referrer" />
              ) : (
                <span className="public-avatar public-avatar-fallback" aria-hidden="true">
                  {getInitial(annotation.annotator.name)}
                </span>
              )}
            </Link>
            <div>
              <p className="annotator-name">
                <Link href={`/p/${annotation.annotator.id}`}>{annotation.annotator.name}</Link>
              </p>
              <p className="publication-date">
                Published <time dateTime={annotation.publishedAt}>{publicationDate}</time>
              </p>
            </div>
            <FollowButton
              key={`${currentUserId ?? "signed-out"}:${String(isFollowing)}:${socialCounts?.followerCount ?? "unavailable"}`}
              profileId={annotation.annotator.id}
              currentUserId={currentUserId}
              initialFollowing={isFollowing}
              initialFollowerCount={socialCounts?.followerCount ?? null}
              returnTo={`/a/${annotation.id}`}
            />
          </div>
        </header>

        <section className="source-attribution" aria-labelledby="source-heading">
          <div className="source-copy">
            <p className="section-label">{annotation.kind === "youtube" ? "YouTube source" : "Original article"}</p>
            <h1 id="source-heading">{sourceTitle}</h1>
            {(annotation.source.author || annotation.source.publisher) && (
              <p className="source-byline">
                {annotation.source.author && `${annotation.kind === "article" ? "By " : ""}${annotation.source.author}`}
                {annotation.source.author && annotation.source.publisher && " · "}
                {annotation.source.publisher}
              </p>
            )}
            <p className="source-hostname">{annotation.source.hostname}</p>
          </div>
          <a
            className="public-button public-button-primary source-link"
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {annotation.kind === "youtube" ? "Open clip on YouTube" : "View original source"}
            <span aria-hidden="true">↗</span>
          </a>
        </section>

        {annotation.kind === "article" ? (
          <section className="passage-section" aria-labelledby="passage-heading">
            <p className="section-label" id="passage-heading">Captured passage</p>
            <blockquote>{annotation.selectedText}</blockquote>
          </section>
        ) : (
          <section className="clip-range-section" aria-labelledby="clip-range-heading">
            <p className="section-label" id="clip-range-heading">Saved clip</p>
            <strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong>
            <span>{formatMediaTime(annotation.endMs - annotation.startMs)} long</span>
          </section>
        )}

        <section className="commentary-section" aria-labelledby="commentary-heading">
          <p className="section-label">Commentary</p>
          <h2 id="commentary-heading">The annotation</h2>
          <p className="commentary-text">{annotation.commentaryText}</p>
        </section>

        {annotation.audio && (
          <PublishedAudioPlayer
            publicUrl={annotation.audio.publicUrl}
            durationMs={annotation.audio.durationMs}
          />
        )}

        <CommentsSection
          key={
            comments.status === "available"
              ? `${comments.page.total}:${comments.page.comments.map((comment) => comment.id).join(",")}`
              : "unavailable"
          }
          annotationId={annotation.id}
          currentUserId={currentUserId}
          initialPage={comments.status === "available" ? comments.page : null}
        />
        <ClaimForm annotationId={annotation.id} />
      </article>
      </main>
    </>
  );
}
