import type { Metadata } from "next";
import { AnnotationCard } from "../annotation-card";
import { SiteHeader } from "../site-header";
import { feedItemKey, getTrendingFeedItems } from "@/lib/data/public-discovery";
import { getCurrentUserId } from "@/lib/data/social";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What’s Trending | Annotated",
  description: "A 7-day ranking of published annotations, one card per author.",
};

export default async function TrendingPage() {
  const [trending, currentUserId] = await Promise.all([
    getTrendingFeedItems(),
    getCurrentUserId(),
  ]);
  const returnTo = "/trending";

  return (
    <>
      <SiteHeader active="trending" returnTo={returnTo} />
      <main className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">WHAT’S TRENDING</p>
          <h1>This week’s most active annotations.</h1>
          <p className="lede">
            Ranked over the last 7 days from comments, unique commenters,
            follows on the author, reshares, and recency. One card per author.
            There is no view count in this ranking.
          </p>
        </header>

        {trending.status === "unavailable" ? (
          <section className="discovery-state discovery-error" role="alert">
            <h2>Trending is temporarily unavailable.</h2>
            <p>Please try again in a little while.</p>
          </section>
        ) : !trending.visible ? (
          <section className="discovery-state">
            <h2>Not enough trending activity yet.</h2>
            <p>
              Trending appears when at least two published annotations score
              in the current 7-day window.
            </p>
          </section>
        ) : (
          <div className="annotation-list" aria-label="Trending annotations">
            {trending.items.map((item) => (
              <AnnotationCard
                key={feedItemKey(item)}
                annotation={item.annotation}
                currentUserId={currentUserId}
                initialShared={item.viewerHasReshared}
                initialBookmarked={item.viewerHasBookmarked}
                returnTo={returnTo}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
