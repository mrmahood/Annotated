import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnnotationCard } from "./annotation-card";
import { PaginationNav } from "./pagination-nav";
import { SiteHeader } from "./site-header";
import { TrendingStrip } from "./trending-strip";
import { feedItemKey, getPublicFeedPage, getTrendingFeedItems } from "@/lib/data/public-discovery";
import { getCurrentUserId } from "@/lib/data/social";
import {
  getPageHref,
  isCanonicalPageQuery,
  parsePageQuery,
} from "@/lib/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public annotation feed | Annotated",
  description: "Discover source-linked annotations published by Annotated readers.",
};

type HomePageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const { page: pageQuery } = await searchParams;
  const page = parsePageQuery(pageQuery);

  if (!isCanonicalPageQuery(pageQuery)) {
    redirect(getPageHref("/", page));
  }

  const [feed, currentUserId, trending] = await Promise.all([
    getPublicFeedPage(page),
    getCurrentUserId(),
    page === 1 ? getTrendingFeedItems() : Promise.resolve(null),
  ]);
  const returnTo = getPageHref("/", page);
  const trendingStrip = trending?.status === "available" && trending.visible
    ? trending.items
    : null;

  return (
    <>
      <SiteHeader active="feed" returnTo={returnTo} />
      <main className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">PUBLIC ANNOTATIONS</p>
          <h1>Reading, connected to its sources.</h1>
          <p className="lede">
            Explore passages readers found worth keeping, alongside their commentary
            and the original work in context.
          </p>
        </header>

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
      </main>
    </>
  );
}
