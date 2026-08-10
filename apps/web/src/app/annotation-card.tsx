import Link from "next/link";
import { formatMediaTime } from "@annotated/shared/media-time";
import { getYouTubeTimestampUrl } from "@annotated/shared/youtube";
import type { PublicAnnotationCardData } from "@/lib/data/public-discovery";
import { getInitial, truncateExcerpt } from "@/lib/public-content";

const PASSAGE_EXCERPT_LENGTH = 360;
const COMMENTARY_EXCERPT_LENGTH = 280;

export function AnnotationCard({
  annotation,
  showCreator = true,
}: {
  annotation: PublicAnnotationCardData;
  showCreator?: boolean;
}) {
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const sourceUrl = annotation.kind === "youtube"
    ? getYouTubeTimestampUrl(annotation.source.canonicalUrl, annotation.startMs)
    : annotation.source.canonicalUrl;
  const sourceLabel = annotation.kind === "youtube"
    ? "YouTube video"
    : annotation.kind === "audio"
      ? "Podcast / web audio"
      : "Source";
  const sourceAttribution = annotation.kind === "audio"
    ? [annotation.source.showName, annotation.source.author, annotation.source.publisher].filter(Boolean).join(" · ")
    : [
        annotation.source.author && `${annotation.kind === "article" ? "By " : ""}${annotation.source.author}`,
        annotation.source.publisher,
      ].filter(Boolean).join(" · ");
  const headingId = `annotation-${annotation.id}`;
  const publicationDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(annotation.publishedAt));

  return (
    <article className="annotation-card" aria-labelledby={headingId}>
      <header className="card-header">
        {showCreator && (
          <Link className="card-creator" href={`/p/${annotation.annotator.id}`}>
            {annotation.annotator.avatarUrl ? (
              // External avatar hosts vary, and URLs are restricted to HTTP(S).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="card-avatar"
                src={annotation.annotator.avatarUrl}
                alt=""
                width="40"
                height="40"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="card-avatar public-avatar-fallback" aria-hidden="true">
                {getInitial(annotation.annotator.displayName)}
              </span>
            )}
            <span>{annotation.annotator.displayName}</span>
          </Link>
        )}
        <p className="card-date">
          Published <time dateTime={annotation.publishedAt}>{publicationDate}</time>
        </p>
      </header>

      <div className="card-source">
        <p className="section-label">{sourceLabel}</p>
        <h2 id={headingId}>
          <Link href={`/a/${annotation.id}`}>{sourceTitle}</Link>
        </h2>
        {sourceAttribution && <p className="card-byline">{sourceAttribution}</p>}
        <p className="card-hostname">{annotation.source.hostname}</p>
      </div>

      {annotation.kind === "article" ? (
        <section className="card-passage" aria-label="Captured passage excerpt">
          <blockquote>{truncateExcerpt(annotation.selectedText, PASSAGE_EXCERPT_LENGTH)}</blockquote>
        </section>
      ) : (
        <section className="card-clip-range" aria-label={`${sourceLabel} clip time range`}>
          <p className="section-label">Clip</p>
          <strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong>
        </section>
      )}

      <section className="card-commentary" aria-label="Commentary excerpt">
        <p className="section-label">Commentary</p>
        <p>{truncateExcerpt(annotation.commentaryText, COMMENTARY_EXCERPT_LENGTH)}</p>
      </section>

      <footer className="card-actions">
        <div className="card-internal-actions">
          <Link className="card-detail-link" href={`/a/${annotation.id}`}>
            View annotation
          </Link>
          <Link href={`/a/${annotation.id}#comments`}>
            {annotation.commentCount.toLocaleString()} {annotation.commentCount === 1 ? "comment" : "comments"}
          </Link>
        </div>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          {annotation.kind === "youtube" ? "Open clip on YouTube" : annotation.kind === "audio" ? "Open episode" : "View original source"} <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </article>
  );
}
