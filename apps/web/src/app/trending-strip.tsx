import Link from "next/link";
import { getInitial, truncateExcerpt } from "@/lib/public-content";
import type { PublicFeedItem } from "@/lib/data/public-discovery";
import { getPublicAnnotationPath } from "@/lib/public-routes";
import { TextWithLogoMark } from "./logo-mark";

const TRENDING_EXCERPT_LENGTH = 140;

export function TrendingStrip({ items }: { items: PublicFeedItem[] }) {
  return (
    <section className="trending-strip" aria-labelledby="trending-strip-heading">
      <div className="trending-strip-head">
        <div>
          <p className="eyebrow">What’s Trending</p>
          <h2 id="trending-strip-heading">Active this week</h2>
        </div>
        <Link className="trending-strip-more" href="/trending">
          Browse Trending
        </Link>
      </div>
      <ul className="trending-strip-list">
        {items.map((item) => {
          const annotation = item.annotation;
          const detailPath = getPublicAnnotationPath(annotation.route, annotation.id);
          const title = annotation.title
            ?? truncateExcerpt(annotation.commentaryText, TRENDING_EXCERPT_LENGTH);
          return (
            <li key={annotation.id}>
              <article className="trending-strip-card">
                <Link className="trending-strip-card-link" href={detailPath}>
                  <span className="trending-strip-author">
                    {annotation.annotator.avatarUrl ? (
                      // External avatar hosts vary, and URLs are restricted to HTTP(S).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="card-avatar"
                        src={annotation.annotator.avatarUrl}
                        alt=""
                        width="28"
                        height="28"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="card-avatar public-avatar-fallback" aria-hidden="true">
                        {getInitial(annotation.annotator.displayName)}
                      </span>
                    )}
                    <span>{annotation.annotator.displayName}</span>
                  </span>
                  <span className="trending-strip-title">
                    <TextWithLogoMark text={title} />
                  </span>
                  <span className="trending-strip-source">{annotation.source.hostname}</span>
                </Link>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
