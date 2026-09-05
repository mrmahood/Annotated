"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMediaTime } from "@annotated/shared/media-time";
import { getYouTubeTimestampUrl } from "@annotated/shared/youtube";
import type { PublicAnnotationCardData } from "@/lib/data/public-discovery";
import { getInitial, truncateExcerpt } from "@/lib/public-content";
import { getPublicAnnotationPath } from "@/lib/public-routes";
import { HostedMediaPlayer } from "./hosted-media-player";

const PASSAGE_EXCERPT_LENGTH = 360;
const COMMENTARY_EXCERPT_LENGTH = 280;

function sourceChipLabel(kind: PublicAnnotationCardData["kind"]): string {
  if (kind === "youtube" || kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  return "Text";
}

function hostedClipMedia(annotation: PublicAnnotationCardData) {
  if (annotation.kind !== "youtube" && annotation.kind !== "video" && annotation.kind !== "audio") return null;
  return {
    mimeType: annotation.kind === "audio" ? "audio/mp4" as const : "video/mp4" as const,
    durationMs: annotation.endMs - annotation.startMs,
    width: null,
    height: null,
  };
}

export function AnnotationCard({
  annotation,
  showCreator = true,
}: {
  annotation: PublicAnnotationCardData;
  showCreator?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const sourceUrl = annotation.kind === "youtube"
    ? getYouTubeTimestampUrl(annotation.source.canonicalUrl, annotation.startMs)
    : annotation.source.canonicalUrl;
  const headingId = `annotation-${annotation.id}`;
  const publicationDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(annotation.publishedAt));
  const detailPath = getPublicAnnotationPath(annotation.route, annotation.id);
  const hasPassage = annotation.kind === "article";
  const hasClip = annotation.kind === "youtube" || annotation.kind === "video" || annotation.kind === "audio";
  const clipMedia = hostedClipMedia(annotation);
  const passageText = hasPassage
    ? expanded
      ? annotation.selectedText
      : truncateExcerpt(annotation.selectedText, PASSAGE_EXCERPT_LENGTH)
    : null;

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
          <time dateTime={annotation.publishedAt}>{publicationDate}</time>
        </p>
      </header>

      <div className="card-body">
        <p className="card-commentary-lead" id={headingId}>
          {truncateExcerpt(annotation.commentaryText, COMMENTARY_EXCERPT_LENGTH)}
        </p>

        <div className="card-nested-source">
          <button
            className="card-nested-source-body"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="source-chip-row">
              <span className="source-chip">{sourceChipLabel(annotation.kind)}</span>
              <span className="card-nested-title">{sourceTitle}</span>
            </span>
            <span className="card-hostname">{annotation.source.hostname}</span>
            {hasPassage && passageText && (
              <span className={`card-passage-excerpt${expanded ? " expanded" : ""}`}>
                {passageText}
              </span>
            )}
            {hasClip && (
              <span className={`card-clip-range${expanded ? " expanded" : ""}`}>
                {formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}
                {expanded && <> · {formatMediaTime(annotation.endMs - annotation.startMs)}</>}
              </span>
            )}
          </button>
          {expanded && clipMedia && (
            <HostedMediaPlayer annotationId={annotation.id} media={clipMedia} compact />
          )}
          <a className="open-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
            Open source <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <footer className="card-actions">
        <div className="card-internal-actions">
          <Link className="card-detail-link" href={detailPath}>
            View annotation
          </Link>
          <Link href={`${detailPath}#comments`}>
            {annotation.commentCount.toLocaleString()} {annotation.commentCount === 1 ? "comment" : "comments"}
          </Link>
        </div>
      </footer>
    </article>
  );
}
