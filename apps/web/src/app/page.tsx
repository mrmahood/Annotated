import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnnotationCard } from "./annotation-card";
import { JsonLd } from "./json-ld";
import { PaginationNav } from "./pagination-nav";
import { SiteHeader } from "./site-header";
import { TrendingStrip } from "./trending-strip";
import { WhoToFollowRail } from "./who-to-follow-rail";
import { feedItemKey, getPublicFeedPage, getTrendingFeedItems } from "@/lib/data/public-discovery";
import { getCurrentUserId, getWhoToFollowSuggestions } from "@/lib/data/social";
import { FEED_LEDE, FEED_PATH, getPublicPageStructuredData } from "@/lib/discoverability";
import { shouldShowWhoToFollowRail } from "@/lib/data/who-to-follow";
import {
  getPageHref,
  isCanonicalPageQuery,
  parsePageQuery,
} from "@/lib/public-content";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const { page: pageQuery } = await searchParams;
  const page = parsePageQuery(pageQuery);

  return {
    title: "Public annotation feed | Annotated",
    description: "Discover source-linked annotations published by Annotated readers.",
    alternates: { canonical: getPageHref(FEED_PATH, page) },
  };
}

export default async function Home({ searchParams }: HomePageProps) {
  const { page: pageQuery } = await searchParams;
  const page = parsePageQuery(pageQuery);

  if (!isCanonicalPageQuery(pageQuery)) {
    redirect(getPageHref("/", page));
  }

  const currentUserId = await getCurrentUserId();
  const [feed, trending, whoToFollow] = await Promise.all([
    getPublicFeedPage(page),
    page === 1 ? getTrendingFeedItems() : Promise.resolve(null),
    getWhoToFollowSuggestions(currentUserId),
  ]);
  const returnTo = getPageHref("/", page);
  const trendingStrip = trending?.status === "available" && trending.visible
    ? trending.items
    : null;
  const suggestions = whoToFollow.status === "available"
    ? whoToFollow.suggestions
    : [];
  const showWhoToFollowRail = shouldShowWhoToFollowRail(suggestions.length);

  return (
    <>
      <JsonLd data={getPublicPageStructuredData(FEED_PATH)} />
      <SiteHeader active="feed" returnTo={returnTo} />
      <main className={showWhoToFollowRail ? "discovery-main discovery-main-with-rail" : "discovery-main"}>
        <header className="discovery-intro">
          <p className="eyebrow">PUBLIC ANNOTATIONS</p>
          <p className="lede">{FEED_LEDE}</p>
        </header>

        <div className="discovery-feed-column">
          {trendingStrip ? <TrendingStrip items={trendingStrip} /> : null}

          {feed.status === "unavailable" ? (
            <section className="discovery-state discovery-error" role="alert">
              <h2>The public feed is temporarily unavailable.</h2>
              <p>Please try again in a little while.</p>
            </section>
          ) : feed.items.length === 0 ? (
            <section className="discovery-state">
              <h2>{page === 1 ? "No annotations have been published yet." : "There are no annotations on this page."}</h2>
              <p>{page === 1 ? "Published annotations will appear here." : "Use Previous to return to an earlier page."}</p>
            </section>
          ) : (
            <div className="annotation-list" aria-label="Published annotations">
              {feed.items.map((item) => (
                <AnnotationCard
                  key={feedItemKey(item)}
                  annotation={item.annotation}
                  reshare={item.reshare}
                  currentUserId={currentUserId}
                  initialShared={item.viewerHasReshared}
                  initialBookmarked={item.viewerHasBookmarked}
                  returnTo={returnTo}
                />
              ))}
            </div>
          )}

          {feed.status === "available" && (
            <PaginationNav basePath="/" page={page} hasNext={feed.hasNext} />
          )}
        </div>

        {showWhoToFollowRail ? (
          <WhoToFollowRail
            suggestions={suggestions}
            currentUserId={currentUserId}
            returnTo={returnTo}
          />
        ) : null}
      </main>
    </>
  );
}
