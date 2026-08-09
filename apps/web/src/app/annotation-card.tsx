import Link from "next/link";
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
        <p className="section-label">Source</p>
        <h2 id={headingId}>
          <Link href={`/a/${annotation.id}`}>{sourceTitle}</Link>
        </h2>
        {(annotation.source.author || annotation.source.publisher) && (
          <p className="card-byline">
            {annotation.source.author && `By ${annotation.source.author}`}
            {annotation.source.author && annotation.source.publisher && " · "}
            {annotation.source.publisher}
          </p>
        )}
        <p className="card-hostname">{annotation.source.hostname}</p>
      </div>

      <section className="card-passage" aria-label="Captured passage excerpt">
        <blockquote>{truncateExcerpt(annotation.selectedText, PASSAGE_EXCERPT_LENGTH)}</blockquote>
      </section>

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
        <a href={annotation.source.canonicalUrl} target="_blank" rel="noopener noreferrer">
          View original source <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </article>
  );
}
