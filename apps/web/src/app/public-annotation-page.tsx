import Link from "next/link";
import { formatMediaTime } from "@annotated/shared/media-time";
import { getYouTubeTimestampUrl } from "@annotated/shared/youtube";
import type { PublicAnnotation } from "@/lib/data/public-annotation-model";
import { getInitial } from "@/lib/public-content";
import { getPublicAnnotationPath } from "@/lib/public-routes";
import {
  getCurrentUserFollowState,
  getCurrentUserId,
  getProfileSocialCounts,
  getPublicAnnotationComments,
} from "@/lib/data/social";
import { ClaimForm } from "./a/[annotationId]/claim-form";
import { CommentsSection } from "./a/[annotationId]/comments-section";
import { PublishedAudioPlayer } from "./a/[annotationId]/published-audio-player";
import { FollowButton } from "./follow-button";
import { HostedMediaPlayer } from "./hosted-media-player";
import { SiteHeader } from "./site-header";

function getDurationDateTime(durationMs: number): string {
  return `PT${durationMs / 1_000}S`;
}

export async function PublicAnnotationPage({ annotation }: { annotation: PublicAnnotation }) {
  const currentUserId = await getCurrentUserId();
  const [socialCounts, isFollowing, comments] = await Promise.all([
    getProfileSocialCounts(annotation.annotator.id),
    getCurrentUserFollowState(annotation.annotator.id, currentUserId),
    getPublicAnnotationComments(annotation.id),
  ]);
  const publicPath = getPublicAnnotationPath(annotation.route, annotation.id);
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const isVideo = annotation.kind === "video_legacy" ||
    annotation.kind === "video_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "video");
  const isAudio = annotation.kind === "audio_legacy" ||
    annotation.kind === "audio_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "audio");
  const isHosted = annotation.kind === "video_hosted" || annotation.kind === "audio_hosted";
  let sourceUrl = annotation.source.canonicalUrl;
  if (
    annotation.kind === "video_legacy" ||
    annotation.kind === "video_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "video")
  ) sourceUrl = getYouTubeTimestampUrl(annotation.source.canonicalUrl, annotation.startMs);
  const publicationDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(annotation.publishedAt));

  return (
    <>
      <SiteHeader returnTo={publicPath} />
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
                {annotation.route && <p className="creator-handle">@{annotation.route.creatorHandle}</p>}
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
                returnTo={publicPath}
              />
            </div>
          </header>

          <section className="source-attribution" aria-labelledby="source-heading">
            <div className="source-copy">
              <p className="section-label">{isVideo ? "YouTube source" : isAudio ? "Podcast / web audio" : "Original article"}</p>
              <h1 id="source-heading">{sourceTitle}</h1>
              {(annotation.source.showName || annotation.source.author || annotation.source.publisher) && (
                <p className="source-byline">
                  {annotation.source.showName && isAudio && `${annotation.source.showName} · `}
                  {annotation.source.author && `${annotation.kind === "article" ? "By " : ""}${annotation.source.author}`}
                  {annotation.source.author && annotation.source.publisher && " · "}
                  {annotation.source.publisher}
                </p>
              )}
              <p className="source-hostname">{annotation.source.hostname}</p>
            </div>
            <a className="public-button public-button-primary source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              {isVideo ? "Open clip on YouTube" : isAudio ? "Open original source" : "View original source"}
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

          {isHosted && (
            <HostedMediaPlayer annotationId={annotation.id} media={annotation.media} />
          )}

          {annotation.kind === "media_removed" && (
            <section className="media-removed-section" aria-labelledby="media-removed-heading">
              <p className="section-label">Archived excerpt</p>
              <h2 id="media-removed-heading">Excerpt unavailable</h2>
              <p>
                This archived excerpt is no longer available. The annotation and original source remain accessible.
              </p>
            </section>
          )}

          {isHosted && (
            <section className="transcript-section" aria-labelledby="transcript-heading">
              <p className="section-label">Excerpt transcript</p>
              <h2 id="transcript-heading">Transcript</h2>
              <p className="transcript-text">{annotation.transcript.text}</p>
              {annotation.transcript.segments && annotation.transcript.segments.length > 0 && (
                <ol className="transcript-segments" aria-label="Timestamped excerpt transcript">
                  {annotation.transcript.segments.map((segment) => (
                    <li key={`${segment.startMs}:${segment.endMs}`}>
                      <span>
                        <time dateTime={getDurationDateTime(segment.startMs)}>{formatMediaTime(segment.startMs)}</time>
                        {"–"}
                        <time dateTime={getDurationDateTime(segment.endMs)}>{formatMediaTime(segment.endMs)}</time>
                      </span>
                      <p>{segment.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section className="commentary-section" aria-labelledby="commentary-heading">
            <p className="section-label">Commentary</p>
            <h2 id="commentary-heading">The annotation</h2>
            <p className="commentary-text">{annotation.commentaryText}</p>
          </section>

          {annotation.kind === "article" && annotation.audio && (
            <PublishedAudioPlayer publicUrl={annotation.audio.publicUrl} durationMs={annotation.audio.durationMs} />
          )}

          <CommentsSection
            key={comments.status === "available" ? `${comments.page.total}:${comments.page.comments.map((comment) => comment.id).join(",")}` : "unavailable"}
            annotationId={annotation.id}
            currentUserId={currentUserId}
            initialPage={comments.status === "available" ? comments.page : null}
            returnTo={`${publicPath}#comments`}
          />
          <ClaimForm annotationId={annotation.id} />
        </article>
      </main>
    </>
  );
}
