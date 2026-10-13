import Link from "next/link";
import { formatMediaTime } from "@annotated/shared/media-time";
import { getYouTubeTimestampUrl } from "@annotated/shared/youtube";
import type { PublicAnnotation } from "@/lib/data/public-annotation-model";
import { getInitial } from "@/lib/public-content";
import { getConfiguredSiteOrigin, getPublicAnnotationPath } from "@/lib/public-routes";
import {
  getCurrentUserFollowState,
  getCurrentUserId,
  getCurrentUserBookmarkState,
  getCurrentUserReshareState,
  getProfileSocialCounts,
  getPublicAnnotationComments,
} from "@/lib/data/social";
import { getAnnotationVoteSnapshot } from "@/lib/data/voting";
import { getAnnotationConsensus } from "@/lib/data/annotation-consensus";
import { AnnotationNoteLive } from "@/components/annotation-note/annotation-note-live";
import { ClaimForm } from "./a/[annotationId]/claim-form";
import { CommentsSection } from "./a/[annotationId]/comments-section";
import { PostToXButton } from "./post-to-x";
import { PublishedAudioPlayer } from "./published-audio-player";
import { FollowButton } from "./follow-button";
import { HostedMediaPlayer } from "./hosted-media-player";
import { TextWithLogoMark } from "./logo-mark";
import { SiteHeader } from "./site-header";
import { BookmarkControl } from "./bookmark-control";
import { ShareControl } from "./share-control";
import { VoteControls } from "./vote-controls";

function getDurationDateTime(durationMs: number): string {
  return `PT${durationMs / 1_000}S`;
}

