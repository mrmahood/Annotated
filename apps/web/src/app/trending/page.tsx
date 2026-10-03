import type { Metadata } from "next";
import { AnnotationCard } from "../annotation-card";
import { JsonLd } from "../json-ld";
import { SiteHeader } from "../site-header";
import { feedItemKey, getTrendingFeedItems } from "@/lib/data/public-discovery";
import { getCurrentUserId } from "@/lib/data/social";
import {
  getPublicPageStructuredData,
  TRENDING_HEADING,
  TRENDING_LEDE,
  TRENDING_PATH,
} from "@/lib/discoverability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What’s Trending | Annotated",
  description: "A 7-day ranking of published annotations, one card per author.",
  alternates: { canonical: TRENDING_PATH },
};

export default async function TrendingPage() {
  const [trending, currentUserId] = await Promise.all([
    getTrendingFeedItems(),
    getCurrentUserId(),
  ]);
  const returnTo = "/trending";

  return (
    <>
      <JsonLd data={getPublicPageStructuredData(TRENDING_PATH)} />
      <SiteHeader active="trending" returnTo={returnTo} />
      <main className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">WHAT’S TRENDING</p>
          <h1>{TRENDING_HEADING}</h1>
          <p className="lede">{TRENDING_LEDE}</p>
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