export async function PublicAnnotationPage({ annotation }: { annotation: PublicAnnotation }) {
  const currentUserId = await getCurrentUserId();
  const [socialCounts, isFollowing, comments, voteSnapshot, hasReshared, hasBookmarked, consensus] = await Promise.all([
    getProfileSocialCounts(annotation.annotator.id),
    getCurrentUserFollowState(annotation.annotator.id, currentUserId),
    getPublicAnnotationComments(annotation.id),
    getAnnotationVoteSnapshot(annotation.id, currentUserId),
    getCurrentUserReshareState(annotation.id, currentUserId),
    getCurrentUserBookmarkState(annotation.id, currentUserId),
    getAnnotationConsensus(annotation.id),
  ]);
  const publicPath = getPublicAnnotationPath(annotation.route, annotation.id);
  const siteOrigin = getConfiguredSiteOrigin();
  const pageUrl = siteOrigin ? `${siteOrigin}${publicPath}` : publicPath;
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const isVideo = annotation.kind === "video_legacy" ||
    annotation.kind === "video_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "video");
  const isYouTubeVideo = isVideo && annotation.source.type === "youtube";
  const isTikTokVideo = isVideo && annotation.source.type === "tiktok";
  const isWebpageVideo = isVideo && annotation.source.type === "article";
  const isAudio = annotation.kind === "audio_legacy" ||
    annotation.kind === "audio_hosted" ||
    (annotation.kind === "media_removed" && annotation.mediaType === "audio");
  const isSpotifyEpisode = isAudio && annotation.source.type === "spotify";
  const isHosted = annotation.kind === "video_hosted" || annotation.kind === "audio_hosted";
  let sourceUrl = annotation.source.canonicalUrl;
  if (isYouTubeVideo) {
    sourceUrl = getYouTubeTimestampUrl(annotation.source.canonicalUrl, annotation.startMs);
  }
  const publicationDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(annotation.publishedAt));
  const intentText = [annotation.title, annotation.commentaryText]
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length > 0) ?? "Annotated";

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

          <AnnotationNoteLive
            annotationId={annotation.id}
            creatorId={annotation.annotator.id}
            currentUserId={currentUserId}
            noteType={annotation.noteType}
            verdict={annotation.verdict}
            agreeCount={voteSnapshot?.upvoteCount ?? consensus?.agreeCount ?? 0}
            disagreeCount={voteSnapshot?.downvoteCount ?? consensus?.disagreeCount ?? 0}
            countsAvailable={voteSnapshot !== null || consensus !== null}
            sources={consensus?.sources ?? annotation.sourceLinks.map((link) => ({
              ...link,
              helpfulCount: 0,
              viewerMarkedHelpful: false,
            }))}
          />

          {(annotation.title || annotation.commentaryText.trim() || annotation.audio) && (
            <section className="commentary-section" aria-labelledby="commentary-heading">
              {annotation.title ? (
                <h1 id="commentary-heading" className="annotation-title"><TextWithLogoMark text={annotation.title} /></h1>
              ) : (
                <h1 id="commentary-heading" className="visually-hidden">Annotation</h1>
              )}
              {annotation.commentaryText.trim() ? (
                <p className="commentary-text"><TextWithLogoMark text={annotation.commentaryText} /></p>
              ) : null}
              {annotation.audio && (
                <PublishedAudioPlayer publicUrl={annotation.audio.publicUrl} durationMs={annotation.audio.durationMs} />
              )}
            </section>
          )}

          {annotation.kind === "article" ? (
            <section className="evidence-card passage-section" aria-labelledby="passage-heading">
              <p className="visually-hidden" id="passage-heading">Captured passage</p>
              <blockquote className="highlighted-quote">{annotation.selectedText}</blockquote>
            </section>
          ) : (
            <section className="evidence-card clip-range-section" aria-labelledby="clip-range-heading">
              <p className="visually-hidden" id="clip-range-heading">Saved clip</p>
              {isHosted ? (
                <HostedMediaPlayer
                  annotationId={annotation.id}
                  media={annotation.media}
                  sourceType={annotation.source.type}
                />
              ) : (
                <div className="clip-still">
                  <strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong>
                  <span>{formatMediaTime(annotation.endMs - annotation.startMs)} long</span>
                </div>
              )}
              {isHosted && (
                <p className="clip-caption">
                  <strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong>
                  <span>{formatMediaTime(annotation.endMs - annotation.startMs)} long</span>
                </p>
              )}
            </section>
          )}

          {annotation.tweetCapture && (
            <section className="preserved-post" aria-labelledby="preserved-post-heading">
              <p className="section-label">Preserved post</p>
              <h2 id="preserved-post-heading">Post on X</h2>
              <p className="preserved-post-note">Saved with this annotation. The post stays here if it is later deleted.</p>
              {annotation.tweetCapture.screenshotUrl && (
                // The screenshot is our stored crop of the visible post, not a live embed.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="preserved-post-shot"
                  src={annotation.tweetCapture.screenshotUrl}
                  alt={`Preserved post by @${annotation.tweetCapture.authorHandle}`}
                  width={annotation.tweetCapture.screenshotWidth ?? undefined}
                  height={annotation.tweetCapture.screenshotHeight ?? undefined}
                />
              )}
              <p className="preserved-post-author">
                {annotation.tweetCapture.authorName ? `${annotation.tweetCapture.authorName} · ` : null}
                @{annotation.tweetCapture.authorHandle}
              </p>
              {annotation.tweetCapture.tweetText && <blockquote>{annotation.tweetCapture.tweetText}</blockquote>}
              <a className="public-button public-button-secondary" href={annotation.tweetCapture.statusUrl} target="_blank" rel="noopener noreferrer">
                View post on X
                <span aria-hidden="true">↗</span>
              </a>
            </section>
          )}

          {annotation.receiptSources.length > 0 && (
            <section className="receipt-sources" aria-labelledby="receipt-sources-heading">
              <p className="section-label">Receipts</p>
              <h2 id="receipt-sources-heading">Sources</h2>
              <ul className="receipt-source-list">
                {annotation.receiptSources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                    {source.publisher && <span>{source.publisher}</span>}
                    {source.origin === "ai-suggested" && <span className="ai-suggested-label">AI-suggested</span>}
                  </li>
                ))}
              </ul>
            </section>
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

          {isHosted && annotation.transcript && (
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

          <div className="permalink-slots">
            <div id="verdict-slot" className="verdict-slot" data-slot="verdict" />
            <div id="consensus-slot" className="consensus-slot" data-slot="consensus" />
          </div>

          <section className="source-attribution" aria-labelledby="source-heading">
            <div className="source-copy">
              <p className="visually-hidden">{isYouTubeVideo ? "YouTube source" : isTikTokVideo ? "TikTok source" : isWebpageVideo ? "Webpage video" : isSpotifyEpisode ? "Spotify episode" : isAudio ? "Podcast / web audio" : "Original article"}</p>
              <h2 id="source-heading">{sourceTitle}</h2>
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
              {isYouTubeVideo ? "Open clip on YouTube" : isTikTokVideo ? "Open clip on TikTok" : isSpotifyEpisode ? "Open clip on Spotify" : isAudio || isWebpageVideo ? "Open original source" : "View original source"}
              <span aria-hidden="true">↗</span>
            </a>
          </section>

          <ClaimForm annotationId={annotation.id} />
          <div className="permalink-publish">
            <PostToXButton pageUrl={pageUrl} text={intentText} />
          </div>

          <section className="share-section" id="share" aria-labelledby="share-heading">
            <ShareControl
              annotationId={annotation.id}
              currentUserId={currentUserId}
              initialShared={hasReshared}
              returnTo={publicPath}
              variant="detail"
            />
          </section>

          <section className="share-section" id="bookmark" aria-labelledby="bookmark-heading">
            <BookmarkControl
              annotationId={annotation.id}
              currentUserId={currentUserId}
              initialBookmarked={hasBookmarked}
              returnTo={publicPath}
              variant="detail"
            />
          </section>

          <VoteControls
            annotationId={annotation.id}
            creatorId={annotation.annotator.id}
            currentUserId={currentUserId}
            initialSnapshot={voteSnapshot}
            returnTo={publicPath}
          />

          <CommentsSection
            key={comments.status === "available" ? `${comments.page.total}:${comments.page.comments.map((comment) => comment.id).join(",")}` : "unavailable"}
            annotationId={annotation.id}
            currentUserId={currentUserId}
            initialPage={comments.status === "available" ? comments.page : null}
            returnTo={`${publicPath}#comments`}
          />
        </article>
      </main>
    </>
  );
}
